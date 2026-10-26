import unittest
from unittest.mock import Mock

from monitoring_failures import failure_evidence
from monitoring_github import GitHubMonitor, GitHubUnavailable, normalize
from monitoring_store import MonitorStore


class FailureTests(unittest.TestCase):
    def setUp(self):
        self.store=MonitorStore({'hosts':[], 'github':{'repositories':['owner/repo']}})
        self.addCleanup(self.store.close)
        self.run={'id':42,'name':'CI','workflow_id':7,'head_branch':'main','run_attempt':1,'status':'completed','conclusion':'failure'}
        self.job={'id':81,'run_id':42,'name':'Tests','run_attempt':1,'status':'completed','conclusion':'failure'}

    def alerts(self):
        return [a for a in self.store.summary()['alerts'] if a.get('runId')]

    def test_code_failure_timeout_and_missing_logs_do_not_create_server_incidents(self):
        for conclusion in ['failure','timed_out','action_required']:
            self.store.record_ci('owner/repo','run',{**self.run,'conclusion':conclusion})
            self.store.record_ci('owner/repo','job',{**self.job,'failureCause':failure_evidence('##[error]Process completed with exit code 1.\nAssertionError: expected true')})
            self.assertFalse(self.alerts())
            self.assertEqual(self.store.ci_summary()['runs'][0]['conclusion'],conclusion)

    def test_confirmed_infrastructure_failure_links_exact_repository_run_and_job(self):
        self.store.record_ci('owner/repo','run',self.run)
        evidence=failure_evidence('2026-10-26T01:00:00Z ##[error]No space left on device')
        self.store.record_ci('owner/repo','job',{**self.job,'failureCause':evidence})
        alert=self.alerts()[0]
        self.assertEqual((alert['repository'],alert['runId'],alert['jobId']),('owner/repo',42,81))
        # Later webhook normalization cannot erase the completed job's diagnosis.
        self.store.record_ci('owner/repo','job',normalize('job',self.job))
        self.assertTrue(self.alerts())
        self.store.record_ci('owner/repo','run',{**self.run,'id':43,'conclusion':'success'})
        self.assertFalse(self.alerts())

    def test_previous_attempt_and_other_repository_cannot_raise_current_run_alert(self):
        self.store.record_ci('owner/repo','run',{**self.run,'run_attempt':2})
        cause=failure_evidence('##[error]The self-hosted runner: ryzen lost communication with the server.')
        self.store.record_ci('owner/repo','job',{**self.job,'failureCause':cause})
        self.store.record_ci('other/repo','job',{**self.job,'run_attempt':2,'failureCause':cause})
        self.assertFalse(self.alerts())

    def test_only_explicit_infrastructure_errors_are_classified(self):
        for message in ['No space left on device','The self-hosted runner: ryzen lost communication with the server.',
                        'The runner has received a shutdown signal','Cannot connect to the Docker daemon at unix:///var/run/docker.sock']:
            self.assertEqual(failure_evidence('##[error]'+message)['category'],'infrastructure')
            self.assertEqual(failure_evidence('test name: '+message)['category'],'unconfirmed')
        for message in ['##[error]Test timed out','##[error]Process completed with exit code 137.',
                        '##[error]TypeError: invalid value','FATAL ERROR: JavaScript heap out of memory',
                        '##[error]AssertionError: expected "No space left on device"']:
            self.assertEqual(failure_evidence(message)['category'],'unconfirmed')

    def test_diagnostics_are_cached_and_log_failure_does_not_break_ci_polling(self):
        client=Mock();client.job_logs.return_value={'text':'##[error]No space left on device'}
        monitor=GitHubMonitor(self.store,client)
        for _ in range(2):self.assertEqual(monitor.enrich_failure('owner/repo',self.job)['failureCause']['category'],'infrastructure')
        self.assertEqual(client.job_logs.call_count,1)
        client.job_logs.side_effect=GitHubUnavailable('not yet available')
        self.assertEqual(monitor.enrich_failure('owner/repo',{**self.job,'id':82})['failureCause']['source'],'unavailable')


if __name__=='__main__':unittest.main()
