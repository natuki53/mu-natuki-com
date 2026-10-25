"""Read-only service, bounded log and backup inventory collection using shared readers."""
import concurrent.futures
import hashlib
import json
import os
import re
import subprocess
import time

from monitoring_collector import collect_backup, collect_logs, collect_service, run
from monitoring_common import utcnow


DOCKER_FIELDS = '{{json .Name}}\t{{json .State.Status}}\t{{json .RestartCount}}\t{{json .State.StartedAt}}\t{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}'


def service_id(kind, target):
    value = kind+'.'+re.sub(r'[^a-zA-Z0-9_.-]', '-', target)
    return value if len(value) <= 80 else value[:65]+'-'+hashlib.sha256(target.encode()).hexdigest()[:12]


def collect(config, refresh_backups=True, previous_backups=None):
    os.environ.update(TZ='UTC', LC_ALL='C')
    if hasattr(time, 'tzset'): time.tzset()
    result = {'measuredAt': utcnow().isoformat(), 'services': [], 'logs': [], 'backups': [], 'errors': [],
              'logSources': [], 'logsTruncated': False}
    targets = []
    expected = set(config.get('expectedRunning', []))
    logs = set(config.get('logTargets', []))
    try:
        names = run(['docker', 'ps', '-a', '--format', '{{.Names}}']).splitlines()
        if len(names) > 80 or any(not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,180}', n) for n in names):
            raise ValueError('Container inventory exceeds limit')
        states = run(['docker', 'inspect', '--format', DOCKER_FIELDS, *names]) if names else ''
        for line in states.splitlines():
            name, state, restarts, started, health = [json.loads(v) for v in line.split('\t')]
            name = name.lstrip('/')
            target = {'id': service_id('docker',name), 'name': name, 'kind': 'docker', 'target': name,
                      'logs': name in logs, 'logLines': 30, 'logMessageLimit': 2000}
            targets.append(target)
            result['services'].append({'id':target['id'],'name':name,'kind':'docker',
                'state':{'running':'running','exited':'stopped','dead':'failed','created':'stopped','paused':'stopped','restarting':'restarting'}.get(state,'unknown'),
                'health':health or 'unknown','restarts':restarts,'startedAt':started,
                'expectedState':'running' if name in expected else 'unknown','logsEnabled':target['logs']})
        # A removed expected container is a missing target, not a healthy empty list.
        for name in sorted(expected-set(names)):
            result['services'].append({'id':service_id('docker',name),'name':name,'kind':'docker',
                'state':'unknown','expectedState':'running','logsEnabled':False,'error':'Expected container is missing'})
    except (OSError,ValueError,RuntimeError,subprocess.SubprocessError):
        result['errors'].append('Docker inventory unavailable')
        for name in sorted(expected):
            result['services'].append({'id':service_id('docker',name),'name':name,'kind':'docker','state':'unknown',
                'expectedState':'running','logsEnabled':False,'error':'Docker inventory unavailable'})
    for item in config.get('systemdServices', [])[:20]:
        target = {**item,'id':service_id('systemd',item['target']),'kind':'systemd','logLines':30,'logMessageLimit':2000}
        targets.append(target)
        try:
            result['services'].append({**collect_service(target),'expectedState':item.get('expectedState','running'),'logsEnabled':item.get('logs',False)})
        except Exception:
            result['services'].append({'id':target['id'],'name':target.get('name',target['target']),'kind':'systemd',
                'state':'unknown','expectedState':item.get('expectedState','running'),'logsEnabled':False,'error':'Unit information unavailable'})
    def read_logs(target):
        try:
            items=collect_logs(target)
            return items, {'serviceId':target['id'],'status':'ok','rows':len(items),'atLimit':len(items)>=30}
        except Exception:
            return [], {'serviceId':target['id'],'status':'error','rows':0,'atLimit':False}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for items, state in pool.map(read_logs,[t for t in targets if t.get('logs')]):
            result['logs'].extend(items)
            result['logSources'].append(state)
    result['logs'].sort(key=lambda entry:entry['at'])
    if len(result['logs']) > 1000:
        result['logs']=result['logs'][-1000:];result['logsTruncated']=True
    for target in config.get('backups', [])[:10]:
        try:
            backup=collect_backup(target,refresh_backups,(previous_backups or {}).get(target['id']))
        except Exception:
            # Retain previous snapshots with their original timestamp; never turn a read failure into zero generations.
            backup=(previous_backups or {}).get(target['id'])
            if backup: backup={**backup,'status':'unknown','error':'Backup configuration or inventory unavailable'}
            else:
                backup={'id':target['id'],'name':target.get('name',target['id']),'role':target['role'],
                    'repository':target.get('root') or target.get('configFile','unknown'),'measuredAt':result['measuredAt'],
                    'disk':{'path':'unknown'},'status':'unknown','snapshots':[],'jobs':[],
                    'error':'Backup configuration or inventory unavailable'}
        result['backups'].append(backup)
    # Keep private observations bounded before they cross SSH, even with non-ASCII log text.
    while len(json.dumps(result,ensure_ascii=False).encode()) > 1_800_000 and result['logs']:
        result['logs']=result['logs'][max(1,len(result['logs'])//10):]
        result['logsTruncated']=True
    return result
