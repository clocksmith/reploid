import { describe, it, expect, vi, afterEach } from 'vitest';
import * as runtime from 'doppler-gpu/partitions';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority, createResidentPartition, createPartitionPeer, createLayerPartitionRunner,
  createPartitionChat, createPartitionNetwork, partitionFingerprint } from '../../packages/reploid/src/mesh/index.js';
import { createPartitionEntry, createPartitionRequester } from '../../packages/reploid/src/mesh/partitions/partition-entry.js';
import { disclosureScope, matchingThreadGrant } from '../../packages/reploid/src/chat/thread-grants.js';
import { createChatSession } from '../../self/host/chat-session.js';
import { createPartitionRuntimeFixture } from '../fixtures/partition-runtime.js';

const policy = { maxTokens: 4, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 1024,
  maxAttempts: 32, maxConcurrentAttempts: 4 };
const generation = { maxTokens: 4, maxSeqLen: 128, temperature: 0, topK: 0, topP: 1,
  repetitionPenalty: 1, repetitionPenaltyWindow: 0, presencePenalty: 0, useChatTemplate: false };
const channelPolicy = { maxFrameBytes: 64, maxControlBytes: 8192, maxPayloadBytes: 4096, maxPendingBytes: 16384,
  maxPendingRequests: 8, maxRequestsPerChannel: 128, maxBufferedBytes: 16384, maxTransferBytes: 1048576, timeoutMs: 1000 };
const cleanup = [];
afterEach(async () => { await Promise.allSettled(cleanup.splice(0).reverse().map(close => close())); });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, {
    readyState: 'open', ordered: true, maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); },
  }));
  return pair;
}
async function fixture(options = {}) {
  const [a, b] = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
  const makeAuthority = identity => createPartitionGrantAuthority({ identity, meshId: 'mesh', maxGrants: 32, maxTtlMs: 10000 });
  const authority = makeAuthority(a), otherAuthority = makeAuthority(b);
  const model = { id: 'fixture', name: 'Injected partition model', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64),
    generation, adapters: [] };
  const plan = runtime.createLayerPartitionPlan({ modelId: model.id, numLayers: 4, hiddenSize: 8, vocabSize: 128, splitLayer: 2 });
  const planId = runtime.hashLayerPartitionPlan(plan);
  const factory = createPartitionRuntimeFixture(options);
  const makeResident = (index, participantId) => createResidentPartition({ runtime: factory, model, plan, planId, index, participantId, limits: { ...policy, ...options.limits } });
  const local = makeResident(0, a.peerId), supplier = makeResident(1, b.peerId);
  const [left, right] = channels();
  const base = { runtime, plan, planId, modelIdentity: model.identity, limits: channelPolicy, receiverLimits: { maxAttempts: 32, maxSteps: 8 } };
  const remote = createPartitionPeer({ ...base, channel: left, localParticipantId: a.peerId, remoteParticipantId: b.peerId, authority });
  const server = createPartitionPeer({ ...base, channel: right, localParticipantId: b.peerId, remoteParticipantId: a.peerId,
    authority: otherAuthority, contributor: supplier });
  const chat = createPartitionChat({ runtime, local, remote, authority, model, plan, planId, limits: policy, grantTtlMs: 10000, authorizeRequester: options.authorizeRequester });
  cleanup.push(() => Promise.all([local.close(), supplier.close()]), () => Promise.all([remote.close(), server.close()]), () => chat.close());
  const binding = { modelId: model.id, modelIdentity: model.identity, planId, participantA: a.peerId, participantB: b.peerId,
    threadId: 'thread', attemptId: 'attempt' };
  return { authority, otherAuthority, local, supplier, remote, server, chat, factory, model, plan, planId,
    generation, generationDigest: await partitionFingerprint(generation), binding, a, b };
}
function host(f, storage = null) {
  const session = createChatSession({ partitions: f.chat, storage, models: [f.model], participantId: f.a.peerId, meshId: 'mesh',
    service: { open() { throw new Error('Whole-model fallback forbidden'); } } });
  cleanup.push(() => session.close());
  return session;
}
function approve(session, threadId, remember = true) {
  const attempt = session.getState().threads.find(t => t.id === threadId).attempts.at(-1);
  session.approve(threadId, attempt.id, attempt.approval.id, true, { remember });
}

describe('Reploid partition APIs with injected Doppler sessions', () => {
  it('keeps imports inert and requires explicit contribution before readiness', async () => {
    const f = await fixture();
    await f.chat.refresh();
    expect(f.factory.log.opens).toEqual([]);
    expect(f.chat.getModels()[0].availability).toBe('unavailable');
    expect(() => f.local.prepare({ approved: false })).toThrow('approval');
    await Promise.all([f.local.prepare({ approved: true }), f.local.prepare({ approved: true })]);
    expect(f.factory.log.opens).toEqual([0]);
    await f.chat.refresh(); expect(f.chat.getModels()[0].availability).toBe('unavailable');
    await f.supplier.prepare({ approved: true }); await f.chat.refresh();
    expect(f.chat.getModels()[0].availability).toBe('ready');
  });

  it('verifies signatures, exact attempt/recipient/plan binding, expiry, revocation and cleanup authority', async () => {
    const f = await fixture();
    const grant = await f.authority.issue(f.binding, policy, { approved: true, ttlMs: 10000,
      disclosure: 'partition-activations-and-tokens', generationDigest: f.generationDigest });
    const request = { identity: f.binding, action: 'mesh.execute_partition_b', step: 0, inputTokenCount: 1,
      generationDigest: f.generationDigest };
    expect(await f.otherAuthority.verify(grant, request)).toBe(true);
    expect(await f.otherAuthority.verify(grant, { ...request, generationDigest: await partitionFingerprint({ ...f.generation, temperature: 1 }) })).toBe(false);
    const activationOnly = await f.authority.issue(f.binding, policy, { approved: true, ttlMs: 10000,
      disclosure: 'partition-activations', generationDigest: f.generationDigest });
    expect(await f.otherAuthority.verify(activationOnly, { ...request, action: 'mesh.transfer_intermediate_activation' })).toBe(true);
    expect(await f.otherAuthority.verify(activationOnly, { ...request, action: 'mesh.transfer_token_context' })).toBe(false);
    for (const key of ['threadId', 'attemptId', 'planId', 'participantB', 'modelIdentity']) {
      expect(await f.otherAuthority.verify(grant, { ...request, identity: { ...f.binding, [key]: 'wrong' } })).toBe(false);
    }
    const changed = structuredClone(grant); changed.claim.limits.maxTokens++;
    expect(await f.otherAuthority.verify(changed, request)).toBe(false);
    expect(await f.otherAuthority.verify(grant, { ...request, step: policy.maxTokens })).toBe(false);
    expect(await f.otherAuthority.verify(grant, { ...request, activationBytes: policy.maxActivationBytes + 1 })).toBe(false);
    f.authority.revoke(grant);
    expect(await f.authority.verify(grant, request)).toBe(false);
    expect(await f.authority.verify(grant, request, { settlement: true })).toBe(true);
    const expired = createPartitionGrantAuthority({ identity: f.b, meshId: 'mesh', maxGrants: 1, maxTtlMs: 10000,
      now: () => grant.claim.expiresAt });
    expect(await expired.verify(grant, request)).toBe(false);
    expect(await expired.verify(grant, request, { settlement: true })).toBe(true);
  });

  it('admits immediate reservations within explicit clock skew without extending expiry', async () => {
    const f = await fixture();
    let clock = 1000;
    const issuer = createPartitionGrantAuthority({ identity: f.a, meshId: 'mesh', maxGrants: 1,
      maxTtlMs: 10000, now: () => 1008 });
    const strict = createPartitionGrantAuthority({ identity: f.b, meshId: 'mesh', maxGrants: 1,
      maxTtlMs: 10000, now: () => clock });
    const receiver = createPartitionGrantAuthority({ identity: f.b, meshId: 'mesh', maxGrants: 1,
      maxTtlMs: 10000, maxClockSkewMs: 250, now: () => clock });
    const grant = await issuer.issue(f.binding, policy, { approved: true, ttlMs: 10000,
      disclosure: 'partition-activations-and-tokens', generationDigest: f.generationDigest });
    const request = { identity: f.binding, action: 'mesh.execute_partition_b', step: 0,
      inputTokenCount: 1, generationDigest: f.generationDigest };
    expect(await strict.verify(grant, request)).toBe(false);
    expect(await receiver.verify(grant, request)).toBe(true);
    clock = grant.claim.issuedAt - 251;
    expect(await receiver.verify(grant, request)).toBe(false);
    clock = grant.claim.expiresAt;
    expect(await receiver.verify(grant, request)).toBe(false);
    expect(await receiver.verify(grant, request, { settlement: true })).toBe(true);
  });

  it('streams two conversations through the host, reuses resident weights and remembers scoped disclosure', async () => {
    const f = await fixture(); await Promise.all([f.local.prepare({ approved: true }), f.supplier.prepare({ approved: true })]);
    await f.chat.refresh(); const session = host(f);
    const selection = f.chat.getModels()[0];
    const a = session.createThread({ model: selection }), b = session.createThread({ model: selection });
    const pending = [session.send(a, '1'), session.send(b, '10')];
    await vi.waitFor(() => expect(session.getState().threads.every(t => t.attempts[0].approval)).toBe(true));
    expect(f.factory.log.steps).toEqual([]);
    approve(session, a); approve(session, b);
    expect((await Promise.all(pending)).map(r => r.status)).toEqual(['completed', 'completed']);
    expect(session.getState().threads.map(t => t.messages.at(-1).content)).toEqual(['2 3 4 ', '11 12 13 ']);
    expect(f.factory.log.opens.sort()).toEqual([0, 1]);
    expect(f.factory.log.steps.every(step => step.maxTokens === policy.maxTokens)).toBe(true);
    const order = f.factory.log.steps.filter(s => s.index === 0).map(s => s.threadId);
    expect(new Set(order.slice(0, 2))).toEqual(new Set([a, b]));
    expect(order).toEqual([...order.slice(0, 2), ...order.slice(0, 2), ...order.slice(0, 2)]);
    expect((await session.send(a, '20')).status).toBe('completed');
    expect(session.getState().threads[0].attempts[1].authorization.kind).toBe('thread-grant');
    expect(f.factory.log.tokenizations.at(-1)).toEqual([{ role: 'user', content: '1' }, { role: 'assistant', content: '2 3 4 ' }, { role: 'user', content: '20' }]);
    expect(f.factory.log.closes).toEqual([]);
    expect(f.remote.getState().receipt.sentFrames).toBeGreaterThan(9);
  });

  it('forwards a lower request limit through authenticated binary transfer to the resident executor', async () => {
    const f = await fixture();
    await Promise.all([f.local.prepare({ approved: true }), f.supplier.prepare({ approved: true })]);
    await f.remote.refresh();
    const shortened = { ...f.generation, maxTokens: 2 };
    const grant = await f.authority.issue(f.binding, policy, { approved: true, ttlMs: 10000,
      disclosure: 'partition-activations-and-tokens', generationDigest: await partitionFingerprint(shortened) });
    const runner = createLayerPartitionRunner({ runtime, plan: f.plan, deviceA: f.local, deviceB: f.remote,
      limits: policy, authorize: request => f.authority.verify(request.grant, {
        ...request, identity: f.binding
      }) });
    cleanup.push(() => runner.close());
    const result = await runner.execute({ tokenIds: [1], generation: shortened, identity: f.binding, maxTokens: 2,
      grants: { executionA: grant, executionB: grant, activation: grant, tokenContext: grant, output: grant } });
    expect(result.content).toBe('2 3 ');
    expect(result.stopReason).toBe('max-tokens');
    expect(f.factory.log.steps.map(step => [step.index, step.maxTokens])).toEqual([[0, 2], [1, 2], [0, 2], [1, 2]]);
  });

  it('refuses an activation-only grant before sending prompt token context or computing a step', async () => {
    const f = await fixture();
    await Promise.all([f.local.prepare({ approved: true }), f.supplier.prepare({ approved: true })]);
    await f.remote.refresh();
    const grant = await f.authority.issue(f.binding, policy, { approved: true, ttlMs: 10000,
      disclosure: 'partition-activations', generationDigest: f.generationDigest });
    const runner = createLayerPartitionRunner({ runtime, plan: f.plan, deviceA: f.local, deviceB: f.remote,
      limits: policy, authorize: request => f.authority.verify(request.grant, { ...request, identity: f.binding }) });
    cleanup.push(() => runner.close());
    await expect(runner.execute({ tokenIds: [1], generation: f.generation, identity: f.binding,
      maxTokens: f.generation.maxTokens,
      grants: { executionA: grant, executionB: grant, activation: grant, tokenContext: grant, output: grant } }))
      .rejects.toThrow('mesh.transfer_token_context');
    expect(f.factory.log.steps).toEqual([]);
  });

  it.each(['missing', 'over-budget', 'mismatched'])('rejects a %s remote token limit before computation', async kind => {
    const f = await fixture();
    await f.supplier.prepare({ approved: true });
    const grant = await f.authority.issue(f.binding, policy, { approved: true, ttlMs: 10000,
      disclosure: 'partition-activations-and-tokens', generationDigest: f.generationDigest });
    const maxTokens = kind === 'missing' ? undefined : kind === 'over-budget' ? policy.maxTokens + 1 : 2;
    const frame = runtime.serializeActivationFrame({ shape: [1, 1, f.plan.hiddenSize], dtype: 'f32',
      data: new Float32Array(f.plan.hiddenSize), step: 0, seqOffset: 0,
      metadata: { ...f.binding, maxTokens: kind === 'mismatched' ? 1 : maxTokens,
        from: f.a.peerId, to: f.b.peerId } });
    await expect(f.remote.executeFrame({ frame, identity: f.binding, continuation: null,
      step: 0, tokenPosition: 0, inputTokenCount: 1, maxTokens,
      executionGrant: grant, outputGrant: grant, signal: new AbortController().signal })).rejects.toThrow();
    expect(f.factory.log.steps).toEqual([]);
  });

  it('revokes a live conversation and waits for remote settlement without mixing another attempt', async () => {
    const entered = gate(), release = gate();
    let held = true;
    cleanup.push(() => release.resolve());
    const f = await fixture({ beforeStep: async (_request, index) => {
      if (index === 1 && held) { held = false; entered.resolve(); await release.promise; }
    } });
    await Promise.all([f.local.prepare({ approved: true }), f.supplier.prepare({ approved: true })]);
    await f.chat.refresh(); const session = host(f), id = session.createThread({ model: f.chat.getModels()[0] });
    const first = session.send(id, '1');
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[0].approval).toBeTruthy());
    approve(session, id); await entered.promise;
    session.revokeGrant(id, session.getState().activeThread.grants[0].id);
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[0].status).toBe('cancelling'));
    release.resolve(); expect((await first).status).toBe('cancelled');
    expect(f.factory.log.settlements.filter(s => s.index === 1)).toHaveLength(1);
    const next = session.send(id, '10');
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[1].approval).toBeTruthy());
    approve(session, id); expect((await next).status).toBe('completed');
    expect(session.getState().activeThread.messages.at(-1).content).toBe('11 12 13 ');
  });

  it('shares admission across independent channels and holds capacity until cleanup settles', async () => {
    const f = await fixture({ limits: { maxConcurrentAttempts: 1 } });
    await f.supplier.prepare({ approved: true });
    const [left, right] = channels();
    const base = { runtime, plan: f.plan, planId: f.planId, modelIdentity: f.model.identity,
      limits: channelPolicy, receiverLimits: { maxAttempts: 32, maxSteps: 8 } };
    const second = createPartitionPeer({ ...base, channel: left, localParticipantId: f.a.peerId,
      remoteParticipantId: f.b.peerId, authority: f.authority });
    const server = createPartitionPeer({ ...base, channel: right, localParticipantId: f.b.peerId,
      remoteParticipantId: f.a.peerId, authority: f.otherAuthority, contributor: f.supplier });
    cleanup.push(() => Promise.all([second.close(), server.close()]));
    const reserve = async (peer, identity) => {
      const grant = await f.authority.issue(identity, policy, { approved: true, ttlMs: 10000,
        disclosure: 'partition-activations-and-tokens', generationDigest: f.generationDigest });
      return peer.reserve({ identity, grant, generation: f.generation,
        generationDigest: f.generationDigest, inputTokenCount: 1 });
    };
    const other = { ...f.binding, attemptId: 'other', threadId: 'other' };
    await reserve(f.remote, f.binding);
    await expect(reserve(second, other)).rejects.toThrow('capacity exhausted');
    expect(f.factory.log.steps).toEqual([]);
    expect(f.supplier.getState().reservations.active).toBe(1);
    await f.remote.closeAttempt({ identity: f.binding });
    expect(f.supplier.getState().reservations.records[0]).toMatchObject({ phase: 'settled', settledAt: expect.any(Number) });
    const fresh = { ...other, attemptId: 'fresh' };
    await reserve(second, fresh);
    await second.close(); await server.close();
    expect(f.supplier.getState().reservations.active).toBe(0);
    expect(f.supplier.getState().ready).toBe(true);
  });

  it('does not release a reservation on failed cleanup, and records full-owner settlement', async () => {
    const f = await fixture({ limits: { maxConcurrentAttempts: 1 } });
    const open = f.factory.openResidentPartition;
    const entered = gate(), release = gate();
    cleanup.push(() => release.resolve());
    f.factory.openResidentPartition = async options => {
      const session = await open(options);
      return { ...session, async closeAttempt() { entered.resolve(); await release.promise; throw new Error('cleanup refused'); } };
    };
    await f.local.prepare({ approved: true });
    f.local.reserve(f.binding);
    const closing = f.local.closeAttempt({ identity: f.binding });
    const rejected = expect(closing).rejects.toThrow('cleanup refused');
    await entered.promise;
    expect(f.local.getState().reservations).toMatchObject({ active: 1, availableSlots: 0 });
    expect(() => f.local.reserve({ ...f.binding, attemptId: 'next' })).toThrow('capacity exhausted');
    release.resolve(); await rejected;
    expect(f.local.getState().reservations.records[0]).toMatchObject({ phase: 'settling', settledAt: null, failure: 'cleanup refused' });
    await f.local.close();
    expect(f.local.getState().reservations).toMatchObject({ active: 0, closed: true });
    expect(f.local.getState().reservations.records[0]).toMatchObject({ phase: 'failed', settledAt: expect.any(Number) });
  });

  it('prevents a delayed reservation from reopening an already cancelled attempt', async () => {
    const f = await fixture();
    await f.local.prepare({ approved: true });
    await f.local.closeAttempt({ identity: f.binding });
    expect(() => f.local.reserve(f.binding)).toThrow('retired');
    expect(f.local.getState().reservations.active).toBe(0);
  });

  it('rejects unavailable split selection without loading a whole model', async () => {
    const f = await fixture(), session = host(f);
    const id = session.createThread({ model: f.chat.getModels()[0] });
    const result = await session.send(id, '1');
    expect(result.status).toBe('failed'); expect(result.error).toContain('No ready contributors');
    expect(f.factory.log.opens).toEqual([]);
  });

  it('settles a model that finishes opening after contribution is stopped', async () => {
    const f = await fixture(), entered = gate(), release = gate();
    const open = f.factory.openResidentPartition;
    f.factory.openResidentPartition = async options => { entered.resolve(); await release.promise; return open(options); };
    const preparing = f.local.prepare({ approved: true });
    const rejected = expect(preparing).rejects.toThrow('stopped');
    await entered.promise;
    const stopping = f.local.close();
    expect(f.local.getState().ready).toBe(false);
    release.resolve(); await rejected; await stopping;
    expect(f.factory.log.closes).toEqual([0]);
    expect(f.local.getState().phase).toBe('closed');
  });

  it('retires a session whose loaded identity changes without calling its executor', async () => {
    const f = await fixture(), open = f.factory.openResidentPartition;
    let corrupt = false;
    f.factory.openResidentPartition = async options => {
      const session = await open(options), descriptor = session.getDescriptor;
      return { ...session, getDescriptor: () => ({ ...descriptor(), ...(corrupt ? { modelIdentity: 'wrong' } : {}) }) };
    };
    await f.local.prepare({ approved: true }); corrupt = true;
    await expect(f.local.tokenize({ messages: [], identity: f.binding, signal: new AbortController().signal })).rejects.toThrow('identity');
    expect(f.local.getState().ready).toBe(false);
    expect(f.factory.log.tokenizations).toEqual([]);
    expect(f.factory.log.closes).toEqual([0]);
  });

  it('does not reuse activation disclosure for another plan, recipient or whole-prompt request', async () => {
    const f = await fixture(), model = f.chat.getModels()[0];
    const request = { model, permissions: { sharingScope: 'invited-mesh' } };
    const preview = { modelId: model.id, modelIdentity: model.identity, adapterIdentities: [],
      recipientIdentity: f.b.peerId, operation: 'generate-partition', disclosure: 'partition-activations-and-tokens', ...model.partition };
    const scope = disclosureScope(request, preview);
    expect(scope).toBeTruthy();
    expect(disclosureScope(request, { ...preview, disclosure: 'partition-activations' })).toBeNull();
    const grants = [{ ...scope, revokedAt: null }];
    expect(matchingThreadGrant(grants, scope)).toBeTruthy();
    expect(matchingThreadGrant(grants, { ...scope, planId: 'different' })).toBeUndefined();
    expect(matchingThreadGrant(grants, { ...scope, recipientIdentity: f.a.peerId })).toBeUndefined();
    expect(matchingThreadGrant(grants, { ...scope, disclosure: 'public' })).toBeUndefined();
  });

  it('rejects certificate replacement during network authentication and settles connection cancellation', async () => {
    for (const replacement of [true, false]) {
      const [channel] = channels();
      let binding = { local: 'local', remote: 'remote' };
      const createEndpoint = vi.fn();
      const network = createPartitionNetwork({ maxPeers: 1, timeoutMs: 1000, createEndpoint,
        transport: { onDataChannel: () => () => {}, openDataChannel: () => channel, getPeerBinding: () => binding },
        verifyPeer: async (_peerId, signal) => {
          if (replacement) { binding = { local: 'local', remote: 'replacement' }; return 'peer:' + 'a'.repeat(24); }
          await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }));
        } });
      const pending = network.connect('peer-id');
      const rejected = expect(pending).rejects.toThrow(replacement ? 'certificate changed' : 'cancelled');
      if (!replacement) await network.close();
      await rejected; await network.close();
      expect(createEndpoint).not.toHaveBeenCalled(); expect(channel.readyState).toBe('closed');
    }
  });

  it.each([false, true])('shares pending endpoint settlement across repeated shutdowns, peer loss: %s', async lost => {
    const [channel] = channels(), release = gate();
    const endpoint = { close: () => release.promise };
    const network = createPartitionNetwork({ maxPeers: 1, timeoutMs: 1000,
      transport: { onDataChannel: () => () => {}, openDataChannel: () => channel,
        getPeerBinding: () => ({ local: 'local', remote: 'remote' }) },
      verifyPeer: async () => 'peer:' + 'a'.repeat(24), createEndpoint: () => endpoint });
    const connecting = network.connect('peer-id');
    channel.dispatchEvent(new MessageEvent('message', { data: 'reploid.partition-channel-ready/v1' }));
    await connecting;
    if (lost) channel.close();
    const first = network.close(), second = network.close();
    expect(second).toBe(first);
    let settled = false; second.then(() => { settled = true; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false);
    release.resolve(); await second; expect(settled).toBe(true);
  });
});


describe('weightless requester entry', () => {
  async function entryFixture(options = {}) {
    const requesterId = 'requester';
    const f = await fixture({ ...options, authorizeRequester: async request => request.participantId === requesterId });
    await f.local.prepare({ approved: true }); await f.supplier.prepare({ approved: true }); await f.chat.refresh();
    const [left, right] = channels();
    const inputLimits = { maxInputCharacters: 1000, maxOutputCharacters: 1024, maxAttempts: 16,
      maxConcurrentAttempts: 2, descriptorTtlMs: 1000 };
    const base = { limits: channelPolicy, inputLimits, authorize: async m => m.requesterId === requesterId && m.participantB === f.b.peerId };
    const entry = createPartitionEntry({ ...base, channel: left, localParticipantId: requesterId, remoteParticipantId: f.a.peerId });
    const server = createPartitionEntry({ ...base, channel: right, localParticipantId: f.a.peerId, remoteParticipantId: requesterId, service: f.chat });
    cleanup.push(() => Promise.all([entry.close(), server.close()]));
    const requester = createPartitionRequester({ entries: () => [entry], requesterId, meshId: 'mesh', modelId: f.model.id,
      modelIdentity: f.model.identity, planId: f.planId, maxPlacements: 1, authorize: async () => true });
    return { ...f, entry, server, requester };
  }
  it('runs A and B without any requester runtime, retaining requester and generation binding', async () => {
    const f = await entryFixture();
    const result = await f.requester.generate({ messages: [{role:'user',content:'10'}], threadId:'requester-thread' });
    expect(result.content).toBeTruthy();
    expect(result.execution.requesterId).toBe('requester');
    expect(result.execution.participantA).toBe(f.a.peerId);
    expect(result.execution.participantB).toBe(f.b.peerId);
    expect(result.execution.activationBytes).toBeGreaterThan(0);
    expect(result.execution.placementGeneration).toBe(0);
    expect(f.factory.log.opens).toEqual([0,1]);
  });
  it('drains a resident without cancelling an already admitted generation', async () => {
    const held = gate(), entered = gate();
    const f = await entryFixture({ beforeStep: async (_request, index) => { if(index===1){entered.resolve();await held.promise;} } });
    const generation = f.requester.generate({ messages:[{role:'user',content:'10'}],threadId:'drain' });
    await entered.promise;
    const draining = f.supplier.drain();
    expect(f.supplier.getState().phase).toBe('draining');
    expect(f.supplier.canAccept({...f.binding,attemptId:'unrelated'})).toBe(false);
    await f.chat.refresh();
    expect(f.chat.getModels()[0].availability).toBe('unavailable');
    held.resolve();
    expect((await generation).content).toBeTruthy(); await draining;
    expect(f.supplier.getState().phase).toBe('closed');
    expect(f.local.getState().ready).toBe(true);
  });
  it('keeps shared weights available after a single malformed input fails', async () => {
    const f = await entryFixture();
    await expect(f.requester.generate({ messages:[{role:'user',content:'not a number'}],threadId:'bad' })).rejects.toThrow();
    expect(f.local.getState().ready).toBe(true);
    expect(f.local.getState().activeAttempts).toBe(0);
    expect(f.factory.log.closes).toEqual([]);
    const result = await f.requester.generate({ messages:[{role:'user',content:'10'}],threadId:'healthy' });
    expect(result.content).toBe('11 12 13 ');
  });
  it('restarts using a new identity on a separately approved replacement', async () => {
    const calls = [];
    const model={id:'m',identity:'sha256:'+ 'b'.repeat(64),availability:'ready',partition:{planId:'p',participantB:'b'}};
    const entries=['a1','a2'].map(id=>({id,refresh:async()=>({ready:true,descriptor:{models:[model]}}),
      generate:async request=>{calls.push(request);if(id==='a1')throw Error('executor lost');return {content:'ok',execution:request};}}));
    const requester=createPartitionRequester({entries:()=>entries,requesterId:'r',meshId:'mesh',modelId:'m',modelIdentity:model.identity,
      planId:'p',maxPlacements:2,authorize:async()=>true});
    const result=await requester.generate({messages:[{role:'user',content:'go'}],threadId:'t'});
    expect(result.recovery.attempts).toBe(2);expect(calls[0].attemptId).not.toBe(calls[1].attemptId);
    expect(calls[1].placementGeneration).toBe(1);
  });
});

describe('automatic cooperative placement', () => {
  it.each([false, true])('discovers cooperative executors with replica coverage=%s', async replicate => {
    const { createAutomaticPartitions } = await import('../../packages/reploid/src/mesh/partitions/automatic-partitions.js');
    const identities = await Promise.all(Array.from({ length: replicate ? 4 : 3 }, () => createSigningIdentity({ algorithm: 'ECDSA' })));
    const registry = new Map(), meshes = [], factories = [], loaded = [];
    const model = { id: 'fixture', name: 'Injected partition model', provider: 'doppler',
      identity: 'sha256:' + 'a'.repeat(64), generation, adapters: [] };
    const plan = runtime.createLayerPartitionPlan({ modelId: model.id, numLayers: 4, hiddenSize: 8, vocabSize: 128 });
    const planId = runtime.hashLayerPartitionPlan(plan);
    const config = { pollMs: 10, maxPeers: 4, connectTimeoutMs: 1000, grantMs: 10000, limits: policy,
      inputChannel: channelPolicy, executionChannel: channelPolicy, controlChannel: channelPolicy,
      receiver: { maxAttempts: 32, maxSteps: 8 },
      inputLimits: { maxInputCharacters: 1000, maxOutputCharacters: 1024, maxAttempts: 16,
        maxConcurrentAttempts: 2, descriptorTtlMs: 1000 } };
    for (const [index, identity] of identities.entries()) {
      const factory = createPartitionRuntimeFixture(); factories.push(factory);
      const networks = new Map(); registry.set(String(index), networks);
      meshes.push(createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], policy: config,
        peers: () => identities.map((_, i) => ({ id: String(i), localTransportId: String(index) })).filter(p => p.id !== String(index)),
        createNetwork(options) {
          const endpoints = new Map();
          const network = { options, endpoints,
            async connect(remoteId) {
              if (endpoints.has(remoteId)) return endpoints.get(remoteId);
              const other = registry.get(remoteId)?.get(options.label);
              if (!other) throw Error('not yet connected');
              const [left, right] = channels();
              const local = options.createEndpoint({ channel: left, remoteParticipantId: identities[Number(remoteId)].peerId });
              const remote = other.options.createEndpoint({ channel: right, remoteParticipantId: identity.peerId });
              endpoints.set(remoteId, local); other.endpoints.set(String(index), remote);
              left.addEventListener('close', () => endpoints.delete(remoteId), { once: true });
              right.addEventListener('close', () => other.endpoints.delete(String(index)), { once: true });
              options.onPeer?.(remoteId, local); other.options.onPeer?.(String(index), remote);
              return local;
            },
            async close() { networks.delete(options.label); await Promise.all([...endpoints.values()].map(e => e.close())); }
          };
          networks.set(options.label, network); return network;
        },
        async loadProgram(selected, partition, controls) {
          loaded.push({ device: index, partition });
          const resident = createResidentPartition({ runtime: factory, model: selected, plan, planId,
            index: partition, participantId: identity.peerId, limits: policy });
          await resident.prepare({ approved: true, signal: controls.signal });
          return { runtime, resident, model: selected, plan, planId };
        }
      }));
    }
    cleanup.push(() => Promise.all(meshes.map(mesh => mesh.close())));
    await meshes[1].contribute(model.id, true); await meshes[2].contribute(model.id, true);
    await vi.waitFor(() => expect(meshes[0].getModels().some(m => m.availability === 'ready')).toBe(true));
    expect(loaded.map(x => x.device).sort()).toEqual([1, 2]);
    expect(loaded.map(x => x.partition).sort()).toEqual([0, 1]);
    expect(factories[0].log.opens).toEqual([]);
    const deltas = [];
    const controls = { signal: new AbortController().signal, requestApproval: async preview => {
      expect(preview.threadId).toBeTruthy(); expect(preview.attemptId).toBe(preview.threadId); return true;
    },
      onDelta: delta => deltas.push(delta.text), onState() {} };
    const run = id => meshes[0].generate({ model, threadId: id, attemptId: id,
      messages: [{ role: 'user', content: '10' }] }, controls);
    const result = await run('first');
    expect(deltas.join('')).toBe(result.content);
    expect(result.execution.participantA).not.toBe(result.execution.participantB);
    expect(result.execution.activationBytes).toBeGreaterThan(0);
    expect((await run('reuse')).content).toBe(result.content);
    expect(loaded).toHaveLength(2);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + config.inputLimits.descriptorTtlMs + 1);
    expect(meshes[0].getModels()).toEqual([]);
    const expired = run('expired-availability');
    clock.mockRestore();
    await expect(expired).rejects.toThrow('No prepared');
    if (replicate) {
      await meshes[3].contribute(model.id, true);
      await vi.waitFor(() => expect(meshes[3].getState().phase).toBe('ready'));
      const pinned = await run('pinned');
      expect(pinned.execution.participantA).toBe(result.execution.participantA);
      expect(pinned.execution.participantB).toBe(result.execution.participantB);
      expect(loaded).toHaveLength(3);
      expect(loaded.at(-1).partition).toBe(1);
      const lost = identities.findIndex(identity => identity.peerId === result.execution.participantB);
      await meshes[lost].stop();
      // Retry immediately, before the requester's next capability poll. The
      // input owner reconciles loss and the requester approves the fresh pair.
      const recovered = await run('replacement');
      expect(recovered.content).toBe(result.content);
      expect(recovered.execution.participantA).toBe(result.execution.participantA);
      expect(recovered.execution.participantB).toBe(identities[3].peerId);
      expect(loaded).toHaveLength(3); // Replacement uses already resident coverage.
      return;
    }
    await meshes[2].stop();
    await vi.waitFor(() => expect(meshes[0].getModels().some(m => m.availability === 'ready')).toBe(false));
    await expect(run('lost')).rejects.toThrow('No prepared');
    await meshes[2].contribute(model.id, true);
    await vi.waitFor(() => expect(meshes[0].getModels().some(m => m.availability === 'ready')).toBe(true));
    expect((await run('restarted')).content).toBe(result.content);
    expect(loaded).toHaveLength(3); // The still-consenting survivor retained its assigned weights.
    const b = loaded.find(item => item.partition === 1).device;
    await meshes[b].stop();
    await meshes[b].contribute(model.id, true);
    await vi.waitFor(() => expect(loaded).toHaveLength(4));
    await new Promise(resolve => setTimeout(resolve, config.pollMs * 3));
    await vi.waitFor(() => expect(meshes[0].getModels().some(m => m.availability === 'ready')).toBe(true));
    expect((await run('fast-restart')).content).toBe(result.content);
    expect(loaded).toHaveLength(4);
  });
});
