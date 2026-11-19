"""Unit tests for hardened A1 host, Shmem, AMD GPU GTT/512MiB carve-out, copy, and cache preflight."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "fixtures/peers/pooled/compare-complete.py"
SPEC = importlib.util.spec_from_file_location("a1_compare_complete_preflight", SOURCE)
comparison = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(comparison)

GIB = 1024 ** 3
MIB = 1024 ** 2


def write_meminfo(proc_root, *, mem_total=122 * GIB, mem_free=42 * GIB, mem_available=100 * GIB,
                  cached=28 * GIB, shmem=30 * MIB, dirty=0, writeback=0):
    lines = [
        f"MemTotal:       {mem_total // 1024} kB",
        f"MemFree:        {mem_free // 1024} kB",
        f"MemAvailable:   {mem_available // 1024} kB",
        f"Cached:         {cached // 1024} kB",
        f"Shmem:          {shmem // 1024} kB",
        f"Dirty:          {dirty // 1024} kB",
        f"Writeback:      {writeback // 1024} kB",
    ]
    (proc_root / "meminfo").write_text("\n".join(lines) + "\n")


def write_amdgpu(drm_root, card="card1", *, vram_total=512 * MIB, vram_used=369 * MIB,
                 gtt_total=61 * GIB, gtt_used=1 * GIB, busy=0):
    dev = drm_root / card / "device"
    dev.mkdir(parents=True, exist_ok=True)
    (dev / "mem_info_vram_total").write_text(f"{vram_total}\n")
    (dev / "mem_info_vram_used").write_text(f"{vram_used}\n")
    (dev / "mem_info_gtt_total").write_text(f"{gtt_total}\n")
    (dev / "mem_info_gtt_used").write_text(f"{gtt_used}\n")
    (dev / "gpu_busy_percent").write_text(f"{busy}\n")
    connector = drm_root / f"{card}-DP-1" / "device"
    connector.mkdir(parents=True, exist_ok=True)


def write_diskstats(proc_root, sectors_read=1000, sectors_written=500):
    (proc_root / "diskstats").write_text(
        f" 259 0 nvme0n1 10 0 {sectors_read} 1 5 0 {sectors_written} 1 0 1 1\n"
        f" 259 1 nvme0n1p1 10 0 {sectors_read} 1 5 0 {sectors_written} 1 0 1 1\n"
    )


def write_proc(proc_root, pid, comm, state="S", argv0=None, open_files=()):
    pdir = proc_root / str(pid)
    (pdir / "fd").mkdir(parents=True, exist_ok=True)
    (pdir / "stat").write_text(f"{pid} ({comm}) {state} 1 {pid} {pid} 0 -1 0 0 0 0 0 0 0 0 20 0 1 0 100\n")
    cmd = (argv0 or comm).encode("utf-8") + b"\x00"
    (pdir / "cmdline").write_bytes(cmd)
    for idx, target in enumerate(open_files):
        (pdir / "fd" / str(idx)).symlink_to(target)


class CompareCompletePreflightTest(unittest.TestCase):
    def setUp(self):
        self.freeze = {
            "minHostAvailableBytes": 32 * GIB,
            "gpuCapBytes": 32 * GIB,
            "protectedProviderUnit": "reploid-qwen27b-0633-20261104.service",
        }

    def test_healthy_host_and_amd_gpu_preflight_passes(self):
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            proc, drm = root / "proc", root / "drm"
            proc.mkdir()
            drm.mkdir()
            write_meminfo(proc)
            write_amdgpu(drm, vram_total=512 * MIB, vram_used=369 * MIB, gtt_total=61 * GIB, gtt_used=1 * GIB, busy=0)
            write_diskstats(proc, 1000, 500)
            write_proc(proc, 101, "node", state="S", argv0="/usr/bin/node")
            snap = comparison.require_host_and_gpu_preflight(
                self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0.05, sleep_fn=lambda _: None, self_pid=999999
            )
            self.assertTrue(snap["passed"])
            self.assertEqual(snap["violations"], [])
            self.assertEqual(snap["gpu"]["vramFreeBytes"], (512 - 369) * MIB)
            self.assertEqual(snap["gpu"]["gttFreeBytes"], 60 * GIB)

    def test_refuses_high_shmem_and_low_memfree_even_when_memavailable_looks_large(self):
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            proc, drm = root / "proc", root / "drm"
            proc.mkdir()
            drm.mkdir()
            write_meminfo(proc, mem_available=80 * GIB, mem_free=9 * GIB, shmem=31 * GIB, dirty=2 * GIB)
            write_amdgpu(drm)
            write_diskstats(proc)
            snap = comparison.check_host_and_gpu_preflight(
                self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0, self_pid=999999
            )
            self.assertFalse(snap["passed"])
            joined = " | ".join(snap["violations"])
            self.assertIn("MemFree", joined)
            self.assertIn("Shmem", joined)
            self.assertIn("Dirty+Writeback", joined)
            with self.assertRaises(comparison.PreflightError):
                comparison.require_host_and_gpu_preflight(
                    self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0, self_pid=999999
                )

    def test_refuses_exhausted_512mib_vram_carveout_and_insufficient_gtt_headroom(self):
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            proc, drm = root / "proc", root / "drm"
            proc.mkdir()
            drm.mkdir()
            write_meminfo(proc)
            write_amdgpu(
                drm,
                vram_total=512 * MIB,
                vram_used=502 * MIB,
                gtt_total=61 * GIB,
                gtt_used=25 * GIB,
                busy=42,
            )
            write_diskstats(proc)
            snap = comparison.check_host_and_gpu_preflight(
                self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0, self_pid=999999
            )
            self.assertFalse(snap["passed"])
            joined = " | ".join(snap["violations"])
            self.assertIn("512 MiB carve-out effectiveVramAvailableBytes", joined)
            self.assertIn("gttFreeBytes", joined)
            self.assertIn("gpuBusyPercent", joined)

    def test_uma_carveout_counts_evictable_drm_vram_and_rejects_unexpected_compute_client(self):
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            proc, drm = root / "proc", root / "drm"
            proc.mkdir()
            drm.mkdir()
            write_meminfo(proc)
            write_amdgpu(
                drm,
                vram_total=512 * MIB,
                vram_used=502 * MIB,
                gtt_total=61 * GIB,
                gtt_used=17 * GIB,
                busy=0,
            )
            write_diskstats(proc)
            write_proc(proc, 9258, "gnome-shell", state="S")
            (proc / "9258/fdinfo").mkdir()
            (proc / "9258/fdinfo/12").write_text(
                "drm-client-id:\t45\ndrm-memory-vram:\t200716 KiB\ndrm-memory-gtt:\t93480 KiB\n"
            )
            write_proc(proc, 116975, "node", state="S")
            (proc / "116975/fdinfo").mkdir()
            (proc / "116975/fdinfo/50").write_text(
                "drm-client-id:\t64\ndrm-memory-vram:\t136888 KiB\ndrm-memory-gtt:\t17643192 KiB\n"
            )
            snap_allowed = comparison.check_host_and_gpu_preflight(
                self.freeze,
                proc_root=proc,
                drm_root=drm,
                allowed_gpu_pids={116975},
                sample_seconds=0,
                self_pid=999999,
            )
            self.assertTrue(snap_allowed["passed"], snap_allowed["violations"])
            self.assertGreaterEqual(snap_allowed["gpu"]["effectiveVramAvailableBytes"], 64 * MIB)

            snap_leaked = comparison.check_host_and_gpu_preflight(
                self.freeze,
                proc_root=proc,
                drm_root=drm,
                allowed_gpu_pids=set(),
                sample_seconds=0,
                self_pid=999999,
            )
            self.assertFalse(snap_leaked["passed"])
            self.assertIn("Unexpected GPU compute client", " | ".join(snap_leaked["violations"]))

    def test_refuses_active_rsync_large_cp_and_high_ambient_disk_throughput(self):
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            proc, drm = root / "proc", root / "drm"
            proc.mkdir()
            drm.mkdir()
            write_meminfo(proc)
            write_amdgpu(drm)
            write_diskstats(proc, sectors_read=1000, sectors_written=1000)
            small_file = root / "small.txt"
            small_file.write_bytes(b"ok")
            large_file = root / "weights.gguf"
            with open(large_file, "wb") as handle:
                handle.truncate(128 * MIB)
            write_proc(proc, 200, "rsync", state="Z")
            write_proc(proc, 201, "cp", state="S", open_files=[small_file])
            snap_clean = comparison.check_host_and_gpu_preflight(
                self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0, self_pid=999999
            )
            self.assertTrue(snap_clean["passed"])

            write_proc(proc, 202, "rsync", state="R", argv0="/usr/bin/rsync")
            write_proc(proc, 203, "cp", state="D", open_files=[large_file])

            def advance_disk(_seconds):
                # +60 MiB in 0.2s = 300 MiB/s (> 64 MiB/s limit); nvme0n1p1 partition row must not double count.
                write_diskstats(proc, sectors_read=1000 + (60 * MIB // 512), sectors_written=1000)

            snap_busy = comparison.check_host_and_gpu_preflight(
                self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0.2, sleep_fn=advance_disk, self_pid=999999
            )
            self.assertFalse(snap_busy["passed"])
            joined = " | ".join(snap_busy["violations"])
            self.assertIn("rsync(pid=202", joined)
            self.assertIn("cp(pid=203,large_regular_file_open)", joined)
            self.assertIn("Ambient disk I/O", joined)

    def test_discovers_validates_and_clears_protected_cache_safely(self):
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            shm = root / "shm"
            shm.mkdir()
            cache_dir = shm / "a1-protected-piece-cache-v65"
            cache_dir.mkdir()
            (cache_dir / "piece.bin").write_bytes(b"cached-expert")
            cand_cfg = root / "candidate.json"
            cand_cfg.write_text(json.dumps({
                "workerGather": {"protectedCache": {"directory": str(cache_dir)}}
            }))
            freeze = {"native": {"candidate": {"nativeConfigPath": str(cand_cfg)}}}
            dirs = comparison.discover_protected_cache_dirs(freeze, allowed_roots=(str(shm),))
            self.assertEqual(dirs, [cache_dir])
            receipts = comparison.clear_protected_cache_dirs(dirs, allowed_roots=(str(shm),))
            self.assertEqual(receipts, [{"directory": str(cache_dir), "removed": True, "existsAfter": False}])
            self.assertFalse(cache_dir.exists())

            outside = root / "outside-cache"
            outside.mkdir()
            with self.assertRaises(comparison.PreflightError):
                comparison.validate_protected_cache_dir(str(outside), allowed_roots=(str(shm),))
            with self.assertRaises(comparison.PreflightError):
                comparison.validate_protected_cache_dir(str(shm), allowed_roots=(str(shm),))
            sym = shm / "symlink-cache"
            sym.symlink_to(outside)
            with self.assertRaises(comparison.PreflightError):
                comparison.validate_protected_cache_dir(str(sym), allowed_roots=(str(shm),))

    def test_paused_provider_policy_verifies_inactive_service_and_detects_unexpected_start(self):
        freeze = {
            "protectedProviderUnit": "reploid-qwen27b-0633-20261104.service",
            "protectedProviderPolicy": "paused_inactive",
        }
        inactive_out = "ActiveState=inactive\nSubState=dead\nMainPID=0\nInvocationID=\n"
        before = comparison.snapshot_protected_provider(freeze, show_paused=lambda: inactive_out)
        after = comparison.snapshot_protected_provider(freeze, show_paused=lambda: inactive_out)
        comparison.verify_protected_provider_unchanged(freeze, before, after)

        active_out = "ActiveState=active\nSubState=running\nMainPID=116968\nInvocationID=abcd\n"
        with self.assertRaises(comparison.ProviderStateError):
            comparison.snapshot_protected_provider(freeze, show_paused=lambda: active_out)

    def test_settles_transient_journal_flush_without_copy_processes_but_refuses_sustained_io(self):
        with tempfile.TemporaryDirectory() as root_str:
            root = Path(root_str)
            proc, drm = root / "proc", root / "drm"
            proc.mkdir()
            drm.mkdir()
            write_meminfo(proc)
            write_amdgpu(drm)
            write_diskstats(proc, sectors_read=1000, sectors_written=1000)

            calls = {"n": 0}

            def transient_flush(_seconds):
                calls["n"] += 1
                if calls["n"] == 1:
                    # Simulate 20 MiB report.json flush in 0.2s (100 MiB/s), then idle on settle + recheck.
                    write_diskstats(proc, sectors_read=1000, sectors_written=1000 + (20 * MIB // 512))

            snap_transient = comparison.check_host_and_gpu_preflight(
                self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0.2, sleep_fn=transient_flush, self_pid=999999
            )
            self.assertTrue(snap_transient["passed"], snap_transient["violations"])
            self.assertGreater(snap_transient["io"]["initialAmbientDiskBytesPerSec"], 64 * MIB)
            self.assertEqual(snap_transient["io"]["ambientDiskBytesPerSec"], 0.0)

            write_diskstats(proc, sectors_read=1000, sectors_written=1000)
            sustained = {"sectors": 1000}

            def sustained_io(seconds):
                sustained["sectors"] += int((100 * MIB * seconds) // 512)
                write_diskstats(proc, sectors_read=sustained["sectors"], sectors_written=1000)

            snap_sustained = comparison.check_host_and_gpu_preflight(
                self.freeze, proc_root=proc, drm_root=drm, sample_seconds=0.2, sleep_fn=sustained_io, self_pid=999999
            )
            self.assertFalse(snap_sustained["passed"])
            self.assertIn("Ambient disk I/O", " | ".join(snap_sustained["violations"]))


if __name__ == "__main__":
    unittest.main()
