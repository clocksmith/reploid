// @vitest-environment node
// Readiness spans and stage admissions as hosts record them (reploid/measurement readiness-records.js), read back for
// the utilization summary and CLI. The end-to-end case drives the real automatic-partitions owner and resident with an
// injected Doppler session through the native JSONL sink, a crash and a restart. Injected execution only: this proves
// the record contract, not physical readiness.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReadinessRecorder, readinessInputFromRecords, createReadinessRecordStore, summarizeCapacityUtilization }
  from '../../packages/reploid/src/measurement/index.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { canonicalPartitionJson } from '../../packages/reploid/src/mesh/partitions/partition-contract.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openNativeReadinessLog } from '../../server/native-readiness-log.js';
import { loadUtilizationInput, formatUtilization, formatRecordedReadiness } from '../../scripts/capacity-utilization.js';

// Discovery alone is supplied: one remote contributor already ready at stage 0, so this host takes stage 1.
vi.mock('../../packages/reploid/src/mesh/partitions/partition-discovery.js', () => ({
  createPartitionDiscovery: ({ catalog }) => ({
    getModels: () => [], refresh: async () => {}, close: async () => {}, invalidateModel() {},
    getSnapshot: () => [{ available: true, participantId: 'peer:' + '0'.repeat(24), transportId: 'remote',
      description: { phase: 'ready', index: 0, offer: { id: catalog[0].id, identity: catalog[0].identity } } }]
  })
}));

const S = 1000, M = 'sha256:' + 'a'.repeat(64), PLAN = 'sha256:' + 'b'.repeat(64);
const cleanups = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const hostState = (overrides = {}) => ({ phase: 'ready', offering: true,
  descriptor: { ready: true, modelIdentity: M, planId: PLAN, index: 1 },
  reservations: { active: 0, availableSlots: 2, closed: false, records: [] }, ...overrides });
function recorded(options = {}) {
  let clock = 0;
  const records = [];
  const recorder = createReadinessRecorder({ participantId: 'p', host: 'node', write: record => records.push(record),
    now: () => clock, checkpointMs: 50 * S, ...options });
  return { recorder, records, at: seconds => { clock = seconds * S; } };
}
const spansOf = records => readinessInputFromRecords(records).readiness
  .map(({ stageIndex, state, capacity, from, to, end }) => [stageIndex, state, capacity?.amount ?? null, from / S, to / S, end ?? null]);

describe('readiness recorder', () => {
  it('records unready time from the session start, admitted slots, owner reductions and why each ready span ended', () => {
    const { recorder, records, at } = recorded();
    at(10); recorder.observe({ phase: 'loading', offering: true, descriptor: null, reservations: null });
    at(20); recorder.observe(hostState());
    at(30); recorder.observe(hostState({ reservations: { active: 1, availableSlots: 0, closed: false } })); // owner reduce to 1
    at(40); recorder.observe(hostState({ phase: 'waiting' }));
    at(50); recorder.observe(hostState({ reservations: { active: 0, availableSlots: 0, closed: false } })); // admits nothing
    at(60); recorder.observe(hostState());
    at(70); recorder.observe(hostState({ phase: 'failed' }));
    at(80); recorder.end('shutdown');
    expect(spansOf(records)).toEqual([[1, 'unready', null, 0, 20, 'ready'], [1, 'ready', 2, 20, 30, 'capacity-changed'],
      [1, 'ready', 1, 30, 40, 'not-admitting'], [1, 'unready', null, 40, 60, 'ready'], [1, 'ready', 2, 60, 70, 'failed'],
      [1, 'unready', null, 70, 80, 'shutdown']]);
    // The checkpoint at 50 s re-records the open unready span with its later observation.
    expect(records.filter(row => row.to === null && row.observedAt === 50 * S)).toMatchObject([{ state: 'unready', from: 40 * S }]);
    expect(records.every(row => row.sessionId === recorder.sessionId && row.sessionStartedAt === 0 && row.host === 'node')).toBe(true);
    recorder.observe(hostState()); // ended: ignored
    expect(recorder.getState()).toMatchObject({ ended: true, open: 0, failures: 0 });
  });

  it('keeps a stage it left unready, starts a new stage unready from the session start, and stops ready claims across unobserved time', () => {
    const { recorder, records, at } = recorded();
    at(10); recorder.observe(hostState());
    at(20); recorder.observe(hostState({ offering: false, phase: 'stopping' }));
    const moved = hostState({ descriptor: { ready: true, modelIdentity: M, planId: PLAN, index: 2 } });
    at(30); recorder.observe(moved);
    at(40); recorder.observe(moved);
    at(200); recorder.observe(moved); // 160 s unobserved: a suspended host serves nothing
    at(210); recorder.end('shutdown');
    expect(spansOf(records).sort((a, b) => a[0] - b[0] || a[3] - b[3])).toEqual([
      [1, 'unready', null, 0, 10, 'ready'], [1, 'ready', 2, 10, 20, 'stopped'], [1, 'unready', null, 20, 210, 'shutdown'],
      [2, 'unready', null, 0, 30, 'ready'], [2, 'ready', 2, 30, 40, 'observation-gap'], [2, 'ready', 2, 200, 210, 'shutdown']]);
    // 40 s to 200 s of stage 2 is covered by no span: unknown, never ready.
    expect(summarizeCapacityUtilization({ interval: { from: 0, to: 210 * S }, readiness: readinessInputFromRecords(records).readiness })
      .contributors[0].stages.find(row => row.stageIndex === 2).maintained).toMatchObject({ unknownMs: 160 * S, readyMs: 20 * S, unreadyMs: 30 * S });
  });

  it('records admissions from the resident with identities, times and slots only, once reserved and once settled', () => {
    const { recorder, records, at } = recorded();
    const listeners = new Set(), unsubscribe = vi.fn();
    const resident = { subscribe(listener) { listeners.add(listener); return unsubscribe; } };
    const identity = attemptId => ({ attemptId, threadId: 'thread-private', requesterId: 'requester-private', participantA: 'a', participantB: 'p',
      modelIdentity: M, planId: PLAN, messages: [{ role: 'user', content: 'private question' }] });
    const record = (attemptId, reservedAt, settledAt = null, failure = null) => ({ identity: identity(attemptId), participantId: 'p', index: 1,
      phase: settledAt === null ? 'reserved' : failure ? 'failed' : 'settled', reservedAt: reservedAt * S, settlingAt: settledAt && settledAt * S,
      settledAt: settledAt && settledAt * S, failure, resources: { attemptSlots: 1, maxTokens: 4096, scope: 'application-attempt-limits' } });
    const emit = (phase, rows) => { for (const listener of listeners) listener({ phase, participantId: 'p', index: 1, reservations: { records: rows } }); };
    at(1); recorder.watchResident(resident);
    at(2); emit('ready', [record('x', 2)]);
    at(3); emit('ready', [record('x', 2), { ...record('tombstone', 0), reservedAt: null }]);
    at(4); emit('ready', [record('x', 2, 4, 'Error: echo of private question'), record('y', 4)]);
    at(5); emit('ready', [record('x', 2, 4, 'Error: echo of private question'), record('y', 4)]);
    at(9); recorder.close('shutdown');
    const admissions = records.filter(row => row.schema === 'reploid.stage-admission/v1');
    expect(admissions.map(row => [row.identity.attemptId, row.settledAt && row.settledAt / S, row.observedAt / S]))
      .toEqual([['x', null, 2], ['x', 4, 4], ['y', null, 4], ['y', null, 9]]);
    expect(admissions[1]).toMatchObject({ failure: 'failed', phase: 'failed', resources: { attemptSlots: 1 },
      identity: { attemptId: 'x', participantA: 'a', participantB: 'p', modelIdentity: M, planId: PLAN } });
    expect(JSON.stringify(records)).not.toMatch(/private|thread|requester|messages|maxTokens/);
    expect(unsubscribe).toHaveBeenCalledOnce();
    const folded = readinessInputFromRecords(records);
    expect(folded.admissions.find(row => row.identity.attemptId === 'y')).toMatchObject({ settledAt: null, observedUntil: 9 * S, releasedBy: null });
  });

  it('never throws into the host for malformed states or a failing sink', () => {
    const { recorder } = recorded({ write: () => { throw Error('disk full'); } });
    expect(() => recorder.observe(undefined)).not.toThrow();
    expect(() => recorder.observe({ descriptor: { modelIdentity: M, planId: PLAN, index: -1 } })).not.toThrow();
    expect(() => recorder.observe(hostState())).not.toThrow();
    expect(recorder.getState().failures).toBeGreaterThan(0);
    expect(() => createReadinessRecorder({ participantId: 'p', host: 'cloud', write() {} })).toThrow('host node or browser');
  });
});

describe('reading recorded copies back', () => {
  const span = (overrides = {}) => ({ schema: 'reploid.readiness-span/v1', spanId: 's1', sessionId: 'one', sessionStartedAt: 0, host: 'node',
    participantId: 'p', modelIdentity: M, planId: PLAN, stageIndex: 1, state: 'ready', capacity: { unit: 'attempt-slots', amount: 2 },
    from: 10 * S, to: null, observedAt: 10 * S, end: null, ...overrides });
  it('counts an open span only through its last observation and refuses contradictory copies', () => {
    const folded = readinessInputFromRecords([span(), span({ observedAt: 70 * S })]);
    expect(folded.readiness).toEqual([expect.objectContaining({ from: 10 * S, to: 70 * S, state: 'ready' })]);
    expect(folded.unterminated).toEqual([expect.objectContaining({ spanId: 's1', from: 10 * S, lastObservedAt: 70 * S })]);
    expect(readinessInputFromRecords([span(), span({ to: 40 * S, observedAt: 40 * S, end: 'stopped' })]).unterminated).toEqual([]);
    expect(() => readinessInputFromRecords([span(), span({ capacity: { unit: 'attempt-slots', amount: 1 } })])).toThrow('conflicting copies');
    expect(() => readinessInputFromRecords([span({ to: 40 * S }), span({ to: 50 * S })])).toThrow('conflicting copies');
    expect(() => readinessInputFromRecords([span({ sessionStartedAt: 5 }), span({ spanId: 's2' })])).toThrow('conflicting session');
    expect(() => readinessInputFromRecords([{ schema: 'other' }])).toThrow('unknown record schema');
  });
});

describe('bounded browser record store', () => {
  it('keeps the latest copy of each span or admission, counts what it drops, and survives storage failures', async () => {
    const values = new Map();
    let failing = false;
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { if (failing) throw Error('quota'); values.set(key, value); } };
    const unbounded = createReadinessRecordStore({ storage, key: 'all' }), store = createReadinessRecordStore({ storage, key: 'records', maxRecords: 1 });
    const { recorder, at } = recorded({ write: record => { unbounded.write(record); store.write(record); } });
    at(10); recorder.observe(hostState());
    at(60); recorder.observe(hostState()); // the checkpoint copy replaces the open copy
    await Promise.resolve();
    expect(JSON.parse(values.get('all')).readinessRecords.map(row => [row.state, row.to && row.to / S, row.observedAt / S]))
      .toEqual([['unready', 10, 10], ['ready', null, 60]]);
    // One record fits: the oldest observed (the closed unready span) is dropped and counted.
    let doc = JSON.parse(values.get('records'));
    expect(doc).toMatchObject({ schema: 'reploid.capacity-utilization-input/v1', readinessDropped: 1 });
    expect(doc.readinessRecords.map(row => [row.state, row.to, row.observedAt / S])).toEqual([['ready', null, 60]]);
    failing = true;
    at(70); recorder.end('disconnected');
    await Promise.resolve();
    expect(store.getState()).toMatchObject({ pending: 1, failures: 1 });
    expect(JSON.parse(values.get('records')).readinessRecords[0].to).toBeNull();
    failing = false;
    doc = store.export();
    expect(doc).toMatchObject({ readinessDropped: 1, readinessRecords: [{ state: 'ready', from: 10 * S, to: 70 * S, end: 'disconnected' }] });
    expect(JSON.parse(values.get('records'))).toEqual(doc);
    expect(store.getState()).toMatchObject({ pending: 0 });
  });
});

describe('end to end: automatic partitions, native log, crash, restart and the CLI', () => {
  const model = { id: 'model', identity: M, generation: { maxSeqLen: 64 } };
  const plan = { modelId: 'model', partitions: [{ layerRange: [0, 1] }, { layerRange: [2, 3] }] };
  const policy = { pollMs: 3_600_000, maxPeers: 4, connectTimeoutMs: 1000, grantMs: 10000, limits: { maxAttempts: 8 }, inputLimits: {}, receiver: {} };
  async function generationDigest() {
    const bytes = new TextEncoder().encode(canonicalPartitionJson(model.generation));
    return 'sha256:' + Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  }
  /** One host process: the real contribution owner and resident, an injected Doppler session and a readiness recorder. */
  async function stageHost(identity, write) {
    const digest = await generationDigest(), recorder = createReadinessRecorder({ participantId: identity.peerId, host: 'node', write,
      checkpointMs: 50 * S });
    let resident = null;
    const session = index => ({ getDescriptor: () => ({ schema: 'doppler.resident-partition/v1', ready: true, modelId: 'model', modelIdentity: M,
      generationDigest: digest, planId: PLAN, index, layerRange: plan.partitions[index].layerRange, residentWeightBytes: 1024 }),
    getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
    tokenize: async () => ({}), executeGroup0: async () => ({}), executeGroup1: async () => ({}), closeAttempt: async () => {}, close: async () => {} });
    const mesh = createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], policy, peers: () => [],
      createNetwork: () => ({ close: async () => {} }),
      loadProgram: async (selected, index, controls) => {
        resident = createResidentPartition({ runtime: { openResidentPartition: async () => session(index) }, model: selected, plan, planId: PLAN,
          index, participantId: controls.participantId, limits: { maxAttempts: 8, maxConcurrentAttempts: 2 } });
        await resident.prepare({ approved: true, signal: controls.signal });
        recorder.watchResident(resident);
        return { runtime: {}, model: selected, plan, planId: PLAN, resident };
      },
      onChange: state => recorder.observe(state) });
    cleanups.push(() => mesh.close());
    const attempt = attemptId => ({ attemptId, threadId: 'thread-private', requesterId: 'requester-private', participantA: 'peer:' + '0'.repeat(24),
      participantB: identity.peerId, modelIdentity: M, planId: PLAN });
    return { mesh, recorder, reserve: attemptId => resident.reserve(attempt(attemptId)),
      settle: attemptId => resident.closeAttempt({ identity: attempt(attemptId) }),
      // The host's poll timer: observe every 25 s up to `seconds`.
      async poll(from, seconds) { for (let t = from + 25; t <= seconds; t += 25) { vi.setSystemTime(T0 + t * S); recorder.observe(mesh.getState()); } } };
  }
  const T0 = Date.UTC(2026, 9, 15, 22, 0, 0);
  const at = seconds => vi.setSystemTime(T0 + seconds * S);

  it('measures recorded readiness and admissions, keeps the restart gap unknown and bounds a crashed attempt by the restart', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'readiness-records-'));
    cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
    const file = path.join(directory, 'readiness.jsonl'), identity = await createSigningIdentity({ algorithm: 'Ed25519' });

    // Session A: ready at 100 s, one settled attempt, one still held when the process dies at 300 s.
    at(0);
    const logA = await openNativeReadinessLog({ file });
    let alive = true;
    const a = await stageHost(identity, record => { if (alive) logA.write(record); });
    at(100); await a.mesh.contribute('model', true);
    expect(a.mesh.getState()).toMatchObject({ phase: 'ready', offering: true, descriptor: { index: 1 } });
    await a.poll(100, 150); a.reserve('a1');
    await a.poll(150, 175); await a.settle('a1');
    await a.poll(175, 250); a.reserve('a2');
    await a.poll(250, 300);
    alive = false; await logA.close();
    await fs.appendFile(file, '{"schema":"reploid.readiness-span/v1","spanId":'); // the write the crash cut short

    // Session B: the same participant restarts at 1000 s, serves one attempt and stops cleanly.
    at(1000);
    const logB = await openNativeReadinessLog({ file });
    const b = await stageHost(identity, logB.write);
    at(1100); await b.mesh.contribute('model', true);
    await b.poll(1100, 1200); b.reserve('b1');
    await b.poll(1200, 1250); await b.settle('b1');
    await b.poll(1250, 1300); await b.mesh.stop();
    await b.poll(1300, 1400); b.recorder.end('shutdown'); await b.mesh.close(); b.recorder.close('shutdown'); await logB.close();

    const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean);
    expect(lines.filter(line => !line.endsWith('}'))).toHaveLength(1);
    expect(lines.join('\n')).not.toMatch(/private/);
    const attempts = path.join(directory, 'attempts.json');
    await fs.writeFile(attempts, JSON.stringify({ schema: 'reploid.capacity-utilization-input/v1',
      attempts: [{ attemptId: 'a1', status: 'completed', satisfactory: true }, { attemptId: 'a2', status: 'interrupted' },
        { attemptId: 'b1', status: 'completed', satisfactory: true }] }));
    const load = (from, to) => loadUtilizationInput([file, attempts], { from: String(T0 + from * S), to: String(T0 + to * S) });
    const stage = summary => summary.contributors.find(row => row.participantId === identity.peerId).stages[0];

    // The whole night: the crash-to-restart gap stays unknown, so the ratios are null with reasons.
    const night = await load(0, 1400);
    expect(night.recorded).toMatchObject({ unreadableLines: 1, dropped: 0, unterminated: [expect.objectContaining({ state: 'ready',
      from: T0 + 100 * S, lastObservedAt: T0 + 300 * S })] });
    expect(night.admissions.find(row => row.identity.attemptId === 'a2')).toMatchObject({ settledAt: null,
      observedUntil: T0 + 300 * S, releasedBy: T0 + 1000 * S });
    const whole = stage(summarizeCapacityUtilization(night));
    expect(whole).toMatchObject({ stageIndex: 1, planId: PLAN, unit: 'attempt-slots',
      maintained: { capacitySeconds: null, knownCapacitySeconds: 800, readyMs: 400 * S, unreadyMs: 300 * S, unknownMs: 700 * S },
      consumed: { capacitySeconds: 125, admissions: 3, open: 1 } });
    expect(whole.ratios).toEqual({ reasons: ['readiness-gaps', 'open-after-observation'], usefulToMaintained: null, usefulToPaid: null,
      occupiedToMaintained: null });
    const text = formatRecordedReadiness(night.recorded) + '\n' + formatUtilization(summarizeCapacityUtilization(night));
    expect(text).toContain('1 spans unknown after their last observation, 1 unreadable lines');
    expect(text).toContain(`ready from ${new Date(T0 + 100 * S).toISOString()}, unknown after ${new Date(T0 + 300 * S).toISOString()}`);
    expect(text).toContain('maintained ready unknown (known 800.0; paid 0.0, unpaid 800.0); unknown 700000 ms');

    // Before the crash and after the restart every input is known; the crashed attempt ends with its process.
    expect(stage(summarizeCapacityUtilization(await load(0, 300)))).toMatchObject({ maintained: { capacitySeconds: 400 },
      consumed: { capacitySeconds: 75 }, ratios: { reasons: [], usefulToMaintained: 0.0625, occupiedToMaintained: 0.1875 } });
    expect(stage(summarizeCapacityUtilization(await load(1000, 1400)))).toMatchObject({ maintained: { capacitySeconds: 400, unknownMs: 0 },
      consumed: { capacitySeconds: 50, admissions: 1 }, ratios: { reasons: [], usefulToMaintained: 0.125, occupiedToMaintained: 0.125 } });
  });
});
