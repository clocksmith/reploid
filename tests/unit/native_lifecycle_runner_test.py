"""No model/GPU imports: verify the frozen comparison's lifecycle request contract."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / "fixtures/peers/pooled/compare-complete.py"
spec = importlib.util.spec_from_file_location("native_lifecycle_comparison", path)
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class NativeLifecycleRunnerTest(unittest.TestCase):
    def test_setup_clock_includes_owned_startup_and_preflight_before_open(self):
        import sys
        script = """import sys,time,json
time.sleep(.05)
for line in sys.stdin:
 request=json.loads(line)
 if request['op']=='preflight':time.sleep(.02)
 if request['op']=='open':time.sleep(.01)
 print('@q4-response '+json.dumps({'id':request['id'],'requestOp':request['op'],'value':{}}),flush=True)
 if request['op']=='close':break
"""
        with tempfile.TemporaryDirectory() as directory:
            rows = comparison.protocol_run([sys.executable, "-u", "-c", script],
                                           [{"op": op} for op in ["preflight", "open", "close"]],
                                           Path(directory) / "worker.log", 5)
        self.assertEqual(rows[1]["clientSetupScope"], "owned-worker-startup-preflight-open/v1")
        self.assertGreaterEqual(rows[1]["clientSetupWallMs"], 70)
        self.assertGreater(rows[1]["clientSetupWallMs"], rows[1]["clientOpenWallMs"])
        self.assertNotIn("clientSetupWallMs", rows[0])

    def test_engine_environment_is_explicit_not_inherited(self):
        with patch.dict(os.environ, {"POOLED_FLASH_KV": "f32", "DOPPLER_DEBUG": "1", "NODE_OPTIONS": "ambient",
                                   "DAWN_OPTS": "ambient", "UV_THREADPOOL_SIZE": "99", "RN_DEBUG": "1"}):
            clean = comparison.clean_environment()
            self.assertNotIn("POOLED_FLASH_KV", clean)
            self.assertNotIn("DOPPLER_DEBUG", clean)
            self.assertNotIn("NODE_OPTIONS", clean)
            for key in ["DAWN_OPTS", "UV_THREADPOOL_SIZE", "RN_DEBUG"]:
                self.assertNotIn(key, clean)
            self.assertEqual(clean.get("PATH"), os.environ.get("PATH"))
            explicit = comparison.clean_environment({"POOLED_FLASH_KV": "f16"})
            self.assertEqual(explicit["POOLED_FLASH_KV"], "f16")
            self.assertEqual(comparison.clean_environment({"POOLED_WIRE_DUP": ""})["POOLED_WIRE_DUP"], "")
            with self.assertRaises(AssertionError):
                comparison.clean_environment({"POOLED_FLASH_KV": 16})

    def test_owned_worker_receives_only_declared_engine_overrides(self):
        import sys
        script = """import sys,os,json
for line in sys.stdin:
 request=json.loads(line)
 print('@q4-response '+json.dumps({'id':request['id'],'requestOp':request['op'],'value':{
  'peer':os.environ.get('POOLED_FLASH_KV'),'native':os.environ.get('DOPPLER_DEBUG')}}),flush=True)
 if request['op']=='close':break
"""
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"POOLED_FLASH_KV": "ambient", "DOPPLER_DEBUG": "ambient"}):
            rows = comparison.protocol_run([sys.executable, "-u", "-c", script], [{"op": "close"}],
                                           Path(directory) / "worker.log", 5, {"POOLED_FLASH_KV": "f16"})
        self.assertEqual(rows[0]["peer"], "f16")
        self.assertIsNone(rows[0]["native"])
        self.assertTrue(rows[0]["ownedProcessExit"]["graceful"])

    def test_heldout_inputs_cannot_repeat_frozen_cases_or_collide_on_disk(self):
        frozen = {"name": "first", "classification": "frozen", "prompt": "first", "promptIds": [1],
                  "maxNew": 2, "stopIds": [9]}
        heldout = dict(frozen, name="second", classification="heldout", prompt="second", promptIds=[2])
        comparison.validate_workloads([frozen, heldout])
        for changed in [dict(heldout, name="first"), dict(heldout, promptIds=[1]),
                        dict(heldout, name="../outside"), dict(heldout, classification="frozen")]:
            with self.assertRaises(AssertionError):
                comparison.validate_workloads([frozen, changed])

    def test_lifecycle_runs_after_timing_and_before_receipts_and_close(self):
        workload = {"prompt": "held-out", "promptIds": [1], "maxNew": 3, "stopIds": [9]}
        requests = comparison.native_requests(workload, True)
        self.assertEqual([row["op"] for row in requests], ["preflight", "open", "request", "request",
                                                         "request", "lifecycle", "receipts", "close"])
        self.assertEqual([row["repeat"] for row in requests[2:5]], [0, 1, 2])
        self.assertEqual(requests[5], dict(workload, op="lifecycle"))
        self.assertNotIn("op", workload)

    def test_legacy_freeze_does_not_silently_add_model_work(self):
        requests = comparison.native_requests({"maxNew": 1}, False)
        self.assertEqual([row["op"] for row in requests][-2:], ["receipts", "close"])
        self.assertNotIn("lifecycle", [row["op"] for row in requests])
        with self.assertRaisesRegex(AssertionError, "multi-token"):
            comparison.native_requests({"maxNew": 1}, True)

    def test_partial_or_unobserved_cancellation_receipts_fail(self):
        value = {"schema": "reploid.native-complete-lifecycle/v1", "observedTokens": 1,
                 "first": {"sampledIds": [5]}, "repeat": {"sampledIds": [5]}, "recovered": {"sampledIds": [5]},
                 "phases": [{"name": name} for name in ["first-complete-request", "repeated-complete-request",
                            "pre-aborted-request", "active-cancellation-settled", "recovered-complete-request"]]}
        self.assertEqual(comparison.lifecycle_outputs(value), [value["first"], value["repeat"], value["recovered"]])
        for changes in [{"observedTokens": 0}, {"phases": value["phases"][:-1]}, {"schema": "other"}]:
            with self.assertRaises(AssertionError):
                comparison.lifecycle_outputs(dict(value, **changes))


if __name__ == "__main__":
    unittest.main()
