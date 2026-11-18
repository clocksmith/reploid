"""Matched single-requester-clock two-machine split comparison. Default is no-GPU metadata preflight."""
import argparse
import hashlib
import json
from pathlib import Path
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from complete_request_client import CompleteRequestClient
import importlib.util

_cc_spec = importlib.util.spec_from_file_location(
    "a1_compare_complete_base", Path(__file__).resolve().parent / "compare-complete.py"
)
compare_base = importlib.util.module_from_spec(_cc_spec)
_cc_spec.loader.exec_module(compare_base)


def summarize_split_arm(workload_name, kind, startup_wall_ms, opened_value, rows, expected_ranges):
    assert len(rows) == 3, "Split arm requires one fresh request and two repeats"
    split = opened_value.get("split")
    ranges = split["ranges"] if isinstance(split, dict) and "ranges" in split else split
    assert ranges == expected_ranges, f"Split placement {ranges!r} differs from frozen {expected_ranges!r}"
    first_client_ms = float(rows[0]["clientRequestWallMs"])
    first_core_ms = float(rows[0]["requestWallMs"])
    repeat_client_ms = [float(rows[1]["clientRequestWallMs"]), float(rows[2]["clientRequestWallMs"])]
    repeat_core_ms = [float(rows[1]["requestWallMs"]), float(rows[2]["requestWallMs"])]
    return {
        "workload": workload_name,
        "kind": kind,
        "clockScope": "single-requester-clock-monotonic/v1",
        "expectedRanges": expected_ranges,
        "startupWallMs": startup_wall_ms,
        "clientOpenWallMs": float(opened_value["clientOpenWallMs"]),
        "postOpenFirstRequestClientMs": first_client_ms,
        "postOpenFirstRequestCoreMs": first_core_ms,
        "openPlusFirstAnswerClientMs": startup_wall_ms + first_client_ms,
        "openPlusFirstAnswerCoreMs": startup_wall_ms + first_core_ms,
        "repeatRequestClientMs": repeat_client_ms,
        "repeatRequestClientMeanMs": statistics.mean(repeat_client_ms),
        "repeatRequestCoreMs": repeat_core_ms,
        "repeatRequestCoreMeanMs": statistics.mean(repeat_core_ms),
    }


def aggregate_split_summaries(arm_summaries):
    by_kind = {}
    for kind in sorted({row["kind"] for row in arm_summaries}):
        subset = [row for row in arm_summaries if row["kind"] == kind]
        repeats = [val for row in subset for val in row["repeatRequestClientMs"]]
        repeats_core = [val for row in subset for val in row["repeatRequestCoreMs"]]
        by_kind[kind] = {
            "armCount": len(subset),
            "startupWallMeanMs": statistics.mean(row["startupWallMs"] for row in subset),
            "postOpenFirstRequestClientMeanMs": statistics.mean(row["postOpenFirstRequestClientMs"] for row in subset),
            "postOpenFirstRequestCoreMeanMs": statistics.mean(row["postOpenFirstRequestCoreMs"] for row in subset),
            "openPlusFirstAnswerClientMeanMs": statistics.mean(row["openPlusFirstAnswerClientMs"] for row in subset),
            "openPlusFirstAnswerCoreMeanMs": statistics.mean(row["openPlusFirstAnswerCoreMs"] for row in subset),
            "repeatRequestClientMeanMs": statistics.mean(repeats),
            "repeatRequestCoreMeanMs": statistics.mean(repeats_core),
        }
    return by_kind


def run_single_clock_arm(*, command, workload, arm_dir, deadline_seconds, expected_ranges,
                         environment=None, stage_launcher=None):
    arm_dir.mkdir(parents=True, exist_ok=False)
    requests = (
        [{"op": "open"}]
        + [dict(workload, op="request", repeat=idx) for idx in range(3)]
        + [{"op": "receipts"}, {"op": "close"}]
    )
    rows = []
    stage_handle = None
    startup_t0 = time.perf_counter()
    try:
        if stage_launcher is not None:
            stage_handle = stage_launcher(arm_dir)
        with CompleteRequestClient(
            command,
            arm_dir / "requester-protocol.log",
            env=compare_base.clean_environment(environment),
            max_response_bytes=16 * 1024 * 1024,
            arm_timeout_seconds=deadline_seconds,
        ) as client:
            for req in requests:
                limit = {"open": 310, "request": 160}.get(req["op"], 45)
                extra = {}
                if req["op"] == "request" and stage_handle is not None and stage_handle.get("expectedProviders"):
                    extra["expectedProviders"] = stage_handle["expectedProviders"]
                response = client.request(dict(req, **extra), timeout_seconds=min(deadline_seconds, limit))
                assert response.get("requestOp") == req["op"], "Split worker response operation differs"
                assert "error" not in response, response.get("error")
                value = response["value"]
                if req["op"] == "open":
                    startup_wall_ms = (time.perf_counter() - startup_t0) * 1000.0
                    value = dict(
                        value,
                        startupWallMs=startup_wall_ms,
                        clientSetupScope="single-requester-clock-split-startup-open/v1",
                        clientOpenWallMs=response["clientRequestWallMs"],
                    )
                    if stage_handle is not None and callable(stage_handle.get("after_open")):
                        stage_handle["after_open"](value)
                elif req["op"] == "request":
                    assert isinstance(value, dict), "Split request must return an object"
                    value = dict(
                        value,
                        clientRequestWallMs=response["clientRequestWallMs"],
                        clientTimingScope="owned-local-stdio-jsonl/v1",
                        clientRequestBytes=response["clientRequestBytes"],
                        clientResponseBytes=response["clientResponseBytes"],
                    )
                    value["clientOverheadMs"] = value["clientRequestWallMs"] - value["requestWallMs"]
                    assert value["clientOverheadMs"] >= -0.01, "Client duration does not contain core interval"
                rows.append(value)
            exit_receipt = client.finish(timeout_seconds=10)
        rows[-1] = dict(rows[-1], ownedProcessExit=exit_receipt)
    finally:
        if stage_handle is not None and callable(stage_handle.get("close")):
            stage_cleanup = stage_handle["close"]()
            if rows:
                rows[-1] = dict(rows[-1], stageCleanup=stage_cleanup)
    opened = rows[0]
    req_rows = rows[1:4]
    summary = summarize_split_arm(
        workload["name"],
        workload.get("kind", "unknown"),
        opened["startupWallMs"],
        opened,
        req_rows,
        expected_ranges,
    )
    return {"opened": opened, "rows": req_rows, "close": rows[-1], "summary": summary}


def validate_split_freeze(freeze):
    assert freeze.get("schema") == "a1.split-single-clock-comparison/v1", "Invalid split comparison schema"
    compare_base.validate_workloads(freeze["workloads"])
    expected_ranges = freeze.get("expectedRanges")
    assert (
        isinstance(expected_ranges, list)
        and len(expected_ranges) >= 2
        and all(isinstance(r, list) and len(r) == 2 and r[0] < r[1] for r in expected_ranges)
    ), "Explicit multi-stage expectedRanges required"
    pattern = freeze.get("pattern")
    assert isinstance(pattern, list) and set(pattern) == {"candidate", "pooled"}, \
        "Interleaved split pattern must include both candidate and pooled"
    return expected_ranges


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("freeze")
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    raw = Path(args.freeze).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == args.sha256, "Split freeze SHA-256 mismatch"
    freeze = json.loads(raw)
    expected_ranges = validate_split_freeze(freeze)
    for pin in freeze.get("filePins", []):
        p = Path(pin["path"])
        assert p.stat().st_size == pin["bytes"], str(p)
        assert hashlib.sha256(p.read_bytes()).hexdigest() == pin["sha256"], str(p)
    out = Path(args.output)
    out.mkdir()
    report = {
        "schema": freeze["schema"],
        "scope": freeze["scope"],
        "freezeSha256": args.sha256,
        "expectedRanges": expected_ranges,
        "started": time.time(),
        "metadataPreflightPassed": True,
        "modelRunsStarted": False,
        "completed": False,
        "arms": [],
    }
    (out / "report.json").write_text(json.dumps(report, indent=2))
    if not args.execute:
        print(json.dumps({"metadataPreflightPassed": True, "expectedRanges": expected_ranges, "modelRunsStarted": False}))
        return
    cache_dirs = [
        compare_base.validate_protected_cache_dir(d)
        for d in freeze.get("protectedCacheDirectories", [])
    ]
    summaries = []
    try:
        for workload in freeze["workloads"]:
            reference_text = None
            for index, kind in enumerate(freeze["pattern"]):
                arm_dir = out / f"{workload['name']}-{index}-{kind}"
                cleared_before = compare_base.clear_protected_cache_dirs(cache_dirs) if (kind != "pooled" and cache_dirs) else None
                try:
                    arm_spec = freeze["arms"][kind]
                    res = run_single_clock_arm(
                        command=arm_spec["command"],
                        workload=dict(workload, kind=kind),
                        arm_dir=arm_dir,
                        deadline_seconds=int(freeze["armTimeoutSeconds"]),
                        expected_ranges=expected_ranges,
                        environment=arm_spec.get("environment", {}),
                    )
                finally:
                    cleared_after = compare_base.clear_protected_cache_dirs(cache_dirs) if (kind != "pooled" and cache_dirs) else None
                report["modelRunsStarted"] = True
                texts = [row["text"].strip() for row in res["rows"]]
                assert len(set(texts)) == 1, "Repeated split output text differed within arm"
                if reference_text is None:
                    reference_text = texts[0]
                assert texts[0] == reference_text, "Split candidate and pooled outputs differed"
                arm_record = {
                    "workload": workload["name"],
                    "kind": kind,
                    "exactTextMatch": True,
                    "protectedCacheClearedBefore": cleared_before,
                    "protectedCacheClearedAfter": cleared_after,
                    "summary": res["summary"],
                    "rows": res["rows"],
                }
                report["arms"].append(arm_record)
                summaries.append(res["summary"])
                report["aggregates"] = aggregate_split_summaries(summaries)
                (out / "report.json").write_text(json.dumps(report, indent=2))
        report["completed"] = True
    except BaseException as error:
        report["completed"] = False
        report["failure"] = str(error)
        raise
    finally:
        report["finished"] = time.time()
        (out / "report.json").write_text(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
