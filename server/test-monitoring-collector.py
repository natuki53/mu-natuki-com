import contextlib
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('monitoring_collector.py'))
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)


class CollectorTests(unittest.TestCase):
    def test_docker_inspection_never_requests_environment(self):
        calls=[]
        def run(args,**kwargs):
            calls.append(args)
            return '2' if args[-2]=='{{.RestartCount}}' else json.dumps({'Status':'running','Health':{'Status':'healthy'}})
        with patch.object(collector,'run',side_effect=run):
            status=collector.collect_service({'id':'app','kind':'docker','target':'app'})
        self.assertEqual(status['state'],'running');self.assertEqual(status['restarts'],2)
        self.assertTrue(all(a[:2]==['docker','inspect'] for a in calls))
        self.assertFalse(any('Env' in str(a) for a in calls))
    def test_invalid_service_target_rejected_before_execution(self):
        with patch.object(collector,'run') as run:
            with self.assertRaises(ValueError):collector.collect_service({'id':'x','kind':'docker','target':'--privileged'})
            run.assert_not_called()
    def test_mismatched_uuid_does_not_read_repository(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);config=root/'config.json'
            config.write_text(json.dumps({'storage_root':temp,'restic_password_file':'unused','retention':{'hourly':48},'minimum_free_bytes':1}))
            with patch.object(collector,'job_state',side_effect=lambda root,kind,config:{'kind':kind}),patch.object(collector,'disk_info',return_value={'path':temp,'mounted':True,'uuidMatches':False}),patch.object(collector,'run') as run:
                result=collector.collect_backup({'id':'backup','role':'primary','configFile':str(config)})
            self.assertEqual(result['status'],'failed');run.assert_not_called()
    def test_cheap_refresh_keeps_inventory_timestamp_and_refreshes_jobs(self):
        with tempfile.TemporaryDirectory() as temp:
            config=Path(temp)/'config.json'
            config.write_text(json.dumps({'storage_root':temp,'restic_password_file':'unused','retention':{'hourly':48},'minimum_free_bytes':1}))
            previous={'measuredAt':'2026-01-01T00:00:00+00:00','snapshots':[],'status':'ok','retention':{'hourly':2}}
            with patch.object(collector,'job_state',side_effect=lambda root,kind,config:{'kind':kind,'phase':'failed'}),patch.object(collector,'disk_info',return_value={'path':temp}),patch.object(collector,'run') as run:
                result=collector.collect_backup({'id':'backup','role':'primary','configFile':str(config)},False,previous)
            self.assertEqual(result['measuredAt'],previous['measuredAt']);self.assertEqual(result['jobs'][0]['phase'],'failed');run.assert_not_called()
            self.assertEqual(result['retention'],{'hourly':48})
    def test_transport_rejects_unencrypted_nonlocal_destination(self):
        with self.assertRaises(ValueError):collector.push({'ingestUrl':'http://192.168.1.1/internal'}, {})
    def test_systemd_timestamp_is_explicitly_utc(self):
        self.assertEqual(collector.systemd_time('Sun 2026-10-25 00:00:00 UTC'),'2026-10-25T00:00:00+00:00')
    def test_latest_replica_observation_and_verified_source_mapping(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'state').mkdir()
            config=root/'config.json'
            config.write_text(json.dumps({'storage_root':temp,'restic_password_file':'private-password','minimum_free_bytes':20,'max_age_hours':{'full':30,'db':3}}))
            (root/'state/success.json').write_text(json.dumps({'success_at':1000,'verified':True,'read_data':True,'snapshot_ids':{'full':'b'*64},'source_ids':{'full':'a'*64}}))
            (root/'state/observation.json').write_text(json.dumps({'status':'ok','observed_at':2000}))
            snaps=[{'id':'b'*64,'original':'c'*64,'tags':['vrnavi','complete','full'],'time':'2026-01-01T00:00:00Z'}]
            def run(args,**kwargs):return '*/5 * * * * python latest_scheduled.py --config '+str(config) if args[0]=='crontab' else json.dumps(snaps)
            with patch.object(collector,'run',side_effect=run),patch.object(collector,'repository_read_lock',return_value=contextlib.nullcontext()),patch.object(collector,'disk_info',return_value={'path':temp}),patch.object(collector,'directory_bytes',return_value=1):
                result=collector.collect_backup({'id':'b','role':'secondary','latestConfigFile':str(config)})
            self.assertEqual(result['retention'],{'full':1,'db':1})
            self.assertEqual(result['snapshots'][0]['sourceId'],'a'*64)
            self.assertEqual(result['jobs'][0]['lastSuccessAt'],collector.iso_epoch(2000))
            self.assertEqual(result['jobs'][1]['lastSuccessAt'],collector.iso_epoch(1000))
            self.assertIsNotNone(result['jobs'][0]['nextRunAt'])
            self.assertEqual(result['jobs'][0]['scheduleMode'],'scheduled')
            self.assertEqual(result['jobs'][1]['scheduleMode'],'on-copy-change')
            self.assertNotIn('private-password',json.dumps(result))
    def test_archive_has_no_snapshot_freshness_deadline(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'archive-verification.json').write_text(json.dumps({'archiveVerified':True,'verified_at':1000,'fullDataRead':True}))
            with patch.object(collector,'run',return_value='[]'),patch.object(collector,'repository_read_lock',return_value=contextlib.nullcontext()),patch.object(collector,'disk_info',return_value={'path':temp}),patch.object(collector,'directory_bytes',return_value=1):
                result=collector.collect_backup({'id':'archive','role':'archive','root':temp,'passwordFile':'private-password'})
            self.assertEqual(result['maxSnapshotAgeHours'],{})
            self.assertEqual(result['jobs'][0]['kind'],'check')
            self.assertTrue(result['jobs'][0]['readData'])
            self.assertEqual(result['jobs'][0]['scheduleMode'],'manual')

    def test_timer_dates_are_read_independently_of_service_status(self):
        def run(args,**kwargs):
            if any(a.endswith('.service') for a in args):raise RuntimeError('Unavailable service')
            return 'LoadState=loaded\nActiveState=active\nNextElapseUSecRealtime=Sun 2026-11-01 06:00:00 UTC\n'
        with tempfile.TemporaryDirectory() as temp,patch.object(collector,'run',side_effect=run):
            job=collector.job_state(Path(temp),'deep-check',{})
        self.assertEqual(job['scheduleMode'],'scheduled')
        self.assertEqual(job['nextRunAt'],'2026-11-01T06:00:00+00:00')
        self.assertEqual(job['phase'],'unknown')

    def test_inactive_missing_and_running_timers_are_distinct(self):
        cases=[('loaded','inactive','inactive','disabled'),('not-found','inactive','inactive','unknown'),('loaded','active','active','after-run')]
        for loaded,timer_state,service_state,mode in cases:
            with self.subTest(mode=mode):
                def run(args,**kwargs):
                    if any(a.endswith('.service') for a in args):return f'ActiveState={service_state}\nResult=success'
                    return f'LoadState={loaded}\nActiveState={timer_state}\nNextElapseUSecRealtime=n/a'
                with tempfile.TemporaryDirectory() as temp,patch.object(collector,'run',side_effect=run):
                    job=collector.job_state(Path(temp),'db',{})
                self.assertEqual(job['scheduleMode'],mode)
                self.assertIsNone(job.get('nextRunAt'))

    def test_structural_check_does_not_count_as_successful_full_data_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'state').mkdir()
            (root/'state/check.json').write_text(json.dumps({'completed_at':'2026-10-25T05:00:00Z','read_data':False}))
            with patch.object(collector,'run',return_value='ActiveState=inactive\nResult=success\nExecMainExitTimestamp=Sun 2026-10-04 06:00:00 UTC'):
                job=collector.job_state(root,'deep-check',{})
            self.assertEqual(job['lastSuccessAt'],'2026-10-04T06:00:00+00:00')
            self.assertTrue(job['readData'])

    def test_scheduled_verification_uses_installed_reader_and_preserves_failed_attempt(self):
        target={'role':'archive','verificationConfigFile':'/private/verify.json','verificationScript':'/code/repository_verify.py'}
        status={'repository':'/hdd/repository','jobs':[{'kind':'check','phase':'idle','scheduleMode':'scheduled','nextRunAt':'2026-10-27T04:30:00+09:00'},
                {'kind':'restore','phase':'failed','scheduleMode':'scheduled','nextRunAt':'2026-10-26T04:30:00+09:00','lastFailureAt':'2026-10-25T06:00:00Z','error':'Test failed'}]}
        old=[{'kind':'restore','lastSuccessAt':'2026-10-24T00:00:00Z','snapshotId':'a'*64,'scheduleMode':'manual'}]
        with patch.object(collector,'run',return_value=json.dumps(status)) as run:
            jobs=collector.verification_jobs(target,Path('/hdd/repository'),old)
        restored=next(j for j in jobs if j['kind']=='restore')
        self.assertEqual(restored['lastSuccessAt'],old[0]['lastSuccessAt'])
        self.assertEqual(restored['phase'],'failed');self.assertEqual(restored['scheduleMode'],'scheduled')
        self.assertEqual(run.call_args.args[0][-1],'status')

    def test_unavailable_or_wrong_verification_reader_never_keeps_old_schedule(self):
        target={'role':'secondary','verificationConfigFile':'/private/verify.json','verificationScript':'/code/repository_verify.py'}
        old=[{'kind':'check','scheduleMode':'on-copy-change'},{'kind':'restore','scheduleMode':'scheduled','nextRunAt':'2026-10-27T00:00:00Z'}]
        for output in ['invalid',json.dumps({'repository':'/wrong','jobs':[{'kind':'restore'}]})]:
            with patch.object(collector,'run',return_value=output):jobs=collector.verification_jobs(target,Path('/expected'),old)
            self.assertEqual(jobs[0]['scheduleMode'],'on-copy-change')
            self.assertEqual(jobs[1]['scheduleMode'],'unknown');self.assertIsNone(jobs[1]['nextRunAt'])


if __name__=='__main__':unittest.main()
