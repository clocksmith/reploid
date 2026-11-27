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
import { MESH_OPERATION_GRANT_SCHEMA, MESH_OPERATION_RECEIPT, MESH_OPERATION_REQUEST, attachMeshOperations, createMeshOperationEnvelope,
  dispatchMeshOperation, meshOperationInputDigest, meshOperationOffer, openMeshOperationCharge, requestMeshOperation } from '../../packages/reploid/src/mesh/operation-envelope.js';
import { OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner }
  from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_FAULT_SCHEMA, SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA } from '../../packages/reploid/src/mesh/settlement-terms.js';
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
      const copy = structuredClone(payload);
      wire.push({ from: self, type, bytes: Buffer.byteLength(JSON.stringify(payload)), payload: structuredClone(payload) });
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
  const hostAuthorize = vi.fn(async () => true), providerRecords = [], providerReceipts = [];
  const operations = attachMeshOperations({ transport: link.provider, identity: provider,
    verifyPeer: async peer => requesterOf(peer), currentPeer: requesterOf,
    offer: () => ({ participantId: provider.peerId, protection: 'plaintext', route: 'remote', modelIdentity: model.identity,
      supportedOperations: scoped.supportedOperations() }),
    authorize: hostAuthorize, admit: input => admission.operation(input), settlementAccount: () => admission.settlementAccount(),
    onSettlementRecords: value => providerRecords.push(value), onReceipt: receipt => providerReceipts.push(receipt),
    dispatch: (envelope, signal) => dispatchMeshOperation(scoped, envelope, { signal }) });
  cleanup.push(() => operations.close());
  // The requester's discovery: the provider's whole-model route, or an ordered split through it.
  const discovered = partition
    ? { models: [{ ...model, partition: { planId: 'plan-1', route: { backend: 'doppler-partition-plaintext/v1', stages: [{ participantId: provider.peerId }] } } }], peers: [] }
    : { models: [model], peers: [{ peerId: 'provider-peer', participantId: provider.peerId, identityVerified: true, modelIdentity: model.identity,
      supportedOperations: scoped.supportedOperations() }] };
  // What the native host composes for `executeMeshOperation` (server/fleet/native-host.js).
  const requesterRecords = [];
  const accounted = createFleetRequester({ identity: requester, credits: requesterCredits, maxOutputTokens: 16,
    onSettlementRecords: value => requesterRecords.push(value),
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
  return { link, session, text, accounted, execute, authorize, envelope, trust, scoreAgainstReceipt, answerReceipt: () => answerReceipt(provider, requester),
    hostAuthorize, operations, providerRecords, providerReceipts, requesterRecords, scoped, discovered };
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
    // The refused call never sent its payload, so the requester settles its hold at zero with its signed stop.
    expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toMatchObject({ state: 'settled', outcome: { charge: 0 } });
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

it('an operation whose signal is already aborted rejects at once and sends nothing', async () => {
  const f = await fixture();
  f.session.hold = new Promise(() => {});
  const envelope = await f.envelope(), aborted = AbortSignal.abort(new Error('already stopped'));
  const direct = requestMeshOperation({ transport: f.link.requester, verifyPeer: async () => keys[1].peerId, currentPeer: () => keys[1].peerId,
    providerPeer: 'provider-peer', envelope, signal: aborted });
  const settledWithin = (promise, ms) => Promise.race([promise.then(() => 'resolved', error => error.message),
    new Promise(resolve => setTimeout(() => resolve('pending'), ms))]);
  expect(await settledWithin(direct, 200)).toBe('already stopped');
  // A provider that never answers: the call still ends at once and nothing is sent to it.
  const silent = { sent: [], getPeerBinding: () => ({ local: 'a', remote: 'b' }), onMessage() {}, sendToPeer(_peer, type) { silent.sent.push(type); return true; } };
  const unanswered = requestMeshOperation({ transport: silent, verifyPeer: async () => keys[1].peerId, currentPeer: () => keys[1].peerId,
    providerPeer: 'provider-peer', envelope, signal: aborted });
  expect(await settledWithin(unanswered, 200)).toBe('already stopped');
  expect(silent.sent).toEqual([]);
  await expect(f.execute(envelope, { signal: aborted })).rejects.toThrow('already stopped');
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(f.link.wire).toEqual([]);
  expect(f.session.scoreTargetSequence).not.toHaveBeenCalled();
  expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toBeNull();
});

const schemas = records => records.map(row => row.schema);
const requesterFrames = f => f.link.wire.filter(frame => frame.from === 'requester');

describe('a non-generation operation goes through the policy and settlement path generation uses', () => {
  it('signs terms, acceptance, close and acknowledgment, sends the payload only after the acceptance, and settles one unit', async () => {
    const f = await fixture();
    const envelope = await f.envelope(), result = await f.execute(envelope);
    // The first frame asks for admission without the payload; the payload leaves only in the second.
    const [ask, run, back] = requesterFrames(f);
    expect(ask).toMatchObject({ type: MESH_OPERATION_REQUEST, payload: { inputDigest: expect.stringMatching(/^sha256:/),
      settlement: { terms: { schema: SETTLEMENT_TERMS_SCHEMA, maxOutputTokens: 1 } } } });
    expect(ask.payload.envelope).not.toHaveProperty('payload');
    expect(JSON.stringify(ask.payload)).not.toContain('I resign.');
    const answer = f.link.wire.findIndex(frame => frame.from === 'provider' && frame.payload.admitted);
    expect(answer).toBeGreaterThan(f.link.wire.indexOf(ask));
    expect(f.link.wire.indexOf(run)).toBeGreaterThan(answer);
    expect(run.payload.envelope.payload).toEqual({ messages, target: 'I resign.' });
    // The countersigned receipt and the acknowledgment go back in one frame.
    expect(back).toMatchObject({ type: MESH_OPERATION_RECEIPT, payload: { requestId: envelope.requestId,
      settlementAcknowledgment: { schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA, count: 1 } } });
    // The host was asked at admission and again before running.
    expect(f.hostAuthorize.mock.calls.map(([call]) => call.action)).toEqual(['operation.admit', 'operation.execute']);
    expect(f.hostAuthorize.mock.calls[0][0]).toMatchObject({ consumer: keys[0].peerId, envelope: { requestId: envelope.requestId } });
    expect(f.hostAuthorize.mock.calls[0][0].envelope).not.toHaveProperty('payload');
    // Generation's records, with one unit: the requester holds all of them, labelled signed.
    expect(result.settlementRecords).toMatchObject({ label: 'signed-records', acknowledged: 1, stopped: false, faulted: false, missing: [] });
    expect(schemas(result.settlementRecords.records)).toEqual([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA,
      SETTLEMENT_ACCEPTANCE_SCHEMA, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA]);
    expect(f.requesterRecords.at(-1).read()).toMatchObject({ label: 'signed-records' });
    // The provider's copy completes with the acknowledgment, and its host gets the countersigned receipt.
    await vi.waitFor(() => expect(f.providerReceipts).toHaveLength(1));
    expect(await verifyReceipt(f.providerReceipts[0])).toMatchObject({ providerValid: true, consumerValid: true });
    expect(schemas(f.providerRecords.at(-1).records)).toEqual(schemas(result.settlementRecords.records));
    expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toMatchObject({ state: 'settled', outcome: { outputTokens: 1, charge: PRICE } });
    expect(holds()).toEqual([0, 0]);
  });

  it('a requester that sends the payload without an admission is refused before the session is touched', async () => {
    const f = await fixture();
    const envelope = await f.envelope(), replies = [];
    f.link.requester.onMessage('reploid:mesh-operation-result', (_peer, payload) => replies.push(payload));
    f.link.requester.sendToPeer('provider-peer', MESH_OPERATION_REQUEST, { envelope });
    await vi.waitFor(() => expect(replies).toHaveLength(1));
    expect(replies[0]).toMatchObject({ requestId: envelope.requestId, code: 'OPERATION_REQUEST_INVALID', error: expect.stringContaining('not admitted') });
    expect(f.session.scoreTargetSequence).not.toHaveBeenCalled();
  });

  it('a host that declines the requester refuses at admission: no payload is sent and the hold settles at zero', async () => {
    const f = await fixture();
    f.hostAuthorize.mockResolvedValue(false);
    const envelope = await f.envelope();
    await expect(f.execute(envelope)).rejects.toMatchObject({ code: 'OPERATION_REFUSED' });
    expect(requesterFrames(f).map(frame => frame.payload.envelope?.payload)).toEqual([undefined]);
    expect(f.session.scoreTargetSequence).not.toHaveBeenCalled();
    expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toMatchObject({ state: 'settled', outcome: { charge: 0 } });
    expect(holds()).toEqual([0, 0]);
  });

  it('a provider that does not sign an acceptance of the terms is never sent the payload', async () => {
    const f = await fixture();
    const original = f.link.provider.sendToPeer;
    // The provider's acceptance is altered on the wire, so it no longer verifies.
    f.link.provider.sendToPeer = (peer, type, payload) => original(peer, type, payload?.admitted
      ? { ...payload, admitted: { settlementAcceptance: { ...payload.admitted.settlementAcceptance, signature: 'x' } } } : payload);
    const envelope = await f.envelope();
    await expect(f.execute(envelope)).rejects.toMatchObject({ code: 'OPERATION_RESULT_INVALID' });
    expect(requesterFrames(f).some(frame => frame.payload.envelope?.payload)).toBe(false);
    expect(f.session.scoreTargetSequence).not.toHaveBeenCalled();
    expect(holds()).toEqual([0, 0]);
  });

  it('runs one operation at a time: a second admission while one runs is refused as busy', async () => {
    const f = await fixture();
    let release;
    f.session.hold = new Promise(resolve => { release = resolve; });
    const first = f.execute(await f.envelope());
    await vi.waitFor(() => expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(1));
    expect(f.operations.running()).toBe(1);
    const second = await f.envelope();
    await expect(f.execute(second)).rejects.toMatchObject({ code: 'OPERATION_BUSY' });
    expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(1);
    release();
    await expect(first).resolves.toMatchObject({ acknowledgedUnits: 1 });
    expect(f.operations.running()).toBe(0);
    await vi.waitFor(() => expect(holds()).toEqual([0, 0]));
  });

  it('close() aborts what runs, signs the provider\'s fault, refuses new work and resolves once every attempt ended', async () => {
    const f = await fixture();
    f.session.hold = new Promise(() => {});
    const running = f.execute(await f.envelope());
    running.catch(() => {});
    await vi.waitFor(() => expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(1));
    await f.operations.close();
    expect(f.operations.running()).toBe(0);
    const failure = await running.catch(error => error);
    expect(failure).toBeInstanceOf(Error);
    expect(f.session.scoreTargetSequence.mock.calls[0][1].signal.aborted).toBe(true);
    await vi.waitFor(() => expect(schemas(failure.settlementRecords.records)).toContain(SETTLEMENT_FAULT_SCHEMA));
    await expect(f.execute(await f.envelope())).rejects.toMatchObject({ code: 'OPERATION_REFUSED' });
    expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(1);
  });

  it('a cancelled operation keeps the provider\'s close that claims nothing and the requester\'s stop', async () => {
    const f = await fixture();
    f.session.hold = new Promise(() => {});
    const envelope = await f.envelope(), controller = new AbortController();
    const pending = f.execute(envelope, { signal: controller.signal });
    await vi.waitFor(() => expect(f.session.scoreTargetSequence).toHaveBeenCalledTimes(1));
    controller.abort(new Error('stopped'));
    const failure = await pending.catch(error => error);
    expect(failure.message).toBe('stopped');
    await vi.waitFor(() => expect(schemas(failure.settlementRecords.records)).toEqual(expect.arrayContaining([SETTLEMENT_STOP_SCHEMA, STAGE_RECEIPT_SCHEMA])));
    expect(failure.settlementRecords.records.find(row => row.schema === STAGE_RECEIPT_SCHEMA)).toMatchObject({ status: 'failed', output: { count: 0 } });
    await vi.waitFor(() => expect(credits.request(`service:${keys[0].peerId}:${envelope.requestId}`)).toMatchObject({ state: 'settled', outcome: { charge: 0 } }));
  });
});

describe('a request of zero units is refused before anything is held or run', () => {
  const zero = [['scoreTargetSequence', { messages, target: '' }], ['scoreTargetSequence', { messages: [], target: 'I resign.' }],
    ['scoreChoices', { prompt: 'Pick one.', choices: [] }], ['embed', { input: '' }]];
  it.each(zero)('%s with %j is refused when the envelope is made', async (operation, payload) => {
    const grant = { schema: MESH_OPERATION_GRANT_SCHEMA, recipient: keys[1].peerId, grantedAt: Date.now(), revokedAt: null };
    await expect(createMeshOperationEnvelope({ requestId: crypto.randomUUID(), operation, modelId: model.id, manifestDigest: model.identity,
      maxCostUnits: 1, payload, execution: { protection: 'plaintext', route: 'remote' }, recipientGrant: grant }))
      .rejects.toMatchObject({ code: 'OPERATION_REQUEST_INVALID' });
  });

  it('a provider refuses a zero-unit payload from a requester that skipped the check, and closes claiming nothing', async () => {
    const [requester, provider] = keys, link = loopback(), dispatch = vi.fn(async () => SCORE), records = [];
    const operations = attachMeshOperations({ transport: link.provider, identity: provider, verifyPeer: async () => requester.peerId,
      currentPeer: () => requester.peerId, authorize: async () => true, onSettlementRecords: value => records.push(value), dispatch,
      offer: () => ({ participantId: provider.peerId, protection: 'plaintext', route: 'remote', modelIdentity: model.identity,
        supportedOperations: ['generate', 'scoreTargetSequence'] }) });
    cleanup.push(() => operations.close());
    const valid = await createMeshOperationEnvelope({ requestId: crypto.randomUUID(), operation: 'scoreTargetSequence', modelId: model.id,
      manifestDigest: model.identity, maxCostUnits: 1, payload: { messages, target: 'I resign.' }, execution: { protection: 'plaintext', route: 'remote' },
      recipientGrant: { schema: MESH_OPERATION_GRANT_SCHEMA, recipient: provider.peerId, grantedAt: Date.now(), revokedAt: null } });
    const empty = { ...structuredClone(valid), payload: { messages, target: '' } };
    const { policy } = await createFleetClient({ url: service.url, identity: requester }).call('terms', { id: model.id, identity: model.identity });
    const charge = await openMeshOperationCharge({ signer: createAttemptEvidenceSigner({ identity: requester }), requestId: empty.requestId,
      planDigest: empty.planDigest, recipient: provider.peerId, reservationId: `service:${requester.peerId}:${empty.requestId}`, policy, maxCostUnits: 1 });
    // requestMeshOperation refuses it too, so the frames are sent by hand: admission, then the payload once accepted.
    await expect(requestMeshOperation({ transport: link.requester, verifyPeer: async () => provider.peerId, currentPeer: () => provider.peerId,
      providerPeer: 'provider-peer', envelope: empty, settlement: charge })).rejects.toMatchObject({ code: 'OPERATION_REQUEST_INVALID' });
    const results = [];
    link.requester.onMessage('reploid:mesh-operation-result', (_peer, payload) => results.push(payload));
    const { payload: _payload, ...admission } = empty;
    link.requester.sendToPeer('provider-peer', MESH_OPERATION_REQUEST, { envelope: admission, inputDigest: await meshOperationInputDigest(empty),
      settlement: { terms: charge.terms, charge: charge.charge } });
    await vi.waitFor(() => expect(results).toHaveLength(1));
    await charge.accept(results[0].admitted.settlementAcceptance);
    link.requester.sendToPeer('provider-peer', MESH_OPERATION_REQUEST, { envelope: empty });
    await vi.waitFor(() => expect(results).toHaveLength(2));
    expect(results[1]).toMatchObject({ code: 'OPERATION_REQUEST_INVALID', error: expect.stringContaining('nothing to run') });
    await charge.close(results[1].settlement.receipt);
    expect(dispatch).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(charge.summary()).toMatchObject({ accepted: true, closed: true, faulted: false }));
    expect(charge.records().find(row => row.schema === STAGE_RECEIPT_SCHEMA)).toMatchObject({ status: 'failed', output: { count: 0, done: false } });
  });
});
