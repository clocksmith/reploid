"""Tiny mocked proc/cgroup fixtures; no live provider or GPU operations."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[1] / "fixtures" / "provider_state.py"
SPEC = importlib.util.spec_from_file_location("a1_provider_state", SOURCE)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class ProviderStateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.proc = self.root / "proc"
        self.group = self.root / "cgroup" / "service"
        self.group.mkdir(parents=True)
        (self.group / "cgroup.procs").write_text("10\n20\n")
        self.show = "ActiveState=active\nMainPID=10\nControlGroup=/service\nInvocationID=" + "a" * 32 + "\n"
        self.process(10, "flock", 1, 100)
        self.process(20, "node worker (provider)", 10, 200, gpu=True)

    def process(self, pid, comm, parent, start, gpu=False):
        directory = self.proc / str(pid)
        (directory / "fdinfo").mkdir(parents=True)
        self.identity(pid, comm, parent, start)
        (directory / "exe").symlink_to("/usr/bin/" + ("node" if gpu else "flock"))
        (directory / "fdinfo" / "0").write_text("pos:\t0\nflags:\t0100000\n")
        if gpu:
            self.counter(pid, 123)

    def identity(self, pid, comm, parent, start):
        # Fields after comm start at kernel stat field3; starttime is field22.
        fields = ["S", str(parent)] + ["0"] * 17 + [str(start)]
        (self.proc / str(pid) / "stat").write_text(f"{pid} ({comm}) " + " ".join(fields) + "\n")

    def counter(self, pid, count):
        (self.proc / str(pid) / "fdinfo" / "7").write_text(
            f"drm-driver:\tamdgpu\ndrm-client-id:\t2237\ndrm-pdev:\t0000:c5:00.0\n"
            f"drm-engine-gfx:\t{count} ns\ndrm-memory-vram:\t8192 KiB\n")

    def snapshot(self, show=None):
        return MODULE.provider_state("protected.service", proc_root=self.proc,
                                     cgroup_root=self.root / "cgroup", show=show or (lambda: self.show))

    def test_flock_parent_and_gpu_child_are_observed_without_using_mainpid_as_gpu_owner(self):
        state = self.snapshot()
        self.assertEqual(state["service"]["MainPID"], "10")
        self.assertEqual(state["cgroupMembers"], {".": [10, 20]})
        self.assertEqual(state["processes"]["10"]["drm"], {})
        self.assertEqual(state["processes"]["20"]["identity"]["startTimeTicks"], "200")
        self.assertEqual(state["processes"]["20"]["drm"]["7"]["drm-engine-gfx"], "123 ns")
        self.assertEqual(state["processes"]["20"]["drm"]["7"]["drm-memory-vram"], "8192 KiB")
        MODULE.assert_provider_unchanged(state, self.snapshot())

    def test_gpu_activity_or_process_restart_invalidates_the_previous_snapshot(self):
        before = self.snapshot()
        self.counter(20, 124)
        with self.assertRaisesRegex(MODULE.ProviderStateError, "activity changed"):
            MODULE.assert_provider_unchanged(before, self.snapshot())
        self.counter(20, 123)
        self.identity(20, "node worker (provider)", 10, 201)
        with self.assertRaisesRegex(MODULE.ProviderStateError, "identity.*changed"):
            MODULE.assert_provider_unchanged(before, self.snapshot())

    def test_nested_service_cgroup_gpu_owners_and_membership_are_retained(self):
        child = self.group / "workers"
        child.mkdir()
        (child / "cgroup.procs").write_text("20\n")
        (self.group / "cgroup.procs").write_text("10\n")
        state = self.snapshot()
        self.assertEqual(state["cgroupMembers"], {".": [10], "workers": [20]})
        (child / "cgroup.procs").write_text("")
        with self.assertRaisesRegex(MODULE.ProviderStateError, "GPU ownership"):
            self.snapshot()

    def test_unobservable_gpu_or_process_metadata_is_not_silently_ignored(self):
        descriptor = self.proc / "20" / "fdinfo" / "7"
        descriptor.write_text("drm-client-id:\t2237\n")
        with self.assertRaisesRegex(MODULE.ProviderStateError, "GPU activity is unobservable"):
            self.snapshot()
        self.counter(20, 123)
        (self.proc / "20" / "stat").unlink()
        with self.assertRaisesRegex(MODULE.ProviderStateError, "ownership is unobservable"):
            self.snapshot()

    def test_restarts_during_observation_and_changed_unit_invocation_are_rejected(self):
        original = MODULE._text
        def read(filename, limit=65536):
            value = original(filename, limit)
            if str(filename).endswith("/20/fdinfo/7"):
                self.identity(20, "node worker (provider)", 10, 202)
            return value
        with patch.object(MODULE, "_text", side_effect=read):
            with self.assertRaisesRegex(MODULE.ProviderStateError, "identity changed during"):
                self.snapshot()
        calls = iter([self.show, self.show.replace("a" * 32, "b" * 32)])
        with self.assertRaisesRegex(MODULE.ProviderStateError, "service changed during"):
            self.snapshot(show=lambda: next(calls))

    def test_new_service_members_during_observation_are_rejected(self):
        original = MODULE._text
        def read(filename, limit=65536):
            value = original(filename, limit)
            if str(filename).endswith("/20/fdinfo/7"):
                (self.group / "cgroup.procs").write_text("10\n20\n30\n")
            return value
        with patch.object(MODULE, "_text", side_effect=read):
            with self.assertRaisesRegex(MODULE.ProviderStateError, "membership changed during"):
                self.snapshot()


if __name__ == "__main__":
    unittest.main()
