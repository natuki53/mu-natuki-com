"""Authenticated dashboard reads and separately signed machine-to-machine ingestion."""
import hashlib
import hmac
import json
import re
import time
from pathlib import Path

from fastapi import Depends, HTTPException, Query, Request
from pydantic import ValidationError

from monitoring_github import GitHubUnavailable, normalize


async def bounded_body(request,maximum=2_000_000):
    body=bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body)>maximum:raise HTTPException(413,'Request exceeds the size limit')
    return bytes(body)


def secret_file(path):
    if not path:raise HTTPException(503,'Integration is not configured')
    try:secret=Path(path).read_text().strip()
    except OSError:raise HTTPException(503,'Integration key is unavailable') from None
    if len(secret)<32:raise HTTPException(503,'Integration key is invalid')
    return secret.encode()


def install_monitoring(app,current_user,store,github):
    @app.get('/api/admin/v1/monitoring')
    def monitoring(_user=Depends(current_user)):
        return store.summary()

    @app.get('/api/admin/v1/monitoring/logs')
    def logs(host: str|None=None,service: str|None=None,level: str|None=None,since: str|None=None,
             before: int|None=Query(None,ge=1),limit: int=Query(200,ge=1,le=500),q: str|None=Query(None,max_length=200),_user=Depends(current_user)):
        if host and host not in store.hosts:raise HTTPException(404,'Host is not registered')
        if level and level not in ['debug','info','warning','error']:raise HTTPException(400,'Invalid log level')
        try:return store.logs(host,service,level,since,before,limit,q)
        except ValueError as error:raise HTTPException(400,str(error)) from None

    @app.get('/api/admin/v1/monitoring/ci/logs')
    def ci_logs(repository: str,jobId: int=Query(ge=1),_user=Depends(current_user)):
        if repository not in github.client.repositories:raise HTTPException(404,'Repository is not registered')
        try:return github.client.job_logs(repository,jobId)
        except (GitHubUnavailable,OSError):raise HTTPException(503,'CI logs are unavailable; open the job on GitHub') from None

    @app.post('/internal/monitoring/v1/hosts/{host_id}')
    async def ingest(host_id: str,request: Request):
        host=store.hosts.get(host_id)
        if not host:raise HTTPException(404,'Host is not registered')
        key=secret_file(host.get('secretFile'))
        stamp=request.headers.get('X-Monitor-Timestamp','')
        if not re.fullmatch(r'\d{10}',stamp) or abs(time.time()-int(stamp))>300:raise HTTPException(403,'Expired collector signature')
        body=await bounded_body(request)
        expected=hmac.new(key,stamp.encode()+b'.'+body,hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected,request.headers.get('X-Monitor-Signature','')):raise HTTPException(403,'Invalid collector signature')
        try:
            payload=json.loads(body)
            if payload.get('hostId')!=host_id:raise ValueError('Host identity mismatch')
            accepted=store.ingest(payload)
        except (ValueError,ValidationError,AttributeError):raise HTTPException(400,'Invalid observation') from None
        return {'accepted':accepted}

    @app.post('/hooks/github/actions')
    async def webhook(request: Request):
        key=secret_file(store.config.get('github',{}).get('webhookSecretFile'))
        body=await bounded_body(request)
        expected='sha256='+hmac.new(key,body,hashlib.sha256).hexdigest()
        if not hmac.compare_digest(expected,request.headers.get('X-Hub-Signature-256','')):raise HTTPException(403,'Invalid webhook signature')
        event=request.headers.get('X-GitHub-Event','')
        if event=='ping':return {'ok':True}
        if event not in ('workflow_run','workflow_job'):raise HTTPException(400,'Unsupported event')
        delivery=request.headers.get('X-GitHub-Delivery','')
        if not re.fullmatch(r'[A-Za-z0-9-]{10,80}',delivery):raise HTTPException(400,'Invalid delivery ID')
        try:
            payload=json.loads(body)
            repo=payload['repository']['full_name']
            if repo not in github.client.repositories:raise HTTPException(403,'Repository is not registered')
            kind='run' if event=='workflow_run' else 'job'
            item=normalize(kind,payload[event])
        except (KeyError,ValueError,TypeError):raise HTTPException(400,'Invalid event payload') from None
        if not store.delivery(delivery):return {'accepted':False,'duplicate':True}
        store.record_ci(repo,kind,item)
        old=store.meta('ci-status')
        # Receiving one event does not certify that polling of all repositories succeeded.
        store.meta('ci-status',{**old,'lastEventAt':store.clock().isoformat()})
        return {'accepted':True}
