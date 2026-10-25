"""Private local observation store. No host operations or credentials in API responses."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sqlite3
import threading
from pathlib import Path

from monitoring_models import Observation, redact, timestamp, utcnow
from monitoring_ci import server_capacity


class MonitorStore:
    def __init__(self, config=None, clock=utcnow):
        self.config = config or {}
        self.clock = clock
        self.hosts = {h['id']: h for h in self.config.get('hosts', [])}
        self.lock = threading.RLock()
        path = self.config.get('database', ':memory:')
        if path != ':memory:':
            Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS hosts (id TEXT PRIMARY KEY, measured TEXT, data TEXT);
            CREATE TABLE IF NOT EXISTS logs (id INTEGER PRIMARY KEY, fingerprint TEXT UNIQUE, host TEXT, service TEXT, at TEXT, level TEXT, message TEXT);
            CREATE INDEX IF NOT EXISTS logs_filter ON logs(host, service, at);
            CREATE TABLE IF NOT EXISTS capacity (backup TEXT, bucket INTEGER, at TEXT, bytes INTEGER, PRIMARY KEY(backup,bucket));
            CREATE TABLE IF NOT EXISTS ci (repo TEXT, kind TEXT, id INTEGER, data TEXT, PRIMARY KEY(repo,kind,id));
            CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, data TEXT);
            CREATE TABLE IF NOT EXISTS deliveries (id TEXT PRIMARY KEY, at TEXT);
        ''')

    def close(self):
        self.db.close()

    def meta(self, key, value=None):
        with self.lock:
            if value is not None:
                self.db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)', (key, json.dumps(value)))
                self.db.commit()
                return value
            row = self.db.execute('SELECT data FROM metadata WHERE key=?', (key,)).fetchone()
            return json.loads(row[0]) if row else {}

    def ingest(self, raw):
        observation = Observation.model_validate(raw)
        data = observation.model_dump()
        host = data['hostId']
        if host not in self.hosts:
            raise ValueError('Host is not registered')
        now = self.clock()
        measured = timestamp(data['measuredAt'])
        if abs((now-measured).total_seconds()) > 300:
            raise ValueError('Observation timestamp is outside the accepted window')
        data['measuredAt'] = measured.isoformat()
        services = {s['id'] for s in data['services']}
        if len(services) != len(data['services']):
            raise ValueError('Duplicate service IDs')
        data['errors'] = [redact(e)[:500] for e in data['errors']]
        for section in [data['services'], data['backups']]:
            for entry in section:
                if entry.get('error'): entry['error'] = redact(entry['error'])[:500]
        with self.lock, self.db:
            old = self.db.execute('SELECT measured FROM hosts WHERE id=?', (host,)).fetchone()
            if old and timestamp(old[0]) >= measured:
                return False
            for entry in data.pop('logs'):
                if entry['serviceId'] not in services:
                    raise ValueError('Log service is not registered in this observation')
                at = timestamp(entry['at'])
                if at > now + dt.timedelta(minutes=5) or at < now-dt.timedelta(days=7):
                    continue
                message = redact(entry['message'])
                fingerprint = hashlib.sha256(json.dumps([host,entry['serviceId'],entry['at'],message]).encode()).hexdigest()
                self.db.execute('INSERT OR IGNORE INTO logs(fingerprint,host,service,at,level,message) VALUES (?,?,?,?,?,?)',
                    (fingerprint,host,entry['serviceId'],at.isoformat(),entry['level'],message))
            for backup in data['backups']:
                if backup['repositoryBytes'] is not None and backup['status']=='ok' and timestamp(backup['measuredAt']):
                    at = timestamp(backup['measuredAt'])
                    if abs((now-at).total_seconds()) < 600:
                        self.db.execute('INSERT OR REPLACE INTO capacity VALUES (?,?,?,?)',
                            (host+':'+backup['id']+':'+backup['repository'],int(at.timestamp()//3600),at.isoformat(),backup['repositoryBytes']))
            self.db.execute('INSERT OR REPLACE INTO hosts VALUES (?,?,?)', (host, data['measuredAt'], json.dumps(data)))
            self.db.execute('DELETE FROM logs WHERE at<?', ((now-dt.timedelta(days=7)).isoformat(),))
            self.db.execute('DELETE FROM logs WHERE id NOT IN (SELECT id FROM logs ORDER BY id DESC LIMIT 50000)')
            self.db.execute('DELETE FROM capacity WHERE at<?', ((now-dt.timedelta(days=90)).isoformat(),))
        return True

    def logs(self, host=None, service=None, level=None, since=None, before=None, limit=200, query=None):
        clauses, values = [], []
        for col, value in [('host',host),('service',service),('level',level)]:
            if value: clauses.append(col+'=?'); values.append(value)
        if since:
            at=timestamp(since)
            if not at: raise ValueError('Invalid log start time')
            clauses.append('at>=?'); values.append(at.isoformat())
        if before: clauses.append('id<?'); values.append(before)
        if query: clauses.append('instr(lower(message),lower(?))>0'); values.append(query)
        where = ' WHERE '+' AND '.join(clauses) if clauses else ''
        with self.lock:
            rows = self.db.execute('SELECT id,host,service,at,level,message FROM logs'+where+' ORDER BY id DESC LIMIT ?', (*values,limit+1)).fetchall()
        items = [dict(row) for row in rows[:limit]]
        return {'items':items,'nextCursor':items[-1]['id'] if len(rows)>limit else None}

    def forecast(self, key, free, reserve):
        with self.lock:
            rows = self.db.execute('SELECT at,bytes FROM capacity WHERE backup=? ORDER BY bucket', (key,)).fetchall()
        if len(rows)<24 or free is None:
            return {'status':'learning','daysRemaining':None}
        days=(timestamp(rows[-1]['at'])-timestamp(rows[0]['at'])).total_seconds()/86400
        if days<7: return {'status':'learning','daysRemaining':None}
        rate=(rows[-1]['bytes']-rows[0]['bytes'])/days
        if rate<=0: return {'status':'stable','daysRemaining':None}
        return {'status':'estimated','daysRemaining':round(max(0,free-reserve)/rate,1),'bytesPerDay':round(rate),'observedDays':round(days,1)}

    def summary(self):
        now=self.clock()
        alerts, hosts, backups=[],[],[]
        with self.lock:
            records={row['id']:json.loads(row['data']) for row in self.db.execute('SELECT * FROM hosts')}
        for host_id, config in self.hosts.items():
            host=records.get(host_id, {'hostId':host_id,'measuredAt':None,'services':[],'disks':[],'backups':[],'errors':[]})
            host['name']=config.get('name',host_id)
            measured=timestamp(host.get('measuredAt'))
            age=(now-measured).total_seconds() if measured else None
            host['freshness']='unknown' if age is None else 'stale' if age>self.config.get('staleAfterSeconds',45) or age< -30 else 'fresh'
            host['ageSeconds']=round(age) if age is not None else None
            service_at=timestamp(host.get('servicesMeasuredAt') or host.get('measuredAt'))
            host['servicesFreshness']='unknown' if not service_at else 'fresh' if -30<=(now-service_at).total_seconds()<=self.config.get('staleAfterSeconds',45) else 'stale'
            if host['freshness']!='fresh':
                alerts.append(self.alert('warning',host_id,'hosts','収集データが更新されていません','Observation unavailable or stale'))
            for disk in host['disks']:
                if disk['mounted'] is False or disk['uuidMatches'] is False or disk['smart']=='failed':
                    alerts.append(self.alert('error',host_id,'hosts',disk['path']+'：ディスクの確認が必要です','Disk needs attention: '+disk['path']))
            for service in host['services']:
                if service['state']=='failed' or (service['state']=='stopped' and service.get('expectedState','running')=='running') or (service['health']=='unhealthy' and service['state'] in ('running','restarting')):
                    alerts.append({**self.alert('error',host_id,'logs',service['name']+'に異常があります',service['name']+' needs attention'), 'serviceId':service['id']})
                elif service['state']=='unknown':
                    alerts.append({**self.alert('warning',host_id,'logs',service['name']+'の状態を取得できません',service['name']+' status unavailable'),'serviceId':service['id']})
            if host.get('errors'):
                alerts.append(self.alert('warning',host_id,'hosts','一部の情報を収集できません','Some collectors failed'))
            for backup in host.pop('backups',[]):
                backup['hostId']=host_id
                stamp=timestamp(backup['measuredAt'])
                backup['freshness']='fresh' if stamp and -30<=(now-stamp).total_seconds()<=600 and host['freshness']=='fresh' else 'stale'
                backup['counts']={kind:sum(s['complete'] and s['kind']==kind for s in backup['snapshots']) for kind in ['full','db']}
                backup['inventoryAvailable']=backup['status']=='ok' or bool(backup['snapshots'])
                backup['pendingCount']=sum(not s['complete'] for s in backup['snapshots'])
                backup['snapshots'].sort(key=lambda s:timestamp(s['time']),reverse=True)
                backup['forecast']=self.forecast(host_id+':'+backup['id']+':'+backup['repository'],backup['disk']['freeBytes'],backup['minimumFreeBytes'])
                issues=[]
                if backup['pendingCount']:
                    issues.append(str(backup['pendingCount'])+'件の未完了世代があります（正常世代には含めません）')
                disk=backup['disk']
                if disk['mounted'] is False or disk['uuidMatches'] is False: issues.append('保存ディスク未接続／不一致')
                if disk['freeBytes'] is not None and disk['freeBytes']<backup['minimumFreeBytes']: issues.append('保存先の空き容量不足')
                if backup['status']!='ok': issues.append('バックアップ情報を取得できません')
                if backup['freshness']!='fresh': issues.append('バックアップ情報が古くなっています')
                for kind in ['full','db']:
                    if backup['inventoryAvailable'] and not backup['counts'][kind]: issues.append(kind+'：正常世代なし')
                    newest=next((s for s in backup['snapshots'] if s['complete'] and s['kind']==kind),None)
                    limit=backup.get('maxSnapshotAgeHours',{}).get(kind)
                    if newest and limit and (now-timestamp(newest['time'])).total_seconds()>limit*3600:
                        issues.append(kind+'：最新保存世代の期限超過')
                for job in backup['jobs']:
                    success=timestamp(job.get('lastSuccessAt'))
                    fail=timestamp(job.get('lastFailureAt'))
                    if job['phase']=='unknown':issues.append(job['kind']+'：処理状態未確認')
                    if job['phase']=='failed' or (fail and (not success or fail>success)):
                        issues.append(job['kind']+'：直近の実行が失敗')
                    if job.get('maxAgeHours') and (not success or (now-success).total_seconds()>job['maxAgeHours']*3600):
                        issues.append(job['kind']+'：成功期限超過／未確認')
                backup['issues']=issues
                for issue in issues:
                    alerts.append({**self.alert('error' if '失敗' in issue or '不足' in issue or '不一致' in issue else 'warning',host_id,'backups',backup['name']+'：'+issue,backup['name']+' needs attention'),'backupId':backup['id']})
                backups.append(backup)
            hosts.append(host)
        primary=next((b for b in backups if b['role']=='primary'),None)
        for backup in backups:
            if backup['role']!='secondary' or not primary:continue
            backup['replication']=[]
            for kind in ['full','db']:
                original=next((s for s in primary['snapshots'] if s['complete'] and s['kind']==kind),None)
                copied=next((s for s in backup['snapshots'] if s['complete'] and s['kind']==kind),None)
                state='unknown'
                lag=None
                if original and copied:
                    lag=max(0,(timestamp(original['time'])-timestamp(copied['time'])).total_seconds())
                    if primary['freshness']=='fresh' and backup['freshness']=='fresh':
                        state='current' if original['id'] in (copied['id'],copied.get('sourceId')) else 'behind' if lag>0 else 'unverified'
                backup['replication'].append({'kind':kind,'state':state,'lagSeconds':lag,
                    'sourceSnapshotId':original['id'] if original else None,'copiedSnapshotId':copied['id'] if copied else None})
        ci=self.ci_summary()
        seen_workflows=set()
        for run in ci['runs']:
            workflow=(run.get('repository'),run.get('workflow_id') or run.get('name'),run.get('head_branch'))
            if workflow in seen_workflows:continue
            seen_workflows.add(workflow)
            if run.get('conclusion') in ['failure','timed_out','action_required']:
                alerts.append({**self.alert('error',None,'ci',run.get('name','CI')+' が失敗しました',run.get('name','CI')+' failed'),'runId':run['id']})
        if ci['state'] in ['stale','error']:
            alerts.append(self.alert('warning',None,'ci','CI情報の取得が停止しています','CI updates are unavailable'))
        alerts.sort(key=lambda a:0 if a['severity']=='error' else 1)
        return {'mode':self.config.get('mode','live'),'generatedAt':now.isoformat(),'hosts':hosts,'backups':backups,'alerts':alerts,'ci':ci}

    @staticmethod
    def alert(severity,host,tab,message,message_en):
        return {'severity':severity,'hostId':host,'tab':tab,'message':message,'messageEn':message_en}

    def record_ci(self,repo,kind,item):
        item=dict(item)
        item['repository']=repo
        with self.lock, self.db:
            row=self.db.execute('SELECT data FROM ci WHERE repo=? AND kind=? AND id=?',(repo,kind,item['id'])).fetchone()
            if row:
                old=json.loads(row[0])
                if int(old.get('run_attempt',1))>int(item.get('run_attempt',1)): return
                same_attempt=int(old.get('run_attempt',1))==int(item.get('run_attempt',1))
                if same_attempt and old.get('status')=='completed' and item.get('status')!='completed': return
                old_time=timestamp(old.get('updated_at')); new_time=timestamp(item.get('updated_at'))
                if same_attempt and old_time and new_time and new_time<old_time:return
            self.db.execute('INSERT OR REPLACE INTO ci VALUES (?,?,?,?)',(repo,kind,item['id'],json.dumps(item)))
            self.db.execute("DELETE FROM ci WHERE repo=? AND kind=? AND json_extract(data,'$.status')='completed' AND id NOT IN (SELECT id FROM ci WHERE repo=? AND kind=? ORDER BY id DESC LIMIT 200)",(repo,kind,repo,kind))

    def delivery(self,delivery_id):
        with self.lock, self.db:
            self.db.execute('DELETE FROM deliveries WHERE at<?',((self.clock()-dt.timedelta(days=7)).isoformat(),))
            try:self.db.execute('INSERT INTO deliveries VALUES (?,?)',(delivery_id,self.clock().isoformat()))
            except sqlite3.IntegrityError:return False
        return True

    def ci_summary(self):
        with self.lock:
            records=[(r['kind'],json.loads(r['data'])) for r in self.db.execute('SELECT kind,data FROM ci ORDER BY id DESC')]
        status=self.meta('ci-status')
        at=timestamp(status.get('lastSuccessAt'))
        state='unconfigured' if not self.config.get('github',{}).get('repositories') else 'unknown'
        if at:state='fresh' if (self.clock()-at).total_seconds()<300 else 'stale'
        if status.get('error'):state='error'
        runner_data=self.meta('ci-runners')
        runner_at=timestamp(runner_data.get('measuredAt'))
        runner_state='unconfigured' if not runner_data.get('enabled') else 'unknown'
        if runner_at:runner_state='fresh' if (self.clock()-runner_at).total_seconds()<300 else 'stale'
        if runner_data.get('error'):runner_state='error'
        result={**status,'state':state,'runs':[data for kind,data in records if kind=='run'],
            'jobs':[data for kind,data in records if kind=='job'],'runners':runner_data.get('items',[]),
            'runnerInventoryState':runner_state,'runnersMeasuredAt':runner_data.get('measuredAt')}
        result['servers']=server_capacity(result,self.hosts,self.config.get('github',{}))
        with self.lock:
            observed = {r['id']: json.loads(r['data']) for r in self.db.execute('SELECT id,data FROM hosts')}
        for server in result['servers']:
            host = observed.get(server['hostId'], {})
            names = self.hosts[server['hostId']].get('machineRunners', {})
            registered = {r['name'] for r in server['runners']}
            server['machines'] = [{**m, 'runnerName': names.get(m['name']),
                'registered': names[m['name']] in registered if m['name'] in names and runner_state == 'fresh' else None}
                for m in host.get('machines', [])]
            at = timestamp(host.get('measuredAt'))
            server['machinesFresh'] = bool(at and host.get('machinesStatus') == 'ok' and
                -30 <= (self.clock()-at).total_seconds() <= self.config.get('staleAfterSeconds', 45))
            server['machinesMeasuredAt'] = host.get('measuredAt')
        return result
