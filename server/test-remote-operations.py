import json
import datetime as dt
import subprocess
import unittest
from unittest.mock import patch

import remote_operations_probe as probe
import monitoring_collector as collector
from monitoring_common import utcnow
from monitoring_store import MonitorStore


class OperationsTests(unittest.TestCase):
    def docker_read(self,args,**kwargs):
        if args[:3]==['docker','ps','-a']:return 'app\nold-test\n'
        if args[:2]==['docker','inspect']:
            return '\n'.join('\t'.join(json.dumps(v) for v in row) for row in [
                ['/app','running',1,utcnow().isoformat(),'healthy'],
                ['/old-test','exited',0,utcnow().isoformat(),None]])
        raise AssertionError('Unexpected command: '+str(args))

    def test_service_discovery_reads_only_selected_fields_and_marks_expected_missing(self):
        with patch.object(probe,'run',side_effect=self.docker_read) as run:
            result=probe.collect({'expectedRunning':['app','missing'],'logTargets':[]})
        self.assertEqual(len(result['services']),3)
        self.assertEqual(result['services'][1]['expectedState'],'unknown')
        self.assertEqual(result['services'][2]['state'],'unknown')
        for call in run.call_args_list:
            self.assertIn(call.args[0][1],['ps','inspect'])
            self.assertNotIn('.Env',str(call))
            self.assertNotIn('{{json .}}',str(call))

    def test_stopped_test_container_is_not_a_service_failure(self):
        with patch.object(probe,'run',side_effect=self.docker_read):
            result=probe.collect({'expectedRunning':['app'],'logTargets':[]})
        store=MonitorStore({'hosts':[{'id':'host'}]})
        try:
            observed=utcnow()
            store.ingest({'hostId':'host','measuredAt':observed.isoformat(),'services':result['services']})
            self.assertFalse(any(a['tab']=='logs' for a in store.summary()['alerts']))
            result['services'][1]['expectedState']='running'
            self.assertTrue(store.ingest({'hostId':'host','measuredAt':(observed+dt.timedelta(seconds=1)).isoformat(),'services':result['services']}))
            self.assertTrue(any(a['tab']=='logs' for a in store.summary()['alerts']))
        finally:store.close()

    def test_logs_redacted_before_transport_including_json_headers_and_key_lines(self):
        at=utcnow().isoformat()
        messages=['{"Authorization":"Bearer RAWAUTH","Cookie":"a=RAWCOOKIE; session=RAWTWO"}',
                  '-----BEGIN RSA PRIVATE KEY-----','RAWKEYBODY','-----END RSA PRIVATE KEY-----','token=RAWTOKEN']
        response=subprocess.CompletedProcess([],0,'\n'.join(at+' '+m for m in messages),'')
        with patch.object(collector.subprocess,'run',return_value=response) as run:
            logs=collector.collect_logs({'id':'app','target':'app','kind':'docker','logs':True,'logLines':30})
        self.assertNotIn('RAW',json.dumps(logs))
        self.assertIn('[REDACTED',json.dumps(logs))
        self.assertEqual(run.call_args.args[0][:6],['docker','logs','--timestamps','--tail','30','--since'])
        with patch.object(collector.subprocess,'run') as run:
            with self.assertRaises(ValueError):collector.collect_logs({'id':'x','kind':'docker','target':'--all','logs':True})
            run.assert_not_called()

    def test_failed_backup_read_retains_snapshot_and_observation_time(self):
        previous={'id':'backup','name':'Backup','role':'primary','repository':'/backup','measuredAt':'2026-01-01T00:00:00Z',
                  'snapshots':[{'id':'a'*64,'kind':'full','complete':True,'time':'2026-01-01T00:00:00Z'}]}
        with patch.object(probe,'run',side_effect=self.docker_read),patch.object(probe,'collect_backup',side_effect=OSError):
            result=probe.collect({'backups':[{'id':'backup','role':'primary'}]},True,{'backup':previous})
        backup=result['backups'][0]
        self.assertEqual(backup['status'],'unknown')
        self.assertEqual(backup['snapshots'],previous['snapshots'])
        self.assertEqual(backup['measuredAt'],previous['measuredAt'])

    def test_log_permission_failure_is_not_an_empty_success(self):
        with patch.object(probe,'run',side_effect=self.docker_read),patch.object(probe,'collect_logs',side_effect=RuntimeError):
            result=probe.collect({'logTargets':['app']})
        self.assertEqual(result['logSources'][0]['status'],'error')
        self.assertEqual(result['logs'],[])


if __name__=='__main__':unittest.main()
