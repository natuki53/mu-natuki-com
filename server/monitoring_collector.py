#!/usr/bin/env python3
"""Read-only Linux collector. Only explicit config targets, no shell or service mutations."""
from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import hmac
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import ssl
import subprocess
import sys
import time
import urllib.request

from disk_inventory import collect_disks

sys.path.insert(0,str(Path(__file__).parent/'admin-api'))
from monitoring_common import redact, timestamp, utcnow


def run(args,timeout=10,env=None):
    result=subprocess.run(args,capture_output=True,text=True,timeout=timeout,env=env,check=False)
    if result.returncode:raise RuntimeError('Read command failed: '+Path(args[0]).name)
    return result.stdout


def read_json(path):
    path=Path(path)
    if path.stat().st_size>2_000_000:raise ValueError('JSON input exceeds limit')
    return json.loads(path.read_text())


def iso_epoch(value):
    return dt.datetime.fromtimestamp(float(value),dt.timezone.utc).isoformat() if value else None


def systemd_time(value):
    if not value or value=='n/a':return None
    # Read systemctl with TZ=UTC and LC_ALL=C in the collector process.
    try:return dt.datetime.strptime(value,'%a %Y-%m-%d %H:%M:%S %Z').replace(tzinfo=dt.timezone.utc).isoformat()
    except ValueError:return None


def disk_info(config):
    path=config['path']
    disk={'path':path,'mounted':None,'uuidMatches':None,'smart':'unknown'}
    try:
        usage=shutil.disk_usage(path)
        disk.update(totalBytes=usage.total,usedBytes=usage.used,freeBytes=usage.free)
    except OSError:disk.update(totalBytes=None,usedBytes=None,freeBytes=None,mounted=False)
    if config.get('mountpoint'):
        try:
            fs=json.loads(run(['findmnt','--json','--mountpoint',config['mountpoint'],'--output','TARGET,UUID']))['filesystems'][0]
            disk['mounted']=fs['target']==config['mountpoint']
            disk['uuidMatches']=fs.get('uuid')==config['expectedUuid'] if config.get('expectedUuid') else None
        except (RuntimeError,ValueError,KeyError,IndexError,subprocess.TimeoutExpired):disk['mounted']=False
    if config.get('smartDevice'):
        try:
            # SMART health only. No sudo, self-test, formatting or power-state changes.
            result=subprocess.run(['smartctl','-H','-j',config['smartDevice']],capture_output=True,text=True,timeout=10)
            passed=json.loads(result.stdout).get('smart_status',{}).get('passed')
            disk['smart']='passed' if passed is True else 'failed' if passed is False else 'unknown'
        except (OSError,ValueError,subprocess.TimeoutExpired):pass
    return disk


def collect_service(config):
    name=config['target']
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,180}',name):raise ValueError('Invalid service target')
    base={'id':config['id'],'name':config.get('name',config['id']),'kind':config['kind'],'state':'unknown','health':'unknown'}
    if config['kind']=='docker':
        data=json.loads(run(['docker','inspect','--format','{{json .State}}',name]))
        base['state']={'running':'running','exited':'stopped','dead':'failed','restarting':'restarting','created':'stopped','paused':'stopped'}.get(data.get('Status'),'unknown')
        base['health']=data.get('Health',{}).get('Status','unknown')
        base['startedAt']=data.get('StartedAt')
        base['restarts']=int(run(['docker','inspect','--format','{{.RestartCount}}',name]).strip())
    elif config['kind']=='systemd':
        prefix=['systemctl']+(['--user'] if config.get('user') else [])
        output=run(prefix+['show',name,'--property=ActiveState,SubState,NRestarts,ActiveEnterTimestamp'])
        data=dict(line.split('=',1) for line in output.splitlines() if '=' in line)
        base['state']={'active':'running','inactive':'stopped','failed':'failed','activating':'restarting'}.get(data.get('ActiveState'),'unknown')
        base['startedAt']=systemd_time(data.get('ActiveEnterTimestamp'))
        base['restarts']=int(data.get('NRestarts') or 0)
    else:raise ValueError('Unsupported service kind')
    return base


def collect_logs(config):
    if not config.get('logs',False):return []
    if not re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.@:-]{0,180}',config['target']):raise ValueError('Invalid log target')
    limit=max(1,min(100,int(config.get('logLines',100))))
    if config['kind']=='docker':
        result=subprocess.run(['docker','logs','--timestamps','--tail',str(limit),'--since','168h' if config.get('includeEarlierLogs') else '5m',config['target']],capture_output=True,text=True,timeout=5)
        if result.returncode:raise RuntimeError('Log collection failed')
        lines=[]
        for line in (result.stdout+'\n'+result.stderr).splitlines():
            at,_,message=line.partition(' ')
            if timestamp(at):lines.append((at,message,None))
    else:
        args=['journalctl']+(['--user'] if config.get('user') else [])
        text=run(args+['--unit',config['target'],'--since','7 days ago' if config.get('includeEarlierLogs') else '5 minutes ago','--lines',str(limit),'--output=json','--no-pager'],timeout=5)
        lines=[]
        for line in text.splitlines():
            data=json.loads(line)
            lines.append((iso_epoch(int(data['__REALTIME_TIMESTAMP'])/1e6),str(data.get('MESSAGE','')),data.get('PRIORITY')))
    entries=[]
    in_key=False
    for at,message,priority in lines[-limit:]:
        if re.search(r'-----BEGIN [^-]*PRIVATE KEY-----',message):in_key=True
        if in_key:
            finished=bool(re.search(r'-----END [^-]*PRIVATE KEY-----',message))
            message='[REDACTED KEY]'
            if finished:in_key=False
        level='error' if priority in ['0','1','2','3'] or re.search(r'\b(error|exception|fatal|failed)\b',message,re.I) else 'warning' if priority=='4' or re.search(r'\bwarn(?:ing)?\b',message,re.I) else 'debug' if priority=='7' else 'info'
        entries.append({'serviceId':config['id'],'at':at,'level':level,'message':redact(message)[:int(config.get('logMessageLimit',8000))]})
    return entries


def job_state(root,kind,config):
    job={'kind':kind,'phase':'unknown','scheduleMode':'unknown','maxAgeHours':config.get('max_age_hours',{}).get(kind)}
    try:
        state_kind='check' if kind=='deep-check' else kind
        data=read_json(root/'state'/f'{state_kind}.json')
        if kind!='deep-check' or data.get('read_data') is True:
            job.update(lastSuccessAt=data.get('completed_at'),snapshotId=data.get('snapshot_id'),readData=data.get('read_data'))
    except (OSError,ValueError):pass
    try:
        data=dict(line.split('=',1) for line in run(['systemctl','--user','show',f'vrnavi-backup-user@{kind}.service','--property=ActiveState,Result,ExecMainExitTimestamp']).splitlines() if '=' in line)
        if data.get('ActiveState') in ['active','activating']:job['phase']='running'
        elif data.get('Result') and data['Result']!='success':
            job.update(phase='failed',lastFailureAt=systemd_time(data.get('ExecMainExitTimestamp')),error='systemd result: '+data['Result'])
        elif data.get('ActiveState')=='inactive':job['phase']='idle'
        if kind=='deep-check' and not job.get('lastSuccessAt') and data.get('Result')=='success':
            job.update(lastSuccessAt=systemd_time(data.get('ExecMainExitTimestamp')),readData=True)
    except (OSError,RuntimeError,subprocess.TimeoutExpired):pass
    try:
        timer=dict(line.split('=',1) for line in run(['systemctl','--user','show',f'vrnavi-backup-{kind}.timer','--property=LoadState,ActiveState,NextElapseUSecRealtime']).splitlines() if '=' in line)
        if timer.get('LoadState')=='loaded':
            if timer.get('ActiveState') in ('inactive','failed'):
                job['scheduleMode']='disabled'
            elif timer.get('ActiveState')=='active':
                job['nextRunAt']=systemd_time(timer.get('NextElapseUSecRealtime'))
                job['scheduleMode']='scheduled' if job['nextRunAt'] else 'after-run' if job['phase']=='running' else 'unknown'
    except (OSError,RuntimeError,subprocess.TimeoutExpired):pass
    return job


@contextlib.contextmanager
def repository_read_lock(path):
    import fcntl
    # Open only an existing lock. Never create or modify backup state.
    with Path(path).open('rb') as handle:
        fcntl.flock(handle,fcntl.LOCK_SH|fcntl.LOCK_NB)
        yield


def directory_bytes(path):
    if not Path(path).exists():return None
    try:return int(run(['du','-s','--block-size=1',str(path)],timeout=60).split()[0])
    except (RuntimeError,ValueError,subprocess.TimeoutExpired):return None


def verification_jobs(target, repository, jobs):
    """Read installed verification receipts and the actual enabled cron schedule."""
    if not target.get('verificationConfigFile'):return jobs
    kinds=('check','restore') if target['role']=='archive' else ('restore',)
    existing={j['kind']:j for j in jobs}
    try:
        script=PurePosixPath(target['verificationScript']);config=PurePosixPath(target['verificationConfigFile'])
        if not script.is_absolute() or not config.is_absolute() or '..' in script.parts or '..' in config.parts:
            raise ValueError('Invalid verification reader path')
        status=json.loads(run([sys.executable,'-B',str(script),'--config',str(config),'status'],timeout=20))
        if status.get('repository')!=repository.as_posix() or {j['kind'] for j in status['jobs']}!=set(kinds):
            raise ValueError('Verification target mismatch')
        for job in status['jobs']:
            prior=existing.get(job['kind'],{})
            for key in ('lastSuccessAt','snapshotId','readData'):
                if job.get(key) is None and prior.get(key) is not None:job[key]=prior[key]
            existing[job['kind']]={**prior,**job}
    except (KeyError,TypeError,OSError,ValueError,RuntimeError,subprocess.TimeoutExpired):
        for kind in kinds:
            existing[kind]={**existing.get(kind,{}),'kind':kind,'phase':'unknown','scheduleMode':'unknown',
                            'nextRunAt':None,'error':'Scheduled verification status unavailable'}
    return list(existing.values())


def collect_backup(target,with_repository=True,previous=None):
    role=target['role']
    receipt={}
    if role=='primary':
        config=read_json(target['configFile'])
        root=Path(config['storage_root']);repo=root/'restic'
        password=config['restic_password_file'];lock=root/'state/job.lock'
        jobs=[job_state(root,kind,config) for kind in ['full','db','check','deep-check','restore','retention']]
        retention=config['retention'];minimum=config['minimum_free_bytes']
    elif target.get('latestConfigFile'):
        config=read_json(target['latestConfigFile'])
        root=Path(config['storage_root']);repo=root/'repository'
        password=config['restic_password_file'];lock=root/'state/pull.lock'
        try:receipt=read_json(root/'state/success.json')
        except (OSError,ValueError):pass
        try:observation=read_json(root/'state/observation.json')
        except (OSError,ValueError):observation={}
        copy={'kind':'copy','phase':'unknown','scheduleMode':'unknown','maxAgeHours':0.5}
        if observation.get('status')=='ok':copy.update(phase='idle',lastSuccessAt=iso_epoch(observation.get('observed_at')))
        elif observation.get('status')=='failed':copy.update(phase='failed',lastFailureAt=iso_epoch(observation.get('observed_at')),error=redact(observation.get('error','Copy failed'))[:500])
        elif receipt.get('verified'):copy.update(phase='idle',lastSuccessAt=iso_epoch(receipt.get('success_at')))
        try:
            with repository_read_lock(root/'state/schedule.lock'):pass
        except BlockingIOError:copy['phase']='running'
        except OSError:pass
        try:
            cron=run(['crontab','-l'])
            if any(line.startswith('*/5 * * * * ') and 'latest_scheduled.py' in line and target['latestConfigFile'] in line for line in cron.splitlines()):
                copy['nextRunAt']=iso_epoch((int(time.time())//300+1)*300)
                copy['scheduleMode']='scheduled'
            else:copy['scheduleMode']='disabled'
        except (OSError,RuntimeError,subprocess.TimeoutExpired):pass
        jobs=[copy]
        if receipt.get('verified'):jobs.append({'kind':'check','phase':'idle','scheduleMode':'on-copy-change','lastSuccessAt':iso_epoch(receipt.get('success_at')),'readData':receipt.get('read_data') is True})
        try:
            restored=read_json(root/'state/restore-verification.json')
            if restored.get('verified'):jobs.append({'kind':'restore','phase':'idle','scheduleMode':'manual','lastSuccessAt':iso_epoch(restored['verified_at']),'snapshotId':restored['full_snapshot_id']})
        except (OSError,ValueError,KeyError):pass
        retention={'full':1,'db':1};minimum=config['minimum_free_bytes']
    elif role=='archive':
        root=Path(target['root']);repo=root/'repository'
        password=target['passwordFile'];lock=root/'state/job.lock'
        jobs=[];retention={};minimum=0
        try:
            checked=read_json(root/'archive-verification.json')
            if checked.get('archiveVerified'):jobs.append({'kind':'check','phase':'idle','scheduleMode':'manual','lastSuccessAt':iso_epoch(checked['verified_at']),'readData':checked.get('fullDataRead') is True})
        except (OSError,ValueError,KeyError):pass
        try:
            restored=read_json(root/'restore-verification.json')
            if restored.get('verified'):jobs.append({'kind':'restore','phase':'idle','scheduleMode':'manual','lastSuccessAt':iso_epoch(restored['verified_at']),'snapshotId':restored['full_snapshot_id']})
        except (OSError,ValueError,KeyError):pass
    else:
        root=Path(target['root']);repo=root/target.get('repositoryDirectory','repository')
        password=str(root/'private/restic-password');lock=root/'private/pull.lock'
        copy={'kind':'copy','phase':'unknown','maxAgeHours':8}
        verified=False
        for filename,key,field in [('success.json','success_at','lastSuccessAt'),('failure.json','failure_at','lastFailureAt')]:
            try:
                record=read_json(root/'records'/filename)
                copy[field]=iso_epoch(record[key])
                if filename=='success.json':verified=record.get('verified') is True
                if record.get('error'):copy['error']=redact(record['error'])[:500]
            except (OSError,ValueError,KeyError):pass
        success=timestamp(copy.get('lastSuccessAt'));failure=timestamp(copy.get('lastFailureAt'))
        copy['phase']='failed' if failure and (not success or failure>success) else 'idle' if success else 'unknown'
        jobs=[copy]
        if verified:jobs.append({'kind':'check','phase':'idle','lastSuccessAt':copy.get('lastSuccessAt'),'readData':True})
        retention=target.get('retention',{});minimum=20*1024**3
    jobs=verification_jobs(target,repo,jobs)
    disk=disk_info({'path':str(root),**target.get('disk',{})})
    base={'id':target['id'],'name':target.get('name',target['id']),'role':role,'repository':str(repo),
        'measuredAt':utcnow().isoformat(),'disk':disk,'retention':retention,'minimumFreeBytes':minimum,'jobs':jobs,'snapshots':[],'status':'unknown'}
    base['maxSnapshotAgeHours']={kind:config.get('max_age_hours',{}).get(kind,30 if kind=='full' else 3) for kind in ['full','db']} if role=='primary' else {'full':30,'db':9}
    if target.get('latestConfigFile'):base['maxSnapshotAgeHours']=config['max_age_hours']
    if role=='archive':base['maxSnapshotAgeHours']={}
    if disk.get('mounted') is False or disk.get('uuidMatches') is False:
        base.update(status='failed',error='Expected backup disk is unavailable')
        return base
    if not with_repository and previous:
        return {**previous,'jobs':jobs,'disk':disk,'retention':retention,'minimumFreeBytes':minimum,
                'maxSnapshotAgeHours':base['maxSnapshotAgeHours']}
    try:
        env={k:v for k,v in os.environ.items() if not k.startswith('RESTIC_')}
        env.update(RESTIC_REPOSITORY=str(repo),RESTIC_PASSWORD_FILE=password)
        with contextlib.ExitStack() as stack:
            stack.enter_context(repository_read_lock(lock))
            repository_lock=root/'state/repository.lock'
            if role=='primary' and repository_lock.exists():stack.enter_context(repository_read_lock(repository_lock))
            snapshots=json.loads(run([target.get('resticBinary','restic'),'--no-lock','--no-cache','snapshots','--json'],timeout=60,env=env))
            if len(snapshots)>5000:raise RuntimeError('Snapshot inventory exceeds configured display limit')
            for snap in snapshots:
                tags=snap.get('tags',[])
                if 'vrnavi' not in tags:continue
                kind='full' if 'full' in tags else 'db' if 'db' in tags else 'unknown'
                source_id=snap.get('original')
                if receipt.get('verified') and receipt.get('snapshot_ids',{}).get(kind)==snap['id']:
                    source_id=receipt.get('source_ids',{}).get(kind,source_id)
                base['snapshots'].append({'id':snap['id'],'sourceId':source_id,
                    'kind':kind,
                    'complete':'complete' in tags and 'pending' not in tags,'time':snap['time']})
            base.update(status='ok')
        # Directory sizes are metadata estimates; release the short repository lock first.
        base.update(repositoryBytes=directory_bytes(repo),workBytes=directory_bytes(root/'work'),restoreBytes=directory_bytes(root/'restore'))
    except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired):
        base.update(status='unknown',error='Repository inventory unavailable or backup maintenance is running')
        if previous:
            base.update(snapshots=previous['snapshots'],measuredAt=previous['measuredAt'])
    return base


class Collector:
    def __init__(self,config):
        self.config=config
        self.cached_backups={}
        self.backup_read_at=0

    def collect(self):
        if 'operations' in self.config:
            return self.collect_native()
        import psutil
        from monitoring_models import Observation
        c=self.config
        data={'hostId':c['hostId'],'measuredAt':utcnow().isoformat(),'cpuPct':psutil.cpu_percent(interval=0.1),
            'memoryPct':psutil.virtual_memory().percent,'uptimeSeconds':max(0,time.time()-psutil.boot_time()),
            'services':[],'disks':[],'logs':[],'backups':[],'errors':[]}
        try:
            temperatures=[t.current for group in psutil.sensors_temperatures().values() for t in group if t.current is not None]
            data['temperatureC']=max(temperatures) if temperatures else None
        except (AttributeError,OSError):pass
        for disk in c.get('disks',[]):data['disks'].append(disk_info(disk))
        if c.get('discoverDisks', True):
            try:
                data['physicalDisks'] = collect_disks(run)
                data['diskInventoryStatus'] = 'ok'
            except (OSError, ValueError, KeyError, TypeError, RuntimeError, subprocess.TimeoutExpired):
                data['physicalDisks'] = []
                data['diskInventoryStatus'] = 'error'
                data['errors'].append('Physical disk inventory unavailable')
        for service in c.get('services',[]):
            try:
                data['services'].append(collect_service(service))
            except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired):
                data['services'].append({'id':service['id'],'name':service.get('name',service['id']),'kind':service['kind'],'state':'unknown','error':'Service collection failed'})
            try:data['logs'].extend(collect_logs(service))
            except (OSError,ValueError,RuntimeError,subprocess.TimeoutExpired):data['errors'].append('Log collection unavailable: '+service['id'])
        refresh=time.monotonic()-self.backup_read_at>=max(60,c.get('backupRefreshSeconds',300))
        for backup in c.get('backups',[]):
            try:
                result=collect_backup(backup,refresh,self.cached_backups.get(backup['id']))
                data['backups'].append(result);self.cached_backups[backup['id']]=result
            except (OSError,ValueError,KeyError):data['errors'].append('Backup configuration unavailable: '+backup['id'])
        if refresh:self.backup_read_at=time.monotonic()
        data['logs']=data['logs'][-1000:]
        data['errors']=data['errors'][:20]
        return Observation.model_validate(data).model_dump()

    def collect_native(self):
        """Use the same bounded readers as the live preview, with only Python's stdlib on hosts.

        The receiving API validates the complete Observation before storing it.
        """
        from remote_host_probe import probe
        from remote_operations_probe import collect
        from disk_inventory import parse_inventory
        raw = probe()
        refresh = not self.cached_backups or time.monotonic()-self.backup_read_at >= max(60, self.config.get('backupRefreshSeconds', 300))
        operations = collect(self.config['operations'], refresh, self.cached_backups)
        self.cached_backups = {b['id']: b for b in operations['backups']}
        if refresh:
            self.backup_read_at = time.monotonic()
        return {'hostId': self.config['hostId'],
                **{k: raw[k] for k in ('measuredAt', 'cpuPct', 'memoryPct', 'uptimeSeconds')},
                'physicalDisks': parse_inventory(raw) if 'blockdevices' in raw else [],
                'diskInventoryStatus': 'ok' if 'blockdevices' in raw else 'error',
                'disks': [disk_info(d) for d in self.config.get('disks', [])],
                'machines': raw.get('machines', []), 'machinesStatus': raw.get('machinesStatus', 'unknown'),
                'servicesMeasuredAt': operations['measuredAt'],
                **{k: operations[k] for k in ('services', 'logs', 'backups')},
                'errors': (raw['errors'] + operations['errors'])[:20]}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def push(config,data):
    url=config['ingestUrl']
    parsed=urllib.parse.urlparse(url)
    if parsed.scheme!='https' and not(parsed.scheme=='http' and parsed.hostname in ('127.0.0.1','localhost','::1')):
        raise ValueError('Collector transport requires HTTPS (except loopback)')
    body=json.dumps(data,separators=(',',':')).encode()
    key=Path(config['secretFile']).read_text().strip().encode()
    if len(key)<32:raise ValueError('Collector key must contain at least 32 characters')
    stamp=str(int(time.time()))
    headers={'Content-Type':'application/json','X-Monitor-Timestamp':stamp,
        'X-Monitor-Signature':hmac.new(key,stamp.encode()+b'.'+body,hashlib.sha256).hexdigest()}
    context=ssl.create_default_context(cafile=config.get('caFile'))
    with urllib.request.build_opener(NoRedirect(),urllib.request.HTTPSHandler(context=context)).open(urllib.request.Request(url,data=body,headers=headers),timeout=15) as response:
        if response.status!=200:raise RuntimeError('Collector ingestion failed')


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',type=Path,required=True)
    parser.add_argument('--once',action='store_true')
    parser.add_argument('--stdout',action='store_true',help='Print sanitized private observations instead of sending')
    args=parser.parse_args()
    os.environ.update(TZ='UTC',LC_ALL='C')
    if hasattr(time,'tzset'):time.tzset()
    config=read_json(args.config);collector=Collector(config)
    while True:
        started=time.monotonic()
        try:
            data=collector.collect()
            if args.stdout:print(json.dumps(data,ensure_ascii=False))
            else:push(config,data)
        except Exception:
            print('Monitoring collection or delivery failed; details withheld',file=sys.stderr)
            if args.once:return 1
        if args.once:return 0
        time.sleep(max(1,max(5,config.get('intervalSeconds',10))-(time.monotonic()-started)))


if __name__=='__main__':raise SystemExit(main())
