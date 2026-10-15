import { describe, expect, it, vi } from 'vitest';
import failureMessages from '../../packages/reploid/src/transport/partition-errors.json' with { type: 'json' };
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createPartitionNetwork } from '../../packages/reploid/src/mesh/partitions/partition-network.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/partitions/resident-partition.js';
import { createPartitionChat } from '../../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionGrantAuthority } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { ATTEMPT_QUEUE_POLICY, ATTEMPT_QUEUE_POLICY_SCHEMA, createPartitionAttemptQueue } from '../../packages/reploid/src/mesh/partitions/partition-attempt-queue.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createRemotePermission, remotePermissionNeed } from '../../packages/reploid/src/chat/remote-permission.js';
import { fixture as stageFixture } from '../fixtures/ordered-partition-ports.js';

// Real automatic owners, entry channels, ordered peers and resident admission records over
// synthetic channels; injected stage arithmetic. Proves admission, queueing and failure codes
// across every hop, not GPU execution, physical capacity or answer quality.
const WORDING = Object.freeze({ id: 'remote-contributors-test', version: 'test/1', text: 'Test-only remote contributor permission wording.' });
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true, maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); } }));
  return pair;
}
const abortable = (promise, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  promise.then(resolve, reject);
});

/** Three prepared stages (coordinator first) with `slots` concurrent attempts each, and weightless requesters. */
async function orderedMesh({ requesters, slots = [2, 2, 2] }) {
  const f = stageFixture(3), count = 3;
  const identities = await Promise.all(Array.from({ length: count + requesters }, () => createSigningIdentity({ algorithm: 'ECDSA' })));
  f.route.stages.forEach((stage, index) => { stage.participantId = identities[index].peerId; });
  f.plan.partitions.forEach((stage, index) => { stage.layerRange = [index * 2, index * 2 + 1]; });
  const model = { id: f.route.modelId, identity: f.route.modelIdentity, name: 'Synthetic queue fixture', generation: f.request.generation };
  const listeners = identities.map(() => new Map()), meshes = [], residents = [], tokenized = [], holds = new Map();
  const channelPolicy = { maxFrameBytes: 64, maxControlBytes: 131072, maxPayloadBytes: 8192, maxPendingBytes: 32768,
    maxPendingRequests: 16, maxRequestsPerChannel: 4096, maxBufferedBytes: 262144, maxTransferBytes: 16777216, timeoutMs: 10000 };
  const policy = { pollMs: 25, maxPeers: 16, connectTimeoutMs: 10000, grantMs: 60000, maxStageOffersPerPeer: 4, limits: f.limits,
    receiver: { maxAttempts: 64, maxSteps: 10 }, inputChannel: channelPolicy, executionChannel: channelPolicy, controlChannel: channelPolicy,
    inputLimits: { maxInputCharacters: 4096, maxOutputCharacters: 128, maxAttempts: 64, maxConcurrentAttempts: 2, descriptorTtlMs: 60000 } };
  const session = index => ({
    getDescriptor: () => ({ schema: 'doppler.resident-partition/v2', ready: true, modelId: model.id, modelIdentity: model.identity, planId: f.route.planId,
      index, stageCount: count, layerRange: f.plan.partitions[index].layerRange, residentWeightBytes: 64, generationDigest: 'sha256:' + 'c'.repeat(64) }),
    getRecoveryCapabilities: () => ({ schema: 'doppler.resident-recovery/v1', inputReplay: false, checkpointExport: false, checkpointImport: false }),
    tokenize: async ({ identity }) => { tokenized.push(identity.threadId); return { modelIdentity: model.identity, tokenIds: [1, 2], generation: f.request.generation }; },
    async executeStage(request) {
      const hold = holds.get(request.identity.threadId);
      // The final stage holds a held conversation's last step. Its reservation keeps a slot on every
      // stage; other admitted attempts wait behind it for this stage's FIFO execution lease, and once
      // released it needs no stage again, so releases finish attempts one at a time.
      if (index === count - 1 && request.step === f.request.generation.maxTokens - 1 && hold) {
        hold.entered = true; await abortable(hold.release.promise, request.signal);
      }
      const result = { identity: request.identity, partitionIndex: index, step: request.step, tokenPosition: request.tokenPosition, continuation: { step: request.step } };
      if (index === count - 1) return { ...result, tokenId: 10 + request.step, delta: String(request.step), done: request.step === 2, stopReason: 'eos' };
      const tokens = request.inputTokenIds.length;
      return { ...result, activationTensor: { shape: [1, tokens, 8], dtype: 'f32', data: new Float32Array(tokens * 8).fill(index + request.step), seqOffset: request.tokenPosition, step: request.step } };
    },
    closeAttempt: async () => {}, close: async () => {} });
  for (let slot = 0; slot < identities.length; slot++) {
    const stage = slot < count ? f.route.stages[slot] : null;
    const transport = { getPeerBinding: peer => ({ local: `cert-${slot}`, remote: `cert-${peer}` }),
      onDataChannel(label, handler) { listeners[slot].set(label, handler); return () => listeners[slot].delete(label); },
      openDataChannel(peer, label) {
        const target = Number(peer.split('-').at(-1)), receive = listeners[target].get(label);
        if (!receive) throw Error('Endpoint unavailable');
        const pair = channels(); receive(`transport-${slot}`, pair[1]); return pair[0];
      } };
    const loadProgram = async (_model, index, controls) => {
      const resident = createResidentPartition({ runtime: { openResidentPartition: async () => session(index) }, model, plan: f.plan,
        planId: f.route.planId, index, participantId: identities[slot].peerId, limits: { maxAttempts: 64, maxConcurrentAttempts: slots[index] },
        ordered: { runtime: f.runtime, stage: controls.ordered.stage } });
      await resident.prepare({ approved: true }); residents[index] = resident;
      return { model, runtime: f.runtime, plan: f.plan, planId: f.route.planId, resident };
    };
    meshes.push(createAutomaticPartitions({ identity: identities[slot], meshId: 'mesh', models: [model], policy,
      ordered: { stage, maxRouteBytes: 32768, maxSelectionSteps: 256, maxRoutes: 4 },
      peers: () => identities.map((_, i) => ({ id: `transport-${i}`, localTransportId: `transport-${slot}` })).filter(row => row.id !== `transport-${slot}`),
      createNetwork: options => createPartitionNetwork({ ...options, transport, verifyPeer: async peer => identities[Number(peer.split('-').at(-1))].peerId }), loadProgram }));
  }
  const apps = [];
  const selection = r => meshes[count + r].getModels().find(row => row.partition?.schema === 'reploid.partition-selection/v2');
  return {
    f, meshes, residents, tokenized, holds, coordinator: meshes[0],
    async ready() {
      for (const index of [1, 2, 0]) await meshes[index].contribute(model.id, true);
      await vi.waitFor(() => { for (let r = 0; r < requesters; r++) expect(selection(r)).toBeTruthy(); }, { timeout: 15000 });
      for (let r = 0; r < requesters; r++) {
        const planned = selection(r), codes = [];
        const need = remotePermissionNeed({ networkId: 'mesh', sharingScope: 'mesh', disclosure: 'ordered-partition-activations-and-tokens', model: planned });
        const permission = createRemotePermission({ id: 'remote', grantedAt: 1, need, wording: WORDING });
        let saved = null;
        // The requester's host port: the coded failure each attempt returned, beside the workspace's message.
        const app = createChatWorkspace({ meshId: 'mesh', participantId: identities[count + r].peerId, remotePermissions: () => [permission],
          store: { load: () => structuredClone(saved), save: value => { saved = structuredClone(value); } },
          execute: async (request, controls) => {
            try { return await meshes[count + r].generate(request, controls); } catch (error) { codes.push(error.code ?? null); throw error; }
          } });
        apps.push({ app, planned, codes, statuses: new Map() });
        app.subscribe(state => { for (const thread of state.threads) for (const attempt of thread.attempts) {
          const seen = apps[r].statuses.get(thread.id) ?? []; if (seen.at(-1) !== attempt.status) seen.push(attempt.status); apps[r].statuses.set(thread.id, seen);
        } });
      }
    },
    /** Requester `r` sends one message in a new conversation; `hold` keeps it at the final stage once admitted. */
    send(r, { hold = true } = {}) {
      const { app, planned, statuses } = apps[r];
      const threadId = app.createThread({ model: planned, permissions: { sharingScope: 'mesh' } });
      if (hold) holds.set(threadId, { entered: false, released: false, release: Promise.withResolvers() });
      const completion = app.send(threadId, 'Count to three.');
      const attempt = () => app.getState().threads.find(thread => thread.id === threadId).attempts.at(-1);
      return { r, threadId, completion, attempt, statuses: () => statuses.get(threadId) ?? [], codes: apps[r].codes,
        cancel: () => app.cancel(threadId), get admitted() { return tokenized.includes(threadId); } };
    },
    /** Release the conversation now held at the final stage and wait for it to finish; returns its thread. */
    async finishHolder(runs) {
      let held;
      await vi.waitFor(() => { held = [...holds.entries()].find(([, hold]) => hold.entered && !hold.released); expect(held).toBeTruthy(); }, { timeout: 10000 });
      held[1].released = true; held[1].release.resolve();
      expect((await runs.find(run => run.threadId === held[0]).completion).status).toBe('completed');
      return held[0];
    },
    releaseAll() { for (const hold of holds.values()) { hold.released = true; hold.release.resolve(); } },
    activeReservations: index => residents[index].getState().reservations.active,
    reservedAttempts: index => residents[index].getState().reservations.records.filter(row => row.reservedAt !== null).map(row => row.identity.threadId),
    async close() {
      for (const hold of holds.values()) hold.release.resolve();
      const closed = await Promise.allSettled([...apps.map(row => row.app.close()), ...meshes.map(mesh => mesh.close())]);
      await f.runner.close();
      expect(closed.filter(row => row.status === 'rejected')).toEqual([]);
    }
  };
}

describe('coordinator admission queue across real ordered owners', () => {
  it('reproduces placement C cell c3: three requesters, two slots; the third waits as queued, then completes on a freed slot', async () => {
    const m = await orderedMesh({ requesters: 3 });
    try {
      await m.ready();
      const runs = [0, 1, 2].map(r => m.send(r));
      await vi.waitFor(() => { expect(m.tokenized).toHaveLength(2); expect(m.coordinator.getState().queue.queued).toBe(1); }, { timeout: 10000 });
      const waiting = runs.find(run => !run.admitted), admitted = runs.filter(run => run.admitted);
      // While it waits nothing is tokenized, reserved or sent to a stage for it, and every stage keeps two slots charged.
      expect(m.tokenized).not.toContain(waiting.threadId);
      for (const index of [0, 1, 2]) {
        expect(m.activeReservations(index)).toBe(2);
        expect(m.reservedAttempts(index)).not.toContain(waiting.threadId);
      }
      expect(waiting.attempt()).toMatchObject({ status: 'queued', error: null, execution: { placement: 'ordered-layer-partition' } });
      expect(waiting.attempt().execution.identity.route.stages.map(stage => stage.participantId)).toEqual(m.f.route.stages.map(stage => stage.participantId));
      expect(admitted.map(run => run.attempt().status)).toEqual(['executing', 'executing']);
      // A finished attempt frees its slot only after its cleanup settles; the waiting attempt is then admitted.
      await m.finishHolder(runs);
      await vi.waitFor(() => expect(waiting.admitted).toBe(true), { timeout: 10000 });
      m.releaseAll();
      const results = await Promise.all(runs.map(run => run.completion));
      expect(results.map(row => [row.status, row.error])).toEqual([['completed', null], ['completed', null], ['completed', null]]);
      expect(results.every(row => m.f.route.stages.every((stage, index) => row.execution.identity.route.stages[index].participantId === stage.participantId))).toBe(true);
      expect(waiting.statuses().filter(status => ['queued', 'executing', 'completed'].includes(status))).toEqual(['queued', 'executing', 'completed']);
      const finished = results.find(row => row.threadId === waiting.threadId);
      expect(finished.execution.admission.queuedMs).toBeGreaterThan(0);
      expect(results.filter(row => row !== finished).map(row => row.execution.admission.queuedMs)).toEqual([0, 0]);
      expect(m.coordinator.getState().queue).toMatchObject({ queued: 0, admitted: 0, opening: 0 });
      for (const index of [0, 1, 2]) expect(m.activeReservations(index)).toBe(0);
    } finally { await m.close(); }
  }, 30000);

  it('admits waiting requesters in arrival order and refuses one more with CAPACITY_QUEUE_FULL at the requester', async () => {
    const queued = ATTEMPT_QUEUE_POLICY.maxQueuedAttempts;
    const m = await orderedMesh({ requesters: 2 + queued });
    try {
      await m.ready();
      const holding = [m.send(0), m.send(1)];
      await vi.waitFor(() => expect(holding.every(run => run.admitted)).toBe(true), { timeout: 10000 });
      const waiting = [];
      for (let r = 2; r < 2 + queued; r++) {
        waiting.push(m.send(r));
        await vi.waitFor(() => expect(m.coordinator.getState().queue.queued).toBe(waiting.length), { timeout: 10000 });
        expect(waiting.at(-1).attempt().status).toBe('queued');
      }
      // One more attempt (requester 0's second conversation) fails explicitly. The coordinator advertises
      // its full queue, so the requester sends nothing; the coordinator's own bound is the queue tests'.
      await vi.waitFor(() => expect(m.meshes[3].getState().capabilities.find(peer => peer.participantId === m.f.route.stages[0].participantId)
        ?.description?.capacity?.attemptQueue).toEqual({ queued, maxQueued: queued }), { timeout: 10000 });
      const overflow = m.send(0, { hold: false });
      const refused = await overflow.completion;
      expect(refused).toMatchObject({ status: 'failed', error: failureMessages.CAPACITY_QUEUE_FULL });
      expect(overflow.codes).toEqual(['CAPACITY_QUEUE_FULL']);
      expect(m.tokenized).not.toContain(overflow.threadId);
      expect(m.coordinator.getState().queue.queued).toBe(queued);
      // Each finished attempt's freed slot admits the earliest waiting requester, and only that one.
      const all = [...holding, ...waiting];
      for (const [index, run] of waiting.entries()) {
        await m.finishHolder(all);
        await vi.waitFor(() => expect(run.admitted).toBe(true), { timeout: 10000 });
        expect(m.tokenized).toHaveLength(3 + index);
        expect(waiting.slice(index + 1).every(later => later.attempt().status === 'queued')).toBe(true);
      }
      m.releaseAll();
      expect(m.tokenized.slice(2)).toEqual(waiting.map(run => run.threadId));
      const results = await Promise.all([...holding, ...waiting].map(run => run.completion));
      expect(results.every(row => row.status === 'completed')).toBe(true);
      expect(m.coordinator.getState().queue).toMatchObject({ queued: 0, admitted: 0 });
    } finally { await m.close(); }
  }, 60000);

  it('removes a cancelled waiting attempt, settling nothing because nothing was reserved, while admitted work continues', async () => {
    const m = await orderedMesh({ requesters: 3 });
    try {
      await m.ready();
      const holding = [m.send(0), m.send(1)];
      await vi.waitFor(() => expect(holding.every(run => run.admitted)).toBe(true), { timeout: 10000 });
      const waiting = m.send(2);
      await vi.waitFor(() => expect(m.coordinator.getState().queue.queued).toBe(1), { timeout: 10000 });
      await waiting.cancel();
      expect((await waiting.completion).status).toBe('cancelled');
      await vi.waitFor(() => expect(m.coordinator.getState().queue).toMatchObject({ queued: 0, admitted: 2 }), { timeout: 10000 });
      expect(m.tokenized).not.toContain(waiting.threadId);
      for (const index of [0, 1, 2]) expect(m.reservedAttempts(index)).not.toContain(waiting.threadId);
      expect(m.coordinator.getState().attempts.map(row => row.identity.threadId)).not.toContain(waiting.threadId);
      m.releaseAll();
      expect((await Promise.all(holding.map(run => run.completion))).map(row => row.status)).toEqual(['completed', 'completed']);
    } finally { await m.close(); }
  }, 30000);

  it('carries a remote stage\'s slot refusal to the requester as CAPACITY_UNAVAILABLE, never the generic failure', async () => {
    // The middle stage admits one attempt while the coordinator admits two: its refusal crosses the
    // ordered peer channel, the coordinator's runner and entry, and the requester's entry.
    const m = await orderedMesh({ requesters: 2, slots: [2, 1, 2] });
    try {
      await m.ready();
      const held = m.send(0);
      await vi.waitFor(() => expect(m.holds.get(held.threadId).entered).toBe(true), { timeout: 10000 });
      const refused = await m.send(1, { hold: false }).completion;
      expect(refused).toMatchObject({ status: 'failed', error: failureMessages.CAPACITY_UNAVAILABLE });
      expect(refused.error).not.toBe(failureMessages.EXECUTION_FAILED);
      const receipt = m.coordinator.getState().attempts.find(row => row.identity.threadId === refused.threadId);
      expect(receipt).toMatchObject({ phase: 'failed', cleanup: [{ status: 'settled' }, { status: 'settled' }] });
      expect(m.activeReservations(1)).toBe(1);
      m.releaseAll();
      expect((await held.completion).status).toBe('completed');
      for (const index of [0, 1, 2]) expect(m.activeReservations(index)).toBe(0);
    } finally { await m.close(); }
  }, 30000);
});

describe('ordered chat admission bounds (injected stage ports, explicit test queue policy)', () => {
  const testPolicy = maxQueueWaitMs => ({ schema: ATTEMPT_QUEUE_POLICY_SCHEMA, maxQueuedAttempts: 4, maxQueuedPerRequester: 4, maxQueueWaitMs });
  async function chat(queuePolicy) {
    const f = stageFixture(3, 1), signer = await createSigningIdentity({ algorithm: 'ECDSA' }), holds = new Map(), states = new Map();
    f.route.stages[0].participantId = signer.peerId; f.stages[0].id = signer.peerId;
    f.stages.forEach((stage, index) => Object.assign(stage, { index, getState: () => ({ ready: true }), subscribe: () => () => {}, refresh: vi.fn(async () => ({ ready: true })) }));
    f.stages[0].tokenize = vi.fn(async ({ identity }) => { f.calls.push(['tokenize', 0, identity.attemptId]); return { modelIdentity: f.route.modelIdentity, tokenIds: [1, 2], generation: f.request.generation }; });
    const compute = f.stages[2].executeStage.getMockImplementation();
    f.stages[2].executeStage.mockImplementation(async args => {
      const hold = holds.get(args.identity.attemptId);
      if (hold && args.step === 1) { hold.entered.resolve(); await abortable(hold.release.promise, args.signal); }
      return compute(args);
    });
    const grants = createPartitionGrantAuthority({ identity: signer, meshId: 'mesh', maxGrants: 20, maxTtlMs: 60000 }), issued = [];
    const authority = { ...grants, issueOrdered: (identity, ...rest) => { issued.push(identity.attemptId); return grants.issueOrdered(identity, ...rest); } };
    const owner = createPartitionChat({ runtime: f.runtime, model: { id: 'model', name: 'Fixture', identity: f.route.modelIdentity }, authority,
      plan: f.plan, planId: f.route.planId, limits: f.limits, grantTtlMs: 60000, authorizeRequester: async () => true,
      ordered: { route: f.route, stages: f.stages, queue: createPartitionAttemptQueue({ policy: queuePolicy }) } });
    const generate = (attemptId, extra = {}) => {
      states.set(attemptId, []);
      return owner.generate({ meshId: 'mesh', participantId: 'requester', threadId: attemptId, attemptId, placementGeneration: 0,
        model: owner.getModels()[0], messages: [{ role: 'user', content: 'hi' }], permissions: { sharingScope: 'approved-partition-path' }, ...extra },
      { requestApproval: async () => true, onDelta: () => {}, onState: value => states.get(attemptId).push(value.status) });
    };
    const hold = attemptId => { const value = { entered: Promise.withResolvers(), release: Promise.withResolvers() }; holds.set(attemptId, value);
      return { entered: value.entered.promise, release: () => value.release.resolve() }; };
    return { f, owner, generate, hold, states, issued, touched: attemptId => f.calls.some(row => row[2] === attemptId) };
  }

  it('fails a wait at the policy bound, or first at the requester\'s disclosure deadline, before tokenization, grant or reservation', async () => {
    const c = await chat(testPolicy(150));
    await c.owner.refresh();
    const gate = c.hold('a'), running = c.generate('a');
    await gate.entered;
    await expect(c.generate('b')).rejects.toMatchObject({ code: 'CAPACITY_QUEUE_TIMEOUT', bound: 'policy', message: failureMessages.CAPACITY_QUEUE_TIMEOUT });
    await expect(c.generate('c', { disclosureExpiresAt: Date.now() + 40 }))
      .rejects.toMatchObject({ code: 'CAPACITY_QUEUE_TIMEOUT', bound: 'authorization' });
    for (const id of ['b', 'c']) {
      expect(c.touched(id)).toBe(false);
      expect(c.states.get(id)).toEqual(['queued']);
    }
    expect(c.issued).toEqual(['a']);
    // Only the running attempt holds an opening; the timed-out waits left none.
    expect(c.owner.getState()).toMatchObject({ pendingInputs: 1, unsettledInputs: 1 });
    gate.release();
    expect((await running).content).toBe('012');
    expect(c.states.get('a')).toEqual(['executing']);
    await c.owner.close(); await c.f.runner.close();
  });

  it('refuses attempts waiting for a closing route as unavailable capacity; they never move to another route', async () => {
    const c = await chat(testPolicy(60000));
    await c.owner.refresh();
    const gate = c.hold('a'), running = c.generate('a');
    await gate.entered;
    const waiting = c.generate('b');
    await vi.waitFor(() => expect(c.states.get('b')).toEqual(['queued']));
    const closing = c.owner.close();
    await expect(waiting).rejects.toMatchObject({ code: 'CAPACITY_UNAVAILABLE', message: failureMessages.CAPACITY_UNAVAILABLE });
    await expect(running).rejects.toThrow();
    await closing;
    expect(c.touched('b')).toBe(false);
    await c.f.runner.close();
  });
});
