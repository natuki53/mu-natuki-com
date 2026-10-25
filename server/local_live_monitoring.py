"""Loopback viewer for SSH / GitHub GET observations; never installs on servers."""
from contextlib import asynccontextmanager
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import threading
import time

sys.path.insert(0, str(Path(__file__).parent/'admin-api'))
# app.py creates a default app at import. These are local-only placeholders, not live credentials.
os.environ.update(ADMIN_CF_TEAM_DOMAIN='https://example.cloudflareaccess.com', ADMIN_CF_POLICY_AUD='local-preview',
    ADMIN_ALLOWED_EMAIL='local-readonly@example.invalid', ADMIN_CSRF_SECRET='local-readonly-csrf-not-for-production',
    ADMIN_BROKER_SHARED_SECRET='local-readonly-broker-not-for-production')
os.environ.pop('ADMIN_MONITOR_CONFIG', None)
from app import BrokerFailure, Settings, create_app
from starlette.responses import JSONResponse
from disk_inventory import parse_inventory
from monitoring_github import GitHubClient, GitHubMonitor, GitHubUnavailable
from monitoring_store import MonitorStore
from monitoring_models import utcnow


def run_local(args, **kwargs):
    return subprocess.run(args, capture_output=True, encoding='utf-8', errors='replace',
                          creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0), **kwargs)


class GhReadClient(GitHubClient):
    """Use gh's existing keyring session. Tokens never leave gh or enter our config."""
    expands_active_runs = True
    def __init__(self, config, execute=run_local):
        super().__init__(config)
        self.execute = execute
        self.runners_by_path = {}
        self.active_runs = {}

    @property
    def runner_rows(self):
        return [row for rows in self.runners_by_path.values() for row in rows]

    def get(self, path):
        # Only the fixed Actions and workflow-read endpoints are available to this local reader.
        allowed = any(re.fullmatch(r'/repos/'+re.escape(repo)+r'/actions/(?:runs/\d+|(?:runs(?:/\d+/jobs)?|runners)\?per_page=\d+(?:&status=(?:in_progress|queued|waiting|requested|pending))?)', path)
                      for repo in self.repositories)
        if not allowed:
            raise GitHubUnavailable('Endpoint is outside the local read scope')
        with self.lock:
            if self.clock() < self.retry_at:
                raise GitHubUnavailable('GitHub collection is waiting before retry')
            try:
                response = self.execute(['gh', 'api', '--hostname', 'github.com', '--method', 'GET', path], timeout=25)
                if response.returncode or len(response.stdout) > 2_000_000:
                    self.retry_at = self.clock() + 60
                    raise GitHubUnavailable('GitHub read failed; check gh authentication, access and rate limits')
                value = json.loads(response.stdout)
                if path.endswith('/runs?per_page=15'):
                    prefix = path.split('?')[0]
                    merged = {r['id']: r for r in value.get('workflow_runs', [])}
                    for status in ('in_progress', 'queued', 'waiting', 'requested', 'pending'):
                        active = self.get(prefix+'?per_page=100&status='+status)
                        if active.get('total_count', 0) > len(active.get('workflow_runs', [])):
                            raise GitHubUnavailable('Active run inventory exceeds collection limit')
                        merged.update({r['id']: r for r in active.get('workflow_runs', [])})
                    # Close previously active runs even after they fall out of the recent-history window.
                    for run_id in self.active_runs.get(prefix, set()) - merged.keys():
                        previous = self.get(prefix+'/'+str(run_id))
                        merged[run_id] = previous
                    self.active_runs[prefix] = {i for i, r in merged.items() if r.get('status') != 'completed'}
                    value['workflow_runs'] = list(merged.values())
                if '/runners?' in path:
                    if value.get('total_count', 0) > len(value.get('runners', [])):
                        raise GitHubUnavailable('Runner list exceeds the current collection limit')
                    self.runners_by_path[path] = value.get('runners', [])
                return value
            except (OSError, ValueError, subprocess.SubprocessError):
                raise GitHubUnavailable('GitHub CLI is unavailable') from None

    def job_logs(self, repo, job_id):
        raise GitHubUnavailable('Local live preview reads job steps; open GitHub for full logs')


class ReadOnlyBroker:
    def call(self, method, actor, params=None):
        raise BrokerFailure(403, 'This local preview exposes read-only monitoring data only')


class LiveStore(MonitorStore):
    def summary(self):
        result = super().summary()
        result['collectionScope'] = ['hosts', 'ci'] + (['services','backups','logs'] if any(h.get('operations') for h in self.hosts.values()) else [])
        result['readOnly'] = True
        result['sourceDescription'] = 'SSH / GitHub API · ' + ', '.join(self.config['github']['repositories'])
        result['ci']['workflowConstraints'] = self.config.get('workflowConstraints', [])
        result['collectionStatus'] = []
        for host in result['hosts']:
            detail = self.meta('host-probe:' + host['hostId'])
            host['machines'] = detail.get('machines', [])
            host['machinesStatus'] = detail.get('machinesStatus', 'unknown')
            result['collectionStatus'].append({'hostId':host['hostId'],'name':host['name'],
                **self.meta('operations:'+host['hostId'])})
            if self.meta('operations:'+host['hostId']).get('error'):
                host['servicesFreshness']='stale'
                for backup in result['backups']:
                    if backup['hostId']==host['hostId']:backup['freshness']='stale'
            if detail.get('error'):
                result['alerts'].append(self.alert('warning', host['hostId'], 'hosts',
                    'SSHによる取得に失敗しました。表示は前回の取得値です。', 'SSH read failed; showing previous observations.'))
            server = next((s for s in result['ci']['servers'] if s['hostId'] == host['hostId']), None)
            if server:
                known_machines = self.hosts[host['hostId']].get('machineRunners', {})
                server['machines'] = [{**m, 'runnerName': known_machines.get(m['name']),
                    'registered': (known_machines[m['name']] in [r['name'] for r in server['runners']])
                        if m['name'] in known_machines and result['ci']['runnerInventoryState'] == 'fresh' else None}
                    for m in detail.get('machines', [])]
                server['machinesFresh'] = host['freshness'] == 'fresh' and not detail.get('error')
                server['machinesMeasuredAt'] = host['measuredAt']
        return result


class LocalReader:
    def __init__(self, store, client=None, execute=run_local):
        self.store = store
        self.client = client or GhReadClient(store.config['github'])
        self.github = GitHubMonitor(store, self.client)
        self.execute = execute
        self.stop = threading.Event()
        self.threads = []
        self.operations_cache = {}
        self.backup_read_at = {}

    def operations_payload(self, host):
        root=Path(__file__).parent
        files=[('monitoring_common',root/'admin-api/monitoring_common.py'),('disk_inventory',root/'disk_inventory.py'),
               ('monitoring_collector',root/'monitoring_collector.py'),('remote_operations_probe',root/'remote_operations_probe.py')]
        # Modules execute only in memory under SSH python -B. No remote installation or credential copying.
        payload='import sys, types, json\n'
        for name,path in files:
            payload+=f"module=types.ModuleType({name!r}); module.__file__='/unused/{path.name}'; sys.modules[{name!r}]=module\n"
            payload+=f'exec(compile({path.read_text(encoding="utf-8")!r},module.__file__,"exec"),module.__dict__)\n'
        previous={b['id']:b for b in self.operations_cache.get(host['id'],{}).get('backups',[])}
        refresh=host['id'] not in self.backup_read_at or time.monotonic()-self.backup_read_at[host['id']]>=300
        payload+=f'config=json.loads({json.dumps(host["operations"])!r})\nprevious=json.loads({json.dumps(previous)!r})\n'
        payload+=f'print(json.dumps(module.collect(config,{refresh!r},previous),ensure_ascii=False))\n'
        return payload,refresh

    def operations_once(self, host):
        payload,refresh=self.operations_payload(host)
        result=self.execute(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
            '-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',host['sshAlias'],'LC_ALL=C python3 -B -'],input=payload,timeout=150)
        if result.returncode or len(result.stdout.encode('utf-8'))>2_000_000:raise ValueError('Operations read failed')
        raw=json.loads(result.stdout)
        self.operations_cache[host['id']]=raw
        if refresh and raw.get('backups') and all(b['status']=='ok' for b in raw['backups']):
            self.backup_read_at[host['id']]=time.monotonic()
        self.store.meta('operations:'+host['id'],{k:raw.get(k) for k in ['measuredAt','logSources','logsTruncated','errors']})
        return raw

    def host_once(self, host):
        alias = host['sshAlias']
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,80}', alias):
            raise ValueError('Invalid SSH alias')
        try:
            script = Path(__file__).with_name('remote_host_probe.py').read_text(encoding='utf-8')
            response = self.execute(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                '-o', 'ConnectTimeout=8', '-o', 'ServerAliveInterval=5', '-o', 'ServerAliveCountMax=2',
                alias, 'LC_ALL=C python3 -B -'], input=script, timeout=70)
            if response.returncode or len(response.stdout) > 2_000_000:
                raise ValueError('SSH read failed')
            raw = json.loads(response.stdout)
            observation = {k: raw[k] for k in ['measuredAt', 'cpuPct', 'memoryPct', 'uptimeSeconds', 'errors']}
            observation['hostId'] = host['id']
            observation['diskInventoryStatus'] = 'ok' if 'blockdevices' in raw else 'error'
            observation['physicalDisks'] = parse_inventory(raw) if 'blockdevices' in raw else []
            if host.get('operations'):
                try:
                    operations=self.operations_once(host)
                except (OSError,ValueError,KeyError,TypeError,subprocess.SubprocessError):
                    operations=self.operations_cache.get(host['id'],{})
                    old=self.store.meta('operations:'+host['id'])
                    self.store.meta('operations:'+host['id'],{**old,'error':'Operations read failed'})
                    observation['errors'].append('Operations read failed; previous observations retained')
                observation.update({key:operations.get(key,[]) for key in ['services','logs','backups']})
                observation['servicesMeasuredAt']=operations.get('measuredAt')
                observation['errors'].extend(operations.get('errors',[]))
            self.store.ingest(observation)
            self.store.meta('host-probe:' + host['id'], {'machines': raw.get('machines', []),
                'machinesStatus': raw.get('machinesStatus', 'unknown'), 'hostname': raw.get('hostname'), 'error': None})
        except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
            old = self.store.meta('host-probe:' + host['id'])
            self.store.meta('host-probe:' + host['id'], {**old, 'error': 'SSH read failed'})

    def ci_once(self):
        self.github.reconcile()
        meta = self.store.meta('ci-runners')
        if meta.get('error') or not meta.get('measuredAt'):
            return
        mappings = {}
        for host_id, host in self.store.hosts.items():
            names = sorted({r['name'] for r in self.client.runner_rows if host.get('runnerLabel') in
                [label.get('name') for label in r.get('labels', [])] or r['name'] in host.get('directRunnerNames', [])})
            mappings[host_id] = {'maxJobs': len(names) or None, 'runnerNames': names,
                'runnerPurposes': {r['name']: 'private-test' for r in self.client.runner_rows if
                    'vrcosme-private-test' in [label.get('name') for label in r.get('labels', [])]},
                'capacitySource': 'registered-runners', 'capacityObservedAt': meta['measuredAt']}
        with self.store.lock:
            self.store.config['github']['runnerHosts'] = mappings

    def start(self):
        tasks = [(lambda h=host: self.host_once(h), 30) for host in self.store.hosts.values()] + [(self.ci_once, 60)]
        for task, interval in tasks:
            def loop(fn=task, seconds=interval):
                while not self.stop.is_set():
                    try:
                        fn()
                    except Exception:
                        # Never expose subprocess output or credential diagnostics through the viewer.
                        pass
                    self.stop.wait(seconds)
            thread = threading.Thread(target=loop, daemon=True)
            thread.start()
            self.threads.append(thread)


def make_live(config, reader_factory=LocalReader):
    store = LiveStore({**config, 'mode': 'local-live', 'staleAfterSeconds': 120})
    settings = Settings(team_domain='https://example.cloudflareaccess.com', policy_audience='local-preview',
        allowed_email='local-readonly@example.invalid', admin_origin='http://127.0.0.1:4178',
        csrf_secret=secrets.token_urlsafe(32), broker_secret=secrets.token_urlsafe(32),
        broker_socket='/unused', public_status_dir='/unused', app_env='test', test_auth_email='local-readonly@example.invalid')
    app = create_app(settings, ReadOnlyBroker(), store)
    reader = reader_factory(store)
    app.state.local_reader = reader
    original = app.router.lifespan_context

    @asynccontextmanager
    async def lifespan(application):
        async with original(application):
            reader.start()
            try:
                yield
            finally:
                reader.stop.set()
    app.router.lifespan_context = lifespan

    @app.middleware('http')
    async def local_read_only(request, call_next):
        if request.headers.get('host') not in ('127.0.0.1:18765', 'localhost:18765', '127.0.0.1:4178', 'localhost:4178'):
            return JSONResponse({'detail': 'Loopback host required'}, status_code=403)
        if request.headers.get('origin') not in (None, 'http://127.0.0.1:4178', 'http://localhost:4178'):
            return JSONResponse({'detail': 'Local origin required'}, status_code=403)
        if request.method not in ('GET', 'HEAD', 'OPTIONS'):
            return JSONResponse({'detail': 'Local live monitoring is read-only'}, status_code=403)
        return await call_next(request)
    return app


if __name__ == '__main__':
    import argparse
    import uvicorn
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    # No token file or remote broker is accepted by this launcher.
    if config.get('github', {}).get('tokenFile'):
        raise SystemExit('Use the existing gh keyring login; tokenFile is not supported here')
    uvicorn.run(make_live(config), host='127.0.0.1', port=18765, log_level='warning')
