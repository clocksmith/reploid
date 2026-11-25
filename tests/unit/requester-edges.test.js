/**
 * Requester-held edges (`protection: 'plaintext'`, `topology: { kind: 'split', edges: 'requester-devices' }`): the policy, the inference API contract and the ordered
 * route. The first and last stage run on the requester's own devices; every other stage gets activations and token
 * counts, never token IDs. These are contract tests with injected stages; they establish no physical inference.
 */
import { describe, it, expect } from 'vitest';
import { createExecutionPolicy, compileExecutionRequirements, edgesExecutionRoute, plaintextExecutionRoute, bindExecutionRoute,
  validateExecutionRoute, tokenContextStages, partitionPrivacyBinding, EDGES_BACKEND } from '../../packages/reploid/src/chat/execution-policy.js';
import { createInference } from '../../packages/reploid/src/inference/index.js';
import { orderedPartitionDisclosure } from '../../packages/reploid/src/contracts/partition-disclosure.js';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createPartitionGrantAuthority } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createPartitionChat } from '../../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionPeer } from '../../packages/reploid/src/mesh/partitions/partition-peer.js';
import { fixture as routeFixture } from '../fixtures/ordered-partition-ports.js';
import { vi } from 'vitest';

const hash = c => 'sha256:' + c.repeat(64);
const model = { id: 'tiny', identity: hash('a') };
const route = { planId: hash('p'), modelId: model.id, modelIdentity: model.identity,
  stages: ['edge-in', 'middle-1', 'middle-2', 'edge-out'].map((participantId, index) => ({ index, participantId })) };
const EDGES = 'split-local-edges';
const execution = (protection = 'plaintext', routeValue = EDGES, ids = route.stages.map(stage => stage.participantId)) => ({ protection, route: routeValue,
  participants: { kind: 'named', ids }, allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] });
const binding = async (backendRoute = edgesExecutionRoute({ model }, { route })) => {
  const privacy = compileExecutionRequirements(execution());
  return bindExecutionRoute({ model, privacy }, backendRoute);
};

describe('requester-edges policy and route', () => {
  it('compiles to a plaintext layered policy and refuses any protected split with requester-held edges', () => {
    expect(compileExecutionRequirements(execution()).leakage).toContain('plaintext');
    for (const protection of ['secret-sharing', 'homomorphic', 'attested']) {
      expect(() => compileExecutionRequirements(execution(protection))).toThrow(expect.objectContaining({ code: 'EXECUTION_REQUEST_INVALID' }));
    }
  });
  it('marks only the first and last stage as content readers and validates that shape', async () => {
    const edges = edgesExecutionRoute({ model }, { route });
    expect(edges.backend).toBe(EDGES_BACKEND);
    expect(edges.hops.map(hop => hop.disclosure)).toEqual(['plaintext', 'activations', 'activations', 'plaintext']);
    expect(tokenContextStages(await binding())).toEqual([0, 3]);
    const policy = compileExecutionRequirements(execution());
    const swapped = { ...edges, hops: edges.hops.map((hop, index) => ({ ...hop, disclosure: index === 1 ? 'plaintext' : hop.disclosure })) };
    expect(() => validateExecutionRoute(policy, swapped)).toThrow('edges route');
    expect(() => edgesExecutionRoute({ model }, { route: { ...route, stages: route.stages.slice(0, 2) } })).toThrow('between its two edges');
    // An activations hop is never accepted on an ordinary plaintext route.
    const plain = plaintextExecutionRoute({ model, privacy: policy }, { recipients: ['a'] });
    expect(() => validateExecutionRoute(policy, { ...plain, hops: [{ ...plain.hops[0], disclosure: 'activations' }] })).toThrow('unqualified route hop');
  });
  it('narrows the signed token disclosure to the two edges only under an edges binding', async () => {
    const full = routeFixture(4).route, ids = full.stages.map(stage => stage.participantId);
    const identity = { schema: 'reploid.partition-attempt/v2', route: full, requesterId: 'requester', threadId: 't', attemptId: 'a', placementGeneration: 0 };
    expect(orderedPartitionDisclosure(identity).tokenRecipients).toEqual(ids);
    const narrowed = orderedPartitionDisclosure(identity, { route: { backend: EDGES_BACKEND } });
    expect(narrowed.kind).toBe('coordinator-mediated-activations-and-edge-tokens');
    expect(narrowed.tokenRecipients).toEqual([ids[0], ids[3]]);
    expect(narrowed.outputRecipients).toEqual([ids[3], ids[0], 'requester']);
  });
});

describe('requester-edges through reploid/inference', () => {
  const candidate = { shape: 'split', backend: EDGES_BACKEND, participants: route.stages.map(stage => stage.participantId),
    selection: 'all', planIdentity: route.planId, edgeParticipants: ['edge-in', 'edge-out'], maxCharge: { kind: 'free' } };
  const prepare = (inference, routeValue = EDGES) => inference.prepare({ model: { id: model.id, identity: model.identity },
    generation: { maxOutputTokens: 4 }, execution: execution('plaintext', routeValue) });
  const mine = { requesterDevices: async () => ['edge-in', 'edge-out'] };

  it('states exactly who reads content and who reads activations, and records it in the receipt', async () => {
    const bound = await binding();
    const inference = createInference({ ...mine, resolveRoute: async () => candidate,
      async execute(job, controls) {
        expect(await controls.requestApproval({ privacyBinding: bound })).toBe(true);
        controls.onDelta({ text: 'ok' });
        return { content: 'ok', modelId: model.id, modelIdentity: model.identity, execution: { stopReason: 'eos-token' } };
      } });
    const plan = await prepare(inference);
    expect(plan.route.edgeParticipants).toEqual(['edge-in', 'edge-out']);
    expect(plan).toMatchObject({ protection: 'plaintext', routeKind: EDGES });
    const edges = { role: 'requester-edge-device', ids: ['edge-in', 'edge-out'] };
    for (const section of ['prompt', 'answer']) expect(plan.disclosure[section].readers).toEqual([{ role: 'requester-device' }, edges]);
    expect(plan.disclosure.intermediate.readers).toEqual([{ role: 'requester-device' }, edges, { role: 'stage-operator', selection: 'all', ids: ['middle-1', 'middle-2'] }]);
    expect(plan.disclosure.intermediate.assumptions).toContain('activations-may-reveal-content');
    expect(plan.disclosure.prompt.assumptions).toEqual(['edge-devices-bound-to-requester']);
    const run = await inference.run({ planId: plan.id, requestId: 'r1', input: { messages: [{ role: 'user', content: 'hi' }] } });
    const result = await run.result;
    expect(result.status).toBe('completed');
    expect(result.executionReceipt).toMatchObject({ protection: 'plaintext', routeKind: EDGES });
    const evidence = result.executionReceipt.evidence.privacy;
    expect(evidence).toMatchObject({ protection: 'plaintext', routeKind: EDGES });
    expect(evidence.contentReadBy.participants).toEqual(['edge-in', 'edge-out']);
    expect(evidence.intermediateReadBy.participants).toEqual(['edge-in', 'edge-out', 'middle-1', 'middle-2']);
    expect(evidence.checks.map(check => check.claim)).toEqual(['edge-devices-bound-to-requester', 'content-recipients', 'activation-only-recipients']);
    expect(evidence.notVerified).toEqual(expect.arrayContaining(['activation-inversion-resistance']));
  });
  it('refuses edges it cannot bind to the requester, before anything is sent', async () => {
    const execute = vi.fn();
    for (const requesterDevices of [undefined, async () => ['edge-in'], async () => { throw Error('no binding store'); }, async () => 'edge-in,edge-out']) {
      const inference = createInference({ requesterDevices, resolveRoute: async () => candidate, execute });
      await expect(prepare(inference)).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE', message: expect.stringMatching(/bound to this requester/) });
    }
    // A binding lost between prepare and run is refused at run, before the input is released.
    let devices = ['edge-in', 'edge-out'];
    const inference = createInference({ requesterDevices: async () => devices, resolveRoute: async () => candidate, execute });
    const plan = await prepare(inference);
    devices = ['edge-in'];
    await expect(inference.run({ planId: plan.id, requestId: 'lost', input: { messages: [{ role: 'user', content: 'hi' }] } }))
      .rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('fails closed when only a readable split exists, and refuses a binding that widens who reads content', async () => {
    const readable = createInference({ ...mine, resolveRoute: async () => ({ ...candidate, backend: 'doppler-partition-plaintext/v1', edgeParticipants: undefined }),
      execute: async () => { throw Error('must not run'); } });
    await expect(prepare(readable)).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    // An ordinary split, auto or whole request never runs on an edges route either.
    const edgesOnly = createInference({ ...mine, resolveRoute: async () => candidate, execute: async () => { throw Error('must not run'); } });
    for (const routeValue of ['auto', 'remote', 'split']) {
      await expect(prepare(edgesOnly, routeValue)).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    }
    let approved = null;
    const policy = compileExecutionRequirements(execution());
    const widened = await bindExecutionRoute({ model, privacy: policy }, plaintextExecutionRoute({ model, privacy: policy },
      { recipients: route.stages.map(stage => stage.participantId), route }));
    const inference = createInference({ ...mine, resolveRoute: async () => candidate,
      async execute(job, controls) { approved = await controls.requestApproval({ privacyBinding: widened }); throw Error('declined'); } });
    const plan = await prepare(inference);
    const result = await (await inference.run({ planId: plan.id, requestId: 'r2', input: { messages: [{ role: 'user', content: 'hi' }] } })).result;
    expect(approved).toBe(false);
    expect(result.error.code).toBe('EXECUTION_PLAN_CHANGED');
  });
});

describe('ordered route under an edges binding', () => {
  function channels() {
    const pair = [new EventTarget(), new EventTarget()];
    pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true, maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
      send(data) { queueMicrotask(() => { if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
      close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); } }));
    return pair;
  }
  it('sends token IDs only to the first and last stage; middle stages run on activations with no token context', async () => {
    const count = 4, f = routeFixture(count), signer = await createSigningIdentity({ algorithm: 'ECDSA' });
    f.route.stages[0].participantId = signer.peerId; f.stages[0].id = signer.peerId;
    f.stages[0].tokenize = vi.fn(async () => ({ modelIdentity: f.route.modelIdentity, tokenIds: [1, 2], generation: f.request.generation }));
    f.stages.forEach((stage, index) => Object.assign(stage, { index, getState: () => ({ ready: true }), subscribe: () => () => {}, refresh: vi.fn(async () => ({ ready: true })) }));
    const authority = createPartitionGrantAuthority({ identity: signer, meshId: 'mesh', maxGrants: 20, maxTtlMs: 10000 });
    const limits = { maxFrameBytes: 64, maxControlBytes: 131072, maxPayloadBytes: 4096, maxPendingBytes: 16384, maxPendingRequests: 8,
      maxRequestsPerChannel: 256, maxBufferedBytes: 262144, maxTransferBytes: 4194304, timeoutMs: 10000 };
    const peers = [], owners = [], ports = [f.stages[0]], seen = new Map();
    for (let index = 1; index < count; index++) {
      const identity = await createSigningIdentity({ algorithm: 'ECDSA' });
      f.route.stages[index].participantId = identity.peerId; f.stages[index].id = identity.peerId;
    }
    for (let index = 1; index < count; index++) {
      const stage = f.stages[index], owner = createPartitionGrantAuthority({ identity: await createSigningIdentity({ algorithm: 'ECDSA' }), meshId: 'mesh', maxGrants: 20, maxTtlMs: 10000 });
      owners.push(owner);
      f.plan.partitions[index].layerRange = [index * 2, index * 2 + 1];
      const execute = stage.executeStage.getMockImplementation();
      // What each remote stage's resident actually receives, after the wire.
      stage.executeStage.mockImplementation(async request => { seen.set(index, [...(seen.get(index) ?? []), { ids: request.inputTokenIds, context: request.tokenContext ?? 'sent' }]); return execute(request); });
      stage.canAccept = () => true;
      stage.getState = () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true, index, stageCount: count,
        modelId: f.route.modelId, modelIdentity: f.route.modelIdentity, planId: f.route.planId, layerRange: f.plan.partitions[index].layerRange } });
      const common = { runtime: f.runtime, plan: f.plan, planId: f.route.planId, modelIdentity: f.route.modelIdentity, limits,
        receiverLimits: { maxAttempts: 20, maxSteps: 10 }, ordered: { route: f.route, partitionIndex: index } };
      const pair = channels();
      peers.push(createPartitionPeer({ ...common, channel: pair[1], localParticipantId: stage.id, remoteParticipantId: signer.peerId, authority: owner, contributor: stage }));
      const client = createPartitionPeer({ ...common, channel: pair[0], localParticipantId: signer.peerId, remoteParticipantId: stage.id, authority });
      peers.push(client); ports.push(client);
    }
    const chatModel = { id: 'model', name: 'Fixture', identity: f.route.modelIdentity };
    const chat = createPartitionChat({ runtime: f.runtime, model: chatModel, authority, plan: f.plan, planId: f.route.planId, limits: f.limits,
      grantTtlMs: 10000, now: () => Date.now(), ordered: { route: f.route, stages: ports }, authorizeRequester: async () => true });
    const privacy = createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } });
    const requestModel = { id: f.route.modelId, identity: f.route.modelIdentity, partition: f.route };
    const privacyBinding = await partitionPrivacyBinding({ privacy, model: requestModel,
      privacyBinding: await bindExecutionRoute({ privacy, model: requestModel }, edgesExecutionRoute({ model: requestModel }, { route: f.route })) },
    f.route.stages.map(stage => stage.participantId), f.route);
    const approvals = [];
    try {
      const result = await chat.generate({ meshId: 'mesh', model: chat.getModels()[0], participantId: 'requester', threadId: 'thread', attemptId: 'attempt',
        placementGeneration: 0, messages: [{ role: 'user', content: 'Hello' }], privacy, privacyBinding, permissions: { sharingScope: 'approved-partition-path' } },
      { signal: new AbortController().signal, onState: () => {}, onDelta: () => {}, requestApproval: async preview => { approvals.push(preview); return true; } });
      expect(result.content).toBe('012');
      expect(approvals[0].disclosure.tokenRecipients).toEqual([f.route.stages[0].participantId, f.route.stages[3].participantId]);
      // The coordinator's own first stage and the final stage get the real token IDs; the middle stages never do.
      expect(f.stages[0].executeStage.mock.calls.every(([request]) => Array.isArray(request.inputTokenIds))).toBe(true);
      expect(seen.get(3).every(row => row.context === 'sent' && row.ids.length > 0)).toBe(true);
      for (const index of [1, 2]) {
        expect(seen.get(index)).toHaveLength(3);
        expect(seen.get(index).every(row => row.context === 'withheld' && row.ids.every(id => id === 0))).toBe(true);
      }
    } finally {
      await Promise.allSettled([chat.close(), f.runner.close(), ...peers.map(peer => peer.close())]);
      authority.close(); owners.forEach(owner => owner.close());
    }
  });
});

describe('settlement chain on an edges route', () => {
  it('chains outputs without their text, so the acknowledgments that reach middle stages carry no answer', async () => {
    const { openStageReceipts, openOutputAcknowledgments, createAttemptEvidenceSigner, extendOutputChain } =
      await import('../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js');
    const full = routeFixture(4).route;
    const requester = await createSigningIdentity({ algorithm: 'Ed25519' }), last = await createSigningIdentity({ algorithm: 'Ed25519' });
    full.stages[3].participantId = last.peerId;
    const identity = { schema: 'reploid.partition-attempt/v2', route: full, requesterId: requester.peerId, threadId: 'thread', attemptId: 'attempt', placementGeneration: 0 };
    const run = async textlessOutputs => {
      const acks = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity: requester }), identity, reservationId: 'service:r:attempt', textlessOutputs });
      const stage = await openStageReceipts({ signer: createAttemptEvidenceSigner({ identity: last }), identity, partitionIndex: 3, charge: acks.charge, textlessOutputs });
      const receipt = await stage.step({ step: 0, inputTokenCount: 2, delta: 'secret', done: true, stopReason: 'eos-token' });
      return { pair: await acks.observe({ step: 0, delta: 'secret', receipt }), genesis: acks.charge };
    };
    const plain = await run(false), textless = await run(true);
    expect(plain.pair.acknowledgment.count).toBe(1);
    expect(textless.pair.acknowledgment.count).toBe(1);
    // The plaintext chain is the genesis extended by the delta's text; the textless one by an empty string.
    const genesis = textless.genesis.chain;
    expect(textless.pair.acknowledgment.chain).toBe(await extendOutputChain(genesis, { step: 0, delta: '' }));
    expect(plain.pair.acknowledgment.chain).toBe(await extendOutputChain(plain.genesis.chain, { step: 0, delta: 'secret' }));
    // A requester and final stage that disagree on the mode never acknowledge: the attempt fails closed.
    const acks = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity: requester }), identity, reservationId: 'service:r:attempt', textlessOutputs: true });
    const stage = await openStageReceipts({ signer: createAttemptEvidenceSigner({ identity: last }), identity, partitionIndex: 3, charge: acks.charge });
    expect(await acks.observe({ step: 0, delta: 'secret', receipt: await stage.step({ step: 0, inputTokenCount: 2, delta: 'secret' }) })).toBe(null);
  });
});
