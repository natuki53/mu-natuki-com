import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from monitoring_collector import Collector, push
from monitoring_models import Observation, utcnow
from monitoring_store import MonitorStore
from monitoring_github import GitHubMonitor, GitHubUnavailable


class ProductionCollectorTests(unittest.TestCase):
    def test_native_payload_contract_and_cache_use_same_reader_as_preview(self):
        at=utcnow().isoformat()
        machine={'name':'ci-vm','state':'shut off','vcpus':2,'memoryKiB':4096,'autostart':'disable'}
        host={'measuredAt':at,'cpuPct':1,'memoryPct':2,'uptimeSeconds':3,'blockdevices':[],
              'machines':[machine],'machinesStatus':'ok','errors':[]}
        ops={'measuredAt':at,'services':[],'logs':[],'backups':[],'errors':[]}
        with patch('remote_host_probe.probe',return_value=host),patch('remote_operations_probe.collect',return_value=ops):
            raw=Collector({'hostId':'intel','operations':{}}).collect()
        Observation.model_validate(raw)
        store=MonitorStore({'hosts':[{'id':'intel','machineRunners':{'ci-vm':'runner'}}]})
        try:
            store.ingest(raw)
            self.assertTrue(store.ci_summary()['servers'][0]['machinesFresh'])
            self.assertEqual(store.summary()['hosts'][0]['machines'][0]['state'],'shut off')
        finally:store.close()

    def test_private_ca_is_verified_and_missing_ca_fails_closed(self):
        with tempfile.TemporaryDirectory() as temp:
            p=Path(temp)/'key';p.write_text('k'*40)
            with self.assertRaises(FileNotFoundError):
                push({'ingestUrl':'https://192.168.1.10/internal','secretFile':str(p),'caFile':str(p.parent/'absent')},{})


class ProductionCITests(unittest.TestCase):
    def test_history_limit_does_not_remove_active_runs(self):
        store=MonitorStore({'github':{'repositories':['owner/repo']}})
        try:
            store.record_ci('owner/repo','run',{'id':1,'status':'in_progress'})
            for i in range(2,205):store.record_ci('owner/repo','run',{'id':i,'status':'completed'})
            self.assertTrue(any(r['id']==1 for r in store.ci_summary()['runs']))
        finally:store.close()

    def test_long_running_job_and_completion_survive_poll_restart(self):
        class Client:
            repositories={'owner/repo'}
            active=True
            def get(self,path):
                if path.endswith('/runs/1'):return {'id':1,'status':'completed','conclusion':'success'}
                if '/jobs?' in path:return {'jobs':[{'id':2,'run_id':1,'status':'in_progress' if self.active else 'completed'}]}
                rows=[{'id':1,'status':'in_progress'}] if path.endswith('status=in_progress') and self.active else []
                return {'workflow_runs':rows,'total_count':len(rows)}
        store=MonitorStore({'github':{'repositories':['owner/repo']}})
        client=Client()
        try:
            GitHubMonitor(store,client).reconcile()
            self.assertEqual(store.ci_summary()['runs'][0]['status'],'in_progress')
            client.active=False
            GitHubMonitor(store,client).reconcile()
            self.assertEqual(store.ci_summary()['runs'][0]['status'],'completed')
            self.assertEqual(store.ci_summary()['jobs'][0]['status'],'completed')
        finally:store.close()

    def test_truncated_active_inventory_never_reports_fresh(self):
        class Client:
            repositories={'owner/repo'}
            def get(self,path):return {'workflow_runs':[],'total_count':101} if 'status=' in path else {'workflow_runs':[]}
        store=MonitorStore({'github':{'repositories':['owner/repo']}})
        try:
            GitHubMonitor(store,Client()).reconcile()
            self.assertEqual(store.ci_summary()['state'],'error')
        finally:store.close()

    def test_truncated_runner_inventory_never_reports_free_capacity(self):
        class Client:
            repositories={'owner/repo'}
            def get(self,path):
                return {'runners':[],'total_count':101} if '/runners?' in path else {'workflow_runs':[]}
        store=MonitorStore({'hosts':[{'id':'intel'}],'github':{'repositories':['owner/repo'],'includeRunners':True}})
        try:
            GitHubMonitor(store,Client()).reconcile()
            self.assertEqual(store.ci_summary()['runnerInventoryState'],'error')
        finally:store.close()


if __name__=='__main__':unittest.main()
