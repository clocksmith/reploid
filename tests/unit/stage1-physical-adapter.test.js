// @vitest-environment node
// Every host here is an in-memory mock behind the command transport. Nothing reaches a machine, a GPU or a network.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPhysicalStage1Adapter } from '../../scripts/stage1/physical-adapter.js';
import { runStage1Phases } from '../../scripts/stage1/runner.js';
import { checkStage1Receipt } from '../../scripts/stage1/receipt-check.js';
import { observeInventory, summarizeRanges } from '../../scripts/stage1/inventory.js';

const DIGEST = 'sha256:' + 'd'.repeat(64);
const range = (file, offset) => ({ path: file, offset, size: 16, identity: 'sha256:' + String(offset).padStart(64, '0') });
const stageRanges = [[range('s0', 0), range('s0', 16)], [range('s1', 0), range('s1', 16), range('s1', 32)]];
const decoding = { temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1, repetitionPenaltyWindow: 1 };
const model = { id: 'model', identity: 'sha256:' + 'a'.repeat(64), quantization: 'q4k', partitionPlanId: 'sha256:' + 'b'.repeat(64),
  generation: decoding, source: { files: [{ path: 'tokenizer.json' }] } };
const fixture = { messages: [{ role: 'user', content: 'x' }], maxOutputTokens: 4 };
const expectations = { runtimeClass: 'physical', inventorySource: 'hashed-on-host', creditsPerOutputToken: 1, creditWeights: [1, 1],
  minimumSoloLoadBytes: 1000, workload: { modelId: model.id, modelIdentity: model.identity, quantization: 'q4k', planIdentity: model.partitionPlanId,
    messagesDigest: 'sha256:' + 'c'.repeat(64), promptDigest: 'p', promptCount: 1, maxOutputTokens: 4, decoding },
  reference: { outputIds: [1, 2, 3], sampleDigest: 's', outputText: '22', stopReasons: ['eos-token'] },
  stages: stageRanges.map((ranges, stageIndex) => ({ stageIndex, layerRange: [stageIndex, stageIndex], ...summarizeRanges(ranges) })),
  totalWeight: { rangeCount: 5, bytes: 80 } };

let identities;
beforeAll(async () => { identities = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' }))); });

function configuration(change = () => {}) {
  const hexId = letter => 'm-' + letter.repeat(16);
  const host = (label, index) => ({ label, machineId: hexId('ab'[index]), participantId: identities[index + 1].peerId, ssh: `mock-${label}`, node: '/opt/bin/node',
    releaseRoot: `/srv/${label}/release`, identityFile: `/srv/${label}/id.json`, stateDirectory: `/srv/${label}/state`, stageDirectory: `/data/${label}/stage`,
    fullCopyDirectory: `/data/${label}/tmp/full`, weightRoots: { model: [`/data/${label}/models`], cache: [`/data/${label}/cache`], temporary: [`/data/${label}/tmp`] },
    memoryPressure: { maxAvg10: 10, pollMs: 1000 }, standingService: null });
  const config = { schema: 'reploid.stage1-hosts/v1', coordinator: {}, credit: { weights: [1, 1], maxDebt: 100, maxRequestMs: 60000 },
    limits: { phaseMs: 2000, abortGraceMs: 200, hardStopMs: 1500, stopMarginMs: 2000, serviceRestoreMs: 300 },
    requester: { machineId: hexId('c'), participantId: identities[0].peerId, ssh: 'mock-requester', node: '/opt/bin/node', releaseRoot: '/srv/r/release',
      identityFile: '/srv/r/id.json', modelDirectory: '/srv/r/empty', stateDirectory: '/srv/r/state' },
    hosts: [host('host-a', 0), host('host-b', 1)] };
  change(config);
  return config;
}

/** Scripted machines. `holds` is what each host's search finds; a service is a state the commands really move. */
function mockHosts(config, scripted = {}) {
  const log = [], services = {}, holds = {}, running = new Map();
  let nextPid = 4000;
  config.hosts.forEach(host => {
    holds[host.label] = { stage: true, fullCopy: true, elsewhere: false, ...(scripted.holds?.[host.label] ?? {}) };
    if (host.standingService) services[host.label] = scripted.initialService ?? 'active';
  });
  const scan = (label, { stageRanges: assigned, scope }) => {
    const state = holds[label], other = stageRanges.flat().filter(row => !assigned.includes(assigned.find(item => item.path === row.path && item.offset === row.offset)));
    const inCopy = scope !== 'stage-directory' && state.fullCopy ? other : [], elsewhere = state.elsewhere ? other : [];
    const held = [...(state.stage ? assigned : []), ...new Set([...inCopy, ...elsewhere])];
    return { inventory: observeInventory({ held, stageRanges: assigned, source: 'hashed-on-host', scope, scannedRanges: stageRanges.flat().length }),
      outsideInFullCopy: inCopy.length, outsideElsewhere: elsewhere.length };
  };
  const controlOps = {
    'scan-weights': (label, body) => scan(label, body),
    'directory-bytes': () => ({ weightBytes: 0, fileCount: 0 }),
    'memory-pressure': label => ({ avg10: scripted.pressure?.[label] ?? 1 }),
    'process-state': (_label, { pid }) => ({ running: running.has(pid) }),
    kill(_label, body) { const child = running.get(body.pid); if (child?.startId === body.startId) { running.delete(body.pid); child.emit('exit', 137); return { killed: true }; } return { killed: false, reason: 'gone' }; },
    'delete-full-copy'(label, body) {
      if (scripted.deleteFails?.[label]) throw Object.assign(Error('full-copy-identity-mismatch: manifest differs from the model'), { code: 'full-copy-identity-mismatch' });
      holds[label].fullCopy = false;
      return { deleted: true, directory: body.directory };
    },
    service(label, { action, unit }) {
      if (unit !== config.hosts.find(host => host.label === label).standingService?.unit) throw Error('touched another service');
      if (action === 'is-active') return { state: services[label] };
      if (action === 'stop') services[label] = 'inactive';
      if (action === 'start') {
        if (scripted.restoreFails?.[label]) throw Object.assign(Error('service-command-failed: start did not succeed'), { code: 'service-command-failed' });
        services[label] = scripted.neverActive?.[label] ? 'activating' : 'active';
      }
      return { done: true };
    }
  };
  const sessionOps = (target, child) => ({
    identity: () => (scripted.wrongIdentity === target.label ? { participantId: identities[0].peerId, publicJwk: identities[0].publicJwk }
      : { participantId: target.participantId, publicJwk: [identities[1], identities[2], identities[0]].find(row => row.peerId === target.participantId).publicJwk }),
    solo: () => scripted.solo?.(target.label, child, { holds, services }) ?? { outcome: 'failed', settings: {}, failure: { kind: 'load-failed' }, claimedFailure: null },
    'abort-solo': () => { child.aborted = true; child.finishSolo?.({ outcome: 'failed', settings: {}, failure: { kind: 'stopped', guardTripped: true }, claimedFailure: null }); return { aborted: true }; },
    close() { queueMicrotask(() => { running.delete(child.pid); child.emit('exit', 0); }); return {}; },
    open: () => { log.push(`open:${target.label}`); throw Error('mock-participant-opened'); }
  });
  const transport = {
    async run(target, argv, { input }) {
      const { op, body } = JSON.parse(input);
      log.push(`control:${target.label}:${op}`);
      if (argv.at(-1) !== '--control') throw Error('control command expected');
      try { return { code: 0, stdout: JSON.stringify({ result: await controlOps[op](target.label, body) }) + '\n', stderr: '' }; }
      catch (error) { return { code: 0, stdout: JSON.stringify({ error: error.message, code: error.code }) + '\n', stderr: '' }; }
    },
    open(target) {
      const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(),
        pid: nextPid++, startId: 'start', kill() {} });
      running.set(child.pid, child);
      log.push(`session:${target.label}`);
      const ops = sessionOps(target, child);
      let buffered = '';
      child.stdin.on('data', async chunk => {
        buffered += chunk;
        for (;;) {
          const end = buffered.indexOf('\n');
          if (end < 0) return;
          const { id, op, body } = JSON.parse(buffered.slice(0, end));
          buffered = buffered.slice(end + 1);
          log.push(`call:${target.label}:${op}`);
          Promise.resolve().then(() => ops[op](body)).then(result => child.stdout.write(JSON.stringify({ id, result: result ?? {} }) + '\n'),
            error => child.stdout.write(JSON.stringify({ id, error: error.message, code: error.code }) + '\n'));
        }
      });
      queueMicrotask(() => child.stdout.write(JSON.stringify({ event: 'agent', pid: child.pid, startId: 'start',
        harnessDigest: scripted.wrongCode === target.label ? 'sha256:' + 'e'.repeat(64) : DIGEST }) + '\n'));
      return child;
    }
  };
  return { transport, log, services, holds, running };
}

let directory;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-physical-')); });

async function runAdapter({ config = configuration(), scripted = {}, approveDeleteFullCopy = false, limits = {} } = {}) {
  const hosts = mockHosts(config, scripted), coordinator = { closed: 0, close: async () => { coordinator.closed += 1; },
    credits: { snapshot: () => ({ accounts: [{ held: 0 }], journal: [] }) } };
  const adapter = createPhysicalStage1Adapter({ config, directory, expectations, stageRanges, model, fixture, fixtureBytes: Buffer.from(JSON.stringify(fixture)),
    approveDeleteFullCopy, transport: hosts.transport, localDigest: async () => DIGEST, startCoordinator: async () => coordinator });
  const receipt = await runStage1Phases({ adapter, expectations, limits: { maxRunMs: 8000, phaseMs: 2000, abortGraceMs: 200, hardStopMs: 1500, ...limits } });
  await fs.rm(directory, { recursive: true, force: true });
  return { ...hosts, receipt, coordinator, verdict: checkStage1Receipt(receipt, expectations) };
}
const codes = result => result.verdict.reasons.map(reason => reason.code);
const noProcessLeft = result => expect([...result.running.keys()]).toEqual([]);
const memoryFailure = { outcome: 'failed', settings: {}, failure: { kind: 'out-of-memory', evidence: 'device-out-of-memory' }, claimedFailure: 'memory' };

describe('preflight', () => {
  it('needs a transport', () => {
    expect(() => createPhysicalStage1Adapter({ config: configuration(), stageRanges, expectations, model, fixture, fixtureBytes: Buffer.alloc(0) })).toThrow('command transport');
  });
  it('refuses a host running other harness code', async () => {
    const result = await runAdapter({ scripted: { wrongCode: 'host-a' } });
    expect(result.receipt.phases.preflight).toMatchObject({ status: 'failed' });
    expect(result.receipt.phases.preflight.reason).toContain('host-code-mismatch');
    expect(result.verdict.ok).toBe(false);
    noProcessLeft(result);
  });
  it('refuses a host proving another identity', async () => {
    const result = await runAdapter({ scripted: { wrongIdentity: 'host-b' } });
    expect(result.receipt.phases.preflight.reason).toContain('host-identity-mismatch');
    noProcessLeft(result);
  });
  it('refuses a host whose stage directory does not hold its stage', async () => {
    const result = await runAdapter({ scripted: { holds: { 'host-b': { stage: false } } } });
    expect(result.receipt.phases.preflight.reason).toContain('host-stage-check-refused: host-b');
    expect(result.log.some(row => row.includes(':solo'))).toBe(false);
  });
  it('refuses a host holding everything in its stage directory', async () => {
    const result = await runAdapter({ scripted: { holds: { 'host-a': { elsewhere: true } } } });
    expect(result.receipt.phases.preflight.reason).toContain('host-stage-check-refused: host-a');
    expect(result.verdict.ok).toBe(false);
  });
});

describe('solo placement and the split gate', () => {
  it('stops with a named reason and deletes nothing without the approval flag', async () => {
    const result = await runAdapter({ approveDeleteFullCopy: false });
    expect(result.receipt.phases.split).toMatchObject({ status: 'failed' });
    expect(result.receipt.phases.split.reason).toContain('full-copy-present-delete-not-approved');
    expect(result.receipt.phases.split.reason).toContain('host-a, host-b');
    expect(result.log.filter(row => row.includes('delete-full-copy'))).toEqual([]);
    expect(result.log.filter(row => row.startsWith('open:'))).toEqual([]);
    expect(result.receipt.phases.cancel.status).toBe('skipped');
    expect(result.holds['host-a'].fullCopy).toBe(true);
    noProcessLeft(result);
  });
  it('deletes the full copy with the flag and only then opens a stage', async () => {
    const result = await runAdapter({ approveDeleteFullCopy: true });
    const firstDelete = result.log.findIndex(row => row.includes('delete-full-copy')), firstOpen = result.log.findIndex(row => row.startsWith('open:'));
    expect(result.log.filter(row => row.includes('delete-full-copy'))).toHaveLength(2);
    expect(firstDelete).toBeGreaterThan(-1);
    expect(firstOpen).toBeGreaterThan(firstDelete);
    expect(result.holds['host-a'].fullCopy).toBe(false);
  });
  it('keeps a copy with the wrong manifest and does not start the split', async () => {
    const result = await runAdapter({ approveDeleteFullCopy: true, scripted: { deleteFails: { 'host-a': true } } });
    expect(result.receipt.phases.split.reason).toContain('full-copy-identity-mismatch');
    expect(result.holds['host-a'].fullCopy).toBe(true);
    expect(result.log.filter(row => row.startsWith('open:'))).toEqual([]);
  });
  it('refuses a host that holds everything outside its full copy, and deletes nothing even with the flag', async () => {
    const result = await runAdapter({ approveDeleteFullCopy: true, scripted: {
      solo: (label, _child, { holds }) => { if (label === 'host-b') holds[label].elsewhere = true; return memoryFailure; } } });
    expect(result.receipt.phases.split.status).toBe('failed');
    expect(result.receipt.phases.split.reason).toContain('host-stage-check-refused: host-b');
    expect(result.log.filter(row => row.includes('delete-full-copy'))).toEqual([]);
    expect(result.log.filter(row => row.startsWith('open:'))).toEqual([]);
    expect(result.verdict.ok).toBe(false);
  });
  it('records an inconclusive control when no full copy is configured', async () => {
    const result = await runAdapter({ config: configuration(c => { c.hosts[0].fullCopyDirectory = null; }) });
    expect(result.receipt.soloControls['host-a']).toMatchObject({ outcome: 'inconclusive', reason: 'no-full-copy-configured' });
  });
  it('runs a control in its own process and confirms that process is gone', async () => {
    const result = await runAdapter({ scripted: { solo: () => memoryFailure } });
    expect(result.log.filter(row => row === 'session:host-a')).toHaveLength(2);
    expect(result.log).toContain('call:host-a:solo');
    noProcessLeft(result);
  });
});

describe('a standing service', () => {
  const withService = approve => configuration(c => { c.hosts[0].standingService = { manager: 'systemd-user', unit: 'worker.service', approveStopForSolo: approve }; });

  it('is left alone without approval, and the control is inconclusive', async () => {
    const result = await runAdapter({ config: withService(false) });
    expect(result.receipt.soloControls['host-a']).toMatchObject({ outcome: 'inconclusive', reason: 'standing-service-not-approved' });
    expect(result.services['host-a']).toBe('active');
    expect(result.log).not.toContain('call:host-a:solo');
    expect(result.receipt.serviceRestores).toEqual([]);
  });

  it('is stopped for the control and restored and verified active', async () => {
    let during = null;
    const result = await runAdapter({ config: withService(true), scripted: {
      solo: (label, _child, { services }) => { if (label === 'host-a') during = services['host-a']; return memoryFailure; } } });
    expect(during).toBe('inactive');
    expect(result.services['host-a']).toBe('active');
    expect(result.receipt.serviceRestores).toEqual([{ host: 'host-a', stopped: true, restored: true, verifiedActive: true }]);
  });

  it('is not started afterwards when it was already down', async () => {
    const result = await runAdapter({ config: withService(true), scripted: { initialService: 'inactive', solo: () => memoryFailure } });
    expect(result.services['host-a']).toBe('inactive');
    expect(result.receipt.serviceRestores).toEqual([]);
  });

  it('fails the receipt and hard-stops the run when the restore fails', async () => {
    const result = await runAdapter({ config: withService(true), scripted: { restoreFails: { 'host-a': true }, solo: () => memoryFailure } });
    expect(result.services['host-a']).toBe('inactive');
    expect(result.receipt.hardStop.reason).toContain('service-restore-failed');
    expect(result.receipt.hardStop.confirmed).toBe(false);
    expect(result.receipt.phases['solo-b'].status).toBe('skipped');
    expect(result.receipt.serviceRestores[0]).toMatchObject({ host: 'host-a', stopped: true, restored: false });
    expect(codes(result)).toEqual(expect.arrayContaining(['hard-stop', 'service-restore-failed']));
    expect(result.verdict.ok).toBe(false);
    noProcessLeft(result);
  });

  it('fails the receipt when the service starts but never reports active', async () => {
    const result = await runAdapter({ config: withService(true), scripted: { neverActive: { 'host-a': true }, solo: () => memoryFailure } });
    expect(result.receipt.serviceRestores[0]).toMatchObject({ restored: false, verifiedActive: false });
    expect(codes(result)).toContain('service-restore-failed');
  });

  it('is restored when the window expires in the middle of its control', async () => {
    const result = await runAdapter({ config: withService(true), limits: { maxRunMs: 120, abortGraceMs: 100 },
      scripted: { solo: (label, child) => new Promise(resolve => { child.finishSolo = resolve; }) } });
    expect(result.receipt.hardStop.reason).toContain('limit');
    expect(result.receipt.phases['solo-a'].status).toBe('stopped');
    expect(result.receipt.phases.split.status).toBe('skipped');
    expect(result.services['host-a']).toBe('active');
    expect(result.receipt.serviceRestores).toEqual([{ host: 'host-a', stopped: true, restored: true, verifiedActive: true }]);
    expect(result.verdict.ok).toBe(false);
    noProcessLeft(result);
  });
});

describe('stopping', () => {
  it('kills an agent that ignores its stop by its exact PID', async () => {
    const result = await runAdapter({ limits: { maxRunMs: 100, abortGraceMs: 50 }, scripted: { solo: () => new Promise(() => {}) } });
    expect(result.receipt.hardStop).toMatchObject({ confirmed: true });
    expect(result.log.filter(row => row.endsWith(':kill')).length).toBeGreaterThan(0);
    noProcessLeft(result);
    expect(result.coordinator.closed).toBe(1);
  });
  it('stops before a phase under memory pressure', async () => {
    const result = await runAdapter({ scripted: { pressure: { 'host-b': 80 } } });
    expect(result.receipt.hardStop.reason).toContain('memory-pressure: host-b');
    expect(result.log.some(row => row.startsWith('session:'))).toBe(false);
  });
});
