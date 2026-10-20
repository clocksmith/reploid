// Run-3 A1 regression: ordered Send from the browser product route. The product session, work swarm,
// chat session, workspace, thread grants and automatic partition owners are the shipped modules. Only
// the signaling mesh, WebRTC transport, identity storage, model-file IO and the peer-offer tab lock are
// injected. Numerical outputs are fixture data, never evidence of physical inference.
import { afterEach, expect, it, vi } from 'vitest';
import * as runtime from 'doppler-gpu/partitions';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createResidentPartition } from '../../packages/reploid/src/mesh/index.js';
import { createAutomaticPartitions } from '../../packages/reploid/src/mesh/partitions/automatic-partitions.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createPartitionRuntimeFixture } from '../fixtures/partition-runtime.js';
import { automaticOrderedMesh, tasks } from '../fixtures/automatic-ordered-mesh.js';
import orderedPolicy from '../../self/config/ordered-participation.json' with { type: 'json' };

const ports = vi.hoisted(() => ({ identity: null, partitions: null, bound: [] }));
vi.mock('../../self/identity.js', async original => ({ ...await original(), ensureIdentityBundle: async () => ports.identity }));
vi.mock('../../self/vendor/reploid/mesh/index.js', async original => ({ ...await original(),
  createLegacyGenerationMesh: ({ ports: input }) => {
    let identity = null;
    return { async connect() { identity = await input.identity.ensure({}); input.createTransport(); }, async close() {},
      getSwarmSnapshot: () => ({ peerId: identity?.peerId ?? null, connectionState: identity ? 'connected' : 'disconnected', peers: [] }) };
  },
  // work-swarm.js passes its authenticated consumer identity; the fixture owner was built with that identity.
  createAutomaticPartitions: options => { ports.bound.push(options.identity.peerId); return ports.partitions; }
}));
vi.mock('../../self/vendor/reploid/transport/index.js', async original => ({ ...await original(),
  createSwarmTransport: () => ({ disconnect() {}, onMessage() {}, offMessage() {}, sendToPeer() {}, _getPeerId: () => 'transport-requester', getConnectedPeers: () => [] }) }));
vi.mock('../../self/host/work-model-files.js', async original => ({ ...await original(),
  createWorkModelFiles: () => ({ async attach() {}, async close() {}, announce() {}, getState: () => ({ sharing: false, preparing: false }) }) }));
vi.mock('../../self/host/work-peer-offers.js', () => ({ createWorkPeerOffers: () => ({
  acquire: async () => 'transport-requester', attach: async () => {}, close() {}, getState: () => null }) }));
import { createProductSession } from '../../self/host/product-session.js';
import { createChatSession } from '../../self/host/chat-session.js';
import { resolveConfig } from '../../self/vendor/reploid/config/index.js';

const DISCLOSURE_MISMATCH = 'Peer disclosure does not match the selected model and verified recipients';
const cleanups = [];
afterEach(async () => {
  const results = await Promise.allSettled(cleanups.splice(0).reverse().map(close => close()));
  Object.assign(ports, { identity: null, partitions: null, bound: [] });
  const failures = results.filter(row => row.status === 'rejected').map(row => row.reason);
  if (failures.length) throw new AggregateError(failures, 'Product session cleanup failed');
});
const memoryStorage = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key) };
};
// The arguments initPoolHome passes (self/ui/pool-home/index.js:36). swarmNetworkOptions only names the
// fixture room; the swarm still connects through the product autoconnect owner.
async function openProduct(ordered) {
  const host = await createProductSession({ storage: memoryStorage(), operationNetwork: null, canonical: null, ordered,
    historyPorts: { loadRuntime: async () => runtime },
    networkOptions: () => ({}),
    swarmNetworkOptions: () => ({ autoConnect: true, discoveryScope: 'public', config: resolveConfig({ overrides: { mesh: { roomId: 'mesh' } } }) }) });
  cleanups.push(() => host.close());
  return host;
}
const weightlessRequester = { stage: null, ...orderedPolicy.limits };
// The product grants the exact verified route under its network preference, without a popup.
async function sendConfigured(chat, threadId, text) {
  const statuses = [];
  const unsubscribe = chat.subscribe(state => statuses.push(state.threads.find(thread => thread.id === threadId)?.attempts.at(-1)?.status));
  try {
    const attempt = await chat.send(threadId, text);
    expect(statuses).not.toContain('approval');
    return attempt;
  } finally { unsubscribe(); }
}
const readyModel = (chat, match) => vi.waitFor(() => {
  const model = chat.getState().models.find(row => match(row) && row.availability === 'ready');
  expect(model).toBeTruthy(); return model;
}, { timeout: 5000 });

it('admits ordered Send from the shipped product session under the authenticated swarm requester', async () => {
  const f = await automaticOrderedMesh({ modelFields: { provider: 'doppler' } }); cleanups.push(() => f.close());
  ports.identity = f.identities[5]; ports.partitions = f.meshes[5];
  await f.prepare(); await vi.waitFor(() => expect(f.select(5, 0)).toBeTruthy(), { timeout: 5000 });
  const host = await openProduct(weightlessRequester);
  const model = await readyModel(host.chat, row => row.partition?.coordinatorId === f.identities[0].peerId);
  expect(ports.bound).toEqual([f.identities[5].peerId]);
  const threadId = host.chat.createThread({ model });
  const dispatched = () => f.states.filter(state => state.resident)
    .reduce((total, state) => total + state.resident.tokenize.mock.calls.length + state.resident.reserve.mock.calls.length, 0);
  const before = dispatched(), stages = model.partition.route.stages.map(stage => stage.participantId);
  const attempt = await sendConfigured(host.chat, threadId, tasks[0].prompt);
  expect(dispatched()).toBeGreaterThan(before);
  const permission = host.chat.getState().remotePermissions.find(item => item.id === attempt.authorization?.permissionId);
  expect(permission).toBeTruthy();
  expect(attempt.error).toBeNull();
  expect(attempt.status).toBe('completed');
  expect(attempt.authorization).toMatchObject({ kind: 'permission', source: 'permission', permissionId: permission.id, recipients: stages,
    disclosure: 'ordered-partition-activations-and-tokens',
    requesterIdentity: f.identities[5].peerId, recipientIdentity: f.identities[0].peerId, route: model.partition.route });
  expect(attempt.execution.identity.requesterId).toBe(f.identities[5].peerId);
  expect(host.swarm.partitions.requesterIdentity()).toBe(f.identities[5].peerId);
  expect(host.chat.getState().activeThread.messages.at(-1).content).toBe(tasks[0].chunks.join(''));
  // History stays owned by the local participant; only disclosure binds the swarm identity.
  expect(host.chat.getState().participantId).toBe('local-user');
  expect(f.loads[5]).not.toHaveBeenCalled();
}, 20000);

it('still rejects ordered Send for a placeholder, unauthenticated or different requester without dispatch', async () => {
  const f = await automaticOrderedMesh({ modelFields: { provider: 'doppler' } }); cleanups.push(() => f.close());
  // The partition owner binds requester 6 while the swarm authenticated requester 5.
  ports.identity = f.identities[5]; ports.partitions = f.meshes[6];
  await f.prepare(); await vi.waitFor(() => expect(f.select(6, 3)).toBeTruthy(), { timeout: 5000 });
  const host = await openProduct(weightlessRequester);
  const model = await readyModel(host.chat, row => row.partition?.coordinatorId === f.identities[3].peerId);
  const dispatched = () => f.states.filter(state => state.resident)
    .reduce((total, state) => total + state.resident.tokenize.mock.calls.length + state.resident.reserve.mock.calls.length, 0);
  const before = dispatched();
  const rejects = async chat => {
    const threadId = chat.createThread({ model });
    // Unverified recipients are never offered for review: the attempt fails before any approval state.
    const attempt = await chat.send(threadId, tasks[0].prompt);
    expect(attempt.status).toBe('failed');
    expect(attempt.error).toBe(DISCLOSURE_MISMATCH);
    expect(attempt.authorization).toBeNull();
  };
  await rejects(host.chat);
  // undefined: the pre-fix product composition ('local-user'); null: not yet authenticated;
  // a well-formed peer that is not the bound requester (the coordinator itself).
  for (const requesterIdentity of [undefined, () => null, () => 'local-user', () => f.identities[3].peerId]) {
    const chat = createChatSession({ storage: null, swarm: host.swarm, partitions: host.swarm.partitions, requesterIdentity });
    cleanups.push(() => chat.close());
    await rejects(chat);
  }
  expect(dispatched()).toBe(before);
}, 20000);

it('opens ordered grants before the swarm authenticates and uses them only for their bound requester', async () => {
  const f = await automaticOrderedMesh(); cleanups.push(() => f.close());
  await f.prepare(); await vi.waitFor(() => expect(f.select(5, 0)).toBeTruthy(), { timeout: 5000 });
  let saved = null, current = f.identities[5].peerId;
  const options = { meshId: 'reploid-local-mesh', participantId: 'local-user', requesterIdentity: () => current,
    store: { load: () => structuredClone(saved), save: value => { saved = structuredClone(value); } },
    execute: (request, controls) => f.meshes[5].generate(request, controls) };
  const open = () => { const app = createChatWorkspace(options); cleanups.push(() => app.close()); return app; };
  const first = open(), threadId = first.createThread({ model: f.select(5, 0), permissions: { sharingScope: 'mesh' } });
  const reviewed = first.send(threadId, tasks[0].prompt);
  await vi.waitFor(() => expect(first.getState().threads[0].attempts.at(-1).status).toBe('approval'));
  const review = first.getState().threads[0].attempts.at(-1);
  expect(review.approval.reusable).toBe(true);
  first.approve(threadId, review.id, review.approval.id, true, { remember: true });
  expect((await reviewed).status).toBe('completed');
  expect(first.getState().threads[0].grants[0].requesterIdentity).toBe(f.identities[5].peerId);
  await first.close();

  // Product history opens before the swarm connects, then the authenticated requester uses its grant.
  current = null; const restored = open(); current = f.identities[5].peerId;
  const follow = await restored.send(threadId, tasks[0].prompt);
  expect(follow.status).toBe('completed');
  expect(follow.authorization).toMatchObject({ kind: 'thread-grant', requesterIdentity: f.identities[5].peerId });
  await restored.close();

  // A stored grant bound to another requester never authorizes this one.
  saved.threads[0].grants[0].requesterIdentity = f.identities[6].peerId;
  current = null; const other = open(); current = f.identities[5].peerId;
  const tokenized = f.states[0].resident.tokenize.mock.calls.length;
  const pending = other.send(threadId, tasks[0].prompt);
  await vi.waitFor(() => expect(other.getState().threads[0].attempts.at(-1).status).toBe('approval'));
  expect(other.getState().threads[0].attempts.at(-1).authorization).toBeNull();
  expect(f.states[0].resident.tokenize).toHaveBeenCalledTimes(tokenized);
  await other.cancel(threadId); expect((await pending).status).toBe('cancelled');
  await other.close();
  // An identity already authenticated at opening still rejects that grant outright.
  expect(() => createChatWorkspace(options)).toThrow('Invalid stored conversation grants');
}, 20000);

// Two-stage (non-ordered) route: its disclosure names participants A and B and binds no requester.
const policy = { maxTokens: 4, maxPromptTokens: 32, maxActivationBytes: 4096, maxOutputCharacters: 1024, maxAttempts: 32, maxConcurrentAttempts: 4 };
const generation = { maxTokens: 4, maxSeqLen: 128, temperature: 0, topK: 0, topP: 1,
  repetitionPenalty: 1, repetitionPenaltyWindow: 0, presencePenalty: 0, useChatTemplate: false };
const channelPolicy = { maxFrameBytes: 64, maxControlBytes: 8192, maxPayloadBytes: 4096, maxPendingBytes: 16384,
  maxPendingRequests: 8, maxRequestsPerChannel: 128, maxBufferedBytes: 16384, maxTransferBytes: 1048576, timeoutMs: 1000 };
function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, {
    readyState: 'open', ordered: true, maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); }
  }));
  return pair;
}
// Requester 0 and contributors 1 and 2, as partition-api.test.js "automatic cooperative placement".
async function twoStageMesh() {
  const identities = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'ECDSA' })));
  const registry = new Map(), meshes = [];
  const model = { id: 'fixture', name: 'Injected partition model', provider: 'doppler', identity: 'sha256:' + 'a'.repeat(64), generation, adapters: [] };
  const plan = runtime.createLayerPartitionPlan({ modelId: model.id, numLayers: 4, hiddenSize: 8, vocabSize: 128 });
  const planId = runtime.hashLayerPartitionPlan(plan);
  const config = { pollMs: 50, maxPeers: 4, connectTimeoutMs: 1000, grantMs: 10000, limits: policy,
    inputChannel: channelPolicy, executionChannel: channelPolicy, controlChannel: channelPolicy, receiver: { maxAttempts: 32, maxSteps: 8 },
    inputLimits: { maxInputCharacters: 1000, maxOutputCharacters: 1024, maxAttempts: 16, maxConcurrentAttempts: 2, descriptorTtlMs: 1000 } };
  for (const [index, identity] of identities.entries()) {
    const factory = createPartitionRuntimeFixture(), networks = new Map(); registry.set(String(index), networks);
    meshes.push(createAutomaticPartitions({ identity, meshId: 'mesh', models: [model], policy: config,
      peers: () => identities.map((_, i) => ({ id: String(i), localTransportId: String(index) })).filter(peer => peer.id !== String(index)),
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
          async close() { networks.delete(options.label); await Promise.all([...endpoints.values()].map(endpoint => endpoint.close())); }
        };
        networks.set(options.label, network); return network;
      },
      async loadProgram(selected, partition, controls) {
        const resident = createResidentPartition({ runtime: factory, model: selected, plan, planId, index: partition, participantId: identity.peerId, limits: policy });
        await resident.prepare({ approved: true, signal: controls.signal });
        return { runtime, resident, model: selected, plan, planId };
      } }));
  }
  return { identities, meshes, model, close: () => Promise.all(meshes.map(mesh => mesh.close())) };
}

it('keeps two-stage Send working from the product session; it never relied on a requester identity', async () => {
  const f = await twoStageMesh(); cleanups.push(() => f.close());
  ports.identity = f.identities[0]; ports.partitions = f.meshes[0];
  await f.meshes[1].contribute(f.model.id, true); await f.meshes[2].contribute(f.model.id, true);
  const host = await openProduct(null);
  const model = await readyModel(host.chat, row => row.partition && row.partition.schema === undefined);
  const placeholder = createChatSession({ storage: null, swarm: host.swarm, partitions: host.swarm.partitions });
  cleanups.push(() => placeholder.close());
  for (const chat of [host.chat, placeholder]) {
    const attempt = await sendConfigured(chat, chat.createThread({ model }), '10');
    expect(attempt.error).toBeNull();
    expect(attempt.status).toBe('completed');
    expect(attempt.authorization).toMatchObject({ source: 'permission', disclosure: 'partition-activations-and-tokens',
      recipients: [model.partition.participantA, model.partition.participantB],
      participantA: model.partition.participantA, recipientIdentity: model.partition.participantB });
    expect(attempt.authorization.requesterIdentity).toBeUndefined();
  }
}, 20000);
