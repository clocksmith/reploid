// @vitest-environment node
// One mesh operation envelope (packages/reploid/src/mesh/operation-envelope.js) through the parts a native host
// composes: the text requester, the accounted fleet requester, a loopback transport, the provider's credit admission
// and its scoped Doppler provider over a mock session, with a real SQLite ledger behind the fleet service. The session
// is a function; this shows the envelope's authorization, wire and settlement, not model inference or a physical peer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { countersignReceipt, createReceiptDraft, signReceiptDraft, verifyReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { hashJson, sha256Hex } from '../../packages/reploid/src/artifacts/signatures.js';
import { attachTargetScoring, requestTargetScore, verifyTargetScore } from '../../packages/reploid/src/mesh/target-scoring.js';
import { MESH_OPERATION_GRANT_SCHEMA, attachMeshOperations, createMeshOperationEnvelope, dispatchMeshOperation, meshOperationOffer,
  requestMeshOperation } from '../../packages/reploid/src/mesh/operation-envelope.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { createTextRequester } from '../../server/text-requester.js';
import { openScopedModelProvider } from '../../shared/infrastructure/scoped-model-provider.js';

const HASH = 'a'.repeat(64);
const model = { id: 'qwen-3-5-2b-q4k-ef16-af32', identity: 'sha256:' + HASH, provider: 'doppler', generation: { maxTokens: 16 } };
const messages = [{ role: 'system', content: 'Answer briefly.' }, { role: 'user', content: 'Offer a brief notice of quitting.' }];
const SCORE = Object.freeze({ schema: 'doppler.target-sequence-score/v1', interpretation: 'teacher-forced-target-log-probability',
  tokenCount: 3, promptTokenCount: 21, targetTokenIds: [40, 9, 13], tokenLogProbs: [-0.1, -0.2, -0.03], totalLogProb: -0.33,
  meanLogProb: -0.11, roundedTotalLogProb: -0.33 });
const PRICE = 2;

let root, keys, credits, service, cleanup;
beforeEach(async () => {
  cleanup = [];
  root = await mkdtemp(path.join(os.tmpdir(), 'mesh-operation-dispatch-'));
  keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'),
    computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: `owner-${index}`,
      providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] })),
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit', creditsPerOutputToken: PRICE,
      maxDebt: 100, maxOutputTokens: 16, maxPendingPerComputer: 2, maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: false,
      wholeModelTerminalCharge: 0 } });
  service = await startFleetService({ credits, models: [model],
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
});
afterEach(async () => {
  for (const step of cleanup.reverse()) await step();
  await service?.close();
  credits?.close();
  await rm(root, { recursive: true, force: true });
});

/** Two in-memory transport ends. `wire` records every frame either side sends, with its byte length. */
function loopback() {
  const handlers = { requester: new Map(), provider: new Map() }, wire = [];
  const end = (self, other) => ({
    getPeerBinding: () => ({ local: `cert-${self}`, remote: `cert-${other}` }),
    onMessage: (type, fn) => handlers[self].set(type, fn),
    sendToPeer: (_peer, type, payload) => {
      wire.push({ from: self, type, bytes: Buffer.byteLength(JSON.stringify(payload)) });
      const copy = structuredClone(payload);
      queueMicrotask(() => handlers[other].get(type)?.(`${self}-peer`, copy));
      return true;
    }
  });
  return { wire, requester: end('requester', 'provider'), provider: end('provider', 'requester') };
}

/** A Doppler session stub: text streaming and target scoring, as DopplerX 0.1.7 exposes them. */
function mockSession() {
  return {
    loaded: true, modelId: model.id, manifestHash: HASH, activeLoRA: null, manifest: {},
    supports: capability => capability === 'targetScoring',
    resetGenerationState: vi.fn(async () => {}),
    async *stream() { yield 'I resign.'; },
    generate: vi.fn(async () => ({ outputText: 'I resign.' })),
    // `hold`, when set, keeps the score pending until it resolves (or the call's signal aborts).
    hold: null,
    scoreTargetSequence: vi.fn(async function score(request, { signal } = {}) {
      if (this.hold) await Promise.race([this.hold, new Promise((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))]);
      return { ...SCORE, request };
    })
  };
}

async function fixture({ partition = false } = {}) {
  const [requester, provider] = keys, link = loopback(), session = mockSession();
  const providerCredits = createFleetClient({ url: service.url, identity: provider });
  const requesterCredits = createFleetClient({ url: service.url, identity: requester });
  const lifetime = new AbortController();
  cleanup.push(() => lifetime.abort());
  const scoped = await openScopedModelProvider({ model, service: { open: async () => session }, scope: 'test', signal: lifetime.signal,
    generation: { maxTokens: 16 }, maxOutcomeCharacters: 4096,
    providerPolicy: { contextCache: { maxBytes: 1, maxEntryBytes: 1 }, adapterQualification: { messages: [], generation: {} } } });
  // The provider: authorized against its own offer, credit-admitted, then run on the resident session.
  // `trust.requester` false models a requester whose identity the provider cannot verify.
  const trust = { requester: true };
  const requesterOf = peer => (trust.requester && peer === 'requester-peer' ? requester.peerId : null);
  const admission = createFleetExecutionAdmission({ credits: providerCredits, model });
  // The earlier Daily path: a provider-signed score bound to the answer's receipt (mesh/target-scoring.js).
  attachTargetScoring({ transport: link.provider, identity: provider, verifyPeer: async peer => requesterOf(peer), currentPeer: requesterOf,
    score: request => scoped.scoreTarget(request) });
  attachMeshOperations({ transport: link.provider, identity: provider,
    verifyPeer: async peer => requesterOf(peer), currentPeer: requesterOf,
    offer: () => ({ participantId: provider.peerId, protection: 'plaintext', route: 'remote', modelIdentity: model.identity,
      supportedOperations: scoped.supportedOperations() }),
    admit: input => admission.operation(input),
    dispatch: (envelope, signal) => dispatchMeshOperation(scoped, envelope, { signal }) });
  // The requester's discovery: the provider's whole-model route, or an ordered split through it.
  const discovered = partition
    ? { models: [{ ...model, partition: { planId: 'plan-1', route: { backend: 'doppler-partition-plaintext/v1', stages: [{ participantId: provider.peerId }] } } }], peers: [] }
    : { models: [model], peers: [{ peerId: 'provider-peer', participantId: provider.peerId, identityVerified: true, modelIdentity: model.identity,
      supportedOperations: scoped.supportedOperations() }] };
  // What the native host composes for `executeMeshOperation` (server/fleet/native-host.js).
  const accounted = createFleetRequester({ identity: requester, credits: requesterCredits, maxOutputTokens: 16,
    participant: { generate: () => { throw Error('not used'); },
      sendMeshOperation: (envelope, controls) => requestMeshOperation({ transport: link.requester,
        verifyPeer: async peer => (peer === 'provider-peer' ? provider.peerId : null), currentPeer: peer => (peer === 'provider-peer' ? provider.peerId : null),
        providerPeer: 'provider-peer', envelope, ...controls }) } });
  const execute = (envelope, { signal } = {}) => accounted.executeOperation(envelope, { signal, offer: value => meshOperationOffer(discovered, value) });
  const host = { getState: () => ({ models: discovered.models }), getNetworkState: () => ({ peers: discovered.peers }),
    generate: () => { throw Error('not used'); }, executeMeshOperation: execute };
  const authorize = vi.fn(async () => true);
  const text = createTextRequester({ participant: host, authenticate: async () => ({ subject: 'tester' }), authorize }, { path: '/v1/unused' });
  cleanup.push(() => text.close());
  const envelope = (grant = {}) => createMeshOperationEnvelope({ requestId: crypto.randomUUID(), operation: 'scoreTargetSequence',
    modelId: model.id, manifestDigest: model.identity, maxCostUnits: 1, payload: { messages, target: 'I resign.' },
    execution: { protection: 'plaintext', route: partition ? 'auto' : 'remote', participants: { kind: 'named', ids: [provider.peerId] } },
    recipientGrant: { schema: MESH_OPERATION_GRANT_SCHEMA, recipient: provider.peerId, grantedAt: Date.now(), revokedAt: null, ...grant } });
  const providerOf = peer => (peer === 'provider-peer' ? provider.peerId : null);
  const scoreAgainstReceipt = (receipt, { signal } = {}) => requestTargetScore({ transport: link.requester, verifyPeer: async peer => providerOf(peer),
    currentPeer: providerOf, providerPeer: 'provider-peer', providerParticipantId: provider.peerId, receipt, messages, target: 'I resign.', ...(signal ? { signal } : {}) });
  return { link, session, text, accounted, execute, authorize, envelope, trust, scoreAgainstReceipt, answerReceipt: () => answerReceipt(provider, requester) };
}

/** The countersigned receipt of the answer the earlier path scores against: provider-signed, requester-countersigned. */
async function answerReceipt(provider, requester) {
  const draft = await createReceiptDraft({ version: 2, provider: provider.peerId, consumer: requester.peerId, jobHash: 'request:answer-1', model: model.id,
    modelIdentity: model.identity, adapterIdentities: [], inputDigest: await hashJson(messages), outputDigest: await sha256Hex('I resign.'),
    inputTokens: 21, outputTokens: 3, usage: 'raw-model-tokens/v1', stopReason: 'eos', cleanup: 'settled', ownerPolicyDigest: null, status: 'completed' });
  return countersignReceipt(await signReceiptDraft(draft, provider), requester);
}

const holds = () => credits.snapshot().accounts.map(row => row.held);
const requests = () => credits.snapshot().journal.length;

it('scoreTargetSequence through the standard requester returns its value and settles one unit; a revoked grant sends no bytes', async () => {
  const f = await fixture();
  const envelope = await f.envelope();
  const result = await f.text.executeMeshOperation(envelope, { principal: { subject: 'tester' } });
  expect(f.authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'mesh.operation', envelope }));
  expect(result.output).toMatchObject({ schema: SCORE.schema, roundedTotalLogProb: -0.33, tokenCount: 3, modelIdentity: model.identity });
  expect(f.session.scoreTargetSequence).toHaveBeenCalledOnce();
  expect(f.session.scoreTargetSequence.mock.calls[0][0]).toMatchObject({ messages, target: 'I resign.' });
  expect(result.acknowledgedUnits).toBe(1);
  expect(await verifyReceipt(result.providerReceipt)).toMatchObject({ providerValid: true, consumerValid: true });
  expect(result.providerReceipt).toMatchObject({ provider: keys[1].peerId, consumer: keys[0].peerId, jobHash: `request:${envelope.requestId}`,
    usage: 'reploid.mesh-operation-units/v1', stopReason: 'operation:scoreTargetSequence', outputTokens: 1 });
  // Settled on the ledger: one unit at the signed price, paid to the provider, nothing left held.
  const row = credits.request(`service:${keys[0].peerId}:${envelope.requestId}`);
  expect(row).toMatchObject({ state: 'settled', binding: { operation: 'scoreTargetSequence', maxOutputTokens: 1 },
    outcome: { outputTokens: 1, charge: PRICE } });
  expect(result.settlement).toMatchObject({ outputTokens: 1, charge: PRICE });
  expect(holds()).toEqual([0, 0]);

  // A revoked grant: refused before any hold and before any byte reaches the wire.
  const sent = f.link.wire.length, journal = requests();
  const revoked = await f.envelope({ revokedAt: Date.now() });
  await expect(f.text.executeMeshOperation(revoked, { principal: { subject: 'tester' } })).rejects.toMatchObject({ code: 'OPERATION_GRANT_REVOKED' });
  expect(f.link.wire.slice(sent).reduce((sum, frame) => sum + frame.bytes, 0)).toBe(0);
  expect(credits.request(`service:${keys[0].peerId}:${revoked.requestId}`)).toBeNull();
  expect(requests()).toBe(journal);
  expect(holds()).toEqual([0, 0]);
  expect(f.session.scoreTargetSequence).toHaveBeenCalledOnce();
});

it('scoreTargetSequence on a split route offer is refused synchronously with UNSUPPORTED_OPERATION: no dispatch and no hold', async () => {
  const f = await fixture({ partition: true });
  const envelope = await f.envelope();
  let thrown = null;
  try { f.execute(envelope); } catch (error) { thrown = error; }
  expect(thrown).toMatchObject({ code: 'UNSUPPORTED_OPERATION' });
  await Promise.resolve();
  expect(f.link.wire).toEqual([]);
  expect(f.session.scoreTargetSequence).not.toHaveBeenCalled();
  expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toBeNull();
  expect(holds()).toEqual([0, 0]);
});

// Parity with the receipt-bound score Daily used before (mesh/target-scoring.js), on the same provider and session:
// the same score, the same refusals before the session is touched, the same signer, and how each cancels.
describe('scoreTargetSequence through the envelope, against the earlier receipt-bound score', () => {
  it('gives the same score from the same session call, signed by the same provider for the same requester and model artifact', async () => {
    const f = await fixture();
    const earlier = await f.scoreAgainstReceipt(await f.answerReceipt());
    const envelope = await f.envelope(), current = await f.execute(envelope);
    expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(2);
    const [[before], [after]] = f.session.scoreTargetSequence.mock.calls;
    expect(after).toEqual(before);
    expect(after).toMatchObject({ messages, target: 'I resign.' });
    // The score Daily stores, from each path.
    expect(Math.round(current.output.roundedTotalLogProb * 100)).toBe(earlier.totalLogProbHundredths);
    expect(current.output.tokenCount).toBe(earlier.tokenCount);
    // Receipts: the earlier record is signed by the provider; the envelope's receipt is signed by the provider and
    // countersigned by the requester, and it is settled. Both name the same signer, requester and model artifact.
    expect(await verifyTargetScore(earlier)).toBe(true);
    expect(await verifyReceipt(current.providerReceipt)).toMatchObject({ providerValid: true, consumerValid: true });
    for (const key of ['provider', 'consumer', 'modelIdentity']) expect(current.providerReceipt[key]).toBe(earlier[key]);
    expect(current.providerReceipt.providerKey).toEqual(earlier.providerKey);
    expect(current.settlement).toMatchObject({ outputTokens: 1, charge: PRICE });
  });

  it('both refuse a requester the provider cannot verify before the session is touched; only the envelope also refuses a revoked grant', async () => {
    const f = await fixture();
    const receipt = await f.answerReceipt(), envelope = await f.envelope();
    f.trust.requester = false;
    await expect(f.scoreAgainstReceipt(receipt)).rejects.toThrow('Verified requester required');
    await expect(f.execute(envelope)).rejects.toThrow('Verified requester required');
    expect(f.session.scoreTargetSequence).not.toHaveBeenCalled();
    // The envelope's hold for the refused call is fenced; the provider never admitted it, so it settles at zero now.
    expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toMatchObject({ state: 'settled', outcome: { charge: 0, outputTokens: 0 } });
    expect(holds()).toEqual([0, 0]);
    const sent = f.link.wire.length;
    const revoked = await f.envelope({ revokedAt: Date.now() });
    expect(() => f.execute(revoked)).toThrow(expect.objectContaining({ code: 'OPERATION_GRANT_REVOKED' }));
    expect(f.link.wire.length).toBe(sent);
  });

  it('cancelling: both stop the requester waiting; the envelope also cancels the provider\'s call and settles its hold at zero', async () => {
    const f = await fixture();
    let release;
    f.session.hold = new Promise(resolve => { release = resolve; });
    const receipt = await f.answerReceipt(), earlier = new AbortController();
    const pendingEarlier = f.scoreAgainstReceipt(receipt, { signal: earlier.signal });
    await vi.waitFor(() => expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(1));
    earlier.abort(new Error('stopped'));
    await expect(pendingEarlier).rejects.toThrow('stopped');
    const envelope = await f.envelope(), current = new AbortController();
    const pendingCurrent = f.execute(envelope, { signal: current.signal });
    await vi.waitFor(() => expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(2));
    current.abort(new Error('stopped'));
    await expect(pendingCurrent).rejects.toThrow('stopped');
    // The provider's own call for the envelope ends with the requester's cancel; the earlier path's call runs on.
    const providerSignal = call => f.session.scoreTargetSequence.mock.calls[call][1].signal;
    await vi.waitFor(() => expect(providerSignal(1).aborted).toBe(true));
    expect(providerSignal(0).aborted).toBe(false);
    await vi.waitFor(() => expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toMatchObject({ state: 'settled',
      outcome: { charge: 0, status: 'cancelled' } }));
    expect(holds()).toEqual([0, 0]);
    release();
  });
});
