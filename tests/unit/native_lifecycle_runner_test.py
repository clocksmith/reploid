"""No model/GPU imports: verify the frozen comparison's lifecycle request contract."""
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).resolve().parents[1] / "fixtures/peers/pooled/compare-complete.py"
spec = importlib.util.spec_from_file_location("native_lifecycle_comparison", path)
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)


class NativeLifecycleRunnerTest(unittest.TestCase):
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
