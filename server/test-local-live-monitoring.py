import json
import subprocess
import threading
import unittest
from unittest.mock import Mock

from local_live_monitoring import GhReadClient, LiveStore, LocalReader, make_live
from monitoring_github import GitHubUnavailable
from monitoring_models import utcnow
from fastapi.testclient import TestClient


def config():
    return {'hosts': [{'id': 'ryzen', 'name': 'Ryzen', 'sshAlias': 'host-test', 'runnerLabel': 'test-ryzen'},
                      {'id': 'intel', 'name': 'Intel', 'sshAlias': 'host-test2', 'runnerLabel': 'test-intel'}],
            'github': {'repositories': ['example/repo'], 'includeRunners': True}}


class LocalReadTests(unittest.TestCase):
    def test_job_logs_are_scoped_read_only_redacted_and_include_failure_evidence(self):
        execute=Mock(return_value=subprocess.CompletedProcess([],0,'##[error]No space left on device\ntoken=DO_NOT_SHOW',''))
        client=GhReadClient(config()['github'],execute=execute)
        result=client.job_logs('example/repo',81)
        self.assertEqual(result['failureCause']['category'],'infrastructure')
        self.assertNotIn('DO_NOT_SHOW',result['text'])
        self.assertEqual(execute.call_args.args[0][-3:],['--method','GET','/repos/example/repo/actions/jobs/81/logs'])
        for repo,job in [('other/repo',81),('example/repo',-1)]:
            with self.assertRaises(ValueError):client.job_logs(repo,job)
        self.assertEqual(execute.call_count,1)

    def test_gh_only_allows_scoped_get_and_keeps_credentials_inside_gh(self):
        execute = Mock(return_value=subprocess.CompletedProcess([], 0, '{"runners":[],"total_count":0}', ''))
        client = GhReadClient(config()['github'], execute=execute)
        client.get('/repos/example/repo/actions/runners?per_page=100')
        args = execute.call_args.args[0]
        self.assertEqual(args[:6], ['gh', 'api', '--hostname', 'github.com', '--method', 'GET'])
        for path in ['/repos/other/repo/actions/runners?per_page=100', '/repos/example/repo/actions/runners/1', '/user', 'https://example.org']:
            with self.assertRaises(GitHubUnavailable): client.get(path)
        self.assertEqual(execute.call_count, 1)

    def test_gh_failure_does_not_expose_stderr_or_treat_partial_inventory_as_complete(self):
        execute = Mock(return_value=subprocess.CompletedProcess([], 1, '', 'secret-token'))
        client = GhReadClient(config()['github'], execute=execute)
        with self.assertRaises(GitHubUnavailable) as error: client.get('/repos/example/repo/actions/runners?per_page=100')
        self.assertNotIn('secret-token', str(error.exception))
        execute.return_value = subprocess.CompletedProcess([], 0, '{"total_count":101,"runners":[]}', '')
        client.retry_at = 0
        with self.assertRaises(GitHubUnavailable): client.get('/repos/example/repo/actions/runners?per_page=100')

    def test_active_runs_outside_recent_history_and_later_completion_are_reconciled(self):
        active = True
        def execute(args, **kwargs):
            path = args[-1]
            payload = {'workflow_runs': [], 'total_count': 0}
            if path.endswith('/runs/1'):
                payload = {'id': 1, 'status': 'completed', 'conclusion': 'success'}
            elif path.endswith('status=in_progress') and active:
                payload = {'workflow_runs': [{'id': 1, 'status': 'in_progress'}], 'total_count': 1}
            return subprocess.CompletedProcess(args, 0, json.dumps(payload), '')
        client = GhReadClient(config()['github'], execute=execute)
        path = '/repos/example/repo/actions/runs?per_page=15'
        self.assertEqual(client.get(path)['workflow_runs'][0]['status'], 'in_progress')
        active = False
        self.assertEqual(client.get(path)['workflow_runs'][0]['status'], 'completed')

    def test_ssh_probe_uses_stdin_and_host_key_validation_without_remote_files(self):
        raw = {'measuredAt': utcnow().isoformat(), 'cpuPct': 1, 'memoryPct': 2, 'uptimeSeconds': 3, 'errors': [],
               'blockdevices': [{'type': 'disk', 'path': '/dev/sda', 'size': 1000, 'tran': 'usb', 'rota': True}]}
        execute = Mock(return_value=subprocess.CompletedProcess([], 0, json.dumps(raw), ''))
        store = LiveStore(config())
        try:
            reader = LocalReader(store, execute=execute)
            reader.host_once(store.hosts['ryzen'])
            args = execute.call_args.args[0]
            self.assertIn('StrictHostKeyChecking=yes', args)
            self.assertEqual(args[-1], 'LC_ALL=C python3 -B -')
            self.assertIn('def probe():', execute.call_args.kwargs['input'])
            host = store.summary()['hosts'][0]
            self.assertEqual(host['physicalDisks'][0]['kind'], 'usb')
            self.assertEqual(host['freshness'], 'fresh')
            measured = host['measuredAt']
            execute.return_value = subprocess.CompletedProcess([], 1, '', 'private failure detail')
            reader.host_once(store.hosts['ryzen'])
            result = store.summary()
            self.assertEqual(result['hosts'][0]['measuredAt'], measured)
            self.assertTrue(any('SSH' in a['message'] for a in result['alerts']))
            self.assertNotIn('private failure', json.dumps(result))
        finally: store.close()

    def test_capacity_comes_from_registered_runners_not_vm_count(self):
        class Client:
            repositories = {'example/repo'}
            runner_rows = [
                {'id': 1, 'name': 'linux', 'status': 'online', 'busy': True, 'labels': [{'name': 'test-ryzen'}]},
                {'id': 2, 'name': 'windows', 'status': 'offline', 'busy': False, 'labels': [{'name': 'test-ryzen'}]},
                {'id': 3, 'name': 'intel', 'status': 'online', 'busy': False, 'labels': [{'name': 'test-intel'}]}]
            def get(self, path): return {'runners': self.runner_rows} if '/runners?' in path else {'workflow_runs': []}
        store = LiveStore(config())
        try:
            reader = LocalReader(store, Client())
            reader.ci_once()
            result = store.summary()['ci']['servers']
            self.assertEqual([s['maxJobs'] for s in result], [2, 1])
            self.assertEqual(result[0]['available'], 0)
            self.assertEqual(result[0]['capacitySource'], 'registered-runners')
            reader.client.runner_rows = reader.client.runner_rows[1:]
            reader.ci_once()
            self.assertEqual(store.ci_summary()['servers'][0]['maxJobs'], 1)
        finally: store.close()

    def test_operations_failure_preserves_previous_data_and_marks_it_stale(self):
        cfg=config();host=cfg['hosts'][0];host['operations']={'backups':[]}
        failed=False
        observed=utcnow().isoformat()
        def execute(args,**kwargs):
            if 'remote_operations_probe' in kwargs.get('input',''):
                if failed:return subprocess.CompletedProcess(args,1,'','withheld failure')
                raw={'measuredAt':observed,'services':[{'id':'app','name':'App','kind':'docker','state':'running'}],
                     'backups':[],'logs':[],'errors':[],'logSources':[]}
            else:
                raw={'measuredAt':utcnow().isoformat(),'cpuPct':1,'memoryPct':2,'uptimeSeconds':3,'errors':[],'blockdevices':[]}
            return subprocess.CompletedProcess(args,0,json.dumps(raw),'')
        store=LiveStore(cfg)
        try:
            reader=LocalReader(store,execute=execute)
            reader.host_once(host)
            self.assertEqual(store.summary()['hosts'][0]['services'][0]['state'],'running')
            failed=True
            reader.host_once(host)
            summary=store.summary()
            self.assertEqual(summary['hosts'][0]['servicesMeasuredAt'],observed)
            self.assertEqual(summary['hosts'][0]['servicesFreshness'],'stale')
            self.assertEqual(summary['hosts'][0]['services'][0]['id'],'app')
            self.assertIn('logs',summary['collectionScope'])
        finally:store.close()

    def test_local_view_rejects_all_writes_cross_origin_and_rebinding_hosts(self):
        class Reader:
            def __init__(self, store):
                self.stop = threading.Event()
                self.client=GhReadClient(store.config['github'],execute=Mock(return_value=subprocess.CompletedProcess([],0,'Fixture job log','')))
            def start(self): pass
        app = make_live(config(), reader_factory=Reader)
        try:
            with TestClient(app, base_url='http://127.0.0.1:18765') as client:
                result = client.get('/api/admin/v1/monitoring')
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()['mode'], 'local-live')
                self.assertEqual(result.json()['collectionScope'], ['hosts', 'ci'])
                for path in ['/api/admin/v1/services/x/actions', '/api/admin/v1/local-scenario', '/hooks/github/actions', '/internal/monitoring/v1/hosts/ryzen']:
                    self.assertEqual(client.post(path, json={}).status_code, 403)
                self.assertEqual(client.get('/api/admin/v1/monitoring', headers={'Origin': 'https://external.invalid'}).status_code, 403)
                self.assertEqual(client.get('/api/admin/v1/monitoring', headers={'Host': 'external.invalid'}).status_code, 403)
                self.assertEqual(client.get('/api/admin/v1/timecard/active').status_code, 403)
                logs=client.get('/api/admin/v1/monitoring/ci/logs?repository=example/repo&jobId=81')
                self.assertEqual(logs.status_code,200)
                self.assertEqual(logs.json()['text'],'Fixture job log')
                self.assertEqual(client.get('/api/admin/v1/monitoring/ci/logs?repository=other/repo&jobId=81').status_code,404)
        finally: app.state.monitor_store.close()


if __name__ == '__main__': unittest.main()
