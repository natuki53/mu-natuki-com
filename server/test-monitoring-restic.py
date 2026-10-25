"""Opt-in integration against an entirely synthetic restic repository in /tmp."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('monitoring_collector.py'))
collector=importlib.util.module_from_spec(spec);spec.loader.exec_module(collector)


@unittest.skipUnless(os.environ.get('MONITOR_RESTIC_INTEGRATION')=='1','Explicit isolated integration opt-in required')
class ResticIntegration(unittest.TestCase):
    def test_inventory_reads_real_repository_without_mutation(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'state').mkdir();(root/'state/job.lock').touch()
            password=root/'password';password.write_text('synthetic-integration-only')
            data=root/'work';data.mkdir();(data/'database.sql').write_text('CREATE TABLE sample (id INT);')
            env={**os.environ,'RESTIC_REPOSITORY':str(root/'restic'),'RESTIC_PASSWORD_FILE':str(password)}
            def restic(*args):subprocess.run(['restic',*args],env=env,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            restic('init','--repository-version','2')
            for kind,tag in [('full','complete'),('db','complete'),('full','pending')]:restic('backup','--tag',f'vrnavi,{kind},{tag}',str(data))
            config=root/'config.json';config.write_text(json.dumps({'storage_root':str(root),'restic_password_file':str(password),
                'retention':{'hourly':48,'daily':30,'weekly':8,'monthly':12},'minimum_free_bytes':1}))
            def hashes():return {str(p.relative_to(root/'restic')):hashlib.sha256(p.read_bytes()).hexdigest() for p in (root/'restic').rglob('*') if p.is_file()}
            before=hashes();result=collector.collect_backup({'id':'backup','role':'primary','configFile':str(config)})
            self.assertEqual(result['status'],'ok');self.assertEqual(len(result['snapshots']),3)
            self.assertEqual(sum(s['complete'] for s in result['snapshots']),2)
            self.assertGreater(result['repositoryBytes'],0);self.assertEqual(before,hashes())

    def test_repository_writer_lock_returns_previous_inventory_without_running_restic(self):
        import fcntl
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'state').mkdir();(root/'state/job.lock').touch();(root/'state/repository.lock').touch()
            config=root/'config.json';config.write_text(json.dumps({'storage_root':temp,'restic_password_file':'unused',
                'retention':{'daily':30},'minimum_free_bytes':1}))
            previous={'snapshots':[{'id':'a'*64,'kind':'full','complete':True,'time':'2026-01-01T00:00:00Z'}],
                'measuredAt':'2026-01-01T00:00:00Z'}
            with (root/'state/repository.lock').open('rb') as writer:
                fcntl.flock(writer,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with patch.object(collector,'job_state',return_value={'kind':'full','phase':'running'}),patch.object(collector,'run') as run:
                    result=collector.collect_backup({'id':'backup','role':'primary','configFile':str(config)},True,previous)
                run.assert_not_called()
            self.assertEqual(result['status'],'unknown')
            self.assertEqual(result['snapshots'],previous['snapshots'])
            self.assertEqual(result['measuredAt'],previous['measuredAt'])


if __name__=='__main__':unittest.main()
