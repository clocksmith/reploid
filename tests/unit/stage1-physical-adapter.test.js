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
  const config = { schema: 'reploid.stage1-hosts/v1', coordinator: {}, credit: { weights: [1, 1], maxDebt: 100, maxRequestMs: 60000, partitionUnclaimedReleaseMs: 1000 },
    limits: { phaseMs: 2000, abortGraceMs: 200, hardStopMs: 1500, stopMarginMs: 2000, serviceRestoreMs: 300 },
    requester: { machineId: hexId('c'), participantId: identities[0].peerId, ssh: 'mock-requester', node: '/opt/bin/node', releaseRoot: '/srv/r/release',
      identityFile: '/srv/r/id.json', modelDirectory: '/srv/r/empty', stateDirectory: '/srv/r/state',
      weightRoots: { model: ['/srv/r/models'], cache: ['/srv/r/cache'], temporary: ['/srv/r/tmp'] } },
    hosts: [host('host-a', 0), host('host-b', 1)] };
  change(config);
  return config;
}

/** Scripted machines. `holds` is what each host's search finds; a service is a state the commands really move. */
function mockHosts(config, scripted = {}) {
  const log = [], services = {}, holds = {}, running = new Map(), bodies = [];
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
    'scan-weights': (label, body) => {
      if (label !== 'requester') return scan(label, body);
      log.push(`requester-roots:${body.roots.join(',')}`);
      const held = scripted.requesterHolds ? stageRanges[0] : [];
      return { inventory: observeInventory({ held, stageRanges: body.stageRanges, source: 'hashed-on-host', scope: body.scope, scannedRanges: body.allRanges.length }),
        outsideInFullCopy: 0, outsideElsewhere: held.length };
    },
    'directory-bytes': label => (label === 'requester' && scripted.requesterOtherBytes ? { weightBytes: scripted.requesterOtherBytes + (scripted.requesterHolds ? 32 : 0), fileCount: 2 }
      : { weightBytes: scripted.requesterHolds ? 32 : 0, fileCount: scripted.requesterHolds ? 1 : 0 }),
    'stage-directory'(label, body) {
      log.push(`stage-directory:${label}:${body.action}`);
      bodies.push({ label, ...body });
      if (scripted.stageDirectoryFails?.[label]) throw Object.assign(Error('stage-directory-mismatch: the build record\'s stage differs from the pin'), { code: 'stage-directory-mismatch' });
      return { verified: 'record', stageIndex: body.stageIndex, ...summarizeRanges(body.stageRanges) };
    },
    'memory-pressure': label => (scripted.pressureLevel?.[label] ? { level: scripted.pressureLevel[label] } : { avg10: scripted.pressure?.[label] ?? 1 }),
    'process-state': (_label, { pid }) => ({ running: running.has(pid) }),
    kill(_label, body) { const child = running.get(body.pid); if (child?.startId === body.startId) { running.delete(body.pid); child.emit('exit', 137); return { killed: true }; } return { killed: false, reason: 'gone' }; },
    'lock-directory'(label, { action, mode }) {
      if (action === 'mode') return { mode: 0o755 };
      if (action === 'lock') { holds[label].locked = true; return { locked: true, previousMode: 0o755 }; }
      if (scripted.unlockFails?.[label]) throw Object.assign(Error('lock-refused: no readable mode to restore'), { code: 'lock-refused' });
      holds[label].locked = false;
      return { restored: true, mode };
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
  return { transport, log, services, holds, running, bodies };
}

let directory;
beforeEach(async () => { directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-physical-')); });

async function runAdapter({ config = configuration(), scripted = {}, limits = {}, options = {} } = {}) {
  // An empty ledger file, so cleanup can count open reservations the way it does on a real run.
  const ledgerFile = path.join(directory, 'credits.sqlite'), { DatabaseSync } = await import('node:sqlite');
  const ledger = new DatabaseSync(ledgerFile);
  ledger.exec('CREATE TABLE fleet_requests (id TEXT PRIMARY KEY, binding TEXT NOT NULL, state TEXT NOT NULL, outcome TEXT)');
  ledger.close();
  const hosts = mockHosts(config, scripted), coordinator = { closed: 0, close: async () => { coordinator.closed += 1; }, ledgerFile,
    credits: { snapshot: () => ({ accounts: [{ held: 0 }], journal: [] }) } };
  const adapter = createPhysicalStage1Adapter({ config, directory, expectations, stageRanges, model, fixture, fixtureBytes: Buffer.from(JSON.stringify(fixture)),
    transport: hosts.transport, localDigest: async () => DIGEST, startCoordinator: async () => coordinator, ...options });
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

describe('stage directories', () => {
  const adapterFor = (config, scripted = {}) => {
    const hosts = mockHosts(config, scripted);
    return { ...hosts, adapter: createPhysicalStage1Adapter({ config, directory, expectations, stageRanges, model, fixture,
      fixtureBytes: Buffer.from(JSON.stringify(fixture)), transport: hosts.transport, localDigest: async () => DIGEST }) };
  };
  it('builds a host\'s stage directory from its full copy with its pinned ranges, the other stage and the pin', async () => {
    const { adapter, bodies } = adapterFor(configuration());
    expect(await adapter.stageDirectory('host-b', { action: 'build', timeoutMs: 1000 })).toMatchObject({ stageIndex: 1, rangeCount: 3 });
    expect(bodies).toEqual([{ label: 'host-b', action: 'build', hash: false, source: '/data/host-b/tmp/full', directory: '/data/host-b/stage', stageIndex: 1,
      stageRanges: stageRanges[1], otherRanges: stageRanges[0], rangesDigest: expectations.stages[1].rangesDigest, inventorySha256: expectations.inventorySha256 }]);
    await adapter.stageDirectory('host-a', { action: 'verify', hash: true });
    expect(bodies[1]).toMatchObject({ action: 'verify', hash: true, source: null, stageIndex: 0, otherRanges: stageRanges[1] });
  });
  it('refuses to build without a full copy', async () => {
    const { adapter, bodies } = adapterFor(configuration(config => { config.hosts[0].fullCopyDirectory = null; }));
    await expect(adapter.stageDirectory('host-a', { action: 'build' })).rejects.toMatchObject({ code: 'stage-directory-refused' });
    expect(bodies).toEqual([]);
  });
  it('optionally checks each build record against the pin in preflight, before the search, without rebuilding', async () => {
    const result = await runAdapter({ options: { verifyStageDirectories: true } });
    expect(result.log.filter(row => row.startsWith('stage-directory:'))).toEqual(['stage-directory:host-a:verify', 'stage-directory:host-b:verify']);
    expect(result.receipt.hosts.map(host => host.stageDirectoryRecord)).toEqual(stageRanges.map((ranges, stageIndex) =>
      ({ verified: 'record', stageIndex, ...summarizeRanges(ranges) })));
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-physical-'));
    const plain = await runAdapter();
    expect(plain.log.some(row => row.startsWith('stage-directory:'))).toBe(false);
  });
  it('stops preflight when a build record differs from the pin', async () => {
    const result = await runAdapter({ options: { verifyStageDirectories: true }, scripted: { stageDirectoryFails: { 'host-b': true } } });
    expect(result.receipt.phases.preflight.reason).toContain('host-stage-check-refused: host-b stage directory record: stage-directory-mismatch');
    expect(result.log.some(row => row.includes(':solo'))).toBe(false);
  });
});

describe('the zero-weight requester', () => {
  it('is searched under the same kinds of weight roots as a stage host, not only its model directory', async () => {
    const result = await runAdapter();
    // These mocks never open a participant, so the after-split measurement (the same call) is covered by the integration run.
    expect(result.log.filter(row => row.startsWith('requester-roots:'))).toEqual(['requester-roots:/srv/r/empty,/srv/r/models,/srv/r/cache,/srv/r/tmp']);
    expect(result.receipt.requester.preflight).toEqual({ weightBytes: 0, otherModelBytes: 0, fileCount: 0, scope: 'requester-weight-directories', scannedRoots: 4,
      heldRanges: { rangeCount: 0, bytes: 0, scannedRanges: 5 } });
    expect(result.log.filter(row => row.startsWith('control:requester:directory-bytes'))).toHaveLength(1);
    expect(result.verdict.reasons.filter(reason => reason.code === 'requester-holds-weights')).toEqual([]);
  });
  it('fails the receipt when pinned pieces of the requested model sit in a requester cache', async () => {
    const result = await runAdapter({ scripted: { requesterHolds: true } });
    expect(result.receipt.requester.preflight).toMatchObject({ weightBytes: 32, otherModelBytes: 0, heldRanges: { rangeCount: 2, bytes: 32 } });
    expect(codes(result)).toContain('requester-holds-weights');
    expect(result.verdict.ok).toBe(false);
  });
  it('records another model\'s files under its roots as otherModelBytes, apart from the claim of zero requested pieces', async () => {
    const result = await runAdapter({ scripted: { requesterOtherBytes: 1100000000 } });
    expect(result.receipt.requester.preflight).toMatchObject({ weightBytes: 0, otherModelBytes: 1100000000, fileCount: 2, heldRanges: { rangeCount: 0, bytes: 0 } });
    expect(codes(result)).not.toContain('requester-holds-weights');
  });
});

describe('solo placement and the split gate', () => {
  it('keeps each full copy, locks it before any stage opens and restores it at cleanup', async () => {
    const result = await runAdapter({ scripted: { solo: () => memoryFailure } });
    const firstLock = result.log.findIndex(row => row.endsWith(':lock-directory')), firstOpen = result.log.findIndex(row => row.startsWith('open:'));
    expect(firstLock).toBeGreaterThan(-1);
    expect(firstOpen).toBeGreaterThan(firstLock);
    expect(result.holds['host-a']).toMatchObject({ fullCopy: true, locked: false });
    expect(result.receipt.cleanup.fullCopyLocks).toEqual([{ host: 'host-a', locked: true, restored: true }, { host: 'host-b', locked: true, restored: true }]);
    expect(result.log.some(row => row.includes('delete'))).toBe(false);
  });
  it('fails the receipt when a lock cannot be restored', async () => {
    const result = await runAdapter({ scripted: { solo: () => memoryFailure, unlockFails: { 'host-b': true } } });
    expect(result.receipt.cleanup.fullCopyLocks).toContainEqual({ host: 'host-b', locked: true, restored: false });
    expect(codes(result)).toContain('full-copy-lock-not-restored');
  });
  it('refuses a host that holds another stage outside its full copy, before locking or opening anything', async () => {
    const result = await runAdapter({ scripted: {
      solo: (label, _child, { holds }) => { if (label === 'host-b') holds[label].elsewhere = true; return memoryFailure; } } });
    expect(result.receipt.phases.split.status).toBe('failed');
    expect(result.receipt.phases.split.reason).toContain('host-stage-check-refused: host-b');
    expect(result.log.filter(row => row.endsWith(':lock-directory'))).toEqual([]);
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
  it('guards a macOS host by its kernel pressure level, and runs a host with no guard', async () => {
    const mac = configuration(config => { config.hosts[0].memoryPressure = { maxPressureLevel: 'normal', pollMs: 1000 }; config.hosts[1].memoryPressure = null; });
    const calm = await runAdapter({ config: mac, scripted: { pressureLevel: { 'host-a': 'normal' } } });
    expect(calm.receipt.hardStop?.reason ?? '').not.toContain('memory-pressure');
    expect(calm.log.filter(row => row === 'control:host-b:memory-pressure')).toEqual([]);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-physical-'));
    const pressed = await runAdapter({ config: mac, scripted: { pressureLevel: { 'host-a': 'warning' } } });
    expect(pressed.receipt.hardStop.reason).toContain('memory-pressure: host-a level warning');
  });
  it('stops before a phase under memory pressure', async () => {
    const result = await runAdapter({ scripted: { pressure: { 'host-b': 80 } } });
    expect(result.receipt.hardStop.reason).toContain('memory-pressure: host-b');
    expect(result.log.some(row => row.startsWith('session:'))).toBe(false);
  });
});
