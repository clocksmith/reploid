"""Bounded JSONL transport for an owned local diagnostic process, without models."""
import json
import math
import os
from pathlib import Path
import selectors
import signal
import subprocess
import sys
import threading
import time


def _reject_constant(value):
    raise ValueError("Non-finite JSON constant: " + value)


class CompleteRequestClient:
    """One outstanding request; request IDs and transport clocks belong here.

    stdout (including ordinary log lines) is retained at log_path. stderr goes
    to log_path + '.stderr'. Request and individual output frames share the
    explicit byte bound. Model initialization and cleanup are separate requests.
    A worker error envelope is returned; malformed transport closes the process.
    Normal context exit requires graceful finish; close is forced fallback only.
    """

    def __init__(self, command, log_path, env=None, response_prefix="@q4-response ",
                 max_response_bytes=16 * 1024 * 1024, arm_timeout_seconds=900):
        if not isinstance(command, (list, tuple)) or not command or not all(
                isinstance(part, str) and part for part in command):
            raise ValueError("Explicit owned command required")
        if (not isinstance(max_response_bytes, int) or isinstance(max_response_bytes, bool)
                or max_response_bytes < 1):
            raise ValueError("Positive response byte bound required")
        self._validate_timeout(arm_timeout_seconds)
        if not isinstance(response_prefix, str) or not response_prefix or "\n" in response_prefix:
            raise ValueError("Explicit single-line response prefix required")
        self._prefix = response_prefix.encode("utf-8")
        self._limit = max_response_bytes
        self._arm_deadline = time.perf_counter() + arm_timeout_seconds
        self._serial = 0
        self._seen = set()
        self._buffer = bytearray()
        self._closed = False
        self._request_lock = threading.Lock()
        self._selector = selectors.DefaultSelector()
        self._child = None
        self._audit = self._stderr = None
        self._stdout_eof = False
        try:
            self._audit = open(Path(log_path), "xb")
            self._stderr = open(str(log_path) + ".stderr", "xb")
            self._child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                           stderr=self._stderr, env=env, start_new_session=True)
            os.set_blocking(self._child.stdin.fileno(), False)
            os.set_blocking(self._child.stdout.fileno(), False)
            self._selector.register(self._child.stdout, selectors.EVENT_READ)
        except BaseException:
            self.close()
            raise

    @staticmethod
    def _validate_timeout(value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError("Positive finite deadline required")

    def _read(self, expected_id):
        """Consume one ready read, validating every complete frame in that read."""
        chunk = os.read(self._child.stdout.fileno(), 65536)
        if not chunk:
            self._stdout_eof = True
            self._selector.unregister(self._child.stdout)
            if self._buffer:
                raise RuntimeError("Worker exited with an incomplete stdout frame")
            return None
        self._audit.write(chunk)
        self._buffer.extend(chunk)
        response = None
        while (end := self._buffer.find(b"\n")) >= 0:
            if end + 1 > self._limit:
                raise ValueError("Worker stdout frame exceeds response byte bound")
            line = bytes(self._buffer[:end])
            del self._buffer[:end + 1]
            if not line.startswith(self._prefix):
                continue
            record = json.loads(line[len(self._prefix):].decode("utf-8"), parse_constant=_reject_constant)
            if not isinstance(record, dict):
                raise ValueError("Worker response must be an object")
            identifier = record.get("id")
            if not isinstance(identifier, int) or isinstance(identifier, bool):
                raise ValueError("Worker response requires an integer request ID")
            if identifier in self._seen:
                raise ValueError("Duplicate worker response ID")
            if expected_id is None or identifier != expected_id:
                raise ValueError("Worker response ID differs from outstanding request")
            if ("value" in record) == ("error" in record):
                raise ValueError("Worker response requires exactly one value or error")
            self._seen.add(identifier)
            response = (record, time.perf_counter_ns(), end + 1)
        if len(self._buffer) > self._limit:
            raise ValueError("Worker stdout frame exceeds response byte bound")
        return response

    def _drain_ready(self, deadline):
        # Late/duplicate response frames cannot become the next request's reply.
        while True:
            if time.perf_counter() >= deadline:
                raise TimeoutError("Owned complete request deadline exceeded")
            ready = self._selector.select(0)
            if not ready:
                return
            for key, mask in ready:
                if key.fileobj is self._child.stdout:
                    self._read(None)

    def request(self, payload, timeout_seconds):
        if not self._request_lock.acquire(blocking=False):
            raise RuntimeError("Only one outstanding request is permitted")
        try:
            if self._closed:
                raise RuntimeError("Owned request client is closed")
            self._validate_timeout(timeout_seconds)
            started = time.perf_counter_ns()
            deadline = min(self._arm_deadline, started / 1e9 + timeout_seconds)
            self._drain_ready(deadline)
            if self._stdout_eof or self._child.poll() is not None:
                raise RuntimeError("Worker exited before request dispatch")
            if not isinstance(payload, dict) or "id" in payload:
                raise ValueError("Request payload must be an object without the reserved id field")
            self._serial += 1
            serialized = json.dumps({**payload, "id": self._serial}, allow_nan=False,
                                    ensure_ascii=False, separators=(",", ":"))
            wire = (serialized + "\n").encode("utf-8")
            if len(wire) > self._limit:
                raise ValueError("Request exceeds transport byte bound")
            owned_payload = json.loads(serialized, parse_constant=_reject_constant)
            remaining = memoryview(wire)
            self._selector.register(self._child.stdin, selectors.EVENT_WRITE)
            response = None
            while response is None:
                wait = deadline - time.perf_counter()
                if wait <= 0:
                    raise TimeoutError("Owned complete request deadline exceeded")
                ready = self._selector.select(wait)
                if not ready:
                    raise TimeoutError("Owned complete request deadline exceeded")
                for key, mask in ready:
                    if key.fileobj is self._child.stdin:
                        try:
                            written = os.write(self._child.stdin.fileno(), remaining)
                        except BlockingIOError:
                            continue
                        if written < 1:
                            raise RuntimeError("Worker stdin made no progress")
                        remaining = remaining[written:]
                        if not remaining:
                            self._selector.unregister(self._child.stdin)
                    else:
                        try:
                            received = self._read(self._serial)
                        except BlockingIOError:
                            continue
                        if received is not None:
                            if remaining:
                                raise ValueError("Worker replied before full request dispatch")
                            response = received
                        if self._stdout_eof and response is None:
                            raise RuntimeError("Worker exited before complete response")
            self._drain_ready(deadline)
            record, finished, response_bytes = response
            if finished / 1e9 > deadline:
                raise TimeoutError("Owned complete request deadline exceeded during response parsing")
            return {**record, "clientRequestWallMs": (finished - started) / 1e6,
                    "clientRequestPayload": owned_payload, "clientRequestBytes": len(wire),
                    "clientResponseBytes": response_bytes}
        except BaseException:
            self.close()
            raise
        finally:
            self._request_lock.release()

    def finish(self, timeout_seconds=5):
        """Require unforced zero exit and complete stdout EOF after protocol close.

        Closing owned stdin signals that there will be no further requests; it
        does not stop held workers/timers/native instances. Such lifetimes fail
        this qualification and are then terminated through close().
        """
        if not self._request_lock.acquire(blocking=False):
            raise RuntimeError("Cannot finish with an outstanding request")
        try:
            if self._closed:
                raise RuntimeError("Owned request client is closed")
            self._validate_timeout(timeout_seconds)
            deadline = min(self._arm_deadline, time.perf_counter() + timeout_seconds)
            self._child.stdin.close()
            while True:
                self._drain_ready(deadline)
                status = self._child.poll()
                if status is not None:
                    if status != 0:
                        raise RuntimeError("Worker did not exit gracefully: " + str(status))
                    if self._stdout_eof:
                        self._closed = True
                        self._release_resources()
                        return {"graceful": True, "forced": False, "exitCode": 0, "stdoutEof": True}
                wait = deadline - time.perf_counter()
                if wait <= 0:
                    raise TimeoutError("Owned graceful finish deadline exceeded")
                # EOF can precede process exit; poll that final transition too.
                for key, mask in self._selector.select(min(wait, .05)):
                    try:
                        self._read(None)
                    except BlockingIOError:
                        continue
        except BaseException:
            self.close()
            raise
        finally:
            self._request_lock.release()

    def _release_resources(self):
        self._selector.close()
        if self._child is not None:
            self._child.stdin.close()
            self._child.stdout.close()
        if self._audit is not None:
            self._audit.close()
        if self._stderr is not None:
            self._stderr.close()

    def _signal_owned_group(self, sig):
        group = self._child.pid
        try:
            os.killpg(group, sig)
        except ProcessLookupError:
            return
        except PermissionError:
            if sys.platform != "darwin" or self._child.poll() is None:
                raise
            # Darwin may return EPERM for a group containing only zombies.
            # An unreaped or inaccessible live member is still a cleanup failure.
            rows = subprocess.run(
                ["/bin/ps", "-A", "-o", "pgid=,stat="], capture_output=True,
                text=True, check=True, timeout=2,
            ).stdout.splitlines()
            for row in rows:
                pgid, state = row.split()
                if int(pgid) == group and not state.startswith("Z"):
                    raise

    def close(self):
        """Signal the owned process group and reap its direct child process."""
        if self._closed:
            return
        self._closed = True
        try:
            if self._child is not None:
                # Reap an already-exited leader before signalling its group;
                # descendants can still retain that owned group and stdout.
                self._child.poll()
                self._signal_owned_group(signal.SIGTERM)
                try:
                    self._child.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    pass
                # A group signalled above can retain descendants after its
                # leader exits. Finish that same owned group before returning.
                self._signal_owned_group(signal.SIGKILL)
                self._child.wait(timeout=2)
        finally:
            self._release_resources()

    def __enter__(self):
        return self

    def __exit__(self, kind, value, traceback):
        if kind is None:
            if not self._closed:
                self.finish()
        else:
            self.close()
