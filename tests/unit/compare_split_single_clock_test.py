"""CPU unit tests for the matched single-requester-clock two-machine split comparison harness."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "fixtures/peers/pooled/compare-split-single-clock.py"
SPEC = importlib.util.spec_from_file_location("a1_split_single_clock", SOURCE)
split_mod = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(split_mod)


class CompareSplitSingleClockTest(unittest.TestCase):
    def test_single_clock_protocol_separates_startup_post_open_first_and_repeats(self):
        worker_code = """import json, sys, time
kind = sys.argv[1]
for line in sys.stdin:
    req = json.loads(line)
    op = req["op"]
    if op == "open":
        time.sleep(0.02 if kind == "candidate" else 0.04)
        val = {"split": {"ranges": [[0, 43], [43, 48]]}}
    elif op == "request":
        delay = (0.03 if req["repeat"] == 0 else 0.01) if kind == "candidate" else (0.025 if req["repeat"] == 0 else 0.02)
        t0 = time.perf_counter()
        time.sleep(delay)
        val = {"text": "exact-split-answer", "requestWallMs": (time.perf_counter() - t0) * 1000.0}
    else:
        val = {"cleanup": "settled"}
    print("@q4-response " + json.dumps({"id": req["id"], "requestOp": op, "value": val}), flush=True)
    if op == "close":
        break
"""
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            worker_file = root / "worker.py"
            worker_file.write_text(worker_code)
            cache_dir = Path("/tmp") / f"a1-split-test-cache-{hashlib.sha256(root_str.encode()).hexdigest()[:12]}"
            cache_dir.mkdir(parents=True, exist_ok=True)
            (cache_dir / "piece.bin").write_bytes(b"stale")
            freeze = {
                "schema": "a1.split-single-clock-comparison/v1",
                "scope": "unit test single-clock split",
                "expectedRanges": [[0, 43], [43, 48]],
                "pattern": ["candidate", "pooled"],
                "armTimeoutSeconds": 10,
                "protectedCacheDirectories": [str(cache_dir)],
                "filePins": [{
                    "path": str(worker_file),
                    "bytes": worker_file.stat().st_size,
                    "sha256": hashlib.sha256(worker_file.read_bytes()).hexdigest(),
                }],
                "workloads": [
                    {"name": "w1", "classification": "frozen", "prompt": "p1", "promptIds": [1, 2], "maxNew": 4, "stopIds": [9]},
                    {"name": "w2", "classification": "heldout", "prompt": "p2", "promptIds": [3, 4], "maxNew": 4, "stopIds": [9]},
                ],
                "arms": {
                    "candidate": {"command": [sys.executable, "-u", str(worker_file), "candidate"]},
                    "pooled": {"command": [sys.executable, "-u", str(worker_file), "pooled"]},
                },
            }
            freeze_path = root / "freeze-split.json"
            raw = json.dumps(freeze, indent=2).encode("utf-8")
            freeze_path.write_bytes(raw)
            sha = hashlib.sha256(raw).hexdigest()

            preflight_out = root / "preflight-out"
            pre = subprocess.run(
                [sys.executable, str(SOURCE), str(freeze_path), "--sha256", sha, "--output", str(preflight_out)],
                capture_output=True, text=True, check=True, timeout=10,
            )
            self.assertTrue(json.loads(pre.stdout)["metadataPreflightPassed"])

            exec_out = root / "exec-out"
            subprocess.run(
                [sys.executable, str(SOURCE), str(freeze_path), "--sha256", sha, "--output", str(exec_out), "--execute"],
                capture_output=True, text=True, check=True, timeout=15,
            )
            report = json.loads((exec_out / "report.json").read_text())
            self.assertTrue(report["completed"])
            self.assertEqual(len(report["arms"]), 4)
            self.assertFalse(cache_dir.exists())
            cand_agg = report["aggregates"]["candidate"]
            pool_agg = report["aggregates"]["pooled"]
            self.assertLess(cand_agg["startupWallMeanMs"], pool_agg["startupWallMeanMs"])
            self.assertLess(cand_agg["repeatRequestClientMeanMs"], pool_agg["repeatRequestClientMeanMs"])
            for arm in report["arms"]:
                s = arm["summary"]
                self.assertAlmostEqual(
                    s["openPlusFirstAnswerClientMs"],
                    s["startupWallMs"] + s["postOpenFirstRequestClientMs"],
                    places=5,
                )

    def test_mismatched_split_layer_placement_is_rejected(self):
        with self.assertRaises(AssertionError):
            split_mod.summarize_split_arm(
                "w1", "pooled", 100.0,
                {"split": {"ranges": [[0, 40], [40, 48]]}, "clientOpenWallMs": 90.0},
                [{"clientRequestWallMs": 10.0, "requestWallMs": 9.0}] * 3,
                [[0, 43], [43, 48]],
            )


if __name__ == "__main__":
    unittest.main()
