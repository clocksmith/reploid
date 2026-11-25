/**
 * Requester-held edges (`confidentiality: 'requester-edges'`): the policy, the inference API contract and the ordered
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
const execution = (confidentiality, ids = route.stages.map(stage => stage.participantId)) => ({ placement: 'network-allowed',
  participants: { kind: 'named', ids }, confidentiality, allowMetadata: ['model-id', 'timing', 'length', 'access-patterns'] });
const binding = async (backendRoute = edgesExecutionRoute({ model }, { route })) => {
  const privacy = compileExecutionRequirements(execution('requester-edges'));
  return bindExecutionRoute({ model, privacy }, backendRoute);
};

describe('requester-edges policy and route', () => {
  it('compiles to a plaintext layered policy, refuses local-only and keeps requester-only failing closed', () => {
    expect(compileExecutionRequirements(execution('requester-edges')).leakage).toContain('plaintext');
    expect(() => compileExecutionRequirements({ ...execution('requester-edges'), placement: 'local-only', participants: { kind: 'none' } }))
      .toThrow(expect.objectContaining({ code: 'EXECUTION_ROUTE_UNAVAILABLE' }));
    expect(() => compileExecutionRequirements(execution('requester-only'))).toThrow(expect.objectContaining({ code: 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' }));
  });
  it('marks only the first and last stage as content readers and validates that shape', async () => {
    const edges = edgesExecutionRoute({ model }, { route });
    expect(edges.backend).toBe(EDGES_BACKEND);
    expect(edges.hops.map(hop => hop.disclosure)).toEqual(['plaintext', 'activations', 'activations', 'plaintext']);
    expect(tokenContextStages(await binding())).toEqual([0, 3]);
    const policy = compileExecutionRequirements(execution('requester-edges'));
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
    selection: 'all', planIdentity: route.planId, edgeParticipants: ['edge-in', 'edge-out'] };
  const prepare = (inference, confidentiality = 'requester-edges') => inference.prepare({ model: { id: model.id, identity: model.identity },
    generation: { maxOutputTokens: 4 }, execution: execution(confidentiality) });

  it('states exactly who reads content and who reads activations, and records it in the receipt', async () => {
    const bound = await binding();
    const inference = createInference({ resolveRoute: async () => candidate,
      async execute(job, controls) {
        expect(await controls.requestApproval({ privacyBinding: bound })).toBe(true);
        controls.onDelta({ text: 'ok' });
        return { content: 'ok', modelId: model.id, modelIdentity: model.identity, execution: { stopReason: 'eos-token' } };
      } });
    const plan = await prepare(inference);
    expect(plan.route.edgeParticipants).toEqual(['edge-in', 'edge-out']);
    expect(plan.disclosures.contentReadableBy.participants).toEqual(['edge-in', 'edge-out']);
    expect(plan.disclosures.activationsReadableBy.participants).toEqual(['middle-1', 'middle-2']);
    expect(plan.disclosures.executorsReadContent).toBe(false);
    expect(plan.disclosures.statement).toMatch(/never token IDs or text/);
    expect(plan.disclosures.statement).toMatch(/not confidential execution/);
    const run = await inference.run({ planId: plan.id, requestId: 'r1', input: { messages: [{ role: 'user', content: 'hi' }] } });
    const result = await run.result;
    expect(result.status).toBe('completed');
    const evidence = result.executionReceipt.evidence.confidentiality;
    expect(evidence.mode).toBe('requester-edges');
    expect(evidence.contentReadBy.participants).toEqual(['edge-in', 'edge-out']);
    expect(evidence.activationsReadBy.participants).toEqual(['middle-1', 'middle-2']);
    expect(evidence.notVerified).toEqual(expect.arrayContaining(['activation-inversion-resistance', 'edge-device-ownership']));
  });
  it('fails closed when only a readable split exists, and refuses a binding that widens who reads content', async () => {
    const readable = createInference({ resolveRoute: async () => ({ ...candidate, backend: 'doppler-partition-plaintext/v1', edgeParticipants: undefined }),
      execute: async () => { throw Error('must not run'); } });
    await expect(prepare(readable)).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    // A readable request never runs on an edges route either.
    const edgesOnly = createInference({ resolveRoute: async () => candidate, execute: async () => { throw Error('must not run'); } });
    await expect(prepare(edgesOnly, 'executor-readable')).rejects.toMatchObject({ code: 'EXECUTION_ROUTE_UNAVAILABLE' });
    let approved = null;
    const policy = compileExecutionRequirements(execution('requester-edges'));
    const widened = await bindExecutionRoute({ model, privacy: policy }, plaintextExecutionRoute({ model, privacy: policy },
      { recipients: route.stages.map(stage => stage.participantId), route }));
    const inference = createInference({ resolveRoute: async () => candidate,
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
