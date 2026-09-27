import { describe, it, expect, vi, afterEach } from 'vitest';
import * as runtime from 'doppler-gpu/partitions';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority, createResidentPartition, createPartitionPeer,
  createPartitionChat, createPartitionNetwork, partitionFingerprint } from '../../packages/reploid/src/mesh/index.js';
import { disclosureScope, matchingThreadGrant } from '../../packages/reploid/src/chat/thread-grants.js';
import { createChatSession } from '../../self/host/chat-session.js';
import { createPartitionRuntimeFixture } from '../fixtures/partition-runtime.js';

const policy = { maxTokens: 4, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 1024,
  maxAttempts: 32, maxConcurrentAttempts: 4 };
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
  const model = { id: 'fixture', name: 'Injected partition model', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64), adapters: [] };
  const plan = runtime.createLayerPartitionPlan({ modelId: model.id, numLayers: 4, hiddenSize: 8, vocabSize: 128, splitLayer: 2 });
  const planId = await partitionFingerprint(plan);
  const factory = createPartitionRuntimeFixture(options);
  const makeResident = (index, participantId) => createResidentPartition({ runtime: factory, model, plan, planId, index, participantId, limits: policy });
  const local = makeResident(0, a.peerId), supplier = makeResident(1, b.peerId);
  const [left, right] = channels();
  const base = { runtime, plan, planId, modelIdentity: model.identity, limits: channelPolicy, receiverLimits: { maxAttempts: 32, maxSteps: 8 } };
  const remote = createPartitionPeer({ ...base, channel: left, localParticipantId: a.peerId, remoteParticipantId: b.peerId, authority });
  const server = createPartitionPeer({ ...base, channel: right, localParticipantId: b.peerId, remoteParticipantId: a.peerId,
    authority: otherAuthority, contributor: supplier });
  const chat = createPartitionChat({ runtime, local, remote, authority, model, plan, planId, limits: policy, grantTtlMs: 10000 });
  cleanup.push(() => Promise.all([local.close(), supplier.close()]), () => Promise.all([remote.close(), server.close()]), () => chat.close());
  const binding = { modelId: model.id, modelIdentity: model.identity, planId, participantA: a.peerId, participantB: b.peerId,
    threadId: 'thread', attemptId: 'attempt' };
  return { authority, otherAuthority, local, supplier, remote, server, chat, factory, model, plan, planId, binding, a, b };
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
    const grant = await f.authority.issue(f.binding, policy, { approved: true, ttlMs: 10000 });
    const request = { identity: f.binding, action: 'mesh.execute_partition_b', step: 0, inputTokenCount: 1 };
    expect(await f.otherAuthority.verify(grant, request)).toBe(true);
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
    expect(f.factory.log.steps.filter(s => s.index === 0).map(s => s.threadId)).toEqual([a, b, a, b, a, b]);
    expect((await session.send(a, '20')).status).toBe('completed');
    expect(session.getState().threads[0].attempts[1].authorization.kind).toBe('thread-grant');
    expect(f.factory.log.tokenizations.at(-1)).toEqual([{ role: 'user', content: '1' }, { role: 'assistant', content: '2 3 4 ' }, { role: 'user', content: '20' }]);
    expect(f.factory.log.closes).toEqual([]);
    expect(f.remote.getState().receipt.sentFrames).toBeGreaterThan(9);
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
      recipientIdentity: f.b.peerId, operation: 'generate-partition', disclosure: 'partition-activations', ...model.partition };
    const scope = disclosureScope(request, preview);
    expect(scope).toBeTruthy();
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
