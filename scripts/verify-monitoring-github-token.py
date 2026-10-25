"""Check a locally stored PAT using fixed GitHub GET endpoints; never print credentials."""
import argparse
import datetime as dt
import json
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'server/admin-api'))
from monitoring_github import GitHubClient, GitHubUnavailable, NoRedirect


class ObservedOpener:
    def __init__(self, repositories, opener=None):
        self.repositories = repositories
        self.opener = opener or urllib.request.build_opener(NoRedirect())
        self.requests = []
        self.expirations = set()

    def open(self, request, timeout):
        url = urlsplit(request.full_url)
        allowed = any(re.fullmatch(r'/repos/'+re.escape(repo)+r'/actions/(?:runs\?per_page=5|runs/\d+/jobs\?per_page=100|runners\?per_page=100)',
                                  url.path+'?'+url.query) for repo in self.repositories)
        if request.get_method() != 'GET' or url.scheme != 'https' or url.netloc != 'api.github.com' or not allowed:
            raise GitHubUnavailable('Request is outside the read-only verification scope')
        record = {'endpoint': url.path, 'method': 'GET', 'status': None}
        self.requests.append(record)
        try:
            response = self.opener.open(request, timeout=timeout)
            record['status'] = response.status
            expiry = response.headers.get('GitHub-Authentication-Token-Expiration')
            if expiry:
                self.expirations.add(expiry.strip())
            return response
        except urllib.error.HTTPError as error:
            record['status'] = error.code
            raise


def verify(config, token_file, opener=None):
    repositories = config['github']['repositories']
    if not repositories:
        raise ValueError('No repository configured')
    observed = ObservedOpener(repositories, opener)
    client = GitHubClient({'repositories': repositories, 'tokenFile': str(token_file)}, opener=observed)
    result = {'verifiedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'verified': False,
              'productionApplied': False, 'requestedExpiration': 'no-expiration',
              'expirationEvidence': 'not-reported-by-api', 'reportedExpiration': [],
              'requests': observed.requests, 'repositories': [], 'errors': []}
    for repo in repositories:
        row = {'repository': repo}
        result['repositories'].append(row)
        try:
            runs = client.get(f'/repos/{repo}/actions/runs?per_page=5')
            if not isinstance(runs.get('workflow_runs'), list):
                raise ValueError('Invalid workflow response')
            row['ci'] = {'status': 200, 'returned': len(runs['workflow_runs']), 'total': runs.get('total_count')}
            if not runs['workflow_runs']:
                result['errors'].append(repo+': No workflow run available to verify the job endpoint')
            for run in runs['workflow_runs']:
                run_id = run['id']
                if type(run_id) is not int or run_id < 1:
                    raise ValueError('Invalid run id')
                jobs = client.get(f'/repos/{repo}/actions/runs/{run_id}/jobs?per_page=100')
                if not isinstance(jobs.get('jobs'), list):
                    raise ValueError('Invalid job response')
                row['jobs'] = {'status': 200, 'runId': run_id, 'returned': len(jobs['jobs']), 'total': jobs.get('total_count')}
                if jobs['jobs']:
                    break
            runners = client.get(f'/repos/{repo}/actions/runners?per_page=100')
            if not isinstance(runners.get('runners'), list):
                raise ValueError('Invalid runner response')
            row['runners'] = {'status': 200, 'returned': len(runners['runners']), 'total': runners.get('total_count'),
                'items': [{'name': r['name'], 'status': r['status'], 'busy': r['busy']} for r in runners['runners']]}
        except GitHubUnavailable as error:
            # The shared client emits only controlled errors, not response bodies/headers.
            result['errors'].append(repo+': '+str(error))
        except (OSError, ValueError, KeyError, TypeError):
            result['errors'].append(repo+': GitHub response or local credential could not be read')
    result['reportedExpiration'] = sorted(observed.expirations)
    if observed.expirations:
        result['expirationEvidence'] = 'reported-by-api'
        if any(value.casefold() not in ('never', 'none', 'no expiration') for value in observed.expirations):
            result['errors'].append('GitHub reports a finite expiration; expected No expiration')
    result['verified'] = not result['errors']
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--token-file', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        result = verify(json.loads(args.config.read_text(encoding='utf-8-sig')), args.token_file)
    except Exception:
        result = {'verified': False, 'productionApplied': False, 'errors': ['Local validation could not start; credential details withheld']}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(result, ensure_ascii=True))
    sys.exit(0 if result['verified'] else 1)
