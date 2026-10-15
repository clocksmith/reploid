// Carriage of signed attempt evidence through the ordered route's network hops: the requester's charge
// binding travels over the requester-to-coordinator entry channel and the coordinator-to-stage peer
// channels; each final-stage receipt returns with its output to the requester, whose acknowledgment
// returns to the route and reaches every stage. Stage arithmetic is injected; the final stage and the
// requester sign with real identities. Proves carriage and signature checks, not execution.
import { describe, expect, it, vi } from 'vitest';

import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import {
  createAttemptEvidenceSigner, openOutputAcknowledgments, openStageReceipts, verifyStageReceipt
} from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { createPartitionChat } from '../../packages/reploid/src/mesh/partitions/partition-chat.js';
import { createPartitionEntry } from '../../packages/reploid/src/mesh/partitions/partition-entry.js';
import { createPartitionGrantAuthority } from '../../packages/reploid/src/mesh/partitions/partition-grants.js';
import { createPartitionPeer } from '../../packages/reploid/src/mesh/partitions/partition-peer.js';
import { fixture as routeFixture } from '../fixtures/ordered-partition-ports.js';

function channels() {
  const pair = [new EventTarget(), new EventTarget()];
  pair.forEach((channel, index) => Object.assign(channel, { readyState: 'open', ordered: true,
    maxRetransmits: null, maxPacketLifeTime: null, bufferedAmount: 0,
    send(data) { queueMicrotask(() => { if (pair[1 - index].readyState === 'open') pair[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })); }); },
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; this.dispatchEvent(new Event('close')); queueMicrotask(() => pair[1 - index].close()); } }));
  return pair;
}

const LIMITS = { maxFrameBytes: 64, maxControlBytes: 131072, maxPayloadBytes: 4096, maxPendingBytes: 16384, maxPendingRequests: 8,
  maxRequestsPerChannel: 256, maxBufferedBytes: 262144, maxTransferBytes: 4194304, timeoutMs: 10000 };
const INPUT_LIMITS = { maxInputCharacters: 4096, maxOutputCharacters: 100, maxAttempts: 20, maxConcurrentAttempts: 2, descriptorTtlMs: 10000 };

/** A requester entry, a coordinator's ordered chat and remote ordered peers for stages 1..n. */
async function network(count = 3) {
  const f = routeFixture(count);
  const coordinator = await createSigningIdentity({ algorithm: 'ECDSA' });
  const requester = await createSigningIdentity({ algorithm: 'ECDSA' });
  f.route.stages[0].participantId = coordinator.peerId; f.stages[0].id = coordinator.peerId;
  f.stages.forEach((stage, index) => Object.assign(stage, { index, getState: () => ({ ready: true }),
    subscribe: () => () => {}, refresh: vi.fn(async () => ({ ready: true })) }));
  f.stages[0].tokenize = vi.fn(async () => ({ modelIdentity: f.route.modelIdentity, tokenIds: [1, 2], generation: f.request.generation }));
  const authority = createPartitionGrantAuthority({ identity: coordinator, meshId: 'mesh', maxGrants: 20, maxTtlMs: 10000 });
  const owners = [], stageIdentities = [], ports = [f.stages[0]];
  for (let index = 1; index < count; index++) {
    stageIdentities[index] = await createSigningIdentity({ algorithm: 'Ed25519' });
    f.route.stages[index].participantId = stageIdentities[index].peerId; f.stages[index].id = stageIdentities[index].peerId;
  }
  // The final stage keeps a real receipt tally over the injected arithmetic, as a resident does.
  const final = f.stages[count - 1], tallies = new Map(), received = { charges: [], acknowledged: [], closed: [] };
  const signer = createAttemptEvidenceSigner({ identity: stageIdentities[count - 1] });
  const reserve = final.reserve.getMockImplementation(), execute = final.executeStage.getMockImplementation();
  for (const stage of f.stages) {
    const stageReserve = stage.reserve.getMockImplementation(), stageClose = stage.closeAttempt.getMockImplementation();
    stage.reserve.mockImplementation(async (request) => { received.charges.push([stage.index, request.charge?.count ?? null]); return stageReserve(request); });
    stage.closeAttempt.mockImplementation(async (request) => { received.closed.push([stage.index, request.acknowledged?.acknowledgment.count ?? null]); return stageClose(request); });
  }
  final.reserve.mockImplementation(async (request) => {
    received.charges.push([count - 1, request.charge?.count ?? null]);
    tallies.set(request.identity.attemptId, await openStageReceipts({ signer, identity: request.identity, partitionIndex: count - 1, charge: request.charge }));
    return reserve(request);
  });
  final.executeStage.mockImplementation(async (request) => {
    received.acknowledged.push([request.step, request.acknowledged?.acknowledgment.count ?? null]);
    const result = await execute(request);
    const receipt = await tallies.get(request.identity.attemptId).step({ step: request.step, inputTokenCount: request.inputTokenCount,
      delta: result.delta, done: result.done, stopReason: result.stopReason });
    return { ...result, receipt };
  });
  for (let index = 1; index < count; index++) {
    const identity = stageIdentities[index], stage = f.stages[index];
    const stageAuthority = createPartitionGrantAuthority({ identity, meshId: 'mesh', maxGrants: 20, maxTtlMs: 10000 });
    const pair = channels();
    f.plan.partitions[index].layerRange = [index * 2, index * 2 + 1];
    stage.canAccept = () => true;
    stage.getState = () => ({ ready: true, descriptor: { schema: 'doppler.resident-partition/v2', ready: true,
      index, stageCount: count, modelId: f.route.modelId, modelIdentity: f.route.modelIdentity,
      planId: f.route.planId, layerRange: f.plan.partitions[index].layerRange } });
    const common = { runtime: f.runtime, plan: f.plan, planId: f.route.planId, modelIdentity: f.route.modelIdentity,
      limits: LIMITS, receiverLimits: { maxAttempts: 20, maxSteps: 10 }, ordered: { route: f.route, partitionIndex: index } };
    const server = createPartitionPeer({ ...common, channel: pair[1], localParticipantId: stage.id, remoteParticipantId: coordinator.peerId,
      authority: stageAuthority, contributor: stage });
    const client = createPartitionPeer({ ...common, channel: pair[0], localParticipantId: coordinator.peerId, remoteParticipantId: stage.id, authority });
    owners.push(server, client, { close: () => stageAuthority.close() }); ports.push(client);
  }
  const model = { id: 'model', name: 'Fixture', identity: f.route.modelIdentity };
  const chat = createPartitionChat({ runtime: f.runtime, model, authority, plan: f.plan, planId: f.route.planId, limits: f.limits, grantTtlMs: 10000,
    now: () => Date.now(), ordered: { route: f.route, stages: ports }, authorizeRequester: vi.fn(async () => true) });
  const pair = channels(), authorize = vi.fn(async () => true);
  const server = createPartitionEntry({ channel: pair[1], localParticipantId: coordinator.peerId, remoteParticipantId: requester.peerId,
    service: chat, ordered: true, authorize, limits: LIMITS, inputLimits: INPUT_LIMITS });
  const client = createPartitionEntry({ channel: pair[0], localParticipantId: requester.peerId, remoteParticipantId: coordinator.peerId,
    ordered: true, authorize, limits: LIMITS, inputLimits: INPUT_LIMITS });
  await client.refresh();
  const request = { meshId: 'mesh', modelId: 'model', modelIdentity: model.identity, planId: f.route.planId, route: f.route,
    coordinatorId: coordinator.peerId, threadId: 'thread', attemptId: 'attempt', placementGeneration: 0, messages: [{ role: 'user', content: 'Hello' }] };
  const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'attempt', requesterId: requester.peerId, placementGeneration: 0, route: f.route };
  return { f, client, request, identity, requester, received, stageIdentities,
    async close() { await Promise.allSettled([client.close(), server.close(), chat.close(), ...owners.map((owner) => owner.close())]); authority.close(); } };
}

describe('signed attempt evidence over the ordered route\'s channels', () => {
  it('carries the charge binding to every stage and each acknowledgment back to the route', async () => {
    const n = await network(3);
    try {
      const acknowledgments = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity: n.requester }),
        identity: n.identity, reservationId: 'rsv:quote_test' });
      const outputs = [], deltas = [];
      const result = await n.client.generate({ ...n.request, charge: acknowledgments.charge }, {
        onDelta: (text) => deltas.push(text),
        onOutput: async (record) => { const pair = await acknowledgments.observe(record); outputs.push([record.step, pair?.acknowledgment.count ?? null]); return pair; }
      });
      expect(result.content).toBe('012');
      expect(deltas).toEqual(['0', '1', '2']);
      // Every output arrived with the final stage's receipt, verified and acknowledged by the requester.
      expect(outputs).toEqual([[0, 1], [1, 2], [2, 3]]);
      const bundle = acknowledgments.evidence();
      expect(bundle.acknowledged.acknowledgment).toMatchObject({ count: 3, requesterId: n.requester.peerId, reservationId: 'rsv:quote_test' });
      expect(await verifyStageReceipt(bundle.acknowledged.receipt)).toMatchObject({ ok: true, body: { partitionIndex: 2, output: { count: 3, done: true } } });
      // The binding reached every stage's reservation, including the remote ones over their peer channels.
      expect(n.received.charges.filter(([index]) => index !== 2).map(([index, count]) => [index, count]).sort()).toEqual([[0, 0], [1, 0]]);
      expect(n.received.charges.filter(([index]) => index === 2)).toEqual([[2, 0]]);
      // Acknowledgments travel with later stage requests and with the coordinator's own closing request.
      expect(n.received.acknowledged[0]).toEqual([0, null]);
      expect(n.received.acknowledged.slice(1).every(([, count]) => count === null || count >= 1)).toBe(true);
      expect(n.received.closed.find(([index]) => index === 0)).toEqual([0, 3]);
    } finally { await n.close(); }
  });

  it('refuses a malformed charge binding before the input leaves the requester, and acknowledges nothing it did not receive', async () => {
    const n = await network(2);
    try {
      const acknowledgments = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity: n.requester }),
        identity: n.identity, reservationId: 'rsv:quote_test' });
      await expect(n.client.generate({ ...n.request, charge: { ...acknowledgments.charge, count: 1 } }, { onOutput: () => null }))
        .rejects.toThrow('Invalid partition entry input');
      await expect(n.client.generate({ ...n.request, charge: acknowledgments.charge }, {})).rejects.toThrow('acknowledgment port');
      // A receipt whose chain does not match the deltas this device received is never acknowledged, nor anything after it.
      const tampered = [];
      await n.client.generate({ ...n.request, charge: acknowledgments.charge }, {
        onOutput: async (record) => { const pair = await acknowledgments.observe({ ...record, delta: `${record.delta}!` }); tampered.push(pair); return pair; }
      });
      expect(tampered).toEqual([null, null, null]);
      expect(acknowledgments.evidence().acknowledged).toBeNull();
    } finally { await n.close(); }
  });
});

describe('stage receipt tallies', () => {
  it('sign cumulative receipts once per step, refuse an unbound charge and close once', async () => {
    const stage = await createSigningIdentity({ algorithm: 'Ed25519' }), requester = await createSigningIdentity({ algorithm: 'ECDSA' });
    const f = routeFixture(2);
    f.route.stages[1].participantId = stage.peerId;
    const identity = { schema: 'reploid.partition-attempt/v2', threadId: 't', attemptId: 'a', requesterId: requester.peerId, placementGeneration: 0, route: f.route };
    const acknowledgments = await openOutputAcknowledgments({ signer: createAttemptEvidenceSigner({ identity: requester }), identity, reservationId: 'rsv:q' });
    const signer = createAttemptEvidenceSigner({ identity: stage });
    await expect(openStageReceipts({ signer, identity: { ...identity, attemptId: 'other' }, partitionIndex: 1, charge: acknowledgments.charge }))
      .rejects.toThrow('charge binding');
    await expect(openStageReceipts({ signer, identity, partitionIndex: 0, charge: acknowledgments.charge })).rejects.toThrow('own signing identity');
    const tally = await openStageReceipts({ signer, identity, partitionIndex: 1, charge: acknowledgments.charge });
    const first = await tally.step({ step: 0, inputTokenCount: 2, delta: 'a' });
    expect(await tally.step({ step: 0, inputTokenCount: 2, delta: 'a' })).toEqual(first);
    const second = await tally.step({ step: 1, inputTokenCount: 1, delta: '', done: true, stopReason: 'eos' });
    expect(second).toMatchObject({ sequence: 2, steps: 2, status: 'executing', tokens: { prompt: 2, processed: 3 }, output: { count: 2, done: true } });
    const closed = await tally.close();
    expect(await tally.close()).toEqual(closed);
    expect(closed).toMatchObject({ sequence: 3, status: 'settled', steps: 2 });
    expect(await verifyStageReceipt(closed)).toMatchObject({ ok: true });
    expect(await verifyStageReceipt({ ...closed, tokens: { ...closed.tokens, processed: 4 } })).toMatchObject({ ok: false, problem: 'signature_invalid' });
    expect(await verifyStageReceipt({ ...closed, steps: 3 })).toMatchObject({ ok: false, problem: 'receipt_malformed' });
    expect(await verifyStageReceipt(closed, { publicJwk: requester.publicJwk })).toMatchObject({ ok: false, problem: 'signer_key_mismatch' });
    // The requester's chain over the same deltas matches the stage's commitment at every count.
    expect(await acknowledgments.observe({ step: 0, delta: 'a', receipt: first })).toMatchObject({ acknowledgment: { count: 1, chain: first.output.chain } });
    expect(await acknowledgments.observe({ step: 1, delta: '', receipt: second })).toMatchObject({ acknowledgment: { count: 2, chain: second.output.chain } });
  });
});
