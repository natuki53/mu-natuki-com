import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('verify_token', ROOT/'scripts/verify-monitoring-github-token.py')
verify_token = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_token)


class Response(io.BytesIO):
    def __init__(self, data, headers=None):
        super().__init__(json.dumps(data).encode())
        self.status = 200
        self.headers = headers or {}


class FakeGitHub:
    def __init__(self, failure=None, expiration=None, empty=False):
        self.failure = failure
        self.expiration = expiration
        self.empty = empty
        self.requests = []

    def open(self, request, timeout):
        self.requests.append(request)
        if self.failure and self.failure in request.full_url:
            raise urllib.error.HTTPError(request.full_url, 403, 'withheld', {}, io.BytesIO(b'SYNTHETIC_SECRET'))
        if '/runners?' in request.full_url:
            payload = {'total_count': 1, 'runners': [{'name': 'fixture-runner', 'status': 'online', 'busy': False}]}
        elif '/jobs?' in request.full_url:
            payload = {'total_count': 2, 'jobs': [{'id': 1}, {'id': 2}]}
        else:
            payload = {'total_count': 0 if self.empty else 1, 'workflow_runs': [] if self.empty else [{'id': 123}]}
        return Response(payload, {'GitHub-Authentication-Token-Expiration': self.expiration} if self.expiration else {})


class TokenVerificationTests(unittest.TestCase):
    def verify(self, fake):
        with tempfile.TemporaryDirectory() as directory:
            token = Path(directory)/'token'
            token.write_text('SYNTHETIC_SECRET')
            return verify_token.verify({'github': {'repositories': ['owner/repo']}}, token, fake)

    def test_all_three_reads_and_no_secret_in_report(self):
        fake = FakeGitHub()
        result = self.verify(fake)
        self.assertTrue(result['verified'])
        self.assertEqual(len(fake.requests), 3)
        self.assertTrue(all(r.get_method() == 'GET' for r in fake.requests))
        self.assertEqual(result['repositories'][0]['jobs']['returned'], 2)
        self.assertNotIn('SYNTHETIC_SECRET', json.dumps(result))
        self.assertFalse(result['productionApplied'])

    def test_permission_failure_is_not_success_and_hides_response_body(self):
        result = self.verify(FakeGitHub(failure='/runners?'))
        self.assertFalse(result['verified'])
        self.assertEqual(result['requests'][-1]['status'], 403)
        self.assertNotIn('SYNTHETIC_SECRET', json.dumps(result))

    def test_expiration_conflicting_with_user_choice_blocks_acceptance(self):
        result = self.verify(FakeGitHub(expiration='2027-01-01 00:00:00 UTC'))
        self.assertFalse(result['verified'])
        self.assertEqual(result['expirationEvidence'], 'reported-by-api')

    def test_absent_expiration_is_not_claimed_as_confirmed(self):
        result = self.verify(FakeGitHub())
        self.assertTrue(result['verified'])
        self.assertEqual(result['expirationEvidence'], 'not-reported-by-api')
        self.assertEqual(result['reportedExpiration'], [])

    def test_empty_run_history_does_not_claim_job_read_verified(self):
        result = self.verify(FakeGitHub(empty=True))
        self.assertFalse(result['verified'])
        self.assertNotIn('jobs', result['repositories'][0])

    def test_wrong_destination_and_mutations_never_reach_transport(self):
        fake = FakeGitHub()
        opener = verify_token.ObservedOpener(['owner/repo'], fake)
        for url in ('https://evil.invalid/repos/owner/repo/actions/runs?per_page=5',
                    'http://api.github.com/repos/owner/repo/actions/runs?per_page=5',
                    'https://api.github.com/repos/another/repo/actions/runs?per_page=5'):
            with self.assertRaises(verify_token.GitHubUnavailable):
                opener.open(urllib.request.Request(url), 10)
        with self.assertRaises(verify_token.GitHubUnavailable):
            opener.open(urllib.request.Request('https://api.github.com/repos/owner/repo/actions/runs?per_page=5', data=b'{}'), 10)
        self.assertEqual(fake.requests, [])


if __name__ == '__main__':
    unittest.main()
