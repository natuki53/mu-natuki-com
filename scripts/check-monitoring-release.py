"""Read-only validation of a prepared monitoring candidate; never installs it."""
import argparse
import hashlib
import json
from pathlib import Path
import ssl
import sys
from urllib.parse import urlsplit


def check(root):
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
    errors=[]
    for name,digest in manifest.items():
        path=(root/name).resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=digest:
            errors.append('Manifest mismatch: '+name)
    api=json.loads((root/'intel/config/api.json').read_text(encoding='utf-8'))
    if api.get('mode','live')!='live' or len(api['hosts'])!=2:errors.append('Invalid production API configuration')
    for host in ('intel','ryzen'):
        config=json.loads((root/host/'config/collector.json').read_text(encoding='utf-8'))
        url=urlsplit(config['ingestUrl'])
        if url.scheme!='https' or url.hostname!='192.168.1.10' or url.path!='/internal/monitoring/v1/hosts/'+host:
            errors.append('Incorrect private ingestion destination: '+host)
        secret=(root/host/'secrets/collector-key').read_text().strip()
        if len(secret)<32 or secret!=(root/'intel/secrets'/f'{host}-key').read_text().strip():errors.append('Collector signing key mismatch: '+host)
        ssl.create_default_context(cafile=str(root/host/'config/ca.crt'))
        if not config.get('operations',{}).get('backups'):errors.append('Backup targets missing: '+host)
    if (root/'intel/secrets/intel-key').read_text()==(root/'intel/secrets/ryzen-key').read_text():errors.append('Host keys must differ')
    text=(root/'intel/config/httpd.conf.candidate').read_text(encoding='utf-8')
    if text.index('Include conf/extra/monitoring.conf')>text.index('ProxyPass        /hooks/'):
        errors.append('Webhook route must precede deployment webhook catch-all')
    token=root/'intel/secrets/github-read-token'
    pending=[] if token.is_file() and len(token.read_text().strip())>=20 else ['GitHub scoped read token must be provisioned before activation']
    result={'preparationReady':not errors,'errors':errors,'deploymentInputs':pending,'filesVerified':len(manifest),
            'productionApplied':False}
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('candidate',type=Path)
    p.add_argument('--require-credentials',action='store_true');args=p.parse_args()
    result=check(args.candidate)
    print(json.dumps(result,indent=2))
    sys.exit(1 if result['errors'] or (args.require_credentials and result['deploymentInputs']) else 0)
