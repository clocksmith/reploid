"""Owned single-machine complete-request comparison. Default is no-GPU preflight."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import signal
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from complete_request_client import CompleteRequestClient
from provider_state import provider_state, assert_provider_unchanged


def native(config, requests, output, deadline):
    args = [config["node"], config["nativeWorker"], config["nativeConfigPath"]]
    return protocol_run(args, requests, output, deadline, config["environment"])


def protocol_run(command, requests, output, deadline, environment=None):
    rows = []
    with CompleteRequestClient(command, output, env=clean_environment(environment),
                               max_response_bytes=16 * 1024 * 1024, arm_timeout_seconds=deadline) as client:
        for request in requests:
            limit = {"open": 310, "request": 130, "lifecycle": 520}.get(request["op"], 45)
            response = client.request(request, timeout_seconds=min(deadline, limit))
            assert response.get("requestOp") == request["op"], "Worker response operation differs"
            assert "error" not in response, response.get("error")
            value = response["value"]
            if request["op"] == "request":
                assert isinstance(value, dict), "Complete request must return an object"
                value = dict(value, clientRequestWallMs=response["clientRequestWallMs"],
                             clientTimingScope="owned-local-stdio-jsonl/v1",
                             clientRequestBytes=response["clientRequestBytes"], clientResponseBytes=response["clientResponseBytes"],
                             clientRequestPayload=response["clientRequestPayload"])
                value["clientOverheadMs"] = value["clientRequestWallMs"] - value["requestWallMs"]
                assert value["clientOverheadMs"] >= -.01, "Client duration does not contain the core interval"
            rows.append(value)
        exit_receipt = client.finish(timeout_seconds=5)
    assert requests[-1]["op"] == "close", "Owned protocol must close explicitly"
    rows[-1] = dict(rows[-1], ownedProcessExit=exit_receipt)
    return rows


def check_tokens(rows, workload, kind, freeze, out):
    payload = out / "complete-output.json"
    payload.write_text(json.dumps({"rows": rows, "workload": workload, "kind": kind}))
    result = subprocess.run([freeze["node"], freeze["controlChecker"], freeze["freezePath"], str(payload)],
                            capture_output=True, text=True, timeout=45, check=True, env=clean_environment())
    return json.loads(result.stdout)["outputs"][0]


def clean_environment(extra=None):
    env = dict(os.environ)
    for key in ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH"]:
        env.pop(key, None)
    env.update(extra or {})
    return env


def native_requests(workload, require_lifecycle):
    requests = [{"op": "preflight"}, {"op": "open", "indices": None}]
    requests += [dict(workload, op="request", repeat=i) for i in range(3)]
    if require_lifecycle:
        assert workload["maxNew"] >= 2, "Full-model lifecycle requires a multi-token workload"
        requests.append(dict(workload, op="lifecycle"))
    return requests + [{"op": "receipts"}, {"op": "close"}]


def validate_workloads(workloads):
    assert isinstance(workloads, list) and workloads, "Frozen comparison workloads required"
    names, inputs, classifications = set(), set(), set()
    for workload in workloads:
        name = workload.get("name")
        assert isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", name), \
            "Workload name must be a safe output-directory component"
        assert name not in names, "Duplicate workload name would reuse an arm output directory: " + name
        names.add(name)
        classification = workload.get("classification")
        assert classification in ("frozen", "heldout"), "Workload must declare frozen or heldout scope"
        classifications.add(classification)
        ids = workload.get("promptIds")
        assert isinstance(ids, list) and ids and all(type(token) is int and token >= 0 for token in ids), \
            "Exact nonempty prompt IDs required"
        key = tuple(ids)
        assert key not in inputs, "Frozen and held-out workloads must use distinct prompt IDs"
        inputs.add(key)
        assert isinstance(workload.get("prompt"), str) and workload["prompt"].strip(), "Prompt text required"
        assert type(workload.get("maxNew")) is int and workload["maxNew"] > 0, "Positive token bound required"
        assert isinstance(workload.get("stopIds"), list) and all(
            type(token) is int and token >= 0 for token in workload["stopIds"]), "Explicit stop IDs required"
    assert classifications == {"frozen", "heldout"}, "Both frozen and held-out workloads required"


def lifecycle_outputs(value):
    assert value.get("schema") == "reploid.native-complete-lifecycle/v1", "Missing full-model lifecycle receipt"
    assert value.get("observedTokens") == 1, "Cancellation did not follow the first observed token"
    assert [phase["name"] for phase in value["phases"]] == [
        "first-complete-request", "repeated-complete-request", "pre-aborted-request",
        "active-cancellation-settled", "recovered-complete-request"], "Incomplete full-model lifecycle"
    return [value[key] for key in ("first", "repeat", "recovered")]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("freeze")
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    frozen_bytes = Path(args.freeze).read_bytes()
    assert hashlib.sha256(frozen_bytes).hexdigest() == args.sha256, "Frozen comparison changed"
    freeze = json.loads(frozen_bytes)
    assert freeze["schema"] == "a1.complete-request-comparison/v2", "Obsolete comparison freeze"
    validate_workloads(freeze["workloads"])
    require_lifecycle = freeze.get("requireNativeLifecycle", False)
    assert isinstance(require_lifecycle, bool), "requireNativeLifecycle must be an explicit boolean"
    if require_lifecycle:
        pins = {Path(pin["path"]).resolve() for pin in freeze["filePins"]}
        for config in freeze["native"].values():
            helper = Path(config["nativeWorker"]).resolve().parent / "native-complete-lifecycle.js"
            assert helper in pins, "Full-model lifecycle helper must be pinned in the comparison freeze"
        for workload in freeze["workloads"]:
            assert workload["maxNew"] >= 2, "Full-model lifecycle requires a multi-token workload"
    freeze["freezePath"] = str(Path(args.freeze).resolve())
    out = Path(args.output)
    out.mkdir()
    report = {"scope": freeze["scope"], "freezeSha256": args.sha256, "started": time.time(),
              "modelRunsStarted": False, "completed": False,
              "nativeLifecycleRequired": require_lifecycle, "nativeLifecycleQualified": False, "arms": []}

    def save():
        (out / "report.json").write_text(json.dumps(report, indent=2))

    server = None
    try:
        for pin in freeze["filePins"]:
            assert Path(pin["path"]).stat().st_size == pin["bytes"], pin["path"]
            digest = hashlib.sha256()
            with open(pin["path"], "rb") as source:
                while block := source.read(65536):
                    digest.update(block)
            assert digest.hexdigest() == pin["sha256"], pin["path"]
        checker = subprocess.run([freeze["node"], freeze["controlChecker"], args.freeze], capture_output=True,
                                 text=True, check=True, timeout=45, env=clean_environment())
        report["controlPreflight"] = json.loads(checker.stdout)
        for name, config in freeze["native"].items():
            rows = native(config, [{"op": "preflight"}, {"op": "close"}], out / (name + "-preflight.log"), 45)
            assert rows[0]["runtime"]["treeSha256"] == config["sourceTreeSha256"]
            assert rows[0]["model"]["readyForWholeModel"] and not rows[0]["gpuOpened"]
            assert rows[1]["gpuOpened"] is False
        report["metadataPreflightPassed"] = True
        report["sourceIntegrityReady"] = report["controlPreflight"]["sourceIntegrity"]["ready"]
        save()
        if not args.execute:
            print(json.dumps({"metadataPreflightPassed": True, "sourceIntegrityReady": report["sourceIntegrityReady"],
                              "modelRunsStarted": False}))
            return
        assert report["sourceIntegrityReady"], "A pinned complete content proof is required before comparison execution"
        with open(freeze["locks"][0], "a") as exclusive, open(freeze["locks"][1], "a") as shared:
            fcntl.flock(exclusive, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(shared, fcntl.LOCK_SH | fcntl.LOCK_NB)
            before = provider_state(freeze["protectedProviderUnit"])
            report["providerBefore"] = before
            reserve = next(int(line.split()[1]) * 1024 for line in Path("/proc/meminfo").read_text().splitlines()
                           if line.startswith("MemAvailable:"))
            assert reserve >= freeze["minHostAvailableBytes"], "Insufficient host reserve"
            signaling = freeze["signaling"]
            with socket.socket() as free:
                free.bind(("127.0.0.1", signaling["port"]))
            server_log = open(out / "signaling.log", "x")
            server = subprocess.Popen(signaling["command"], stdout=server_log, stderr=subprocess.STDOUT,
                                      env=clean_environment(), start_new_session=True)
            try:
                for _ in range(100):
                    assert server.poll() is None, "Owned signaling process exited"
                    try:
                        with socket.create_connection(("127.0.0.1", signaling["port"]), timeout=.1):
                            break
                    except OSError:
                        time.sleep(.1)
                else:
                    raise RuntimeError("Owned signaling deadline")
                for workload in freeze["workloads"]:
                    reference = None
                    for index, kind in enumerate(freeze["pattern"]):
                        lifecycle = None
                        arm = out / (workload["name"] + "-" + str(index) + "-" + kind)
                        arm.mkdir()
                        assert_provider_unchanged(before, provider_state(freeze["protectedProviderUnit"]))
                        report["modelRunsStarted"] = None
                        report["stage"] = {"workload": workload["name"], "kind": kind,
                                           "state": "owned model-command admission attempted; opening unobserved"}
                        save()
                        if kind == "pooled":
                            config = dict(freeze["pooledConfig"])
                            config["out"] = str(arm / "result.json")
                            config["protocol"] = True
                            config["cases"] = []
                            config_path = arm / "config.json"
                            config_path.write_text(json.dumps(config))
                            requests = [{"op": "open"}]
                            requests += [dict(workload, op="request", repeat=i) for i in range(3)]
                            requests += [{"op": "receipts"}, {"op": "close"}]
                            responses = protocol_run([freeze["node"], freeze["pooledAdapter"], str(config_path)],
                                                     requests, arm / "process.log", freeze["armTimeoutSeconds"])
                            result = responses[-1]
                            (arm / "protocol-results.json").write_text(json.dumps(responses, indent=2))
                            assert result.get("cleanup") == "settled" and not result.get("error")
                            assert result["split"]["ranges"] == [[0, 48]]
                            gpu = result["gpuMemory"]
                            assert not gpu["errors"] and not gpu["overCapAllocations"] and gpu["peakBytes"] <= freeze["gpuCapBytes"]
                            assert gpu["liveBytes"] == 0, "Peer GPU allocations did not retire after room close"
                            rows = responses[1:4]
                            assert all(case["reused"] == 0 for case in rows), "Pooled reused a prefix"
                        else:
                            requests = native_requests(workload, require_lifecycle)
                            responses = native(freeze["native"][kind], requests, arm / "process.log", freeze["armTimeoutSeconds"])
                            rows = responses[2:5]
                            assert all(row["generationEvidence"]["stats"]["reusedPrefixTokens"] == 0 for row in rows)
                            for response in responses[1:5]:
                                gpu = response["memory"]["device"]
                                assert gpu["maxBytes"] == freeze["gpuCapBytes"] and gpu["peakBytes"] <= freeze["gpuCapBytes"] and gpu["rejected"] == 0
                            close = responses[-1]
                            assert not close.get("receiptFailure"), "Native source receipt collection failed"
                            assert close["sourceCleanup"] == "settled" and close["closedSourceReceipts"]
                            for collection in [responses[-2], close["sourceReceipts"], close["closedSourceReceipts"]]:
                                for source in collection:
                                    assert not source.get("receiptFailure"), "Source receipt failed"
                                    assert source["generic"]["activeReadBytes"] == 0, "Native source read did not settle"
                                    if source.get("gather") is not None:
                                        assert source["gather"]["activeReadBytes"] == 0, "Gather ownership did not settle"
                            assert all(close["pool"]["resources"][owner]["bytes"] == 0
                                       for owner in ["active", "retainedModel", "deferredCleanup"])
                            if require_lifecycle:
                                lifecycle = responses[5]
                                recovered_rows = lifecycle_outputs(lifecycle)
                                normalized_recovery = check_tokens(recovered_rows, workload, kind, freeze, arm)
                                assert normalized_recovery == check_tokens(rows, workload, kind, freeze, arm), \
                                    "Lifecycle recovery differs from timed full-model requests"
                            (arm / "result.json").write_text(json.dumps(responses, indent=2))
                        report["modelRunsStarted"] = True
                        report["stage"]["state"] = "complete request outputs observed"
                        normalized = check_tokens(rows, workload, kind, freeze, arm)
                        if reference is None:
                            reference = normalized
                        assert normalized == reference, "Exact complete IDs, stop reason/token or public text differs"
                        assert_provider_unchanged(before, provider_state(freeze["protectedProviderUnit"]))
                        report["arms"].append({"workload": workload["name"], "kind": kind, "exactCompletion": True,
                                               "normalized": normalized, "rows": rows, "lifecycle": lifecycle})
                        save()
                report["completed"] = True
                native_arms = [arm for arm in report["arms"] if arm["kind"] != "pooled"]
                report["nativeLifecycleQualified"] = require_lifecycle and bool(native_arms) \
                    and all(arm["lifecycle"] is not None for arm in native_arms)
            finally:
                try:
                    os.killpg(server.pid, signal.SIGTERM)
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid, signal.SIGKILL)
                    server.wait(timeout=5)
                server_log.close()
                report["providerAfter"] = provider_state(freeze["protectedProviderUnit"])
                assert_provider_unchanged(before, report["providerAfter"])
    except BaseException as error:
        report["completed"] = False
        report["nativeLifecycleQualified"] = False
        report["failure"] = str(error)
        raise
    finally:
        report["finished"] = time.time()
        save()


if __name__ == "__main__":
    main()
