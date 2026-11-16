"""Owned single-machine complete-request comparison. Default is no-GPU preflight."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import signal
import subprocess
import time


def read_json(path):
    return json.loads(Path(path).read_bytes())


def native(config, requests, output, deadline):
    args = [config["node"], config["nativeWorker"], config["nativeConfigPath"]]
    body = "".join(json.dumps(dict(row, id=i + 1)) + "\n" for i, row in enumerate(requests))
    with open(output, "x") as log:
        # Supply protocol input through an owned regular file so the child deadline
        # also covers initialization before it starts consuming stdin.
        input_path = Path(str(output) + ".input")
        input_path.write_text(body)
        with open(input_path) as protocol:
            owned_run(args, stdin=protocol, text=True, stdout=log, stderr=subprocess.STDOUT,
                      env=clean_environment(config["environment"]), timeout=deadline)
    rows = [json.loads(line[13:]) for line in Path(output).read_text().splitlines()
            if line.startswith("@q4-response ")]
    assert len(rows) == len(requests), "Missing native protocol responses"
    assert all("error" not in row for row in rows), rows
    return [row["value"] for row in rows]


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


def owned_run(args, *, timeout, **options):
    child = subprocess.Popen(args, start_new_session=True, **options)
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except BaseException:
        # Target only this runner's owned process group, including its workers.
        os.killpg(child.pid, signal.SIGTERM)
        try:
            child.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.communicate(timeout=5)
        raise
    assert child.returncode == 0, "Owned process failed: " + str(child.returncode)
    return stdout, stderr


def provider_state(unit):
    state = subprocess.check_output(["systemctl", "--user", "show", unit,
                                     "-p", "ActiveState", "-p", "MainPID"], text=True)
    values = dict(line.split("=", 1) for line in state.splitlines())
    assert values["ActiveState"] == "active", "Protected provider is not active"
    pid = int(values["MainPID"])
    engines = {}
    for file in Path("/proc", str(pid), "fdinfo").iterdir():
        try:
            values = dict(line.split(":", 1) for line in file.read_text().splitlines()
                          if line.startswith(("drm-client-id:", "drm-engine-")))
            if "drm-client-id" in values:
                engines[values["drm-client-id"].strip()] = {
                    key: value.strip() for key, value in values.items() if key.startswith("drm-engine-")}
        except OSError:
            pass
    assert engines, "Protected provider GPU ownership is unavailable"
    return {"service": state, "engines": engines}


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
    freeze["freezePath"] = str(Path(args.freeze).resolve())
    out = Path(args.output)
    out.mkdir()
    report = {"scope": freeze["scope"], "freezeSha256": args.sha256, "started": time.time(),
              "modelRunsStarted": False, "completed": False, "arms": []}

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
        save()
        if not args.execute:
            print(json.dumps({"metadataPreflightPassed": True, "modelRunsStarted": False}))
            return
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
                        arm = out / (workload["name"] + "-" + str(index) + "-" + kind)
                        arm.mkdir()
                        assert provider_state(freeze["protectedProviderUnit"]) == before, "Protected provider changed"
                        report["modelRunsStarted"] = None
                        report["stage"] = {"workload": workload["name"], "kind": kind,
                                           "state": "owned model-command admission attempted; opening unobserved"}
                        save()
                        if kind == "pooled":
                            config = dict(freeze["pooledConfig"])
                            config["out"] = str(arm / "result.json")
                            config["cases"] = [dict(workload, repeat=i) for i in range(3)]
                            config_path = arm / "config.json"
                            config_path.write_text(json.dumps(config))
                            with open(arm / "process.log", "x") as log:
                                owned_run([freeze["node"], freeze["pooledAdapter"], str(config_path)],
                                          stdout=log, stderr=subprocess.STDOUT, timeout=freeze["armTimeoutSeconds"],
                                          env=clean_environment())
                            result = read_json(config["out"])
                            assert result.get("cleanup") == "settled" and not result.get("error")
                            assert result["split"]["ranges"] == [[0, 48]]
                            gpu = result["gpuMemory"]
                            assert not gpu["errors"] and not gpu["overCapAllocations"] and gpu["peakBytes"] <= freeze["gpuCapBytes"]
                            assert gpu["liveBytes"] == 0, "Peer GPU allocations did not retire after room close"
                            rows = [dict(case, inputIds=case["promptIds"]) for case in result["cases"]]
                            assert all(case["reused"] == 0 for case in rows), "Pooled reused a prefix"
                        else:
                            requests = [{"op": "preflight"}, {"op": "open", "indices": None}]
                            requests += [dict(op="request", prompt=workload["prompt"], promptIds=workload["promptIds"]) for _ in range(3)]
                            requests += [{"op": "receipts"}, {"op": "close"}]
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
                            (arm / "result.json").write_text(json.dumps(responses, indent=2))
                        report["modelRunsStarted"] = True
                        report["stage"]["state"] = "complete request outputs observed"
                        normalized = check_tokens(rows, workload, kind, freeze, arm)
                        if reference is None:
                            reference = normalized
                        assert normalized == reference, "Exact complete IDs, stop reason/token or public text differs"
                        assert provider_state(freeze["protectedProviderUnit"]) == before, "Provider/GPU activity changed; timing invalid"
                        report["arms"].append({"workload": workload["name"], "kind": kind, "exactCompletion": True,
                                               "normalized": normalized, "rows": rows})
                        save()
                report["completed"] = True
            finally:
                try:
                    os.killpg(server.pid, signal.SIGTERM)
                    server.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(server.pid, signal.SIGKILL)
                    server.wait(timeout=5)
                server_log.close()
                report["providerAfter"] = provider_state(freeze["protectedProviderUnit"])
                assert report["providerAfter"] == before
    except BaseException as error:
        report["failure"] = str(error)
        raise
    finally:
        report["finished"] = time.time()
        save()


if __name__ == "__main__":
    main()
