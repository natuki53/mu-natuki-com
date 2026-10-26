"""Read-only GitHub Actions client, serialized polling and signed-event normalization."""
import datetime as dt
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from monitoring_models import redact, utcnow
from monitoring_failures import FAILED_CONCLUSIONS, failure_evidence


class GitHubUnavailable(Exception):
    pass


def normalize(kind, value):
    if not isinstance(value,dict) or type(value.get('id')) is not int or value['id']<1:
        raise ValueError('Invalid GitHub object')
    fields = ('id','workflow_id','name','status','conclusion','head_branch','head_sha','run_attempt','created_at','updated_at','run_started_at') if kind=='run' else ('id','name','run_id','run_attempt','status','conclusion','started_at','completed_at','runner_name')
    result={k:value.get(k) for k in fields if isinstance(value.get(k),(str,int)) or value.get(k) is None}
    for key,val in result.items():
        if isinstance(val,str):result[key]=redact(val)[:500]
    if result.get('run_attempt') is None:result['run_attempt']=1
    if kind=='job':
        result['steps']=[{k:step.get(k) for k in ('name','number','status','conclusion','started_at','completed_at')}
            for step in value.get('steps',[])[:100] if isinstance(step,dict)]
        for step in result['steps']:step['name']=redact(step.get('name',''))[:300]
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):return None


class GitHubClient:
    def __init__(self,config,opener=None,clock=time.time):
        self.config=config
        self.repositories=set(config.get('repositories',[]))
        if any(not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+',r) for r in self.repositories):
            raise ValueError('Invalid repository allowlist')
        self.opener=opener or urllib.request.build_opener(NoRedirect())
        self.clock=clock
        self.retry_at=0
        self.lock=threading.RLock()
        self.cache={}

    def get(self,path):
        with self.lock:
            if self.clock()<self.retry_at:raise GitHubUnavailable('GitHub API rate limit: waiting before retry')
            token=Path(self.config['tokenFile']).read_text().strip()
            headers={'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,'X-GitHub-Api-Version':'2026-03-10','User-Agent':'mu-home-monitor'}
            if path in self.cache:headers['If-None-Match']=self.cache[path][0]
            request=urllib.request.Request('https://api.github.com'+path,headers=headers)
            try:
                with self.opener.open(request,timeout=10) as response:
                    body=response.read(2_000_001)
                    if len(body)>2_000_000:raise GitHubUnavailable('GitHub response exceeded size limit')
                    data=json.loads(body)
                    etag=response.headers.get('ETag')
                    if etag:self.cache[path]=(etag,data)
                    if len(self.cache)>500:self.cache.pop(next(iter(self.cache)))
                    return data
            except urllib.error.HTTPError as error:
                if error.code==304 and path in self.cache:return self.cache[path][1]
                if error.code in (403,429):
                    try:
                        delay=max(60,float(error.headers.get('Retry-After','60')))
                        reset=float(error.headers.get('X-RateLimit-Reset','0')) if error.headers.get('X-RateLimit-Remaining')=='0' else 0
                    except ValueError:delay,reset=60,0
                    self.retry_at=max(self.clock()+delay,reset)
                raise GitHubUnavailable('GitHub API returned HTTP '+str(error.code)) from None
            except (OSError,ValueError):raise GitHubUnavailable('GitHub API could not be read') from None

    def job_logs(self,repo,job_id):
        if repo not in self.repositories or type(job_id) is not int or job_id<1:raise ValueError('Job is outside the allowed repositories')
        if not self.config.get('tokenFile'):raise GitHubUnavailable('GitHub logs integration is not configured')
        with self.lock:
            if self.clock()<self.retry_at:raise GitHubUnavailable('GitHub API rate limit: waiting before retry')
            token=Path(self.config['tokenFile']).read_text().strip()
            req=urllib.request.Request(f'https://api.github.com/repos/{repo}/actions/jobs/{job_id}/logs',headers={
                'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','User-Agent':'mu-home-monitor','X-GitHub-Api-Version':'2026-03-10'})
            try:
                response=self.opener.open(req,timeout=10)
            except urllib.error.HTTPError as error:
                if error.code!=302:raise GitHubUnavailable('Job logs are not available yet (HTTP '+str(error.code)+')') from None
                url=error.headers.get('Location','')
                parsed=urllib.parse.urlparse(url)
                host=parsed.hostname or ''
                if parsed.scheme!='https' or parsed.username or parsed.password or parsed.port not in (None,443) or not any(host.endswith('.'+suffix) for suffix in ('githubusercontent.com','blob.core.windows.net')):
                    raise GitHubUnavailable('Unexpected log download destination')
                # The GitHub token must never be forwarded to the signed storage URL.
                response=self.opener.open(urllib.request.Request(url),timeout=15)
            except OSError:raise GitHubUnavailable('Job logs could not be read') from None
            with response:
                body=response.read(1_000_001)
            decoded=body[:1_000_000].decode('utf-8','replace')
            return {'text':redact(decoded),'truncated':len(body)>8000,
                    'failureCause':failure_evidence(decoded)}


class GitHubMonitor:
    def __init__(self,store,client=None):
        self.store=store
        self.config=store.config.get('github',{})
        self.client=client or GitHubClient(self.config)
        self.stop_event=threading.Event()
        self.thread=None
        self.failure_cache={}
        self.failure_budget=3

    def enrich_failure(self, repo, job):
        if job.get('status')!='completed' or job.get('conclusion') not in FAILED_CONCLUSIONS:
            return job
        key=(repo,job['id'],job.get('run_attempt') or 1)
        now=time.monotonic()
        cached=self.failure_cache.get(key)
        if cached and now-cached[0]<cached[2]:
            return {**job,'failureCause':cached[1]}
        if self.failure_budget<=0:return job
        self.failure_budget-=1
        try:
            result=self.client.job_logs(repo,job['id'])
            cause=result.get('failureCause') or failure_evidence(result.get('text',''))
            ttl=3600
        except (GitHubUnavailable,OSError,AttributeError):
            cause={'category':'unconfirmed','source':'unavailable'}
            ttl=300
        self.failure_cache[key]=(now,cause,ttl)
        if len(self.failure_cache)>200:self.failure_cache.pop(next(iter(self.failure_cache)))
        return {**job,'failureCause':cause}

    def runs(self, repo, previous):
        prefix=f'/repos/{repo}/actions/runs'
        recent=self.client.get(prefix+'?per_page=15').get('workflow_runs',[])
        merged={r['id']:r for r in recent}
        for state in ('in_progress','queued','waiting','requested','pending'):
            result=self.client.get(prefix+'?per_page=100&status='+state)
            rows=result.get('workflow_runs',[])
            if result.get('total_count',0)>len(rows):
                raise GitHubUnavailable('Active run inventory exceeds collection limit')
            merged.update({r['id']:r for r in rows})
        # Refresh runs still active before restart, even when they leave recent history.
        for old in previous:
            if old.get('repository')==repo and old.get('status')!='completed' and old['id'] not in merged:
                merged[old['id']]=self.client.get(prefix+'/'+str(old['id']))
        return list(merged.values())

    def reconcile(self):
        self.failure_budget=3
        try:
            previous=self.store.ci_summary()
            pending_runs={(j.get('repository'),j.get('run_id')) for j in previous['jobs'] if j.get('status')!='completed'}
            for repo in sorted(self.client.repositories):
                # Local GhReadClient already expands active runs; production uses the same semantics here.
                runs=(self.client.get(f'/repos/{repo}/actions/runs?per_page=15').get('workflow_runs',[])
                      if getattr(self.client,'expands_active_runs',False) else self.runs(repo,previous['runs']))
                for run in runs:
                    self.store.record_ci(repo,'run',normalize('run',run))
                    # Refresh active runs and the latest completed run; other retained jobs come from events.
                    if run.get('status')!='completed' or run is runs[0] or (repo,run['id']) in pending_runs or run.get('conclusion') in FAILED_CONCLUSIONS:
                        response=self.client.get(f'/repos/{repo}/actions/runs/{run["id"]}/jobs?per_page=100')
                        if response.get('total_count',0)>len(response.get('jobs',[])):
                            raise GitHubUnavailable('Job inventory exceeds collection limit')
                        for job in response.get('jobs',[]):
                            self.store.record_ci(repo,'job',self.enrich_failure(repo,normalize('job',job)))
            status=self.store.meta('ci-status')
            self.store.meta('ci-status',{**status,'lastSuccessAt':self.store.clock().isoformat(),'error':None})
        except Exception as error:
            status=self.store.meta('ci-status')
            self.store.meta('ci-status',{**status,'lastFailureAt':self.store.clock().isoformat(),
                'error':str(error) if isinstance(error,GitHubUnavailable) else 'GitHub collection failed'})
        if self.config.get('includeRunners'):
            try:
                runners=[]
                for repo in sorted(self.client.repositories):
                    response=self.client.get(f'/repos/{repo}/actions/runners?per_page=100')
                    if response.get('total_count',0)>len(response.get('runners',[])):
                        raise GitHubUnavailable('Runner inventory exceeds collection limit')
                    for runner in response.get('runners',[]):
                        runners.append({'repository':repo,**{k:runner.get(k) for k in ('id','name','status','busy','os')}})
                self.store.meta('ci-runners',{'items':runners,'enabled':True,'measuredAt':self.store.clock().isoformat()})
            except Exception:
                previous=self.store.meta('ci-runners')
                self.store.meta('ci-runners',{**previous,'enabled':True,'error':'Runner inventory unavailable'})

    def start(self):
        if not self.client.repositories or not self.config.get('tokenFile'):return
        def loop():
            while not self.stop_event.is_set():
                self.reconcile()
                self.stop_event.wait(max(30,int(self.config.get('pollSeconds',60))))
        self.thread=threading.Thread(target=loop,daemon=True,name='github-readonly-monitor')
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:self.thread.join(timeout=2)
