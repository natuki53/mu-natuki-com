"""Exercise the production images/routing on a local internal Docker network only."""
import argparse
import datetime as dt
import hashlib
import hmac
import ipaddress
import json
from pathlib import Path
import secrets
import shutil
import ssl
import subprocess
import time
import urllib.error
import urllib.request

import jwt
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

ROOT=Path(__file__).resolve().parents[1]


def main(candidate, work):
    work.mkdir(parents=True,exist_ok=False)
    for name in ('state','secrets','tls','jwks/cdn-cgi/access'):(work/name).mkdir(parents=True)
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    jwk=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key()));jwk.update(kid='rehearsal',use='sig',alg='RS256')
    (work/'jwks/cdn-cgi/access/certs').write_text(json.dumps({'keys':[jwk]}))
    secret=secrets.token_urlsafe(40)
    (work/'secrets/key').write_text(secret)
    api={'database':'/state/observations.sqlite','staleAfterSeconds':1,
         'hosts':[{'id':h,'secretFile':'/secrets/key'} for h in ('intel','ryzen')],
         'github':{'repositories':['fixture/repo'],'webhookSecretFile':'/secrets/key'}}
    (work/'api.json').write_text(json.dumps(api))
    now=dt.datetime.now(dt.timezone.utc)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'localhost')])
    cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(minutes=1))
          .not_valid_after(now+dt.timedelta(days=2))
          .add_extension(x509.SubjectAlternativeName([x509.DNSName('localhost'),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False)
          .add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).sign(key,hashes.SHA256()))
    (work/'tls/server.crt').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (work/'tls/server.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    routes=[json.loads(x) for x in (candidate.parent/'production-routing-baseline.jsonl').read_text(encoding='utf-8-sig').splitlines() if x]
    cache=next(x['text'] for x in routes if x['path']=='server-status/apache-status-cache.conf')
    (work/'status-cache.conf').write_text(cache)
    def bind(source,target,read_only=True):
        return {'type':'bind','source':str(source.resolve()),'target':target,'read_only':read_only}
    api_image='mu-monitoring-api:readiness'
    # Build the exact prepared production context, not the local authentication substitute.
    subprocess.run(['docker','build','--target','production','-t',api_image,str(candidate/'intel/admin-api')],check=True,stdout=(work/'build.log').open('w'),stderr=subprocess.STDOUT)
    common={'read_only':True,'cap_drop':['ALL'],'security_opt':['no-new-privileges:true'],'networks':['isolated']}
    compose={'services':{
        'jwks':{**common,'image':api_image,'entrypoint':['python','-m','http.server','8000','--directory','/jwks'],
                'volumes':[bind(work/'jwks','/jwks')]},
        'admin-api':{**common,'image':api_image,'user':'1000:1000','tmpfs':['/tmp'],
            'environment':{'APP_ENV':'production','ADMIN_CF_TEAM_DOMAIN':'http://jwks:8000','ADMIN_CF_POLICY_AUD':'rehearsal',
                'ADMIN_ALLOWED_EMAIL':'admin@example.invalid','ADMIN_CSRF_SECRET':secrets.token_urlsafe(40),
                'ADMIN_BROKER_SHARED_SECRET':secrets.token_urlsafe(40),'ADMIN_ORIGIN':'http://127.0.0.1:19081',
                'ADMIN_MONITOR_CONFIG':'/config/api.json'},
            'volumes':[bind(work/'api.json','/config/api.json'),bind(work/'secrets','/secrets'),bind(work/'state','/state',False)]},
        'ingest':{**common,'image':'nginx@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951',
            'entrypoint':['nginx','-g','daemon off;'],'user':'1000:1000','tmpfs':['/tmp:size=16m,mode=1777'],
            'ports':['127.0.0.1:19443:8443'],'depends_on':['admin-api'],'networks':['isolated','edge'],
            'volumes':[bind(candidate/'intel/config/ingest.conf','/etc/nginx/nginx.conf'),bind(work/'tls','/tls')]},
        'apache':{'image':'httpd@sha256:a30cd4cd57f3f3c3be9b2d16384d2488839996bb14c67df2b51f1ecbb3e584a1',
            'networks':['isolated','edge'],'ports':['127.0.0.1:19081:80'],'depends_on':['admin-api'],
            'volumes':[bind(candidate/'intel/config/httpd.conf.candidate','/usr/local/apache2/conf/httpd.conf'),
                bind(work/'status-cache.conf','/usr/local/apache2/conf/extra/server-status-cache.conf'),
                bind(candidate/'intel/config/apache-monitoring.conf','/usr/local/apache2/conf/extra/monitoring.conf'),
                bind(candidate/'frontend','/usr/local/apache2/htdocs')]}
    },'networks':{'isolated':{'internal':True},'edge':{}}}
    (work/'compose.json').write_text(json.dumps(compose))
    command=['docker','compose','-p','mu-monitoring-readiness','-f',str(work/'compose.json')]
    def dc(*args):return subprocess.run(command+list(args),check=True,capture_output=True,text=True).stdout
    context=ssl.create_default_context(cafile=str(work/'tls/server.crt'))
    base='http://127.0.0.1:19081'
    def request(url,path='',body=None,headers=None):
        try:
            response=urllib.request.urlopen(urllib.request.Request(url+path,data=body,headers=headers or {}),context=context,timeout=2)
        except urllib.error.HTTPError as e:response=e
        with response:return response.status,dict(response.headers),response.read()
    checks={}
    def require(name,condition):
        checks[name]=bool(condition)
        if not condition:raise AssertionError(name)
    def auth(**changes):
        claims={'iss':'http://jwks:8000','aud':'rehearsal','email':'admin@example.invalid',
                'iat':int(time.time()),'exp':int(time.time())+600,**changes}
        return {'Cf-Access-Jwt-Assertion':jwt.encode(claims,key,algorithm='RS256',headers={'kid':'rehearsal'})}
    def signed(data):
        body=json.dumps(data).encode();stamp=str(int(time.time()))
        return body,{'Content-Type':'application/json','X-Monitor-Timestamp':stamp,
                     'X-Monitor-Signature':hmac.new(secret.encode(),stamp.encode()+b'.'+body,hashlib.sha256).hexdigest()}
    try:
        dc('up','-d')
        for _ in range(30):
            try:
                if request(base,'/api/admin/v1/session')[0]==403:break
            except OSError:pass
            time.sleep(1)
        require('apache-config', 'Syntax OK' in subprocess.run(command+['exec','-T','apache','httpd','-t'],capture_output=True,text=True).stderr)
        for path in ('/api/admin/v1/session','/api/admin/v1/monitoring','/api/admin/v1/monitoring/logs'):
            require('no-auth:'+path,request(base,path)[0]==403)
        for name,headers in [('expired',auth(exp=int(time.time())-1)),('wrong-audience',auth(aud='wrong')),
                             ('wrong-user',auth(email='other@example.invalid')),('forged',{'Cf-Access-Jwt-Assertion':'not-a-jwt'})]:
            require(name,request(base,'/api/admin/v1/monitoring',headers=headers)[0]==403)
        require('authenticated-session',request(base,'/api/admin/v1/session',headers=auth())[0]==200)
        require('frontend',request(base,'/admin/')[0]==200)
        require('public-internal-block',request(base,'/internal/monitoring/v1/hosts/intel')[0]==403)
        require('tls-no-admin',request('https://127.0.0.1:19443','/api/admin/v1/monitoring',headers=auth())[0]==404)
        raw={'hostId':'intel','measuredAt':dt.datetime.now(dt.timezone.utc).isoformat(),
             'services':[{'id':'fixture','name':'Fixture','kind':'docker','state':'running'}],
             'logs':[{'serviceId':'fixture','at':dt.datetime.now(dt.timezone.utc).isoformat(),'level':'info','message':'token=DO_NOT_EXPOSE'}]}
        body,headers=signed(raw)
        path='/internal/monitoring/v1/hosts/intel'
        require('tls-signed-ingest',json.loads(request('https://127.0.0.1:19443',path,body,headers)[2])['accepted'])
        require('replay-rejected',not json.loads(request('https://127.0.0.1:19443',path,body,headers)[2])['accepted'])
        require('tampered-signature',request('https://127.0.0.1:19443',path,body,{**headers,'X-Monitor-Signature':'bad'})[0]==403)
        require('wrong-host',request('https://127.0.0.1:19443','/internal/monitoring/v1/hosts/ryzen',body,headers)[0]==400)
        result=request(base,'/api/admin/v1/monitoring',headers=auth())
        require('production-mode',json.loads(result[2])['mode']=='live')
        require('cache-disabled','no-store' in result[1].get('Cache-Control',''))
        require('log-redaction',b'DO_NOT_EXPOSE' not in request(base,'/api/admin/v1/monitoring/logs',headers=auth())[2])
        payload=json.dumps({'repository':{'full_name':'fixture/repo'},'workflow_run':{'id':123,'name':'Test','status':'in_progress'}}).encode()
        hook={'X-GitHub-Event':'workflow_run','X-GitHub-Delivery':'readiness-delivery-123',
              'X-Hub-Signature-256':'sha256='+hmac.new(secret.encode(),payload,hashlib.sha256).hexdigest()}
        require('webhook-exact-route',request(base,'/monitoring-hooks/github/actions',payload,hook)[0]==200)
        require('webhook-invalid-signature',request(base,'/monitoring-hooks/github/actions',payload,{**hook,'X-Hub-Signature-256':'bad'})[0]==403)
        dc('restart','admin-api')
        for _ in range(30):
            try:
                result=request(base,'/api/admin/v1/monitoring',headers=auth())
                if result[0]==200:break
            except OSError:pass
            time.sleep(1)
        data=json.loads(result[2])
        require('sqlite-survives-restart',any(h['hostId']=='intel' and h['measuredAt'] for h in data['hosts']))
        require('webhook-survives-restart',any(r['id']==123 for r in data['ci']['runs']))
        time.sleep(2)
        data=json.loads(request(base,'/api/admin/v1/monitoring',headers=auth())[2])
        require('stopped-collector-stale',next(h for h in data['hosts'] if h['hostId']=='intel')['freshness']=='stale')
        # Reject writes without valid same-origin CSRF before the production broker is contacted.
        require('csrf-required',request(base,'/api/admin/v1/services/fixture/actions',b'{}',auth())[0]==403)
    finally:
        (work/'result.json').write_text(json.dumps({'checks':checks,'passed':all(checks.values()),'productionWrites':False},indent=2))
        (work/'container.log').write_text(dc('logs','--no-color'))
        dc('down')
    print(json.dumps({'passed':len(checks),'result':str(work/'result.json')}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--work',type=Path,required=True)
    args=parser.parse_args()
    main(args.candidate.resolve(),args.work.resolve())
