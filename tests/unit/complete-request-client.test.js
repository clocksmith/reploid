// @vitest-environment node
// Actual bounded subprocess transport checks; no SDK, model or GPU imports.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CompleteRequestClient, RuntimeError, TimeoutError, ValueError } from '../fixtures/complete-request-client.js';

// Worker helpers: unbuffered fd writes (so frames can be split), lazy stdin lines, sleeps.
const PRELUDE = `import fs from 'node:fs'; import readline from 'node:readline'; import { spawn } from 'node:child_process';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let lines = null;
const readLine = async () => {
  lines ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  const next = await lines.next();
  return next.done ? null : next.value;
};
const out = text => fs.writeSync(1, text);
const err = text => fs.writeSync(2, text);
const reply = record => out('@q4-response ' + JSON.stringify(record) + '\\n');
const endInput = () => process.stdin.destroy();
`;

let directory, sequence, clients;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'complete-request-client-'));
  sequence = 0;
  clients = [];
});
afterEach(async () => {
  await Promise.all(clients.map(client => client.close()));
  fs.rmSync(directory, { recursive: true, force: true });
});

function client(source, options = {}) {
  sequence += 1;
  const log = path.join(directory, sequence + '.log');
  const value = new CompleteRequestClient([process.execPath, '--input-type=module', '-e', PRELUDE + source], log, options);
  clients.push(value);
  return [value, log];
}

const exited = value => value.returncode !== null;

describe('CompleteRequestClient', () => {
  it('splits responses, serializes requests, preserves logs and owns the request echo', async () => {
    const [value, log] = client(`
let line;
while ((line = await readLine()) !== null) {
  const request = JSON.parse(line);
  out('ordinary audit line\\n');
  err('separate stderr line\\n');
  const wire = Buffer.from('@q4-response ' + JSON.stringify({ id: request.id, value: request.nested }) + '\\n');
  await sleep(40);
  fs.writeSync(1, wire.subarray(0, 9));
  await sleep(20);
  fs.writeSync(1, wire.subarray(9));
}`);
    const payload = { nested: { ids: [1, 2], text: 'token λ' } };
    const first = await value.request(payload, 2);
    payload.nested.ids.push(3);
    expect(first.value).toEqual({ ids: [1, 2], text: 'token λ' });
    expect(first.clientRequestPayload.nested.ids).toEqual([1, 2]);
    expect(first.id).toBe(1);
    expect(first.clientRequestWallMs).toBeGreaterThanOrEqual(50);
    const requestWire = JSON.stringify(first.clientRequestPayload) + '\n';
    const responseWire = '@q4-response ' + JSON.stringify({ id: 1, value: first.value }) + '\n';
    expect(first.clientRequestBytes).toBe(Buffer.byteLength(requestWire));
    expect(first.clientResponseBytes).toBe(Buffer.byteLength(responseWire));
    const second = await value.request(payload, 2);
    expect(second.id).toBe(2);
    expect(second.value.ids).toEqual([1, 2, 3]);
    await value.close();
    const audit = fs.readFileSync(log, 'utf8');
    expect(audit).toContain('ordinary audit line');
    expect(audit).toContain('@q4-response ');
    expect(audit).not.toContain('separate stderr');
    expect(fs.readFileSync(log + '.stderr', 'utf8')).toContain('separate stderr');
  });

  it('fails closed on wrong and duplicate IDs', async () => {
    for (const [code, message] of [['{ id: r.id + 1, value: 0 }', /differs/], ['{ id: true, value: 0 }', /integer/]]) {
      const [value] = client(`const r = JSON.parse(await readLine()); reply(${code}); await sleep(10000);`);
      const failure = await value.request({ op: 'request' }, 2).catch(error => error);
      expect(failure).toBeInstanceOf(ValueError);
      expect(failure.message).toMatch(message);
      expect(exited(value)).toBe(true);
    }
    const [value] = client(`
const r = JSON.parse(await readLine());
const wire = '@q4-response ' + JSON.stringify({ id: r.id, value: 0 }) + '\\n';
out(wire + wire);
await sleep(10000);`);
    await expect(value.request({}, 2)).rejects.toThrow(/Duplicate/);
    expect(exited(value)).toBe(true);
  });

  it('cannot accept a late duplicate as the next response', async () => {
    const [value] = client(`
const r = JSON.parse(await readLine());
const wire = '@q4-response ' + JSON.stringify({ id: r.id, value: 0 }) + '\\n';
out(wire); await sleep(30); out(wire);
await sleep(10000);`);
    expect((await value.request({}, 2)).value).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 60));
    await expect(value.request({}, 2)).rejects.toThrow(/Duplicate/);
  });

  it('fails closed on oversized and non-finite responses', async () => {
    for (const [source, message] of [
      ["await readLine(); out('@q4-response ' + 'x'.repeat(1024)); await sleep(10000);", /byte bound/],
      ["const r = JSON.parse(await readLine()); out('@q4-response {\"id\":' + r.id + ',\"value\":NaN}\\n'); await sleep(10000);", /Non-finite/]
    ]) {
      const [value] = client(source, { maxResponseBytes: 256 });
      const failure = await value.request({}, 2).catch(error => error);
      expect(failure).toBeInstanceOf(ValueError);
      expect(failure.message).toMatch(message);
      expect(exited(value)).toBe(true);
    }
  });

  it('obeys the deadline on a partial response stall and reaps the worker', async () => {
    const [value] = client("await readLine(); out('@q4-response {'); await sleep(10000);");
    const started = performance.now();
    await expect(value.request({}, 0.15)).rejects.toThrow(TimeoutError);
    expect(performance.now() - started).toBeLessThan(3000);
    expect(exited(value)).toBe(true);
  });

  it('does not block on stdin writes to a non-reading worker', async () => {
    const [value] = client('await sleep(10000);', { maxResponseBytes: 4 * 1024 * 1024 });
    await expect(value.request({ text: 'x'.repeat(2 * 1024 * 1024) }, 0.15)).rejects.toThrow(TimeoutError);
    expect(exited(value)).toBe(true);
  });

  it('fails and reaps when the worker exits before responding', async () => {
    const [value] = client('await readLine(); process.exit(7);');
    const failure = await value.request({}, 2).catch(error => error);
    expect(failure).toBeInstanceOf(RuntimeError);
    expect(failure.message).toMatch(/exited/);
    expect(value.returncode).toBe(7);
  });

  it('includes initialization in the arm deadline', async () => {
    const [value] = client('await sleep(10000);', { armTimeoutSeconds: 0.1 });
    await expect(value.request({}, 2)).rejects.toThrow(TimeoutError);
  });

  it('returns an error envelope and exits the context naturally on EOF', async () => {
    const [value] = client(`
let line;
while ((line = await readLine()) !== null) {
  const r = JSON.parse(line);
  reply({ id: r.id, error: { message: 'expected' } });
}`);
    await value.run(async () => {
      const result = await value.request({}, 2);
      expect(result.error.message).toBe('expected');
      expect(result.clientRequestWallMs).toBeGreaterThanOrEqual(0);
      expect(exited(value)).toBe(false);
    });
    expect(value.returncode).toBe(0);
    await expect(value.request({}, 1)).rejects.toThrow(/closed/);
  });

  it('qualifies an explicit close acknowledgement and natural exit', async () => {
    const [value, log] = client(`
const r = JSON.parse(await readLine());
reply({ id: r.id, value: { closed: true } });
out('ordinary shutdown audit\\n');
endInput();`);
    expect((await value.request({ op: 'close' }, 2)).value.closed).toBe(true);
    expect(await value.finish(1)).toEqual({ graceful: true, forced: false, exitCode: 0, stdoutEof: true });
    expect(value.returncode).toBe(0);
    expect(fs.readFileSync(log, 'utf8')).toContain('ordinary shutdown audit');
    await value.close(); // No signals follow an already-qualified finish.
  });

  it('fails a close acknowledgement with a held event loop, then reaps', async () => {
    const [value] = client(`
const r = JSON.parse(await readLine());
reply({ id: r.id, value: { closed: true } });
while (await readLine() !== null);
await sleep(30000);`);
    expect((await value.request({ op: 'close' }, 2)).value.closed).toBe(true);
    await expect(value.finish(0.15)).rejects.toThrow(TimeoutError);
    expect(exited(value)).toBe(true);
    await expect(value.finish(1)).rejects.toThrow(/closed/);
  });

  it('rejects a late duplicate and a nonzero exit during finish', async () => {
    for (const [tail, type, message] of [
      ['await sleep(30); out(wire + "\\n");', ValueError, /Duplicate/],
      ['await sleep(30); process.exit(7);', RuntimeError, /gracefully/]
    ]) {
      const [value] = client(`
const r = JSON.parse(await readLine());
const wire = '@q4-response ' + JSON.stringify({ id: r.id, value: 0 });
out(wire + '\\n');
endInput();
${tail}`);
      expect((await value.request({ op: 'close' }, 2)).value).toBe(0);
      const failure = await value.finish(1).catch(error => error);
      expect(failure).toBeInstanceOf(type);
      expect(failure.message).toMatch(message);
      expect(exited(value)).toBe(true);
    }
  });

  it('requires stdout EOF even after a zero leader exit', async () => {
    const [value] = client(`
const r = JSON.parse(await readLine());
spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' }).unref();
reply({ id: r.id, value: 0 });
endInput();`);
    expect((await value.request({ op: 'close' }, 2)).value).toBe(0);
    await expect(value.finish(0.15)).rejects.toThrow(TimeoutError);
    expect(value.returncode).toBe(0);
  });

  it('uses the bounded fallback on exceptional context exit', async () => {
    const [value] = client('await sleep(30000);');
    await expect(value.run(() => { throw new RuntimeError('caller failure'); })).rejects.toThrow(/caller failure/);
    expect(exited(value)).toBe(true);
  });

  it('closes the owned worker on an invalid payload', async () => {
    for (const payload of [{ id: 4 }, { value: Infinity }]) {
      const [value] = client('await sleep(10000);');
      await expect(value.request(payload, 1)).rejects.toThrow(ValueError);
      expect(exited(value)).toBe(true);
    }
  });

  it('distinguishes zombies from live members during Darwin group cleanup', () => {
    const value = Object.create(CompleteRequestClient.prototype);
    const denied = Object.assign(new Error('EPERM'), { code: 'EPERM' });
    let rows = [], snapshots = 0;
    value._child = { pid: 123, exitCode: 7, signalCode: null };
    value._platform = () => 'darwin';
    value._killGroup = () => { throw denied; };
    value._groupRows = () => { snapshots += 1; return rows; };
    rows = ['200 S', '123 Z+', ''];
    value._signalOwnedGroup('SIGKILL');
    rows = ['123 Z', '123 S'];
    expect(() => value._signalOwnedGroup('SIGKILL')).toThrow(denied);
    snapshots = 0;
    value._child.exitCode = null;
    expect(() => value._signalOwnedGroup('SIGKILL')).toThrow(denied);
    expect(snapshots).toBe(0);
  });

  it('terminates an owned descendant on timeout', async () => {
    const marker = path.join(directory, 'descendant-exit');
    const [value, log] = client(`
const sub = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'inherit' });
const subExit = new Promise(resolve => sub.once('exit', (code, signal) => resolve(code ?? -{ SIGTERM: 15, SIGKILL: 9 }[signal])));
process.on('SIGTERM', async () => {
  const code = await Promise.race([subExit, sleep(1000).then(() => 'timeout')]);
  fs.writeFileSync(${JSON.stringify(marker)}, String(code));
  process.exit(0);
});
out('owned-descendant:' + sub.pid + '\\n');
const r = JSON.parse(await readLine());
reply({ id: r.id, value: 'ready' });
await readLine(); await sleep(30000);`);
    expect((await value.request({ op: 'ready' }, 4)).value).toBe('ready');
    await expect(value.request({}, 0.2)).rejects.toThrow(TimeoutError);
    expect(fs.readFileSync(log, 'utf8')).toContain('owned-descendant:');
    expect(Number(fs.readFileSync(marker, 'utf8'))).toBe(-15);
    expect(exited(value)).toBe(true);
  });

  it('does not leave a descendant holding stdout after the leader exits', async () => {
    // Node has no flock(2): the descendant records its PID, and liveness is checked by signal 0.
    const ready = path.join(directory, 'descendant.ready');
    const descendant = `require('fs').writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setTimeout(() => {}, 30000);`;
    const [value] = client(`
const r = JSON.parse(await readLine());
spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'inherit' }).unref();
while (!fs.existsSync(${JSON.stringify(ready)})) await sleep(1);
while (!fs.readFileSync(${JSON.stringify(ready)}, 'utf8')) await sleep(1);
reply({ id: r.id, value: 'ready' });
await readLine(); process.exit(7);`);
    expect((await value.request({ op: 'ready' }, 4)).value).toBe('ready');
    // The descendant keeps stdout open after its process leader exits.
    await expect(value.request({}, 0.25)).rejects.toThrow(TimeoutError);
    expect(value.returncode).toBe(7);
    const pid = Number(fs.readFileSync(ready, 'utf8'));
    expect(pid).toBeGreaterThan(0);
    const deadline = performance.now() + 1000;
    for (;;) {
      try { process.kill(pid, 0); } catch (error) { expect(error.code).toBe('ESRCH'); break; }
      if (performance.now() >= deadline) throw new Error('Owned descendant survived client close');
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  });
});
