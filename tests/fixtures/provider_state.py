"""Read-only ownership/activity snapshots for one protected systemd service."""
import os
from pathlib import Path
import re
import subprocess


class ProviderStateError(RuntimeError):
    pass


def _require(condition, message):
    if not condition:
        raise ProviderStateError(message)


def _text(filename, limit=65536):
    with open(filename, "rb") as source:
        data = source.read(limit + 1)
    _require(len(data) <= limit, "Protected provider metadata exceeds observation bound")
    return data.decode("utf-8", errors="strict")


def _service(text):
    values = dict(line.split("=", 1) for line in text.splitlines() if "=" in line)
    required = {key: values.get(key) for key in ["ActiveState", "MainPID", "ControlGroup", "InvocationID"]}
    _require(required["ActiveState"] == "active", "Protected provider is not active")
    _require(str(required["MainPID"]).isdigit() and int(required["MainPID"]) > 0,
             "Protected provider MainPID is unavailable")
    group = required["ControlGroup"]
    _require(isinstance(group, str) and group.startswith("/") and group != "/"
             and all(part not in {".", ".."} for part in group.split("/")),
             "Protected provider cgroup is unavailable")
    _require(isinstance(required["InvocationID"], str)
             and re.fullmatch(r"[a-fA-F0-9]{32}", required["InvocationID"]),
             "Protected provider invocation identity is unavailable")
    return required


def _membership(root, group):
    base = Path(root).resolve(strict=True)
    selected = (base / group.lstrip("/")).resolve(strict=True)
    _require(selected.is_relative_to(base), "Protected provider cgroup escaped its root")
    members = {}
    seen = set()

    def visit(directory):
        _require(len(members) < 256, "Protected provider cgroup observation bound exceeded")
        raw = _text(directory / "cgroup.procs").split()
        _require(all(value.isdigit() and int(value) > 0 for value in raw),
                 "Protected provider cgroup membership is unobservable")
        pids = sorted(int(value) for value in raw)
        _require(len(pids) == len(set(pids)) and not seen.intersection(pids),
                 "Protected provider membership changed during observation")
        seen.update(pids)
        _require(len(seen) <= 64, "Protected provider process observation bound exceeded")
        members[str(directory.relative_to(selected))] = pids
        for child in sorted(directory.iterdir()):
            _require(not child.is_symlink(), "Protected provider cgroup has an unobservable alias")
            if child.is_dir():
                visit(child)

    visit(selected)
    return members


def _identity(proc_root, pid):
    directory = Path(proc_root) / str(pid)
    data = _text(directory / "stat")
    begin, end = data.find("("), data.rfind(")")
    _require(begin > 0 and end > begin and data[:begin].strip() == str(pid),
             "Protected provider process identity is unobservable")
    fields = data[end + 1:].split()
    _require(len(fields) >= 20 and fields[1].isdigit() and fields[19].isdigit(),
             "Protected provider process start identity is unavailable")
    return {"pid": pid, "parentPid": int(fields[1]), "startTimeTicks": fields[19],
            "comm": data[begin + 1:end], "executable": os.readlink(directory / "exe")}


def provider_state(unit, *, proc_root="/proc", cgroup_root="/sys/fs/cgroup", show=None):
    """Snapshot all observed cgroup members, not just an ExecStart wrapper PID.

    Every DRM fd's fields are retained, including engine counters and memory.
    Endpoints detect changes to observed ownership; this is not global GPU
    utilization or an attestation of work between observations.
    """
    _require(isinstance(unit, str) and re.fullmatch(r"[A-Za-z0-9_.@:-]+\.service", unit),
             "Explicit protected service name required")
    if show is None:
        def show():
            return subprocess.check_output(["systemctl", "--user", "show", unit,
                                            "-p", "ActiveState", "-p", "MainPID",
                                            "-p", "ControlGroup", "-p", "InvocationID"],
                                           text=True, timeout=5)
    try:
        service = _service(show())
        members = _membership(cgroup_root, service["ControlGroup"])
        pids = sorted(pid for values in members.values() for pid in values)
        _require(int(service["MainPID"]) in pids, "Protected provider MainPID left its service cgroup")
        processes = {}
        owners = 0
        for pid in pids:
            identity = _identity(proc_root, pid)
            directory = Path(proc_root) / str(pid) / "fdinfo"
            descriptors = sorted(directory.iterdir(), key=lambda value: value.name)
            _require(len(descriptors) <= 4096 and all(value.name.isdigit() for value in descriptors),
                     "Protected provider descriptor observation bound exceeded")
            drm = {}
            for descriptor in descriptors:
                fields = dict(line.split(":", 1) for line in _text(descriptor).splitlines()
                              if line.startswith("drm-") and ":" in line)
                if "drm-client-id" not in fields:
                    _require(not fields, "Protected provider DRM ownership lacks a client identity")
                    continue
                _require(any(key.startswith("drm-engine-") and not key.startswith("drm-engine-capacity-")
                             for key in fields), "Protected provider GPU activity is unobservable")
                drm[descriptor.name] = {key: value.strip() for key, value in sorted(fields.items())}
            _require(_identity(proc_root, pid) == identity, "Protected provider process identity changed during observation")
            _require(sorted(value.name for value in directory.iterdir()) == [value.name for value in descriptors],
                     "Protected provider descriptors changed during observation")
            owners += bool(drm)
            processes[str(pid)] = {"identity": identity, "drm": drm}
        _require(owners > 0, "Protected provider GPU ownership is unavailable")
        _require(_membership(cgroup_root, service["ControlGroup"]) == members,
                 "Protected provider cgroup membership changed during observation")
        _require(_service(show()) == service, "Protected provider service changed during observation")
        return {"service": service, "cgroupMembers": members, "processes": processes}
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        raise ProviderStateError("Protected provider ownership is unobservable: " + str(error)) from error


def assert_provider_unchanged(before, after):
    _require(before == after, "Protected provider membership, process identity, DRM ownership or activity changed")
    return after
