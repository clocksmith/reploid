import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('sampler',Path(__file__).with_name('a1-resource-sampler.py'))
sampler=importlib.util.module_from_spec(spec);spec.loader.exec_module(sampler)

class SamplerTest(unittest.TestCase):
    def test_delta_refuses_missing_reused_or_reset_counters(self):
        old={'available':True,'pid':5,'startTicks':'10','io':{'read_bytes':100,'rchar':200}}
        new={**old,'io':{'read_bytes':130,'rchar':300}}
        self.assertEqual(sampler.io_delta(old,new),{'read_bytes':30,'rchar':100})
        self.assertIsNone(sampler.io_delta(None,new))
        self.assertIsNone(sampler.io_delta(old,{**new,'startTicks':'11'}))
        self.assertIsNone(sampler.io_delta(old,{**new,'io':{'read_bytes':1}}))
    def test_explicit_phase_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'phase.json'
            self.assertFalse(sampler.phase_snapshot(path)['available'])
            path.write_text('{');self.assertFalse(sampler.phase_snapshot(path)['available'])
            path.write_text(json.dumps({'runId':'r','armId':'a','phase':'open','eventId':'1'}))
            self.assertEqual(sampler.phase_snapshot(path)['phase'],'open')
    def test_unavailable_process_is_not_zero_io(self):
        with tempfile.TemporaryDirectory() as directory:
            result=sampler.process_snapshot(123,Path(directory))
            self.assertFalse(result['available']);self.assertNotIn('io',result)
    def test_harness_context_never_claims_request_phase(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'report.json'
            path.write_text(json.dumps({'freezeSha256':'a'*64,'arms':[{}], 'stage':{'kind':'candidate'}}))
            result=sampler.harness_context(path,'a'*64)
            self.assertTrue(result['available']);self.assertFalse(result['requestPhaseAttribution'])
            self.assertEqual(result['completedArms'],1)
            self.assertFalse(sampler.harness_context(path,'b'*64)['available'])
            path.write_text('{');self.assertFalse(sampler.harness_context(path,'a'*64)['available'])

    def test_report_valid_json_with_wrong_shape_is_unavailable(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'report'
            for value in ([],None,{'freezeSha256':'a'*64,'arms':None}):
                path.write_text(json.dumps(value))
                self.assertFalse(sampler.harness_context(path,'a'*64)['available'])

    def test_pid_reused_during_snapshot_is_unavailable(self):
        first='5 (worker name) '+' '.join(['0']*19+['10'])
        second='5 (worker name) '+' '.join(['0']*19+['11'])
        with patch.object(Path,'read_text',side_effect=[first,'read_bytes: 7',second]):
            self.assertEqual(sampler.process_snapshot(5)['reason'],'pid-reused-during-snapshot')

    def test_same_phase_name_with_new_event_is_distinct(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'marker'
            marker={'runId':'r','armId':'a','phase':'request','eventId':'1'}
            path.write_text(json.dumps(marker));before=sampler.phase_snapshot(path)
            marker['eventId']='2';path.write_text(json.dumps(marker))
            self.assertNotEqual(before,sampler.phase_snapshot(path))

    def test_residency_rejects_unowned_files_before_query(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'model';path.write_bytes(b'test')
            with patch.object(sampler.os,'geteuid',return_value=path.stat().st_uid+1), patch.object(sampler.subprocess,'run') as run:
                result=sampler.residency([path])
                self.assertFalse(result['available']);run.assert_not_called()

    def test_residency_missing_tool_is_explicit(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'model';path.write_bytes(b'test')
            with patch.object(sampler.subprocess,'run',side_effect=FileNotFoundError) as run:
                self.assertFalse(sampler.residency([path])['available'])
                run.assert_called_once()

if __name__=='__main__':unittest.main()
