"""Build a private deployment candidate locally. No SSH, installation or production writes."""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
from pathlib import Path
import secrets
import shutil
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
REMOTE = '/home/natuki/services/monitoring'


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def certificate_files(folder):
    from cryptography import x509
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.x509.oid import NameOID
    now = dt.datetime.now(dt.timezone.utc)
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Home monitoring private CA')])
    ca = (x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
          .serial_number(x509.random_serial_number()).not_valid_before(now-dt.timedelta(minutes=5))
          .not_valid_after(now+dt.timedelta(days=1825)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True)
          .sign(key,hashes.SHA256()))
    server = rsa.generate_private_key(public_exponent=65537,key_size=3072)
    cert = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'192.168.1.10')]))
            .issuer_name(name).public_key(server.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now-dt.timedelta(minutes=5)).not_valid_after(now+dt.timedelta(days=365))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('192.168.1.10'))]),critical=False)
            .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).sign(key,hashes.SHA256()))
    pem=serialization.Encoding.PEM
    folder.mkdir(parents=True)
    (folder/'ca.crt').write_bytes(ca.public_bytes(pem))
    (folder/'server.crt').write_bytes(cert.public_bytes(pem))
    (folder/'server.key').write_bytes(server.private_bytes(pem,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    # This task needs no reusable signing authority. Discard CA private key after issuing the certificate.
    return cert.not_valid_after_utc.isoformat()


def prepare(live, observed, output, baseline):
    output.mkdir(parents=True, exist_ok=False)
    api = {'database':'/var/lib/mu-monitoring/observations.sqlite','staleAfterSeconds':180,'hosts':[],
           'github': {'repositories':live['github']['repositories'],'includeRunners':True,'pollSeconds':60,
                      'tokenFile':'/run/monitoring-secrets/github-read-token',
                      'webhookSecretFile':'/run/monitoring-secrets/github-webhook-key','runnerHosts':{}}}
    intel=output/'intel'; ryzen=output/'ryzen'
    for dest in (intel,ryzen):
        for name in ('config','secrets','code/admin-api'):(dest/name).mkdir(parents=True)
        for name in ('monitoring_collector.py','remote_host_probe.py','remote_operations_probe.py','disk_inventory.py'):
            shutil.copy2(ROOT/'server'/name,dest/'code'/name)
        shutil.copy2(ROOT/'server/admin-api/monitoring_common.py',dest/'code/admin-api/monitoring_common.py')
        shutil.copy2(ROOT/'server/deployment/mu-monitoring-collector.service',dest/'mu-monitoring-collector.service')
    expires=certificate_files(intel/'tls')
    for host in live['hosts']:
        host_id=host['id']; dest=output/host_id
        key=secrets.token_urlsafe(48)
        (dest/'secrets/collector-key').write_text(key+'\n')
        (intel/'secrets'/f'{host_id}-key').write_text(key+'\n')
        shutil.copy2(intel/'tls/ca.crt',dest/'config/ca.crt')
        collector={'hostId':host_id,'intervalSeconds':30,'backupRefreshSeconds':300,
            'secretFile':REMOTE+'/secrets/collector-key','caFile':REMOTE+'/config/ca.crt',
            'ingestUrl':f'https://192.168.1.10:18443/internal/monitoring/v1/hosts/{host_id}',
            'operations':host['operations'],'disks':[{'path':'/'}]}
        if host_id=='ryzen':
            archive=next(b for b in collector['operations']['backups'] if b['role']=='archive')
            disk=archive['disk']
            if not disk.get('mountpoint') or not disk.get('expectedUuid'):
                raise ValueError('Verified archive mount and UUID are required')
            collector['disks'].append({'path':disk['mountpoint'],**disk})
            for b in collector['operations']['backups']:b['disk']=disk
        write(dest/'config/collector.json',collector)
        api['hosts'].append({'id':host_id,'name':host['name'],'secretFile':f'/run/monitoring-secrets/{host_id}-key',
                             'machineRunners':host.get('machineRunners',{})})
        server=next(s for s in observed['ci']['servers'] if s['hostId']==host_id)
        if server['state'] in ('unknown','unconfigured') or not server['runners']:
            raise ValueError('A fresh runner inventory is required before preparing the deployment')
        api['github']['runnerHosts'][host_id]={'maxJobs':server['maxJobs'],
            'runnerNames':[r['name'] for r in server['runners']],
            'runnerPurposes':{r['name']:r['purpose'] for r in server['runners'] if r.get('purpose')},
            'capacitySource':server['capacitySource'],'capacityObservedAt':server['capacityObservedAt']}
    (intel/'secrets/github-webhook-key').write_text(secrets.token_urlsafe(48)+'\n')
    # Never export the workstation's broad gh credential. Provision a scoped read token at deployment.
    write(intel/'config/api.json',api)
    for name in ('ingest.conf','apache-monitoring.conf'):
        shutil.copy2(ROOT/'server/deployment'/name,intel/'config'/name)
    shutil.copy2(ROOT/'server/deployment/docker-compose.monitoring.yml',intel/'docker-compose.monitoring.yml')
    shutil.copytree(ROOT/'server/admin-api',intel/'admin-api',ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    shutil.copytree(ROOT/'dist',output/'frontend')
    routes=[json.loads(line) for line in baseline.read_text(encoding='utf-8-sig').splitlines() if line.strip()]
    original=next(r for r in routes if r['path']=='apache/httpd.conf')
    text=original['text']; anchor='Include conf/extra/server-status-cache.conf'
    if text.count(anchor)!=1 or 'conf/extra/monitoring.conf' in text:
        raise ValueError('Unexpected Apache source; refresh the read-only baseline')
    (intel/'config/httpd.conf.candidate').write_text(text.replace(anchor,anchor+'\nInclude conf/extra/monitoring.conf'),encoding='utf-8')
    write(output/'baseline.json',[{'path':r['path'],'sha256':r['sha256']} for r in routes])
    write(output/'readiness.json',{'status':'prepared-not-deployed','certificateExpiresAt':expires,
        'pendingAtDeployment':['GitHub scoped Actions read + Administration read token',
            'Install directories as UID 1000, mode 0700; secret files 0600',
            'Permit Ryzen to Intel private TLS port 18443 only if firewall requires it',
            'Install and start collectors; verify authenticated production routes',
            'Register GitHub workflow_run/workflow_job webhook with staged secret'],
        'requiresExistingAdminEnvironment':True,'requiresExistingBroker':True})
    hashes={p.relative_to(output).as_posix():hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(output.rglob('*')) if p.is_file()}
    write(output/'manifest.json',hashes)
    return {'files':len(hashes),'output':str(output),'status':'prepared-not-deployed','certificateExpiresAt':expires}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--live-config',type=Path,required=True)
    p.add_argument('--routing-baseline',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    with urllib.request.urlopen('http://127.0.0.1:18765/api/admin/v1/monitoring',timeout=20) as r:observed=json.load(r)
    print(json.dumps(prepare(json.loads(args.live_config.read_text(encoding='utf-8-sig')),observed,args.output,args.routing_baseline)))
