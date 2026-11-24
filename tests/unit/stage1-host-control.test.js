// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { assertCompleteCopy, findWeightDirectories, lockDirectory, killExactProcess, parseMemoryPressure, scanHostWeights, serviceAction } from '../../scripts/stage1/host-control.js';
import { createSessionOperations, harnessDigest, readHostIdentity, runHostAgent, runSoloLoad } from '../../scripts/stage1/host-agent.js';
import { createCancelGate, createTokenTrace } from '../../scripts/stage1/stage-participant.js';
import { runGatedCancel, verifySplitTokens } from '../../scripts/stage1/split-evidence.js';
import { fakeTokenTexts } from '../../scripts/stage1/fake-runtime.js';
import { witnessDigest } from '../../scripts/stage1/expectations.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';

const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
let root;
beforeEach(async () => { root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'stage1-host-')); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

/** A small model of two stages over two real shard files. */
async function smallModel() {
  const pieces = [Buffer.alloc(32, 1), Buffer.alloc(32, 2), Buffer.alloc(32, 3), Buffer.alloc(32, 4)];
  const range = (file, offset, bytes) => ({ path: file, offset, size: bytes.length, identity: sha(bytes) });
  const stageRanges = [[range('s0.bin', 0, pieces[0]), range('s0.bin', 32, pieces[1])], [range('s1.bin', 0, pieces[2]), range('s1.bin', 32, pieces[3])]];
  const files = { 's0.bin': Buffer.concat(pieces.slice(0, 2)), 's1.bin': Buffer.concat(pieces.slice(2)) };
  const manifest = Buffer.from(JSON.stringify({ shards: Object.entries(files).map(([filename, bytes]) => ({ filename, size: bytes.length })) }));
  const write = async (directory, names = Object.keys(files)) => {
    await fs.mkdir(directory, { recursive: true });
    for (const name of names) await fs.writeFile(path.join(directory, name), files[name]);
    return directory;
  };
  const writeCopy = async directory => { await write(directory); await fs.writeFile(path.join(directory, 'manifest.json'), manifest); return directory; };
  return { stageRanges, allRanges: stageRanges.flat(), write, writeCopy, identity: sha(manifest) };
}

describe('the on-host weight search', () => {
  it('sees the other stage: a stage directory holding its own ranges only passes, one holding everything does not', async () => {
    const model = await smallModel(), stage = await model.write(path.join(root, 'stage'), ['s0.bin']);
    const clean = await scanHostWeights({ roots: [stage], allRanges: model.allRanges, stageRanges: model.stageRanges[0], scope: 'stage-directory' });
    expect(clean).toMatchObject({ outsideElsewhere: 0, outsideInFullCopy: 0, inventory: { source: 'hashed-on-host', rangeCount: 2, outsideStageRanges: 0, scannedRanges: 4 } });
    await model.write(stage);
    const full = await scanHostWeights({ roots: [stage], allRanges: model.allRanges, stageRanges: model.stageRanges[0], scope: 'stage-directory' });
    expect(full).toMatchObject({ outsideElsewhere: 2, inventory: { rangeCount: 4, outsideStageRanges: 2, outsideStageBytes: 64 } });
  });

  it('finds a full copy left anywhere under the model, cache or temporary roots', async () => {
    const model = await smallModel(), stage = await model.write(path.join(root, 'stage'), ['s0.bin']);
    for (const place of ['models/old', 'cache/a/b', 'tmp/run-1/full']) {
      const copy = await model.write(path.join(root, place));
      const scan = await scanHostWeights({ roots: [stage, path.join(root, 'models'), path.join(root, 'cache'), path.join(root, 'tmp')],
        allRanges: model.allRanges, stageRanges: model.stageRanges[0], scope: 'host-weight-directories' });
      expect(scan.outsideElsewhere).toBe(2);
      await fs.rm(copy, { recursive: true });
    }
  });

  it('attributes the configured full copy separately from weights elsewhere', async () => {
    const model = await smallModel(), stage = await model.write(path.join(root, 'stage'), ['s0.bin']), copy = await model.write(path.join(root, 'tmp/full'));
    const scan = await scanHostWeights({ roots: [stage, path.join(root, 'tmp')], fullCopyDirectory: copy, allRanges: model.allRanges,
      stageRanges: model.stageRanges[0], scope: 'host-weight-directories' });
    expect(scan).toMatchObject({ outsideInFullCopy: 2, outsideElsewhere: 0 });
  });

  it('follows a linked directory once and does not loop', async () => {
    const model = await smallModel(), real = await model.write(path.join(root, 'real'));
    await fs.mkdir(path.join(root, 'tmp'));
    await fs.symlink(real, path.join(root, 'tmp', 'link'));
    await fs.symlink(path.join(root, 'tmp'), path.join(root, 'tmp', 'loop'));
    expect(await findWeightDirectories([path.join(root, 'tmp')], new Set(['s0.bin']))).toEqual([real]);
  });

  it('skips an absent root', async () => {
    expect(await findWeightDirectories([path.join(root, 'absent')], new Set(['s0.bin']))).toEqual([]);
  });
});

describe('the full copy', () => {
  it('is complete only with its manifest and every shard at size', async () => {
    const model = await smallModel(), copy = await model.writeCopy(path.join(root, 'full'));
    await expect(assertCompleteCopy({ directory: copy, expectedIdentity: model.identity })).resolves.toBeUndefined();
    await expect(assertCompleteCopy({ directory: copy, expectedIdentity: sha('other') })).rejects.toMatchObject({ code: 'WRONG_WEIGHTS' });
    await fs.truncate(path.join(copy, 's1.bin'), 8);
    await expect(assertCompleteCopy({ directory: copy, expectedIdentity: model.identity })).rejects.toMatchObject({ code: 'MISSING_WEIGHTS' });
    await expect(assertCompleteCopy({ directory: path.join(root, 'absent'), expectedIdentity: model.identity })).rejects.toMatchObject({ code: 'MISSING_WEIGHTS' });
  });

  it('is locked for the split with mode 000 and restored afterwards, and the locked copy is skipped by the search', async () => {
    const model = await smallModel(), copy = await model.writeCopy(path.join(root, 'full'));
    const { mode } = await lockDirectory({ directory: copy, action: 'mode' });
    expect(await lockDirectory({ directory: copy, action: 'lock' })).toEqual({ locked: true, previousMode: mode });
    await expect(fs.readdir(copy)).rejects.toMatchObject({ code: 'EACCES' });
    const scan = await scanHostWeights({ roots: [root], fullCopyDirectory: copy, skipDirectories: [copy], allRanges: model.allRanges,
      stageRanges: model.stageRanges[0], scope: 'host-weight-directories' });
    expect(scan).toMatchObject({ outsideInFullCopy: 0, skippedDirectories: 1 });
    await expect(lockDirectory({ directory: copy, action: 'unlock', mode: 0 })).rejects.toMatchObject({ code: 'lock-refused' });
    expect(await lockDirectory({ directory: copy, action: 'unlock', mode })).toEqual({ restored: true, mode });
    expect((await fs.readdir(copy)).length).toBe(3);
  });

  it('refuses to lock a linked directory or a non-canonical path', async () => {
    const model = await smallModel(), copy = await model.writeCopy(path.join(root, 'full')), link = path.join(root, 'link');
    await fs.symlink(copy, link);
    await expect(lockDirectory({ directory: link, action: 'lock' })).rejects.toMatchObject({ code: 'lock-refused' });
    await expect(lockDirectory({ directory: copy + '/../full', action: 'lock' })).rejects.toMatchObject({ code: 'lock-refused' });
    expect((await fs.readdir(copy)).length).toBe(3);
  });
});

describe('remote kill', () => {
  it('signals only the exact PID and start time', async () => {
    const kill = vi.fn();
    expect(await killExactProcess({ pid: 500, startId: 'A', readStart: async () => 'A', kill, selfPid: 1000 })).toEqual({ killed: true });
    expect(kill).toHaveBeenCalledExactlyOnceWith(500, 'SIGKILL');
  });
  it('does not signal a reused PID or a gone process', async () => {
    const kill = vi.fn();
    expect(await killExactProcess({ pid: 500, startId: 'A', readStart: async () => 'B', kill, selfPid: 1000 })).toEqual({ killed: false, reason: 'pid-reused' });
    expect(await killExactProcess({ pid: 500, startId: 'A', readStart: async () => null, kill, selfPid: 1000 })).toEqual({ killed: false, reason: 'gone' });
    expect(kill).not.toHaveBeenCalled();
  });
  it.each([[0], [1], [-5], [1000], ['500'], [1.5]])('refuses PID %s', async pid => {
    await expect(killExactProcess({ pid, startId: 'A', readStart: async () => 'A', kill: vi.fn(), selfPid: 1000 })).rejects.toMatchObject({ code: 'kill-refused' });
  });
  it('refuses a kill with no start identity', async () => {
    await expect(killExactProcess({ pid: 500, startId: '', readStart: async () => '', kill: vi.fn(), selfPid: 1000 })).rejects.toMatchObject({ code: 'kill-refused' });
  });
});

describe('the standing service', () => {
  it('acts only on the one named unit', async () => {
    const exec = vi.fn(async () => ({ stdout: 'active\n' }));
    expect(await serviceAction({ manager: 'systemd-user', unit: 'worker.service', action: 'is-active' }, exec)).toEqual({ state: 'active' });
    expect(exec).toHaveBeenCalledWith('systemctl', ['--user', 'is-active', '--', 'worker.service']);
    await serviceAction({ manager: 'systemd-system', unit: 'worker.service', action: 'stop' }, exec);
    expect(exec).toHaveBeenLastCalledWith('systemctl', ['stop', '--', 'worker.service']);
  });
  it('reads an inactive state from the exit of is-active', async () => {
    const exec = async () => { throw Object.assign(Error('exit 3'), { stdout: 'inactive\n' }); };
    expect(await serviceAction({ manager: 'systemd-user', unit: 'worker.service', action: 'is-active' }, exec)).toEqual({ state: 'inactive' });
  });
  it.each([
    [{ manager: 'systemd-user', unit: '*.service', action: 'stop' }],
    [{ manager: 'systemd-user', unit: 'a.service b.service', action: 'stop' }],
    [{ manager: 'systemd-user', unit: 'worker.timer', action: 'stop' }],
    [{ manager: 'systemd-user', unit: 'worker.service', action: 'disable' }],
    [{ manager: 'launchd', unit: 'worker.service', action: 'stop' }]
  ])('refuses %j', async request => {
    const exec = vi.fn();
    await expect(serviceAction(request, exec)).rejects.toMatchObject({ code: 'service-refused' });
    expect(exec).not.toHaveBeenCalled();
  });
  it('reports a failed start', async () => {
    await expect(serviceAction({ manager: 'systemd-user', unit: 'worker.service', action: 'start' }, async () => { throw Error('no'); }))
      .rejects.toMatchObject({ code: 'service-command-failed' });
  });
});

it('parses memory pressure and refuses an unreadable value', () => {
  expect(parseMemoryPressure('some avg10=2.50 avg60=1.00 avg300=0.10 total=9\nfull avg10=0.00')).toEqual({ avg10: 2.5 });
  expect(() => parseMemoryPressure('nothing')).toThrow('memory-pressure-unreadable');
});

describe('the host agent', () => {
  const body = { directory: '/unused', messages: [], maxOutputTokens: 4, settings: { modelId: 'm' }, requiredBytes: 16941875200, pressure: null, timeoutMs: 5000 };
  const ports = extra => ({ assertCopy: async () => {}, readPressure: async () => 'some avg10=0.10', ...extra });
  const hang = ({ signal }) => new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

  it('reports a completed solo load', async () => {
    expect(await runSoloLoad({ body, ports: ports({ loadSolo: async () => {} }), controls: {} })).toEqual({ outcome: 'completed', settings: body.settings });
  });
  it('maps a mid-load device refusal and claims memory', async () => {
    const loadSolo = async () => { throw Object.assign(Error('oom'), { code: 'GPU_OUT_OF_MEMORY', stage1During: 'whole-model-load', liveBytesAtFailure: 12884901888 }); };
    expect(await runSoloLoad({ body, ports: ports({ loadSolo }), controls: {} })).toMatchObject({ outcome: 'failed', claimedFailure: 'memory',
      failure: { evidence: 'device-out-of-memory', operatorCapped: false, requiredBytes: 16941875200, allocatedBeforeFailureBytes: 12884901888 } });
  });
  it('does not open the GPU for a copy that is missing', async () => {
    const loadSolo = vi.fn();
    const result = await runSoloLoad({ body, ports: ports({ loadSolo, assertCopy: async () => { throw Object.assign(Error('none'), { code: 'MISSING_WEIGHTS' }); } }), controls: {} });
    expect(result).toMatchObject({ outcome: 'failed', claimedFailure: null, failure: { kind: 'missing-weights' } });
    expect(loadSolo).not.toHaveBeenCalled();
  });
  it('stops on memory pressure and stays inconclusive', async () => {
    const result = await runSoloLoad({ body: { ...body, pressure: { maxAvg10: 5, pollMs: 2 } },
      ports: ports({ loadSolo: hang, readPressure: async () => 'some avg10=50.00' }), controls: {} });
    expect(result).toMatchObject({ claimedFailure: null, failure: { kind: 'memory-pressure', guardTripped: true } });
  });
  it('treats an unreadable pressure as a stop', async () => {
    const result = await runSoloLoad({ body: { ...body, pressure: { maxAvg10: 5, pollMs: 2 } },
      ports: ports({ loadSolo: hang, readPressure: async () => { throw Error('no file'); } }), controls: {} });
    expect(result.failure).toMatchObject({ kind: 'memory-pressure', guardTripped: true });
  });
  it('stops at its timeout and on an abort, both inconclusive', async () => {
    const timed = await runSoloLoad({ body: { ...body, timeoutMs: 5 }, ports: ports({ loadSolo: hang }), controls: {} });
    expect(timed.failure).toMatchObject({ timedOut: true });
    const controls = {};
    const aborted = runSoloLoad({ body, ports: ports({ loadSolo: args => { controls.abort(); return hang(args); } }), controls });
    expect((await aborted).failure).toMatchObject({ guardTripped: true });
  });

  it('loads only a private, self-consistent identity', async () => {
    const identity = await createSigningIdentity({ algorithm: 'Ed25519' }), file = path.join(root, 'identity.json');
    await fs.writeFile(file, JSON.stringify(identity), { mode: 0o600 });
    expect((await readHostIdentity(file)).peerId).toBe(identity.peerId);
    await fs.chmod(file, 0o644);
    await expect(readHostIdentity(file)).rejects.toMatchObject({ code: 'identity-unavailable' });
    await fs.writeFile(file, JSON.stringify({ ...identity, peerId: 'peer:' + '0'.repeat(24) }), { mode: 0o600 });
    await fs.chmod(file, 0o600);
    await expect(readHostIdentity(file)).rejects.toMatchObject({ code: 'identity-unavailable' });
  });

  it('serves a whole-model answer on the earning device as a provider-signed measured receipt, never the split model', async () => {
    const identity = await createSigningIdentity({ algorithm: 'Ed25519' }), file = path.join(root, 'identity.json');
    await fs.writeFile(file, JSON.stringify(identity), { mode: 0o600 });
    const served = [];
    const operations = createSessionOperations({ openWhole: async ({ model }) => ({ runtime: 'test-whole',
      async generate({ messages, settings }) {
        served.push({ messages, settings });
        return { content: 'answer', modelIdentity: model.identity, adapterIdentities: [],
          completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 3, generatedTokenCount: settings.maxOutputTokens, stopReason: 'length' } };
      }, async close() {} }) });
    await operations.identity({ file });
    await expect(operations['open-whole']({ modelId: 'qwen-3-8-27b-text-q4k-ef16-af32', modelDirectory: root })).rejects.toThrow('whole-model catalog entry');
    expect(await operations['open-whole']({ modelId: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16', modelDirectory: root })).toMatchObject({ runtime: 'test-whole' });
    const messages = [{ role: 'user', content: 'hello' }];
    const { receipt } = await operations['serve-whole']({ requestId: 'r1', consumer: 'peer:' + 'b'.repeat(24), messages, settings: { maxOutputTokens: 5 } });
    expect(receipt).toMatchObject({ version: 3, provider: identity.peerId, jobHash: 'request:r1', outputTokens: 5, model: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16' });
    expect((await verifyReceipt(receipt)).providerValid).toBe(true);
    expect(served).toHaveLength(1);
    await operations.close();
  });

  it('refuses a fixture changed in transit before opening anything', async () => {
    const identity = await createSigningIdentity({ algorithm: 'Ed25519' }), file = path.join(root, 'identity.json');
    await fs.writeFile(file, JSON.stringify(identity), { mode: 0o600 });
    const openParticipant = vi.fn(), operations = createSessionOperations({ openParticipant });
    await operations.identity({ file });
    await expect(operations.open({ stageIndex: 0, stateDirectory: root, fixtureBase64: Buffer.from('a').toString('base64'), fixtureSha256: '0'.repeat(64), witness: { threadId: 't' } }))
      .rejects.toThrow('changed in transit');
    expect(openParticipant).not.toHaveBeenCalled();
  });

  it('on end of input, aborts a running solo and exits only after it has released the GPU', async () => {
    const events = [];
    const loadSolo = async ({ signal }) => {
      await hang({ signal }).catch(() => {});
      events.push('aborted');
      await new Promise(resolve => setTimeout(resolve, 20)); // Model and device close take time.
      events.push('gpu-closed');
      throw Object.assign(Error('Whole-model contribution stopped'), { stage1During: 'whole-model-load' });
    };
    const input = new PassThrough(), output = new PassThrough();
    const exited = new Promise(resolve => {
      runHostAgent({ mode: '--session', input, output, startId: 's', ports: ports({ loadSolo }), exit: code => { events.push(`exit:${code}`); resolve(); } });
    });
    input.write(JSON.stringify({ id: 1, op: 'solo', body }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 5));
    input.end();
    await exited;
    expect(events).toEqual(['aborted', 'gpu-closed', 'exit:0']);
  });

  it('exits after the bounded wait when a solo never settles', async () => {
    const input = new PassThrough(), output = new PassThrough();
    const exit = vi.fn();
    const done = runHostAgent({ mode: '--session', input, output, startId: 's', settleMs: 10,
      ports: ports({ loadSolo: () => new Promise(() => {}) }), exit });
    input.write(JSON.stringify({ id: 1, op: 'solo', body }) + '\n');
    await new Promise(resolve => setTimeout(resolve, 5));
    input.end();
    await done;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('answers one control operation and reports a refusal with its code', async () => {
    const run = async request => {
      const input = new PassThrough(), output = new PassThrough(), lines = [];
      output.on('data', chunk => lines.push(String(chunk)));
      input.end(JSON.stringify(request));
      await runHostAgent({ mode: '--control', input, output, ports: { readPressure: async () => 'some avg10=1.25' } });
      return JSON.parse(lines.join(''));
    };
    expect(await run({ op: 'memory-pressure' })).toEqual({ result: { avg10: 1.25 } });
    expect(await run({ op: 'kill', body: { pid: 1, startId: 'x' } })).toMatchObject({ code: 'kill-refused' });
    expect((await run({ op: 'rm' })).error).toContain('Unknown');
  });

  it('identifies its own code', async () => {
    const directory = path.join(root, 'code');
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, 'a.js'), 'one');
    const first = await harnessDigest(directory);
    await fs.writeFile(path.join(directory, 'a.js'), 'two');
    expect(await harnessDigest(directory)).not.toBe(first);
  });
});

describe('the cancel gate', () => {
  const identity = { threadId: 'cancel', attemptId: 'attempt' };
  const resident = () => ({ executeStage: vi.fn(async input => ({ tokenId: input.step })), closeAttempt: vi.fn(async () => {}) });

  it.each([[3, 2], [64, 63], [128, 127]])('holds a %i-token answer before its final token', async (count, step) => {
    const gate = createCancelGate(), inner = resident(), wrapped = gate.wrap(inner), controller = new AbortController();
    gate.arm('cancel', count - 1);
    for (let index = 0; index < step; index += 1) await wrapped.executeStage({ identity, step: index, signal: controller.signal });
    expect(gate.isEntered('cancel')).toBe(false);
    const held = wrapped.executeStage({ identity, step, signal: controller.signal });
    expect(gate.isEntered('cancel')).toBe(true);
    controller.abort(Error('stopped'));
    await expect(held).rejects.toThrow('stopped');
    expect(inner.executeStage).toHaveBeenCalledTimes(step);
  });

  it('releases on close, ignores other threads and fails a hold nobody ends', async () => {
    const gate = createCancelGate({ holdMs: 5 }), inner = resident(), wrapped = gate.wrap(inner);
    gate.arm('cancel', 1);
    await expect(wrapped.executeStage({ identity: { threadId: 'other', attemptId: 'x' }, step: 1 })).resolves.toEqual({ tokenId: 1 });
    await expect(wrapped.executeStage({ identity, step: 1 })).rejects.toThrow('never released');
    const closing = createCancelGate(), closed = closing.wrap(resident());
    closing.arm('cancel', 1);
    const held = closed.executeStage({ identity, step: 1 });
    await closed.closeAttempt({ identity });
    await expect(held).rejects.toThrow('closed at the cancel gate');
    expect(() => closing.arm('short', 0)).toThrow('at least two tokens');
  });

  it('stops only after the requester has seen output, and reports an answer that escaped the gate', async () => {
    const calls = [], finalStage = { call: async (op) => { calls.push(op); return op === 'gate-state' ? { entered: true } : {}; } };
    let finish;
    const requester = { call: (op) => {
      calls.push(op);
      if (op === 'generate') return new Promise(resolve => { finish = resolve; });
      if (op === 'cancel') { finish({ completed: false, stopped: true }); return Promise.resolve({ cancelled: true }); }
      return Promise.resolve({ deltas: 1 });
    } };
    expect(await runGatedCancel({ requester, finalStage, messages: [], threadId: 't', outputCount: 64 })).toMatchObject({ stopped: true });
    expect(calls[0]).toBe('arm-gate');
    const escaped = { call: async op => (op === 'generate' ? { completed: true } : { deltas: 0 }) };
    await expect(runGatedCancel({ requester: escaped, finalStage: { call: async op => (op === 'gate-state' ? { entered: false } : {}) }, messages: [], threadId: 't', outputCount: 3 }))
      .rejects.toThrow('cancel-gate-missed');
  });
});

describe('token evidence', () => {
  it('records the cleartext IDs of each attempt', async () => {
    const trace = createTokenTrace(), wrapped = trace.wrap({ executeStage: async input => ({ tokenId: input.id }) });
    for (const id of [17, 17, 248046]) await wrapped.executeStage({ id, identity: { attemptId: 'a' } });
    expect(trace.tokens('a')).toEqual([17, 17, 248046]);
    expect(trace.tokens('b')).toEqual([]);
  });

  it('refuses a cleartext trace that differs from the production witness digest', () => {
    const output = { sampleDigest: witnessDigest([17, 17, 248046]), sampleCount: 3 };
    expect(() => verifySplitTokens({ tokenIds: [17, 18, 248046], output, input: {}, answer: {} })).toThrow('token-witness-disagrees');
    expect(() => verifySplitTokens({ tokenIds: [17, 17], output, input: {}, answer: {} })).toThrow('token-witness-disagrees');
  });
});

describe('fake token text', () => {
  it.each([['22', 2], ['A multi-character answer that spans many more characters than tokens.', 7], ['short', 9], ['naïve 🙂 text', 4]])('rebuilds %j across %i tokens', (text, count) => {
    const parts = fakeTokenTexts(text, count);
    expect(parts).toHaveLength(count);
    expect(parts.join('')).toBe(text);
  });
  it('keeps the frozen two-token answer one digit per token', () => { expect(fakeTokenTexts('22', 2)).toEqual(['2', '2']); });
});
