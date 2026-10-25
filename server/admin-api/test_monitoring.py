import copy
import datetime as dt
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import tempfile
import time
import unittest
import urllib.error
from unittest.mock import Mock

from test_app import settings, FakeBroker
from app import create_app, Settings
from fastapi.testclient import TestClient
from monitoring_models import Observation, redact, utcnow
from monitoring_store import MonitorStore
from monitoring_github import GitHubClient, GitHubMonitor, GitHubUnavailable, normalize


def observation(now=None):
    at=(now or utcnow()).isoformat()
    return {'hostId':'ryzen','measuredAt':at,'cpuPct':20,'memoryPct':30,
        'services':[{'id':'web','name':'Web','kind':'docker','state':'running','health':'healthy'}],
        'logs':[{'serviceId':'web','at':at,'message':'Authorization: Bearer TOPSECRET token=ANOTHERSECRET','level':'info'}],
        'backups':[{'id':'vrnavi','name':'Backup','role':'primary','repository':'/backup/restic','measuredAt':at,
            'status':'ok','disk':{'path':'/backup','mounted':True,'uuidMatches':True,'freeBytes':1000,'totalBytes':2000},
            'minimumFreeBytes':100,'repositoryBytes':300,'retention':{'hourly':48,'daily':30},
            'snapshots':[{'id':'a'*64,'kind':'full','complete':True,'time':at},{'id':'b'*64,'kind':'db','complete':True,'time':at},
                         {'id':'c'*64,'kind':'full','complete':False,'time':at}],
            'jobs':[{'kind':'db','phase':'idle','lastSuccessAt':at,'maxAgeHours':3},
                    {'kind':'restore','phase':'idle','lastSuccessAt':at,'snapshotId':'d'*64}]}]}


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.now=utcnow()
        self.store=MonitorStore({'hosts':[{'id':'ryzen','name':'Ryzen'}]},clock=lambda:self.now)
    def tearDown(self):self.store.close()
    def test_pending_is_not_complete_and_restore_target_is_preserved(self):
        self.store.ingest(observation(self.now))
        backup=self.store.summary()['backups'][0]
        self.assertEqual(backup['counts'],{'full':1,'db':1})
        self.assertEqual(backup['pendingCount'],1)
        self.assertEqual(backup['jobs'][1]['snapshotId'],'d'*64)
        self.assertEqual(backup['forecast']['status'],'learning')
    def test_staleness_is_computed_at_read_time(self):
        self.store.ingest(observation(self.now));self.now+=dt.timedelta(minutes=10)
        result=self.store.summary()
        self.assertEqual(result['hosts'][0]['freshness'],'stale')
        self.assertTrue(result['alerts'])
        self.assertEqual(result['backups'][0]['freshness'],'stale')
    def test_unknown_host_exists_without_a_sample(self):
        result=self.store.summary()
        self.assertEqual(result['hosts'][0]['freshness'],'unknown')
        self.assertTrue(result['alerts'])
    def test_latest_failure_does_not_erase_prior_success(self):
        raw=observation(self.now);raw['backups'][0]['jobs'][0].update(phase='failed',lastFailureAt=self.now.isoformat())
        self.store.ingest(raw);backup=self.store.summary()['backups'][0]
        self.assertTrue(backup['jobs'][0]['lastSuccessAt'])
        self.assertTrue(any('失敗' in issue for issue in backup['issues']))
    def test_mount_and_capacity_failure(self):
        raw=observation(self.now);raw['backups'][0]['disk'].update(mounted=False,uuidMatches=False,freeBytes=10)
        self.store.ingest(raw)
        issues=self.store.summary()['backups'][0]['issues']
        self.assertTrue(any('未接続' in x for x in issues));self.assertTrue(any('容量不足' in x for x in issues))
    def test_replay_and_late_data_do_not_replace_current(self):
        raw=observation(self.now);self.assertTrue(self.store.ingest(raw));self.assertFalse(self.store.ingest(raw))
        raw['measuredAt']=(self.now-dt.timedelta(seconds=1)).isoformat();self.assertFalse(self.store.ingest(raw))
    def test_wrong_host_future_and_raw_secret_fields_rejected(self):
        for change in ({'hostId':'other'},{'measuredAt':(self.now+dt.timedelta(hours=1)).isoformat()},{'password':'secret'}):
            raw={**observation(self.now),**change}
            with self.assertRaises(ValueError):self.store.ingest(raw)
    def test_logs_redacted_deduplicated_and_paginated(self):
        raw=observation(self.now);self.store.ingest(raw)
        self.now+=dt.timedelta(seconds=1);raw['measuredAt']=self.now.isoformat();self.store.ingest(raw)
        logs=self.store.logs()['items'];self.assertEqual(len(logs),1)
        self.assertNotIn('TOPSECRET',logs[0]['message']);self.assertNotIn('ANOTHERSECRET',logs[0]['message'])
        raw['logs'].append({'serviceId':'web','at':self.now.isoformat(),'message':'second','level':'error'})
        self.now+=dt.timedelta(seconds=1);raw['measuredAt']=self.now.isoformat();self.store.ingest(raw)
        first=self.store.logs(limit=1);second=self.store.logs(before=first['nextCursor'],limit=1)
        self.assertNotEqual(first['items'][0]['id'],second['items'][0]['id'])
        self.assertEqual(len(self.store.logs(level='error')['items']),1)
    def test_invalid_log_does_not_partially_commit(self):
        raw=observation(self.now);raw['logs'].append({'serviceId':'missing','at':self.now.isoformat(),'message':'bad'})
        with self.assertRaises(ValueError):self.store.ingest(raw)
        self.assertFalse(self.store.logs()['items'])
    def test_old_ci_events_cannot_resurrect_completed_job(self):
        self.store.record_ci('example/repo','job',{'id':1,'status':'completed','conclusion':'failure'})
        self.store.record_ci('example/repo','job',{'id':1,'status':'in_progress'})
        self.assertEqual(self.store.ci_summary()['jobs'][0]['status'],'completed')
    def test_rerun_can_replace_previous_attempt(self):
        self.store.record_ci('example/repo','run',{'id':1,'run_attempt':1,'status':'completed','conclusion':'failure'})
        self.store.record_ci('example/repo','run',{'id':1,'run_attempt':2,'status':'in_progress'})
        self.assertEqual(self.store.ci_summary()['runs'][0]['status'],'in_progress')
    def test_successful_latest_workflow_clears_old_failure_alert(self):
        self.store.record_ci('example/repo','run',{'id':1,'name':'CI','head_branch':'main','status':'completed','conclusion':'failure'})
        self.store.record_ci('example/repo','run',{'id':2,'name':'CI','head_branch':'main','status':'completed','conclusion':'success'})
        self.assertFalse(any(a['tab']=='ci' for a in self.store.summary()['alerts']))
    def test_replication_uses_source_id_not_timestamp_alone(self):
        self.store.hosts['intel']={'id':'intel','name':'Intel'}
        raw=observation(self.now);self.store.ingest(raw)
        replica=copy.deepcopy(raw);replica['hostId']='intel';replica['backups'][0]['role']='secondary'
        replica['backups'][0]['snapshots'][0].update(id='e'*64,sourceId='a'*64)
        self.store.ingest(replica)
        relation=self.store.summary()['backups'][1]['replication']
        self.assertEqual(relation[0]['state'],'current')
        self.now+=dt.timedelta(seconds=1);replica['measuredAt']=self.now.isoformat();replica['backups'][0]['snapshots'][0]['sourceId']=None
        self.store.ingest(replica)
        self.assertEqual(self.store.summary()['backups'][1]['replication'][0]['state'],'unverified')
    def test_fixed_archive_is_not_treated_as_a_delayed_replica(self):
        raw=observation(self.now)
        archived=copy.deepcopy(raw['backups'][0])
        archived.update(id='archive',role='archive',maxSnapshotAgeHours={},jobs=[])
        archived['snapshots']=[s for s in archived['snapshots'] if s['complete']]
        for snapshot in archived['snapshots']:snapshot['time']=(self.now-dt.timedelta(days=365)).isoformat()
        raw['backups'].append(archived);self.store.ingest(raw)
        result=self.store.summary()['backups'][1]
        self.assertEqual(result['issues'],[])
        self.assertNotIn('replication',result)
    def test_forecast_requires_real_history(self):
        with self.store.lock,self.store.db:
            for i in range(192):
                at=self.now-dt.timedelta(hours=192-i)
                self.store.db.execute('INSERT INTO capacity VALUES (?,?,?,?)',('ryzen:vrnavi',i,at.isoformat(),i*10))
        estimate=self.store.forecast('ryzen:vrnavi',10000,100)
        self.assertEqual(estimate['status'],'estimated');self.assertGreater(estimate['daysRemaining'],0)
    def test_sensitive_patterns(self):
        for raw,secret in [('password="hunter2"','hunter2'),('https://me:secret@example.com','secret'),('ghp_ABC123456','ABC123456'),('https://discord.com/api/webhooks/123/secret','123/secret')]:
            self.assertNotIn(secret,redact(raw))


class RouteTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.key=Path(self.temp.name)/'key';self.key.write_text('k'*40)
        self.store=MonitorStore({'hosts':[{'id':'ryzen','secretFile':str(self.key)}],
            'github':{'repositories':['example/repo'],'webhookSecretFile':str(self.key)}})
        self.app=create_app(settings(self.temp.name),FakeBroker(),self.store)
        self.client=TestClient(self.app)
    def tearDown(self):self.client.close();self.store.close();self.temp.cleanup()
    def signed(self,raw):
        body=json.dumps(raw).encode();stamp=str(int(time.time()))
        return body,{'X-Monitor-Timestamp':stamp,'X-Monitor-Signature':hmac.new(b'k'*40,stamp.encode()+b'.'+body,hashlib.sha256).hexdigest()}
    def webhook(self,payload,delivery='delivery-123456',signature=True):
        body=json.dumps(payload).encode()
        headers={'X-GitHub-Event':'workflow_run','X-GitHub-Delivery':delivery,
            'X-Hub-Signature-256':'sha256='+hmac.new(b'k'*40,body,hashlib.sha256).hexdigest() if signature else 'invalid'}
        return self.client.post('/hooks/github/actions',content=body,headers=headers)
    def test_signed_collection_replay_and_bad_signature(self):
        body,headers=self.signed(observation())
        response=self.client.post('/internal/monitoring/v1/hosts/ryzen',content=body,headers=headers)
        self.assertEqual(response.status_code,200);self.assertTrue(response.json()['accepted'])
        self.assertFalse(self.client.post('/internal/monitoring/v1/hosts/ryzen',content=body,headers=headers).json()['accepted'])
        self.assertEqual(self.client.post('/internal/monitoring/v1/hosts/ryzen',content=body,headers={**headers,'X-Monitor-Signature':'bad'}).status_code,403)
    def test_collector_key_cannot_impersonate_another_host(self):
        body,headers=self.signed({**observation(),'hostId':'intel'})
        self.assertEqual(self.client.post('/internal/monitoring/v1/hosts/ryzen',content=body,headers=headers).status_code,400)
    def test_webhook_signature_allowlist_and_duplicate(self):
        payload={'repository':{'full_name':'example/repo'},'workflow_run':{'id':123,'status':'in_progress','name':'CI'}}
        self.assertEqual(self.webhook(payload,signature=False).status_code,403)
        self.assertTrue(self.webhook(payload).json()['accepted']);self.assertTrue(self.webhook(payload).json()['duplicate'])
        payload['repository']['full_name']='other/repo'
        self.assertEqual(self.webhook(payload,delivery='different-12345').status_code,403)
    def test_overlarge_payload_is_rejected(self):
        self.assertEqual(self.client.post('/hooks/github/actions',content=b'x'*2_000_001).status_code,413)
    def test_missing_auth_denied_and_no_demo_in_production(self):
        prod=settings(self.temp.name)
        prod=Settings(**{**prod.__dict__,'app_env':'production','test_auth_email':None})
        client=TestClient(create_app(prod,FakeBroker(),self.store))
        for path in ['/api/admin/v1/monitoring','/api/admin/v1/monitoring/logs','/api/admin/v1/monitoring/ci/logs?repository=example/repo&jobId=1']:
            self.assertEqual(client.get(path).status_code,403)
        self.assertEqual(client.post('/api/admin/v1/local-scenario').status_code,404)
        self.assertEqual(client.get('/api/server-status.json').status_code,404)
        client.close()
    def test_read_routes_no_store_and_query_bounds(self):
        response=self.client.get('/api/admin/v1/monitoring')
        self.assertIn('no-store',response.headers['cache-control'])
        self.assertEqual(self.client.get('/api/admin/v1/monitoring/logs?limit=501').status_code,422)
        self.assertEqual(self.client.get('/api/admin/v1/monitoring/logs?since=not-a-date').status_code,400)
        self.assertEqual(self.client.get('/api/admin/v1/monitoring/ci/logs?repository=other/repo&jobId=1').status_code,404)
        self.assertEqual(self.client.get('/api/admin/v1/monitoring/ci/logs?repository=example/repo&jobId=1').status_code,503)


class GitHubTests(unittest.TestCase):
    def test_normalization_excludes_unapproved_payload_fields(self):
        value=normalize('run',{'id':1,'name':'CI','token':'SECRET','repository':{'secret':'x'},'html_url':'javascript:alert(1)'})
        self.assertNotIn('token',value);self.assertNotIn('repository',value);self.assertNotIn('html_url',value)
    def test_rate_limit_respects_retry_after_and_prevents_request(self):
        with tempfile.TemporaryDirectory() as temp:
            key=Path(temp)/'token';key.write_text('test-token')
            opener=Mock();opener.open.side_effect=urllib.error.HTTPError('https://api.github.com',429,'limited',{'Retry-After':'120'},None)
            client=GitHubClient({'repositories':['example/repo'],'tokenFile':str(key)},opener,clock=lambda:1000)
            for _ in range(2):
                with self.assertRaises(GitHubUnavailable):client.get('/repos/example/repo/actions/runs')
            self.assertEqual(opener.open.call_count,1);self.assertEqual(client.retry_at,1120)
    def test_etag_returns_cached_data(self):
        with tempfile.TemporaryDirectory() as temp:
            key=Path(temp)/'token';key.write_text('test-token')
            response=Mock();response.__enter__=Mock(return_value=response);response.__exit__=Mock(return_value=False)
            response.headers={'ETag':'test-etag'};response.read.return_value=b'{"workflow_runs":[]}'
            opener=Mock();opener.open.side_effect=[response,urllib.error.HTTPError('url',304,'same',{},None)]
            client=GitHubClient({'tokenFile':str(key)},opener)
            self.assertEqual(client.get('/a'),client.get('/a'))
            self.assertEqual(opener.open.call_args.args[0].get_header('If-none-match'),'test-etag')


if __name__=='__main__':unittest.main()
