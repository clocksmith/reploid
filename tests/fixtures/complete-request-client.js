// Bounded JSONL transport for an owned local diagnostic process, without models.
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export class TimeoutError extends Error { constructor(message) { super(message); this.name = 'TimeoutError'; } }
export class ValueError extends Error { constructor(message) { super(message); this.name = 'ValueError'; } }
export class RuntimeError extends Error { constructor(message) { super(message); this.name = 'RuntimeError'; } }

const decoder = new TextDecoder('utf-8', { fatal: true });
const NON_FINITE = ['-Infinity', 'Infinity', 'NaN'];

function nonFiniteConstant(text) {
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '\\') index += 1;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    const constant = NON_FINITE.find(value => text.startsWith(value, index));
    if (constant) return constant;
  }
  return null;
}

/** JSON.parse that names NaN/Infinity constants and reports every failure as ValueError. */
export function parseStrictJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const constant = nonFiniteConstant(text);
    throw new ValueError(constant ? 'Non-finite JSON constant: ' + constant : 'Invalid JSON: ' + error.message);
  }
}

function assertSerializable(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValueError('Out of range float values are not JSON compliant: ' + value);
  } else if (Array.isArray(value)) {
    value.forEach(assertSerializable);
  } else if (value !== null && typeof value === 'object') {
    Object.values(value).forEach(assertSerializable);
  } else if (value !== null && !['string', 'boolean'].includes(typeof value)) {
    throw new TypeError('Object of type ' + typeof value + ' is not JSON serializable');
  }
}

const isPlainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validateTimeout(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ValueError('Positive finite deadline required');
  }
}

/**
 * One outstanding request; request IDs and transport clocks belong here.
 *
 * stdout (including ordinary log lines) is retained at logPath. stderr goes to
 * logPath + '.stderr'. Request and individual output frames share the explicit
 * byte bound. Model initialization and cleanup are separate requests. A worker
 * error envelope is returned; malformed transport closes the process. Normal
 * run() exit requires graceful finish; close is the forced fallback only.
 *
 * Every frame is validated as it arrives. A frame that arrives while no request
 * is outstanding (a late or duplicate reply) fails the next request or finish.
 */
export class CompleteRequestClient {
  constructor(command, logPath, { env, responsePrefix = '@q4-response ', maxResponseBytes = 16 * 1024 * 1024,
    armTimeoutSeconds = 900 } = {}) {
    if (!Array.isArray(command) || !command.length || !command.every(part => typeof part === 'string' && part)) {
      throw new ValueError('Explicit owned command required');
    }
    if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) throw new ValueError('Positive response byte bound required');
    validateTimeout(armTimeoutSeconds);
    if (typeof responsePrefix !== 'string' || !responsePrefix || responsePrefix.includes('\n')) {
      throw new ValueError('Explicit single-line response prefix required');
    }
    this._prefix = Buffer.from(responsePrefix, 'utf8');
    this._limit = maxResponseBytes;
    this._armDeadline = performance.now() + armTimeoutSeconds * 1000;
    this._serial = 0;
    this._seen = new Set();
    this._buffer = Buffer.alloc(0);
    this._closed = false;
    this._busy = false;
    this._child = null;
    this._audit = this._stderr = null;
    this._stdoutEof = false;
    this._expected = null;
    this._response = null;
    this._dispatched = true;
    this._fault = null;
    this._waiters = new Set();
    try {
      this._audit = fs.openSync(logPath, 'wx');
      this._stderr = fs.openSync(String(logPath) + '.stderr', 'wx');
      // detached: the worker leads a new session and process group owned by this client.
      this._child = spawn(command[0], command.slice(1), { stdio: ['pipe', 'pipe', this._stderr], env, detached: true });
      this._exited = new Promise(resolve => this._child.once('exit', () => { this._notify(); resolve(); }));
      this._child.on('error', error => this._setFault(new RuntimeError('Owned worker process error: ' + error.message)));
      this._child.stdin.on('error', error => {
        if (!this._dispatched) this._setFault(new RuntimeError('Worker stdin failed before full request dispatch: ' + error.message));
      });
      this._child.stdout.on('data', chunk => this._onData(chunk));
      this._child.stdout.on('end', () => this._onEnd());
      if (!this._child.pid) throw new RuntimeError('Owned command did not start: ' + command[0]);
    } catch (error) {
      this._closed = true;
      this._releaseResources();
      throw error;
    }
  }

  get returncode() {
    if (!this._child) return null;
    if (this._child.exitCode !== null) return this._child.exitCode;
    if (this._child.signalCode !== null) return -os.constants.signals[this._child.signalCode];
    return null;
  }

  _leaderExited() {
    return this._child.exitCode !== null || this._child.signalCode !== null;
  }

  _notify() {
    for (const wake of this._waiters) wake();
  }

  _changed(milliseconds) {
    return new Promise(resolve => {
      const wake = () => { clearTimeout(timer); this._waiters.delete(wake); resolve(); };
      const timer = setTimeout(wake, Math.max(0, milliseconds));
      this._waiters.add(wake);
    });
  }

  _setFault(error) {
    if (!this._fault) this._fault = error;
    this._notify();
  }

  _throwFault() {
    if (this._fault) throw this._fault;
  }

  _onData(chunk) {
    if (this._closed || this._fault) return;
    fs.writeSync(this._audit, chunk);
    this._buffer = Buffer.concat([this._buffer, chunk]);
    try {
      let end;
      while ((end = this._buffer.indexOf(10)) >= 0) {
        if (end + 1 > this._limit) throw new ValueError('Worker stdout frame exceeds response byte bound');
        const line = this._buffer.subarray(0, end);
        this._buffer = this._buffer.subarray(end + 1);
        if (!line.subarray(0, this._prefix.length).equals(this._prefix)) continue;
        let text;
        try { text = decoder.decode(line.subarray(this._prefix.length)); } catch (error) { throw new ValueError(error.message); }
        const record = parseStrictJson(text);
        if (!isPlainObject(record)) throw new ValueError('Worker response must be an object');
        const identifier = record.id;
        if (!Number.isInteger(identifier)) throw new ValueError('Worker response requires an integer request ID');
        if (this._seen.has(identifier)) throw new ValueError('Duplicate worker response ID');
        if (this._expected === null || identifier !== this._expected) throw new ValueError('Worker response ID differs from outstanding request');
        if (Object.hasOwn(record, 'value') === Object.hasOwn(record, 'error')) {
          throw new ValueError('Worker response requires exactly one value or error');
        }
        this._seen.add(identifier);
        if (!this._dispatched && this._child.stdin.writableLength) throw new ValueError('Worker replied before full request dispatch');
        this._response = [record, performance.now(), end + 1];
        // Any later frame is late or duplicate, never the next request's reply.
        this._expected = null;
      }
      if (this._buffer.length > this._limit) throw new ValueError('Worker stdout frame exceeds response byte bound');
    } catch (error) {
      this._setFault(error);
    }
    this._notify();
  }

  _onEnd() {
    this._stdoutEof = true;
    if (this._buffer.length && !this._closed) this._setFault(new RuntimeError('Worker exited with an incomplete stdout frame'));
    this._notify();
  }

  _checkIdle(deadline) {
    if (performance.now() >= deadline) throw new TimeoutError('Owned complete request deadline exceeded');
    this._throwFault();
  }

  async request(payload, timeoutSeconds) {
    if (this._busy) throw new RuntimeError('Only one outstanding request is permitted');
    this._busy = true;
    try {
      if (this._closed) throw new RuntimeError('Owned request client is closed');
      validateTimeout(timeoutSeconds);
      const started = performance.now();
      const deadline = Math.min(this._armDeadline, started + timeoutSeconds * 1000);
      this._checkIdle(deadline);
      if (this._stdoutEof || this._leaderExited()) throw new RuntimeError('Worker exited before request dispatch');
      if (!isPlainObject(payload) || Object.hasOwn(payload, 'id')) {
        throw new ValueError('Request payload must be an object without the reserved id field');
      }
      this._serial += 1;
      const message = { ...payload, id: this._serial };
      assertSerializable(message);
      const serialized = JSON.stringify(message);
      const wire = Buffer.from(serialized + '\n', 'utf8');
      if (wire.length > this._limit) throw new ValueError('Request exceeds transport byte bound');
      const ownedPayload = JSON.parse(serialized);
      this._expected = this._serial;
      this._response = null;
      this._dispatched = false;
      this._child.stdin.write(wire, () => { this._dispatched = true; this._notify(); });
      while (!this._response) {
        this._throwFault();
        if (this._stdoutEof) throw new RuntimeError('Worker exited before complete response');
        const wait = deadline - performance.now();
        if (wait <= 0) throw new TimeoutError('Owned complete request deadline exceeded');
        await this._changed(wait);
      }
      // Frames already queued behind the reply are checked before it is returned.
      await new Promise(resolve => setImmediate(resolve));
      this._throwFault();
      const [record, finished, responseBytes] = this._response;
      if (finished > deadline) throw new TimeoutError('Owned complete request deadline exceeded during response parsing');
      return { ...record, clientRequestWallMs: finished - started, clientRequestPayload: ownedPayload,
        clientRequestBytes: wire.length, clientResponseBytes: responseBytes };
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      this._expected = null;
      this._busy = false;
    }
  }

  /**
   * Require unforced zero exit and complete stdout EOF after protocol close.
   *
   * Closing owned stdin signals that there will be no further requests; it does
   * not stop held workers/timers/native instances. Such lifetimes fail this
   * qualification and are then terminated through close().
   */
  async finish(timeoutSeconds = 5) {
    if (this._busy) throw new RuntimeError('Cannot finish with an outstanding request');
    this._busy = true;
    try {
      if (this._closed) throw new RuntimeError('Owned request client is closed');
      validateTimeout(timeoutSeconds);
      const deadline = Math.min(this._armDeadline, performance.now() + timeoutSeconds * 1000);
      this._dispatched = true;
      this._child.stdin.end();
      for (;;) {
        this._checkIdle(deadline);
        if (this._leaderExited()) {
          const status = this.returncode;
          if (status !== 0) throw new RuntimeError('Worker did not exit gracefully: ' + status);
          if (this._stdoutEof) {
            this._closed = true;
            this._releaseResources();
            return { graceful: true, forced: false, exitCode: 0, stdoutEof: true };
          }
        }
        const wait = deadline - performance.now();
        if (wait <= 0) throw new TimeoutError('Owned graceful finish deadline exceeded');
        await this._changed(wait);
      }
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      this._busy = false;
    }
  }

  _releaseResources() {
    if (this._child) {
      this._child.stdin?.destroy();
      this._child.stdout?.destroy();
    }
    if (this._audit !== null) { fs.closeSync(this._audit); this._audit = null; }
    if (this._stderr !== null) { fs.closeSync(this._stderr); this._stderr = null; }
    this._notify();
  }

  _killGroup(group, signal) {
    process.kill(-group, signal);
  }

  _platform() {
    return process.platform;
  }

  _groupRows() {
    return execFileSync('/bin/ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8', timeout: 2000 }).split('\n');
  }

  _signalOwnedGroup(signal) {
    const group = this._child.pid;
    try {
      this._killGroup(group, signal);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      if (error.code !== 'EPERM' || this._platform() !== 'darwin' || !this._leaderExited()) throw error;
      // Darwin may return EPERM for a group containing only zombies.
      // An unreaped or inaccessible live member is still a cleanup failure.
      for (const row of this._groupRows()) {
        if (!row.trim()) continue;
        const [pgid, state] = row.trim().split(/\s+/);
        if (Number(pgid) === group && !state.startsWith('Z')) throw error;
      }
    }
  }

  async _waitExit(milliseconds) {
    if (this._leaderExited()) return true;
    let timer;
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(false), milliseconds); });
    try {
      return await Promise.race([this._exited.then(() => true), timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Signal the owned process group and wait for its direct child process. */
  close() {
    if (this._closing) return this._closing;
    if (this._closed) return Promise.resolve();
    this._closed = true;
    const signal = async name => {
      try {
        this._signalOwnedGroup(name);
      } catch (error) {
        if (error.code !== 'EPERM' || this._leaderExited()) throw error;
        // Node reaps an exited leader asynchronously; a zombie-only group can return EPERM on
        // Darwin before the exit event arrives. Let it be reaped, then classify the group again.
        await this._waitExit(100);
        this._signalOwnedGroup(name);
      }
    };
    this._closing = (async () => {
      try {
        if (this._child?.pid) {
          // An already-exited leader's descendants can still retain the owned group and stdout.
          await signal('SIGTERM');
          await this._waitExit(2000);
          // A group signalled above can retain descendants after its leader exits.
          // Finish that same owned group before returning.
          await signal('SIGKILL');
          if (!await this._waitExit(2000)) throw new TimeoutError('Owned worker did not exit after SIGKILL');
        }
      } finally {
        this._releaseResources();
      }
    })();
    return this._closing;
  }

  /** Context helper: graceful finish after fn, forced close if fn throws. */
  async run(fn) {
    let result;
    try {
      result = await fn(this);
    } catch (error) {
      await this.close();
      throw error;
    }
    if (!this._closed) await this.finish();
    return result;
  }
}
