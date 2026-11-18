"""Actual bounded subprocess transport checks; no SDK, model or GPU imports."""
import importlib.util
import fcntl
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import Mock, patch

MODULE = Path(__file__).resolve().parents[1] / "fixtures" / "complete_request_client.py"
SPEC = importlib.util.spec_from_file_location("complete_request_client", MODULE)
CLIENT_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CLIENT_MODULE)
CompleteRequestClient = CLIENT_MODULE.CompleteRequestClient

PRELUDE = "import json,os,sys,time,subprocess,signal\n"


class CompleteRequestClientTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="complete-request-client-")
        self.addCleanup(self.directory.cleanup)
        self.sequence = 0

    def client(self, source, **options):
        self.sequence += 1
        log = Path(self.directory.name) / (str(self.sequence) + ".log")
        client = CompleteRequestClient([sys.executable, "-u", "-c", PRELUDE + source], log, **options)
        self.addCleanup(client.close)
        return client, log

    def test_split_response_and_serial_requests_preserve_logs_and_owned_echo(self):
        client, log = self.client("""
for line in sys.stdin:
    request=json.loads(line)
    print('ordinary audit line',flush=True)
    print('separate stderr line',file=sys.stderr,flush=True)
    wire=('@q4-response '+json.dumps({'id':request['id'],'value':request['nested']})+'\\n').encode()
    time.sleep(.04)
    os.write(1,wire[:9])
    time.sleep(.02)
    os.write(1,wire[9:])
""")
        payload = {"nested": {"ids": [1, 2], "text": "token \u03bb"}}
        first = client.request(payload, 2)
        payload["nested"]["ids"].append(3)
        self.assertEqual(first["value"], {"ids": [1, 2], "text": "token \u03bb"})
        self.assertEqual(first["clientRequestPayload"]["nested"]["ids"], [1, 2])
        self.assertEqual(first["id"], 1)
        self.assertGreaterEqual(first["clientRequestWallMs"], 50)
        request_wire = json.dumps(first["clientRequestPayload"], ensure_ascii=False, separators=(",", ":")) + "\n"
        response_wire = "@q4-response " + json.dumps({"id": 1, "value": first["value"]}) + "\n"
        self.assertEqual(first["clientRequestBytes"], len(request_wire.encode("utf-8")))
        self.assertEqual(first["clientResponseBytes"], len(response_wire.encode("utf-8")))
        second = client.request(payload, 2)
        self.assertEqual(second["id"], 2)
        self.assertEqual(second["value"]["ids"], [1, 2, 3])
        client.close()
        self.assertIn(b"ordinary audit line", log.read_bytes())
        self.assertIn(b"@q4-response ", log.read_bytes())
        self.assertNotIn(b"separate stderr", log.read_bytes())
        self.assertIn(b"separate stderr", Path(str(log) + ".stderr").read_bytes())

    def test_wrong_and_duplicate_ids_fail_closed(self):
        for code, message in [
            ("{'id':r['id']+1,'value':0}", "differs"),
            ("{'id':True,'value':0}", "integer"),
        ]:
            with self.subTest(code=code):
                client, _ = self.client("r=json.loads(sys.stdin.readline())\nprint('@q4-response '+json.dumps(" + code + "),flush=True)\ntime.sleep(10)")
                with self.assertRaisesRegex(ValueError, message):
                    client.request({"op": "request"}, 2)
                self.assertIsNotNone(client._child.poll())
        client, _ = self.client("""
r=json.loads(sys.stdin.readline())
wire='@q4-response '+json.dumps({'id':r['id'],'value':0})+'\\n'
os.write(1,(wire+wire).encode())
time.sleep(10)
""")
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            client.request({}, 2)
        self.assertIsNotNone(client._child.poll())

    def test_late_duplicate_cannot_become_next_response(self):
        client, _ = self.client("""
r=json.loads(sys.stdin.readline())
wire='@q4-response '+json.dumps({'id':r['id'],'value':0})+'\\n'
os.write(1,wire.encode());time.sleep(.03);os.write(1,wire.encode())
time.sleep(10)
""")
        self.assertEqual(client.request({}, 2)["value"], 0)
        time.sleep(.06)
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            client.request({}, 2)

    def test_oversized_and_nonfinite_responses_fail_closed(self):
        for source, message in [
            ("sys.stdin.readline();os.write(1,b'@q4-response '+b'x'*1024);time.sleep(10)", "byte bound"),
            ("r=json.loads(sys.stdin.readline());print('@q4-response '+json.dumps({'id':r['id'],'value':float('nan')}),flush=True);time.sleep(10)", "Non-finite"),
        ]:
            with self.subTest(message=message):
                client, _ = self.client(source, max_response_bytes=256)
                with self.assertRaisesRegex(ValueError, message):
                    client.request({}, 2)
                self.assertIsNotNone(client._child.poll())

    def test_partial_response_stall_obeys_deadline_and_reaps_worker(self):
        client, _ = self.client("sys.stdin.readline();os.write(1,b'@q4-response {');time.sleep(10)")
        started = time.perf_counter()
        with self.assertRaises(TimeoutError):
            client.request({}, .15)
        self.assertLess(time.perf_counter() - started, 3)
        self.assertIsNotNone(client._child.poll())

    def test_nonreading_worker_does_not_block_stdin_write(self):
        client, _ = self.client("time.sleep(10)", max_response_bytes=4 * 1024 * 1024)
        with self.assertRaises(TimeoutError):
            client.request({"text": "x" * (2 * 1024 * 1024)}, .15)
        self.assertIsNotNone(client._child.poll())

    def test_worker_exit_before_response_fails_and_reaps(self):
        client, _ = self.client("sys.stdin.readline();sys.exit(7)")
        with self.assertRaisesRegex(RuntimeError, "exited"):
            client.request({}, 2)
        self.assertEqual(client._child.returncode, 7)

    def test_arm_deadline_includes_initialization(self):
        client, _ = self.client("time.sleep(10)", arm_timeout_seconds=.1)
        with self.assertRaises(TimeoutError):
            client.request({}, 2)

    def test_error_envelope_is_returned_and_context_exits_naturally_on_eof(self):
        client, _ = self.client("""
for line in sys.stdin:
    r=json.loads(line)
    print('@q4-response '+json.dumps({'id':r['id'],'error':{'message':'expected'}}),flush=True)
""")
        with client:
            result = client.request({}, 2)
            self.assertEqual(result["error"]["message"], "expected")
            self.assertGreaterEqual(result["clientRequestWallMs"], 0)
            self.assertIsNone(client._child.poll())
        self.assertEqual(client._child.returncode, 0)
        with self.assertRaisesRegex(RuntimeError, "closed"):
            client.request({}, 1)

    def test_explicit_close_ack_and_natural_exit_are_qualified(self):
        client, log = self.client("""
r=json.loads(sys.stdin.readline())
print('@q4-response '+json.dumps({'id':r['id'],'value':{'closed':True}}),flush=True)
print('ordinary shutdown audit',flush=True)
""")
        self.assertTrue(client.request({"op": "close"}, 2)["value"]["closed"])
        result = client.finish(1)
        self.assertEqual(result, {"graceful": True, "forced": False, "exitCode": 0, "stdoutEof": True})
        self.assertEqual(client._child.returncode, 0)
        self.assertIn(b'ordinary shutdown audit', log.read_bytes())
        client.close()  # No signals follow an already-qualified finish.

    def test_close_ack_with_held_event_loop_fails_then_reaps(self):
        client, _ = self.client("""
r=json.loads(sys.stdin.readline())
print('@q4-response '+json.dumps({'id':r['id'],'value':{'closed':True}}),flush=True)
sys.stdin.read();time.sleep(30)
""")
        self.assertTrue(client.request({"op": "close"}, 2)["value"]["closed"])
        with self.assertRaises(TimeoutError):
            client.finish(.15)
        self.assertIsNotNone(client._child.poll())
        with self.assertRaisesRegex(RuntimeError, 'closed'):
            client.finish(1)

    def test_finish_rejects_late_duplicate_and_nonzero_exit(self):
        for tail, exception, message in [
            ("time.sleep(.03);print(wire,flush=True)", ValueError, 'Duplicate'),
            ("time.sleep(.03);sys.exit(7)", RuntimeError, 'gracefully'),
        ]:
            with self.subTest(tail=tail):
                client, _ = self.client("""
r=json.loads(sys.stdin.readline())
wire='@q4-response '+json.dumps({'id':r['id'],'value':0})
print(wire,flush=True)
""" + tail)
                self.assertEqual(client.request({"op": "close"}, 2)["value"], 0)
                with self.assertRaisesRegex(exception, message):
                    client.finish(1)
                self.assertIsNotNone(client._child.poll())

    def test_finish_requires_stdout_eof_even_after_zero_leader_exit(self):
        client, _ = self.client("""
r=json.loads(sys.stdin.readline())
subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
print('@q4-response '+json.dumps({'id':r['id'],'value':0}),flush=True)
""")
        self.assertEqual(client.request({"op": "close"}, 2)["value"], 0)
        with self.assertRaises(TimeoutError):
            client.finish(.15)
        self.assertEqual(client._child.returncode, 0)

    def test_exceptional_context_exit_uses_bounded_fallback(self):
        client, _ = self.client("time.sleep(30)")
        with self.assertRaisesRegex(RuntimeError, 'caller failure'):
            with client:
                raise RuntimeError('caller failure')
        self.assertIsNotNone(client._child.poll())

    def test_invalid_payload_closes_owned_worker(self):
        for payload in [{"id": 4}, {"value": float("inf")}]:
            client, _ = self.client("time.sleep(10)")
            with self.assertRaises(ValueError):
                client.request(payload, 1)
            self.assertIsNotNone(client._child.poll())

    def test_darwin_group_cleanup_distinguishes_zombies_from_live_members(self):
        client = object.__new__(CompleteRequestClient)
        client._child = Mock(pid=123, **{"poll.return_value": 7})
        with patch.object(CLIENT_MODULE.sys, 'platform', 'darwin'), \
             patch.object(CLIENT_MODULE.os, 'killpg', side_effect=PermissionError), \
             patch.object(CLIENT_MODULE.subprocess, 'run') as snapshot:
            snapshot.return_value.stdout = "200 S\n123 Z+\n"
            client._signal_owned_group(CLIENT_MODULE.signal.SIGKILL)
            snapshot.return_value.stdout = "123 Z\n123 S\n"
            with self.assertRaises(PermissionError):
                client._signal_owned_group(CLIENT_MODULE.signal.SIGKILL)
            snapshot.reset_mock()
            client._child.poll.return_value = None
            with self.assertRaises(PermissionError):
                client._signal_owned_group(CLIENT_MODULE.signal.SIGKILL)
            snapshot.assert_not_called()

    def test_timeout_terminates_owned_descendant(self):
        marker = Path(self.directory.name) / 'descendant-exit'
        client, log = self.client("""
sub=subprocess.Popen([sys.executable,'-c','import time;time.sleep(30)'])
def stopped(sig,frame):
    code=sub.wait(timeout=1)
    with open(MARKER,'w') as handle:handle.write(str(code))
    sys.exit(0)
signal.signal(signal.SIGTERM,stopped)
print('owned-descendant:'+str(sub.pid),flush=True)
r=json.loads(sys.stdin.readline())
print('@q4-response '+json.dumps({'id':r['id'],'value':'ready'}),flush=True)
sys.stdin.readline();time.sleep(30)
""".replace('MARKER', repr(str(marker))))
        self.assertEqual(client.request({"op": "ready"}, 4)["value"], "ready")
        with self.assertRaises(TimeoutError):
            client.request({}, .2)
        self.assertIn('owned-descendant:', log.read_text())
        self.assertEqual(int(marker.read_text()), -15)
        self.assertIsNotNone(client._child.poll())

    def test_exited_leader_does_not_leave_descendant_holding_stdout(self):
        lock = Path(self.directory.name) / 'descendant.lock'
        ready = Path(self.directory.name) / 'descendant.ready'
        descendant = ("import fcntl,time,pathlib;handle=open(" + repr(str(lock)) + ",'w');"
                      "fcntl.flock(handle,fcntl.LOCK_EX);pathlib.Path(" + repr(str(ready))
                      + ").write_text('ready');time.sleep(30)")
        client, _ = self.client("""
r=json.loads(sys.stdin.readline())
subprocess.Popen([sys.executable,'-c',DESCENDANT])
while not os.path.exists(READY):time.sleep(.001)
print('@q4-response '+json.dumps({'id':r['id'],'value':'ready'}),flush=True)
sys.stdin.readline();sys.exit(7)
""".replace('DESCENDANT', repr(descendant)).replace('READY', repr(str(ready))))
        self.assertEqual(client.request({"op": "ready"}, 4)["value"], "ready")
        # The descendant keeps stdout open after its process leader exits.
        with self.assertRaises(TimeoutError):
            client.request({}, .25)
        self.assertEqual(client._child.returncode, 7)
        self.assertTrue(ready.exists())
        with open(lock) as handle:
            deadline = time.perf_counter() + 1
            while True:
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.perf_counter() >= deadline:
                        raise
                    time.sleep(.005)


if __name__ == "__main__":
    unittest.main()
