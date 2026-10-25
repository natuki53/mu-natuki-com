import datetime as dt
import unittest

from monitoring_ci import server_capacity
from monitoring_models import utcnow
from monitoring_store import MonitorStore
from monitoring_github import GitHubMonitor, GitHubUnavailable


class CapacityTests(unittest.TestCase):
    def setUp(self):
        self.hosts = {'ryzen': {'name': 'Ryzen'}, 'intel': {'name': 'Intel'}}
        self.config = {'runnerHosts': {'ryzen': {'maxJobs': 2, 'runnerNames': ['ryzen-1', 'ryzen-2']},
                                      'intel': {'maxJobs': 1, 'runnerNames': ['intel-1']}}}
        self.ci = {'runnerInventoryState': 'fresh', 'runs': [], 'jobs': [], 'runners': [
            {'id': 1, 'name': 'ryzen-1', 'status': 'online', 'busy': True},
            {'id': 2, 'name': 'ryzen-2', 'status': 'online', 'busy': False},
            {'id': 3, 'name': 'intel-1', 'status': 'offline', 'busy': False}]}

    def result(self):
        return server_capacity(self.ci, self.hosts, self.config)

    def test_running_ready_offline_and_capacity_are_separate(self):
        ryzen, intel = self.result()
        self.assertEqual((ryzen['state'], ryzen['running'], ryzen['maxJobs'], ryzen['available']), ('running', 1, 2, 1))
        self.assertEqual((intel['state'], intel['running'], intel['available']), ('offline', 0, 0))
        self.ci['runners'][0]['busy'] = False
        self.assertEqual((self.result()[0]['state'], self.result()[0]['available']), ('idle', 2))

    def test_missing_or_stale_inventory_never_means_idle(self):
        for state in ['unknown', 'unconfigured', 'error', 'stale']:
            self.ci['runnerInventoryState'] = state
            self.assertEqual(self.result()[0]['state'], 'unknown')
            self.assertIsNone(self.result()[0]['available'])
        self.ci['runnerInventoryState'] = 'fresh'
        self.ci['runners'] = []
        self.assertEqual(self.result()[0]['unknown'], 2)

    def test_shared_runner_is_counted_once_but_ambiguous_names_are_unknown(self):
        self.ci['runners'].append({**self.ci['runners'][0], 'repository': 'owner/another'})
        self.assertEqual(self.result()[0]['running'], 1)
        self.ci['runners'][-1]['id'] = 999
        self.assertEqual(self.result()[0]['state'], 'unknown')
        self.assertIsNone(self.result()[0]['available'])

    def test_busy_flag_is_required_and_conflicting_readings_are_unknown(self):
        self.ci['runners'][1].pop('busy')
        self.assertEqual(self.result()[0]['unknown'], 1)
        self.ci['runners'].append({**self.ci['runners'][0], 'busy': False})
        self.assertEqual(self.result()[0]['unknown'], 2)

    def test_runner_assigned_to_two_hosts_is_unknown_not_double_capacity(self):
        self.config['runnerHosts']['intel']['runnerNames'].append('ryzen-1')
        self.assertTrue(all(server['state'] == 'unknown' for server in self.result()))

    def test_runner_permission_error_does_not_hide_successful_workflow_collection(self):
        class Client:
            repositories = {'owner/repo'}
            def get(self, path):
                if '/runners?' in path:
                    raise GitHubUnavailable('Permission denied')
                return {'workflow_runs': []}
        store = MonitorStore({'hosts': [{'id': k, **v} for k, v in self.hosts.items()],
                              'github': {**self.config, 'repositories': ['owner/repo'], 'includeRunners': True}})
        try:
            GitHubMonitor(store, Client()).reconcile()
            result = store.ci_summary()
            self.assertEqual(result['state'], 'fresh')
            self.assertEqual(result['runnerInventoryState'], 'error')
            self.assertTrue(all(s['available'] is None for s in result['servers']))
        finally:
            store.close()

    def test_stale_job_does_not_consume_an_idle_runner(self):
        self.ci['jobs'] = [{'repository': 'owner/repo', 'run_id': 10, 'status': 'in_progress', 'runner_name': 'ryzen-2'}]
        self.assertEqual(self.result()[0]['running'], 1)
        self.assertEqual(self.result()[0]['runners'][1]['jobs'], [])

    def test_completed_or_previous_attempt_job_is_not_shown_as_current(self):
        self.ci['runs'] = [{'repository': 'owner/repo', 'id': 10, 'status': 'completed'}]
        self.ci['jobs'] = [{'repository': 'owner/repo', 'run_id': 10, 'status': 'in_progress', 'runner_name': 'ryzen-1', 'run_attempt': 1}]
        self.assertEqual(self.result()[0]['runners'][0]['jobs'], [])
        self.ci['runs'][0].update(status='in_progress', run_attempt=2)
        self.assertEqual(self.result()[0]['runners'][0]['jobs'], [])
        self.ci['jobs'][0]['run_attempt'] = 2
        self.assertEqual(len(self.result()[0]['runners'][0]['jobs']), 1)

    def test_limits_are_configuration_not_a_guess_or_enforcement(self):
        self.config['runnerHosts']['ryzen']['maxJobs'] = 1
        self.assertEqual(self.result()[0]['available'], 0)
        self.assertTrue(self.result()[0]['atLimit'])
        self.ci['runners'][1]['busy'] = True
        self.assertTrue(self.result()[0]['overLimit'])
        for limit in [None, 0, -1, True, '2']:
            self.config['runnerHosts']['ryzen']['maxJobs'] = limit
            self.assertEqual(self.result()[0]['state'], 'unconfigured')
            self.assertIsNone(self.result()[0]['available'])

    def test_store_expires_runner_telemetry_independently(self):
        now = utcnow()
        config = {'hosts': [{'id': k, **v} for k, v in self.hosts.items()], 'github': self.config}
        store = MonitorStore(config, clock=lambda: now)
        try:
            store.meta('ci-runners', {'enabled': True, 'items': self.ci['runners'], 'measuredAt': now.isoformat()})
            self.assertEqual(store.ci_summary()['servers'][0]['available'], 1)
            now += dt.timedelta(minutes=6)
            self.assertEqual(store.ci_summary()['runnerInventoryState'], 'stale')
            self.assertIsNone(store.ci_summary()['servers'][0]['available'])
            store.meta('ci-runners', {'enabled': True, 'items': self.ci['runners'], 'measuredAt': now.isoformat(), 'error': 'permission denied'})
            self.assertEqual(store.ci_summary()['servers'][0]['state'], 'unknown')
        finally:
            store.close()


if __name__ == '__main__':
    unittest.main()
