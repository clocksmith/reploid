"""Owned single-machine complete-request comparison. Default is no-GPU preflight."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import stat
import subprocess
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from complete_request_client import CompleteRequestClient
from provider_state import ProviderStateError, provider_state, assert_provider_unchanged

DEFAULT_MIN_HOST_MEM_FREE_BYTES = 16 * 1024 ** 3
DEFAULT_MAX_HOST_SHMEM_BYTES = 4 * 1024 ** 3
DEFAULT_MAX_HOST_DIRTY_WRITEBACK_BYTES = 1024 ** 3
DEFAULT_MIN_GPU_GTT_HEADROOM_BYTES = 8 * 1024 ** 3
DEFAULT_MIN_GPU_VRAM_FREE_BYTES = 64 * 1024 ** 2
DEFAULT_MAX_GPU_PREEMPT_USED_BYTES = 64 * 1024 ** 2
DEFAULT_UMA_CARVEOUT_MAX_BYTES = 1024 ** 3
DEFAULT_UMA_CLIENT_PINNED_RESERVE_BYTES = 4 * 1024 ** 2
DEFAULT_UNEXPECTED_GPU_CLIENT_GTT_BYTES = 64 * 1024 ** 2
DEFAULT_MAX_DESKTOP_CLIENT_GTT_BYTES = 512 * 1024 ** 2
DESKTOP_DISPLAY_COMMS = frozenset({
    "gnome-shell", "Xwayland", "Xorg", "mutter-x11-fram", "ibus-x11", "kwin_wayland", "sway", "weston"
})
DEFAULT_MAX_GPU_BUSY_PERCENT = 5
DEFAULT_MAX_AMBIENT_DISK_BYTES_PER_SEC = 64 * 1024 ** 2
DEFAULT_LARGE_COPY_FILE_BYTES = 64 * 1024 ** 2
UNCONDITIONAL_COPY_COMMANDS = frozenset({
    "rsync", "scp", "sftp-server", "rclone", "dd", "pv", "zstd", "unzstd", "pzstd"
})
CONDITIONAL_COPY_COMMANDS = frozenset({"cp", "mv", "tar", "gzip", "pigz", "xz"})
WHOLE_DISK_NAME_RE = re.compile(r"^(?:nvme\d+n\d+|sd[a-z]+|vd[a-z]+|xvd[a-z]+|mmcblk\d+)$")


class PreflightError(RuntimeError):
    def __init__(self, message, snapshot=None):
        super().__init__(message)
        self.snapshot = snapshot


def native(config, requests, output, deadline):
    args = [config["node"], config["nativeWorker"], config["nativeConfigPath"]]
    return protocol_run(args, requests, output, deadline, config["environment"])


def protocol_run(command, requests, output, deadline, environment=None):
    rows = []
    setup_started = time.perf_counter()
    with CompleteRequestClient(command, output, env=clean_environment(environment),
                               max_response_bytes=16 * 1024 * 1024, arm_timeout_seconds=deadline) as client:
        for request in requests:
            limit = {"open": 310, "request": 130, "lifecycle": 520}.get(request["op"], 45)
            response = client.request(request, timeout_seconds=min(deadline, limit))
            assert response.get("requestOp") == request["op"], "Worker response operation differs"
            assert "error" not in response, response.get("error")
            value = response["value"]
            if request["op"] == "open":
                value = dict(value, clientSetupWallMs=(time.perf_counter() - setup_started) * 1000,
                             clientSetupScope="owned-worker-startup-preflight-open/v1",
                             clientOpenWallMs=response["clientRequestWallMs"])
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
    for key in list(env):
        if key not in ["NODE_OPTIONS", "NODE_PATH", "LD_PRELOAD", "LD_LIBRARY_PATH",
                       "DAWN_OPTS", "UV_THREADPOOL_SIZE", "RN_DEBUG"] \
                and not key.startswith(("POOLED_", "DOPPLER_")):
            continue
        env.pop(key, None)
    assert extra is None or isinstance(extra, dict) and all(
        isinstance(key, str) and isinstance(value, str) and "\x00" not in key + value and "=" not in key
        for key, value in extra.items()), "Explicit environment must map valid strings to strings"
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


def paused_provider_state(unit, *, show=None):
    if not isinstance(unit, str) or not re.fullmatch(r"[A-Za-z0-9_.@:-]+\.service", unit):
        raise ProviderStateError("Explicit protected service name required")
    if show is None:
        def show():
            return subprocess.check_output(
                ["systemctl", "--user", "show", unit,
                 "-p", "ActiveState", "-p", "SubState", "-p", "MainPID", "-p", "InvocationID"],
                text=True, timeout=5
            )
    try:
        values = dict(line.split("=", 1) for line in show().splitlines() if "=" in line)
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise ProviderStateError("Protected provider pause state is unobservable: " + str(error)) from error
    if values.get("ActiveState") != "inactive" or values.get("MainPID") != "0":
        raise ProviderStateError(
            f"Protected provider {unit} is not paused inactive "
            f"(ActiveState={values.get('ActiveState')!r}, MainPID={values.get('MainPID')!r})"
        )
    return {
        "policy": "paused_inactive",
        "unit": unit,
        "ActiveState": values.get("ActiveState"),
        "SubState": values.get("SubState"),
        "MainPID": values.get("MainPID"),
        "InvocationID": values.get("InvocationID", ""),
    }


def snapshot_protected_provider(freeze, *, show_paused=None):
    policy = freeze.get("protectedProviderPolicy", "active_unchanged")
    assert policy in ("active_unchanged", "paused_inactive"), f"Unknown protectedProviderPolicy: {policy!r}"
    unit = freeze["protectedProviderUnit"]
    if policy == "paused_inactive":
        return paused_provider_state(unit, show=show_paused)
    return provider_state(unit)


def verify_protected_provider_unchanged(freeze, before, after):
    policy = freeze.get("protectedProviderPolicy", "active_unchanged")
    if policy == "paused_inactive":
        if before != after:
            raise ProviderStateError("Paused protected provider state changed during comparison")
        return after
    return assert_provider_unchanged(before, after)


def validate_protected_cache_dir(raw_path, *, allowed_roots=("/dev/shm", "/tmp")):
    assert isinstance(raw_path, str) and raw_path.startswith("/"), "Protected cache directory must be an absolute path"
    candidate = Path(raw_path)
    assert ".." not in candidate.parts, "Protected cache directory must not contain parent traversal"
    if candidate.is_symlink():
        raise PreflightError(f"Protected cache directory must not be a symlink: {raw_path}")
    parent = candidate.parent.resolve(strict=True)
    resolved_roots = []
    for root in allowed_roots:
        root_path = Path(root)
        if root_path.exists():
            resolved_roots.append(root_path.resolve(strict=True))
    if not any(parent == root or parent.is_relative_to(root) for root in resolved_roots):
        raise PreflightError(
            f"Protected cache directory {raw_path} must reside under an allowed ephemeral root {list(allowed_roots)}"
        )
    resolved_candidate = parent / candidate.name
    if any(resolved_candidate == root for root in resolved_roots):
        raise PreflightError(f"Protected cache directory must not be an ephemeral root itself: {raw_path}")
    return candidate


def discover_protected_cache_dirs(freeze, *, allowed_roots=("/dev/shm", "/tmp")):
    discovered = []
    for name, spec in sorted(freeze.get("native", {}).items()):
        cfg_path = Path(spec["nativeConfigPath"])
        if not cfg_path.exists():
            continue
        cfg = json.loads(cfg_path.read_text())
        for section in ("workerGather", "gather"):
            directory = ((cfg.get(section) or {}).get("protectedCache") or {}).get("directory")
            if directory is not None:
                validated = validate_protected_cache_dir(directory, allowed_roots=allowed_roots)
                if validated not in discovered:
                    discovered.append(validated)
    for directory in freeze.get("protectedCacheDirectories", []):
        validated = validate_protected_cache_dir(directory, allowed_roots=allowed_roots)
        if validated not in discovered:
            discovered.append(validated)
    return discovered


def clear_protected_cache_dirs(directories, *, allowed_roots=("/dev/shm", "/tmp")):
    receipts = []
    for directory in directories:
        validated = validate_protected_cache_dir(str(directory), allowed_roots=allowed_roots)
        existed = validated.exists()
        if existed:
            shutil.rmtree(validated)
        if validated.exists() or validated.is_symlink():
            raise PreflightError(f"Protected cache directory failed to clear cleanly: {validated}")
        receipts.append({"directory": str(validated), "removed": existed, "existsAfter": False})
    return receipts


def read_meminfo_bytes(proc_root="/proc"):
    meminfo_path = Path(proc_root) / "meminfo"
    values = {}
    for line in meminfo_path.read_text().splitlines():
        if ":" not in line:
            continue
        key, rest = line.split(":", 1)
        parts = rest.split()
        if not parts or not parts[0].isdigit():
            continue
        multiplier = 1024 if len(parts) > 1 and parts[1] == "kB" else 1
        values[key.strip()] = int(parts[0]) * multiplier
    for required in ("MemTotal", "MemFree", "MemAvailable", "Shmem"):
        if required not in values:
            raise PreflightError(f"/proc/meminfo missing required counter {required}")
    return values


def _parse_drm_size_bytes(raw_value):
    parts = (raw_value or "").strip().split()
    if not parts or not parts[0].isdigit():
        return 0
    amount = int(parts[0])
    unit = parts[1] if len(parts) > 1 else "B"
    scale = {"B": 1, "KiB": 1024, "kB": 1024, "MiB": 1024 ** 2, "GiB": 1024 ** 3}.get(unit, 1)
    return amount * scale


def scan_drm_clients(proc_root="/proc"):
    clients = {}
    proc_base = Path(proc_root)
    if not proc_base.is_dir():
        return []
    for entry in sorted(proc_base.iterdir(), key=lambda item: item.name):
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        fdinfo_dir = entry / "fdinfo"
        if not fdinfo_dir.is_dir():
            continue
        try:
            comm = (entry / "comm").read_text(errors="replace").strip() if (entry / "comm").is_file() else ""
            if not comm and (entry / "stat").is_file():
                st = (entry / "stat").read_text(errors="replace")
                b, e = st.find("("), st.rfind(")")
                comm = st[b + 1:e] if b >= 0 and e > b else ""
            for fdinfo in sorted(fdinfo_dir.iterdir(), key=lambda item: item.name):
                try:
                    lines = fdinfo.read_text(errors="replace").splitlines()
                except OSError:
                    continue
                fields = dict(line.split(":", 1) for line in lines if line.startswith("drm-") and ":" in line)
                cid = fields.get("drm-client-id", "").strip()
                if not cid:
                    continue
                vram_bytes = _parse_drm_size_bytes(fields.get("drm-memory-vram", ""))
                shared_vram_bytes = _parse_drm_size_bytes(fields.get("drm-shared-vram", ""))
                private_vram_bytes = max(0, vram_bytes - shared_vram_bytes)
                gtt_bytes = _parse_drm_size_bytes(fields.get("drm-memory-gtt", ""))
                prev = clients.get(cid)
                if prev is None or (vram_bytes + gtt_bytes) > (prev["vramBytes"] + prev["gttBytes"]):
                    clients[cid] = {
                        "clientId": cid,
                        "pid": pid,
                        "comm": comm,
                        "vramBytes": vram_bytes,
                        "sharedVramBytes": shared_vram_bytes,
                        "privateVramBytes": private_vram_bytes,
                        "gttBytes": gtt_bytes,
                    }
        except OSError:
            continue
    return [clients[cid] for cid in sorted(clients, key=lambda value: int(value) if value.isdigit() else value)]


def read_amdgpu_sysfs(drm_root="/sys/class/drm", card_name=None):
    base = Path(drm_root)
    if not base.exists():
        raise PreflightError(f"DRM sysfs root unavailable: {drm_root}")
    candidates = []
    for entry in sorted(base.iterdir(), key=lambda item: item.name):
        if not re.fullmatch(r"card\d+", entry.name):
            continue
        if card_name is not None and entry.name != card_name:
            continue
        device = entry / "device"
        fields = ("mem_info_gtt_total", "mem_info_gtt_used", "mem_info_vram_total", "mem_info_vram_used")
        if not all((device / name).is_file() for name in fields):
            continue
        metrics = {name: int((device / name).read_text().strip()) for name in fields}
        if metrics["mem_info_gtt_total"] <= 0:
            continue
        busy_file = device / "gpu_busy_percent"
        busy = int(busy_file.read_text().strip()) if busy_file.is_file() else 0
        preempt_file = device / "mem_info_preempt_used"
        preempt_used = int(preempt_file.read_text().strip()) if preempt_file.is_file() else 0
        is_uma_carveout = (
            metrics["mem_info_vram_total"] <= DEFAULT_UMA_CARVEOUT_MAX_BYTES
            and metrics["mem_info_gtt_total"] >= 8 * metrics["mem_info_vram_total"]
        )
        candidates.append({
            "card": entry.name,
            "isUmaCarveout": is_uma_carveout,
            "vramTotalBytes": metrics["mem_info_vram_total"],
            "vramUsedBytes": metrics["mem_info_vram_used"],
            "vramFreeBytes": metrics["mem_info_vram_total"] - metrics["mem_info_vram_used"],
            "preemptUsedBytes": preempt_used,
            "gttTotalBytes": metrics["mem_info_gtt_total"],
            "gttUsedBytes": metrics["mem_info_gtt_used"],
            "gttFreeBytes": metrics["mem_info_gtt_total"] - metrics["mem_info_gtt_used"],
            "gpuBusyPercent": busy,
        })
    if not candidates:
        raise PreflightError("No observable AMD GPU sysfs memory counters found under " + str(drm_root))
    if len(candidates) > 1:
        names = [row["card"] for row in candidates]
        raise PreflightError(f"Multiple AMD GPU sysfs devices found ({names}); pin gpuDrmCard in freeze")
    return candidates[0]


def _read_whole_disk_io_bytes(proc_root):
    diskstats = Path(proc_root) / "diskstats"
    if not diskstats.is_file():
        return None
    total = 0
    for line in diskstats.read_text().splitlines():
        parts = line.split()
        if len(parts) < 10 or not WHOLE_DISK_NAME_RE.match(parts[2]):
            continue
        if parts[5].isdigit() and parts[9].isdigit():
            total += (int(parts[5]) + int(parts[9])) * 512
    return total


def detect_bulk_copy_activity(proc_root="/proc", *, large_file_bytes=DEFAULT_LARGE_COPY_FILE_BYTES,
                              sample_seconds=0.2, sleep_fn=time.sleep, self_pid=None):
    own_pid = os.getpid() if self_pid is None else self_pid
    copy_processes = []
    proc_base = Path(proc_root)
    for entry in sorted(proc_base.iterdir(), key=lambda item: item.name):
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == own_pid:
            continue
        try:
            stat_text = (entry / "stat").read_text(errors="replace")
            begin, end = stat_text.find("("), stat_text.rfind(")")
            if begin < 0 or end <= begin:
                continue
            comm = stat_text[begin + 1:end]
            after_fields = stat_text[end + 1:].split()
            state = after_fields[0] if after_fields else ""
            if state in ("Z", "X"):
                continue
            raw_cmd = (entry / "cmdline").read_bytes().split(b"\x00")
            argv0 = Path(raw_cmd[0].decode("utf-8", errors="replace")).name if raw_cmd and raw_cmd[0] else ""
            names = {name for name in (comm, argv0) if name}
            unconditional = sorted(names.intersection(UNCONDITIONAL_COPY_COMMANDS))
            if unconditional:
                copy_processes.append({
                    "pid": pid,
                    "command": unconditional[0],
                    "reason": "active_bulk_copy_or_archive_process",
                })
                continue
            conditional = sorted(names.intersection(CONDITIONAL_COPY_COMMANDS))
            if conditional:
                fd_dir = entry / "fd"
                max_open_bytes = 0
                if fd_dir.is_dir():
                    for fd_entry in fd_dir.iterdir():
                        try:
                            target_stat = os.stat(fd_entry)
                            if stat.S_ISREG(target_stat.st_mode) and target_stat.st_size > max_open_bytes:
                                max_open_bytes = target_stat.st_size
                        except OSError:
                            continue
                if max_open_bytes >= large_file_bytes:
                    copy_processes.append({
                        "pid": pid,
                        "command": conditional[0],
                        "reason": "large_regular_file_open",
                        "maxOpenFileBytes": max_open_bytes,
                    })
        except OSError:
            continue
    io_before = _read_whole_disk_io_bytes(proc_root)
    ambient_bps = 0.0
    if io_before is not None and sample_seconds > 0:
        sleep_fn(sample_seconds)
        io_after = _read_whole_disk_io_bytes(proc_root)
        if io_after is not None and io_after >= io_before:
            ambient_bps = (io_after - io_before) / float(sample_seconds)
    return {
        "copyProcesses": copy_processes,
        "ambientDiskBytesPerSec": ambient_bps,
        "sampleSeconds": sample_seconds,
    }


def _allowed_gpu_pids(provider_snapshot):
    if not isinstance(provider_snapshot, dict) or "processes" not in provider_snapshot:
        return set()
    return {int(pid) for pid in provider_snapshot["processes"] if str(pid).isdigit()}


def check_host_and_gpu_preflight(freeze, *, proc_root="/proc", drm_root="/sys/class/drm",
                                 allowed_gpu_pids=None, sample_seconds=0.2, sleep_fn=time.sleep, self_pid=None):
    min_available = int(freeze["minHostAvailableBytes"])
    min_mem_free = int(freeze.get("minHostMemFreeBytes", DEFAULT_MIN_HOST_MEM_FREE_BYTES))
    max_shmem = int(freeze.get("maxHostShmemBytes", DEFAULT_MAX_HOST_SHMEM_BYTES))
    max_dirty = int(freeze.get("maxHostDirtyWritebackBytes", DEFAULT_MAX_HOST_DIRTY_WRITEBACK_BYTES))
    gpu_policy = freeze.get("gpuPreflightPolicy", "amdgpu_sysfs")
    assert gpu_policy in ("amdgpu_sysfs", "none"), f"Unknown gpuPreflightPolicy: {gpu_policy!r}"
    min_gtt_free = int(freeze["gpuCapBytes"]) + int(
        freeze.get("minGpuGttHeadroomBytes", DEFAULT_MIN_GPU_GTT_HEADROOM_BYTES)
    )
    min_vram_free = int(freeze.get("minGpuVramFreeBytes", DEFAULT_MIN_GPU_VRAM_FREE_BYTES))
    max_preempt_used = int(freeze.get("maxGpuPreemptUsedBytes", DEFAULT_MAX_GPU_PREEMPT_USED_BYTES))
    unexpected_client_gtt = int(
        freeze.get("unexpectedGpuClientGttBytes", DEFAULT_UNEXPECTED_GPU_CLIENT_GTT_BYTES)
    )
    max_gpu_busy = int(freeze.get("maxGpuBusyPercent", DEFAULT_MAX_GPU_BUSY_PERCENT))
    max_disk_bps = int(freeze.get("maxAmbientDiskBytesPerSec", DEFAULT_MAX_AMBIENT_DISK_BYTES_PER_SEC))
    large_copy_bytes = int(freeze.get("largeCopyFileThresholdBytes", DEFAULT_LARGE_COPY_FILE_BYTES))
    allowed_pids = set() if allowed_gpu_pids is None else {int(pid) for pid in allowed_gpu_pids}

    violations = []
    mem = read_meminfo_bytes(proc_root)
    dirty_writeback = mem.get("Dirty", 0) + mem.get("Writeback", 0)
    if mem["MemAvailable"] < min_available:
        violations.append(
            f"MemAvailable {mem['MemAvailable']} < minHostAvailableBytes {min_available}"
        )
    if mem["MemFree"] < min_mem_free:
        violations.append(
            f"MemFree {mem['MemFree']} < minHostMemFreeBytes {min_mem_free} (page-cache churn risk)"
        )
    if mem["Shmem"] > max_shmem:
        violations.append(
            f"Shmem {mem['Shmem']} > maxHostShmemBytes {max_shmem} (/tmp or /dev/shm tmpfs pressure)"
        )
    if dirty_writeback > max_dirty:
        violations.append(
            f"Dirty+Writeback {dirty_writeback} > maxHostDirtyWritebackBytes {max_dirty}"
        )

    gpu = None
    if gpu_policy == "amdgpu_sysfs":
        try:
            gpu = read_amdgpu_sysfs(drm_root, card_name=freeze.get("gpuDrmCard"))
            drm_clients = scan_drm_clients(proc_root)
            evictable_uma_vram = 0
            if gpu["isUmaCarveout"]:
                evictable_uma_vram = min(
                    gpu["vramUsedBytes"],
                    sum(
                        max(0, client["privateVramBytes"] - DEFAULT_UMA_CLIENT_PINNED_RESERVE_BYTES)
                        for client in drm_clients
                    ),
                )
            effective_vram_avail = gpu["vramFreeBytes"] + evictable_uma_vram
            required_gtt_free = min_gtt_free + evictable_uma_vram
            max_desktop_gtt = int(
                freeze.get("maxDesktopClientGttBytes", DEFAULT_MAX_DESKTOP_CLIENT_GTT_BYTES)
            )
            unexpected_clients = [
                client for client in drm_clients
                if client["pid"] not in allowed_pids
                and client["gttBytes"] >= (
                    max_desktop_gtt if client["comm"] in DESKTOP_DISPLAY_COMMS else unexpected_client_gtt
                )
            ]
            gpu["evictableUmaVramBytes"] = evictable_uma_vram
            gpu["effectiveVramAvailableBytes"] = effective_vram_avail
            gpu["requiredGttFreeBytes"] = required_gtt_free
            gpu["drmClients"] = drm_clients
            gpu["unexpectedComputeClients"] = unexpected_clients

            if gpu["gttFreeBytes"] < required_gtt_free:
                violations.append(
                    f"GPU {gpu['card']} gttFreeBytes {gpu['gttFreeBytes']} < required {required_gtt_free} "
                    f"(gttUsedBytes={gpu['gttUsedBytes']}, gttTotalBytes={gpu['gttTotalBytes']}, "
                    f"evictableUmaVramBytes={evictable_uma_vram})"
                )
            if "maxGpuGttUsedBytes" in freeze and gpu["gttUsedBytes"] > int(freeze["maxGpuGttUsedBytes"]):
                violations.append(
                    f"GPU {gpu['card']} gttUsedBytes {gpu['gttUsedBytes']} > maxGpuGttUsedBytes {int(freeze['maxGpuGttUsedBytes'])}"
                )
            if effective_vram_avail < min_vram_free:
                violations.append(
                    f"GPU {gpu['card']} 512 MiB carve-out effectiveVramAvailableBytes {effective_vram_avail} "
                    f"< minGpuVramFreeBytes {min_vram_free} (vramFreeBytes={gpu['vramFreeBytes']}, "
                    f"evictableUmaVramBytes={evictable_uma_vram}, vramTotalBytes={gpu['vramTotalBytes']}; "
                    f"BO_VA / SDMA suballoc risk)"
                )
            if gpu["preemptUsedBytes"] > max_preempt_used:
                violations.append(
                    f"GPU {gpu['card']} preemptUsedBytes {gpu['preemptUsedBytes']} > maxGpuPreemptUsedBytes {max_preempt_used}"
                )
            if unexpected_clients:
                desc = ", ".join(
                    f"{row['comm']}(pid={row['pid']},client={row['clientId']},gtt={row['gttBytes']})"
                    for row in unexpected_clients
                )
                violations.append(f"Unexpected GPU compute client(s) holding GTT memory: {desc}")
            if gpu["gpuBusyPercent"] > max_gpu_busy:
                violations.append(
                    f"GPU {gpu['card']} gpuBusyPercent {gpu['gpuBusyPercent']} > maxGpuBusyPercent {max_gpu_busy}"
                )
        except PreflightError as error:
            violations.append(str(error))

    io_activity = detect_bulk_copy_activity(
        proc_root,
        large_file_bytes=large_copy_bytes,
        sample_seconds=sample_seconds,
        sleep_fn=sleep_fn,
        self_pid=self_pid,
    )
    if (
        not io_activity["copyProcesses"]
        and io_activity["ambientDiskBytesPerSec"] > max_disk_bps
        and sample_seconds > 0
    ):
        sleep_fn(1.0)
        recheck = detect_bulk_copy_activity(
            proc_root,
            large_file_bytes=large_copy_bytes,
            sample_seconds=max(sample_seconds, 0.5),
            sleep_fn=sleep_fn,
            self_pid=self_pid,
        )
        recheck["initialAmbientDiskBytesPerSec"] = io_activity["ambientDiskBytesPerSec"]
        io_activity = recheck
    if io_activity["copyProcesses"]:
        summary = ", ".join(f"{row['command']}(pid={row['pid']},{row['reason']})" for row in io_activity["copyProcesses"])
        violations.append(f"Active bulk file copy or archive process detected: {summary}")
    if io_activity["ambientDiskBytesPerSec"] > max_disk_bps:
        violations.append(
            f"Ambient disk I/O {io_activity['ambientDiskBytesPerSec']:.0f} B/s > maxAmbientDiskBytesPerSec {max_disk_bps}"
        )

    snapshot = {
        "checkedAt": time.time(),
        "passed": not violations,
        "violations": violations,
        "thresholds": {
            "minHostAvailableBytes": min_available,
            "minHostMemFreeBytes": min_mem_free,
            "maxHostShmemBytes": max_shmem,
            "maxHostDirtyWritebackBytes": max_dirty,
            "gpuPreflightPolicy": gpu_policy,
            "minGpuGttFreeBytes": min_gtt_free if gpu_policy == "amdgpu_sysfs" else None,
            "minGpuVramFreeBytes": min_vram_free if gpu_policy == "amdgpu_sysfs" else None,
            "maxGpuBusyPercent": max_gpu_busy if gpu_policy == "amdgpu_sysfs" else None,
            "maxAmbientDiskBytesPerSec": max_disk_bps,
            "largeCopyFileThresholdBytes": large_copy_bytes,
        },
        "hostMemory": {
            "MemTotal": mem["MemTotal"],
            "MemFree": mem["MemFree"],
            "MemAvailable": mem["MemAvailable"],
            "Cached": mem.get("Cached", 0),
            "Shmem": mem["Shmem"],
            "SwapCached": mem.get("SwapCached", 0),
            "Dirty": mem.get("Dirty", 0),
            "Writeback": mem.get("Writeback", 0),
        },
        "gpu": gpu,
        "io": io_activity,
    }
    return snapshot


def require_host_and_gpu_preflight(freeze, **kwargs):
    snapshot = check_host_and_gpu_preflight(freeze, **kwargs)
    if not snapshot["passed"]:
        raise PreflightError("Hardened host/GPU preflight refused execution: " + "; ".join(snapshot["violations"]),
                             snapshot=snapshot)
    return snapshot


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("freeze")
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--check-host-preflight", action="store_true")
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    frozen_bytes = Path(args.freeze).read_bytes()
    assert hashlib.sha256(frozen_bytes).hexdigest() == args.sha256, "Frozen comparison changed"
    freeze = json.loads(frozen_bytes)
    assert freeze["schema"] == "a1.complete-request-comparison/v2", "Obsolete comparison freeze"
    validate_workloads(freeze["workloads"])
    require_lifecycle = freeze.get("requireNativeLifecycle", False)
    assert isinstance(require_lifecycle, bool), "requireNativeLifecycle must be an explicit boolean"
    provider_policy = freeze.get("protectedProviderPolicy", "active_unchanged")
    assert provider_policy in ("active_unchanged", "paused_inactive"), "Invalid protectedProviderPolicy"
    cache_policy = freeze.get("protectedCachePolicy", "preserve_across_arms")
    assert cache_policy in ("preserve_across_arms", "clear_before_candidate", "clear_each_arm"), \
        "Invalid protectedCachePolicy"
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
    report = {
        "scope": freeze["scope"],
        "freezeSha256": args.sha256,
        "started": time.time(),
        "modelRunsStarted": False,
        "completed": False,
        "protectedProviderUnit": freeze["protectedProviderUnit"],
        "protectedProviderPolicy": provider_policy,
        "runsBesideProtectedProvider": provider_policy == "active_unchanged",
        "protectedCachePolicy": cache_policy,
        "environmentPolicy": "Unset ambient POOLED_*, DOPPLER_*, DAWN_OPTS, UV_THREADPOOL_SIZE and RN_DEBUG; apply only frozen arm overrides; unset is distinct from empty",
        "nativeLifecycleRequired": require_lifecycle,
        "nativeLifecycleQualified": False,
        "arms": [],
    }

    def save():
        with open(out / "report.json", "w", encoding="utf-8") as fh:
            fh.write(json.dumps(report, indent=2))
            fh.flush()
            os.fsync(fh.fileno())

    server = None
    try:
        clean_environment(freeze["pooledConfig"].get("environment", {}))
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
        protected_cache_dirs = discover_protected_cache_dirs(freeze)
        report["protectedCacheDirectories"] = [str(item) for item in protected_cache_dirs]
        report["metadataPreflightPassed"] = True
        report["sourceIntegrityReady"] = report["controlPreflight"]["sourceIntegrity"]["ready"]
        save()
        if args.check_host_preflight and not args.execute:
            report["providerBefore"] = snapshot_protected_provider(freeze)
            host_snapshot = check_host_and_gpu_preflight(
                freeze, allowed_gpu_pids=_allowed_gpu_pids(report["providerBefore"])
            )
            report["hostPreflightBefore"] = host_snapshot
            save()
            summary = {
                "metadataPreflightPassed": True,
                "sourceIntegrityReady": report["sourceIntegrityReady"],
                "protectedProviderPolicy": provider_policy,
                "runsBesideProtectedProvider": report["runsBesideProtectedProvider"],
                "hostPreflightPassed": host_snapshot["passed"],
                "violations": host_snapshot["violations"],
                "hostMemory": host_snapshot["hostMemory"],
                "gpu": host_snapshot["gpu"],
                "io": host_snapshot["io"],
                "modelRunsStarted": False,
            }
            print(json.dumps(summary))
            if not host_snapshot["passed"]:
                raise PreflightError(
                    "Hardened host/GPU preflight refused execution: " + "; ".join(host_snapshot["violations"]),
                    snapshot=host_snapshot,
                )
            return
        if not args.execute:
            print(json.dumps({"metadataPreflightPassed": True, "sourceIntegrityReady": report["sourceIntegrityReady"],
                              "modelRunsStarted": False}))
            return
        assert report["sourceIntegrityReady"], "A pinned complete content proof is required before comparison execution"
        with open(freeze["locks"][0], "a") as exclusive, open(freeze["locks"][1], "a") as shared:
            fcntl.flock(exclusive, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(shared, fcntl.LOCK_SH | fcntl.LOCK_NB)
            before = snapshot_protected_provider(freeze)
            report["providerBefore"] = before
            allowed_gpu_pids = _allowed_gpu_pids(before)
            if cache_policy in ("clear_before_candidate", "clear_each_arm") and protected_cache_dirs:
                report["protectedCacheClearedAtStart"] = clear_protected_cache_dirs(protected_cache_dirs)
            host_before = check_host_and_gpu_preflight(freeze, allowed_gpu_pids=allowed_gpu_pids)
            report["hostPreflightBefore"] = host_before
            save()
            if not host_before["passed"]:
                raise PreflightError(
                    "Hardened host/GPU preflight refused execution: " + "; ".join(host_before["violations"]),
                    snapshot=host_before,
                )
            signaling = freeze["signaling"]
            with socket.socket() as free:
                free.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
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
                        verify_protected_provider_unchanged(freeze, before, snapshot_protected_provider(freeze))
                        cache_cleared_before = None
                        if kind != "pooled" and cache_policy in ("clear_before_candidate", "clear_each_arm") and protected_cache_dirs:
                            cache_cleared_before = clear_protected_cache_dirs(protected_cache_dirs)
                        arm_preflight = check_host_and_gpu_preflight(freeze, allowed_gpu_pids=allowed_gpu_pids)
                        (arm / "host-preflight.json").write_text(json.dumps(arm_preflight, indent=2))
                        if not arm_preflight["passed"]:
                            report["lastArmPreflightFailure"] = {
                                "workload": workload["name"],
                                "armIndex": index,
                                "kind": kind,
                                "hostPreflight": arm_preflight,
                            }
                            save()
                            raise PreflightError(
                                f"Hardened preflight refused arm {workload['name']}-{index}-{kind}: "
                                + "; ".join(arm_preflight["violations"]),
                                snapshot=arm_preflight,
                            )
                        report["modelRunsStarted"] = None
                        report["stage"] = {"workload": workload["name"], "kind": kind,
                                           "state": "owned model-command admission attempted; opening unobserved"}
                        save()
                        cache_cleared_after = None
                        try:
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
                                                         requests, arm / "process.log", freeze["armTimeoutSeconds"],
                                                         config.get("environment", {}))
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
                        finally:
                            if kind != "pooled" and cache_policy == "clear_each_arm" and protected_cache_dirs:
                                cache_cleared_after = clear_protected_cache_dirs(protected_cache_dirs)
                        report["modelRunsStarted"] = True
                        report["stage"]["state"] = "complete request outputs observed"
                        normalized = check_tokens(rows, workload, kind, freeze, arm)
                        if reference is None:
                            reference = normalized
                        assert normalized == reference, "Exact complete IDs, stop reason/token or public text differs"
                        verify_protected_provider_unchanged(freeze, before, snapshot_protected_provider(freeze))
                        opened = responses[0] if kind == "pooled" else responses[1]
                        setup = {key: opened[key] for key in ["clientSetupWallMs", "clientSetupScope", "clientOpenWallMs"]}
                        report["arms"].append({
                            "workload": workload["name"],
                            "kind": kind,
                            "exactCompletion": True,
                            "setup": setup,
                            "hostPreflight": arm_preflight,
                            "protectedCacheClearedBefore": cache_cleared_before,
                            "protectedCacheClearedAfter": cache_cleared_after,
                            "normalized": normalized,
                            "rows": rows,
                            "lifecycle": lifecycle,
                        })
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
                report["providerAfter"] = snapshot_protected_provider(freeze)
                verify_protected_provider_unchanged(freeze, before, report["providerAfter"])
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
