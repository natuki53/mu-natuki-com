#!/usr/bin/env python3
"""Loopback-only synthetic preview; no production keys, host commands or GitHub requests."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import sys
import threading

sys.path.insert(0,str(Path(__file__).parent/'admin-api'))
os.environ.update(ADMIN_CF_TEAM_DOMAIN='https://example.cloudflareaccess.com',ADMIN_CF_POLICY_AUD='local-preview',
    ADMIN_ALLOWED_EMAIL='local-preview@example.invalid',ADMIN_CSRF_SECRET='local-demo-csrf-secret-not-for-production',
    ADMIN_BROKER_SHARED_SECRET='local-demo-broker-secret-not-for-production')

from fastapi import HTTPException,Request
from app import BrokerFailure,Settings,create_app
from monitoring_store import MonitorStore
from monitoring_models import utcnow
from monitoring_github import GitHubUnavailable


class DemoBroker:
    def call(self,method,actor,params=None):
        if method in ['services.action','timecard.correct']:raise BrokerFailure(403,'Local preview is read-only')
        if method in ['services.list','timecard.active','timecard.members','audit.list']:return []
        if method=='timecard.records':return {'items':[],'total':0,'page':1,'pageSize':25}
        if method=='timecard.summary':return {'members':[],'totals':{'workSeconds':0,'breakSeconds':0,'shiftCount':0,'workDays':0}}
        return {}


def demo_disks(primary, backup_disk, scenario):
    def volume(device, kind, size, fs, mounts=None, used=None, free=None, container=False):
        return {'device':device,'kind':kind,'sizeBytes':size,'filesystem':fs,'mountpoints':mounts or [],
            'mounted':bool(mounts),'container':container,'totalBytes':size if mounts else None,
            'usedBytes':used,'freeBytes':free}
    gib=1024**3
    used=(230 if primary else 290)*gib
    devices=[{'device':'/dev/sda','kind':'ssd','model':'Sample system SSD','transport':'sata','removable':False,'sizeBytes':500_000_000_000,
        'volumes':[
            volume('/dev/sda1','part',gib,'vfat',['/boot/efi'],200*1024**2,824*1024**2),
            volume('/dev/sda2','part',498_000_000_000,'LVM2_member',container=True),
            volume('/dev/mapper/system-root','lvm',490_000_000_000,'ext4',['/'],used,490_000_000_000-used),
        ]}]
    if primary:
        if scenario!='disk-missing':
            devices.append({'device':'/dev/sdb','kind':'hdd','model':'Sample backup HDD','transport':'sata','sizeBytes':8_000_000_000_000,
                'volumes':[volume('/dev/sdb1','part',backup_disk['totalBytes'],'ext4',['/srv/storage'],backup_disk['usedBytes'],backup_disk['freeBytes'])]})
        devices.append({'device':'/dev/sdc','kind':'usb','model':'Sample USB drive','transport':'usb','removable':True,'sizeBytes':32_000_000_000,
            'volumes':[volume('/dev/sdc1','part',31_900_000_000,'vfat')]})
    return devices


def demo_observation(host,scenario='normal'):
    now=utcnow()
    at=lambda hours=0:(now-dt.timedelta(hours=hours)).isoformat()
    primary=host=='ryzen';full='a'*64;database='b'*64
    total=7_900_000_000_000 if primary else 490_000_000_000
    used=(76 if primary else 290)*1024**3
    disk={'path':'/srv/storage' if primary else '/', 'totalBytes':total,
        'usedBytes':used,'freeBytes':total-used,
        'mounted':True,'uuidMatches':True,'smart':'passed'}
    snapshots=[{'id':full,'time':at(3),'kind':'full','complete':True},{'id':database,'time':at(.3),'kind':'db','complete':True}]
    if primary:
        snapshots += [{'id':f'{i+100:064x}','time':at(i+1),'kind':'db','complete':True} for i in range(47)]
        snapshots += [{'id':f'{i+200:064x}','time':at((i+1)*24),'kind':'full','complete':True} for i in range(29)]
    jobs=[{'kind':kind,'phase':'idle','lastSuccessAt':at(.3 if kind=='db' else 3),'snapshotId':database if kind=='db' else full,
        'nextRunAt':at(-.5),'maxAgeHours':3 if kind=='db' else 30} for kind in ('full','db')]
    if not primary:jobs=[{'kind':'copy','phase':'idle','lastSuccessAt':at(.1),'maxAgeHours':8}]
    jobs += [{'kind':'check','phase':'idle','lastSuccessAt':at(12),'readData':True},
        {'kind':'restore','phase':'idle','lastSuccessAt':at(25),'snapshotId':f'{999:064x}'}]
    backup={'id':'vrnavi','name':'ぶいなび / '+('主保存先' if primary else '独立コピー'),'role':'primary' if primary else 'secondary',
        'repository':'/srv/storage/vrnavi-backup/storage/restic' if primary else '/home/backup/secondary/repository',
        'measuredAt':at(),'status':'ok','disk':dict(disk),'repositoryBytes':24*1024**3 if primary else 21*1024**3,
        'workBytes':32*1024**3 if primary else 0,'restoreBytes':0,'minimumFreeBytes':50*1024**3 if primary else 20*1024**3,
        'retention':{'hourly':48,'daily':30,'weekly':8,'monthly':12} if primary else {'full':1,'db':1},'snapshots':snapshots,'jobs':jobs}
    if primary and scenario=='backup-failure':jobs[1].update(phase='failed',lastFailureAt=at(),error='Synthetic backup failure; previous successful snapshot retained')
    if primary and scenario=='disk-missing':
        disk.update(mounted=False,uuidMatches=False,freeBytes=None)
        backup.update(disk=dict(disk),status='failed',error='Synthetic unmounted disk')
    if primary and scenario=='low-space':
        disk['freeBytes']=backup['disk']['freeBytes']=8*1024**3
        disk['usedBytes']=backup['disk']['usedBytes']=disk['totalBytes']-disk['freeBytes']
    service={'id':'sample-web','name':'Sample Web' if primary else 'Management API','kind':'docker','state':'running','health':'healthy','restarts':0,'startedAt':at(30),'logsEnabled':True}
    if primary and scenario=='service-failure':service.update(state='failed',health='unhealthy',restarts=5)
    return {'version':1,'hostId':host,'measuredAt':at(),'cpuPct':22.4 if primary else 8.7,'memoryPct':46.2 if primary else 32.8,
        'uptimeSeconds':108000,'temperatureC':42 if primary else 39,'disks':[disk],'services':[service],'backups':[backup],
        'physicalDisks':demo_disks(primary,disk,scenario),'diskInventoryStatus':'ok',
        'logs':[{'serviceId':'sample-web','at':at(),'level':'error' if scenario=='service-failure' else 'info',
            'message':'Sample log · request completed · token=demo-secret-must-be-redacted'}]}


def make_demo(scenario='normal', ui_port=4178):
    if not 1024 <= ui_port <= 65535:raise ValueError('Invalid local preview port')
    store=MonitorStore({'mode':'demo','hosts':[{'id':'ryzen','name':'Ryzen'},{'id':'intel','name':'Intel'}],
        'github':{'repositories':['example/home-dashboard'],'runnerHosts':{
            'ryzen':{'maxJobs':2,'runnerNames':['sample-ryzen-linux','sample-ryzen-windows']},
            'intel':{'maxJobs':1,'runnerNames':['sample-intel-linux']}}}})
    settings=Settings(team_domain='https://example.cloudflareaccess.com',policy_audience='local-preview',
        allowed_email='local-preview@example.invalid',admin_origin=f'http://127.0.0.1:{ui_port}',csrf_secret='c'*32,broker_secret='b'*32,
        broker_socket='/unused',public_status_dir='/unused',app_env='test',test_auth_email='local-preview@example.invalid')
    app=create_app(settings,DemoBroker(),store)
    current={'scenario':scenario,'tick':0}
    class DemoLogs:
        repositories={'example/home-dashboard'}
        def job_logs(self,repo,job_id):
            if repo not in self.repositories or job_id!=81:raise GitHubUnavailable('Unknown synthetic job')
            if current['scenario']!='ci-server-failure':raise GitHubUnavailable('Synthetic logs unavailable')
            return {'text':'SAMPLE DATA / synthetic job 81\n##[error]No space left on device\nRunner: sample-ryzen-linux','truncated':False}
    app.state.github_monitor.client=DemoLogs()
    def seed():
        current['tick']+=1
        for host in ('ryzen','intel'):
            data=demo_observation(host,current['scenario'])
            store.ingest(data)
            if host=='ryzen' and current['scenario']=='collector-offline':
                data['measuredAt']=(utcnow()-dt.timedelta(minutes=5)).isoformat();data.pop('logs')
                with store.lock,store.db:store.db.execute('UPDATE hosts SET measured=?,data=? WHERE id=?',(data['measuredAt'],json.dumps(data),'ryzen'))
        now=utcnow().isoformat();failed=current['scenario'] in ('ci-failure','ci-server-failure')
        idle=current['scenario'] in ('ci-idle','ci-offline')
        finished=failed or idle
        # New synthetic run IDs make transitions visible without contacting GitHub.
        with store.lock,store.db:store.db.execute('DELETE FROM ci')
        store.record_ci('example/home-dashboard','run',{'id':42,'name':'Build & verify','status':'completed' if finished else 'in_progress',
            'conclusion':'failure' if failed else 'success' if idle else None,'head_branch':'feat/home-monitoring','head_sha':'c'*40,'run_attempt':1,
            'run_started_at':(utcnow()-dt.timedelta(minutes=3)).isoformat(),'updated_at':now})
        store.record_ci('example/home-dashboard','job',{'id':81,'run_id':42,'name':'Web and API checks','status':'completed' if finished else 'in_progress',
            'conclusion':'failure' if failed else 'success' if idle else None,'runner_name':'sample-ryzen-linux',
            'failureCause':{'category':'infrastructure','code':'disk-full','source':'job-log','message':'実行環境のディスク容量が不足しました','messageEn':'The execution environment ran out of disk space'} if current['scenario']=='ci-server-failure' else {'category':'unconfirmed'},'steps':[
                {'name':'Checkout','status':'completed','conclusion':'success'},
                {'name':'Test dashboard','status':'completed' if finished else 'in_progress','conclusion':'failure' if failed else 'success' if idle else None}]})
        store.meta('ci-status',{'lastSuccessAt':now,'error':None})
        store.meta('ci-runners',{'enabled':True,'measuredAt':now,'items':[
            {'id':1,'repository':'example/home-dashboard','name':'sample-ryzen-linux','status':'offline' if current['scenario']=='ci-offline' else 'online','busy':not finished,'os':'linux'},
            {'id':2,'repository':'example/home-dashboard','name':'sample-ryzen-windows','status':'offline' if current['scenario']=='ci-offline' else 'online','busy':False,'os':'windows'},
            {'id':3,'repository':'example/home-dashboard','name':'sample-intel-linux','status':'offline','busy':False,'os':'linux'},
        ]})
    seed()
    @app.post('/api/admin/v1/local-scenario')
    async def set_scenario(request:Request):
        if request.headers.get('origin') not in (f'http://127.0.0.1:{ui_port}',f'http://localhost:{ui_port}'):
            raise HTTPException(403,'Local preview origin required')
        value=(await request.json()).get('scenario')
        if value not in ['normal','backup-failure','disk-missing','low-space','collector-offline','service-failure','ci-failure','ci-server-failure','ci-idle','ci-offline']:
            raise HTTPException(400,'Unknown preview scenario')
        current['scenario']=value;seed()
        return {'scenario':value}
    stop=threading.Event()
    def loop():
        while not stop.wait(5):seed()
    threading.Thread(target=loop,daemon=True).start()
    return app


if __name__=='__main__':
    import uvicorn
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--port',type=int,default=18765)
    parser.add_argument('--ui-port',type=int,default=4178)
    args=parser.parse_args()
    uvicorn.run(make_demo(ui_port=args.ui_port),host='127.0.0.1',port=args.port,log_level='warning')
