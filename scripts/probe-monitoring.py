"""Run the prepared collector in memory over SSH; installs/writes nothing on either host."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'server/admin-api'))
from monitoring_models import Observation
from monitoring_store import MonitorStore


def probe(candidate,host_id,alias):
    root=candidate/host_id
    config=json.loads((root/'config/collector.json').read_text(encoding='utf-8'))
    code='import sys,types,json\n'
    for name,path in [('monitoring_common','admin-api/monitoring_common.py'),('disk_inventory','disk_inventory.py'),
                       ('monitoring_collector','monitoring_collector.py'),('remote_host_probe','remote_host_probe.py'),
                       ('remote_operations_probe','remote_operations_probe.py')]:
        code+=f"m=types.ModuleType({name!r});m.__file__='/unused/{path}';sys.modules[{name!r}]=m\n"
        code+=f"exec(compile({(root/'code'/path).read_text(encoding='utf-8')!r},m.__file__,'exec'),m.__dict__)\n"
    code+=f'from monitoring_collector import Collector\nprint(json.dumps(Collector({config!r}).collect()))\n'
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8',
                          alias,'LC_ALL=C python3 -B -'],input=code,capture_output=True,text=True,encoding='utf-8',timeout=180)
    if result.returncode:raise RuntimeError(f'{host_id}: read-only probe failed (output withheld)')
    if len(result.stdout.encode())>2_000_000:raise ValueError('Observation too large')
    return Observation.model_validate(json.loads(result.stdout)).model_dump()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=False)
    store=MonitorStore({'hosts':[{'id':'intel'},{'id':'ryzen'}],'staleAfterSeconds':180})
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        futures=[pool.submit(probe,args.candidate,h,a) for h,a in [('ryzen','home-server-2'),('intel','home-server')]]
        for future in futures:
            raw=future.result();store.ingest(raw)
            (args.output/(raw['hostId']+'.json')).write_text(json.dumps(raw,ensure_ascii=False),encoding='utf-8')
    summary=store.summary()
    result={'productionWrites':False,'hosts':[{'id':h['hostId'],'freshness':h['freshness'],
        'services':len(h['services']),'disks':len(h['physicalDisks']),'machines':len(h['machines']),'errors':h['errors']} for h in summary['hosts']],
        'backups':[{'hostId':b['hostId'],'id':b['id'],'status':b['status'],'counts':b['counts'],'issues':b['issues'],'jobs':b['jobs']} for b in summary['backups']]}
    (args.output/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'hosts':result['hosts'],'backups':[{'id':b['id'],'counts':b['counts'],'issues':b['issues']} for b in result['backups']]}))
    store.close()
