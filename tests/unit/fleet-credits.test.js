// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { createAttemptEvidenceSigner, attemptRouteHash, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';

const hash = 'sha256:' + 'a'.repeat(64), other = 'sha256:' + 'b'.repeat(64);
const policy = { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
  creditsPerOutputToken: 1, maxDebt: 20, maxOutputTokens: 20, maxPendingPerComputer: 2,
  maxClockSkewMs: 1000, maxRequestMs: 60000, allowSameOwner: true };
describe('enrolled fleet service credits', () => {
  let directory, ledger, identities, computers, options;
  const at = 1794300000000;
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'reploid-fleet-credit-'));
    identities = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    computers = identities.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: 'same-owner',
      providers: [{ participantId: identity.peerId, publicJwk: identity.publicJwk }] }));
    options = { file: path.join(directory, 'credits.sqlite'), computers, policy, now: () => at };
    ledger = await openFleetCredits(options);
  });
  afterEach(async () => { ledger?.close(); await rm(directory, { recursive: true, force: true }); });
  const request = (id = 'one', consumer = 0, provider = 1) => ({ id, executionId: `execution-${id}`, mode: 'whole-model',
    consumer: identities[consumer].peerId, providers: [{ participantId: identities[provider].peerId, weight: 1 }],
    model: { id: 'model', identity: hash, adapterIdentities: [] }, inputDigest: hash, maxOutputTokens: 10 });
  async function evidence(input, outputTokens = 6, provider = 1, consumer = 0) {
    const draft = await createReceiptDraft({ version: 2, provider: identities[provider].peerId, consumer: identities[consumer].peerId,
      jobHash: `request:${input.executionId}`, model: input.model.id, modelIdentity: input.model.identity, adapterIdentities: [],
      inputDigest: input.inputDigest, outputDigest: other, inputTokens: 12, outputTokens, usage: 'raw-model-tokens/v1',
      status: 'completed', cleanup: 'settled', stopReason: 'eos', ownerPolicyDigest: null, timestamp: at });
    return countersignReceipt(await signReceiptDraft(draft, identities[provider]), identities[consumer]);
  }
  function dispatch(input) { ledger.reserve(input); ledger.dispatch(input.id, input.consumer); }
  it('debits below zero, credits the provider, conserves totals and survives reopening', async () => {
    const input = request(); dispatch(input);
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 10, available: -10 });
    const receipt = await evidence(input);
    expect(await ledger.settle(input.id, receipt)).toMatchObject({ charge: 6, outputTokens: 6 });
    ledger.close(); ledger = await openFleetCredits(options);
    expect(ledger.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[-6, 0], [6, 0], [0, 0]]);
    await ledger.settle(input.id, receipt);
    expect(ledger.snapshot().journal).toHaveLength(2);
  });
  it('reserves against outstanding debt and concurrent holds before execution', () => {
    ledger.reserve(request('one')); ledger.reserve(request('two'));
    expect(() => ledger.reserve(request('three'))).toThrow('limit');
    ledger.abandonBeforeDispatch('two', identities[0].peerId);
    expect(ledger.reserve(request('three')).maximum).toBe(10);
  });
  it('will not release a dispatched unknown attempt just because the requester disconnects', () => {
    const input = request(); dispatch(input);
    expect(() => ledger.abandonBeforeDispatch(input.id, input.consumer)).toThrow('closed');
    expect(ledger.snapshot().accounts[0].held).toBe(10);
  });
  it('rejects wrong weights, model, input, consumer, counter signatures and inflated output', async () => {
    const input = request(); dispatch(input);
    const receipt = await evidence(input);
    for (const change of [{ modelIdentity: other }, { inputDigest: other }, { consumer: identities[2].peerId },
      { consumerSignature: '' }, { outputTokens: 11 }]) {
      await expect(ledger.settle(input.id, { ...receipt, ...change })).rejects.toThrow();
    }
    expect(ledger.snapshot().accounts.map(row => row.balance)).toEqual([0, 0, 0]);
  });
  it('refuses altered reservation replay and pays one actual execution only once across reservation ids', async () => {
    const input = request(); dispatch(input);
    expect(() => ledger.reserve({ ...input, maxOutputTokens: 9 })).toThrow('different terms');
    const receipt = await evidence(input);
    await ledger.settle(input.id, receipt);
    const duplicate = { ...input, id: 'another' }; dispatch(duplicate);
    await expect(ledger.settle(duplicate.id, receipt)).rejects.toThrow();
    expect(ledger.snapshot().accounts.map(row => row.balance)).toEqual([-6, 6, 0]);
  });
  it('groups reconnecting provider keys under one computer without making hardware an identity', async () => {
    ledger.close(); ledger = null;
    const alias = await createSigningIdentity({ algorithm: 'Ed25519' });
    computers[1].providers.push({ participantId: alias.peerId, publicJwk: alias.publicJwk });
    ledger = await openFleetCredits({ ...options, file: path.join(directory, 'grouped.sqlite') });
    expect(ledger.enrollment.byPeer.get(alias.peerId).computerId).toBe('computer-1');
    expect(ledger.snapshot().accounts).toHaveLength(3);
  });
  it('rejects unapproved enrollment changes and policy reinterpretation on an existing database', async () => {
    await expect(openFleetCredits({ ...options, policy: { ...policy, creditsPerOutputToken: 2 } })).rejects.toThrow('migration');
    await expect(openFleetCredits({ ...options, computers: computers.map(row => ({ ...row, ownerId: 'changed' })) })).rejects.toThrow('migration');
  });
  it('respects same-owner opt-out and rejects self-paid work', async () => {
    expect(() => ledger.reserve(request('self', 0, 0))).toThrow('Ineligible');
    ledger.close(); ledger = await openFleetCredits({ ...options, file: path.join(directory, 'unrelated.sqlite'), policy: { ...policy, allowSameOwner: false } });
    expect(() => ledger.reserve(request())).toThrow('Ineligible');
  });
  it('pays both settled stages by accepted shares and rejects an incomplete or mismatched chain', async () => {
    const route = { schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: hash, planId: hash,
      stages: identities.slice(1).map((identity, index) => ({ index, participantId: identity.peerId,
        transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `stage-${index}` })),
      activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 1024, precision: 'f32', components: 1, elementStrideBytes: 4 } };
    const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'execution-one',
      requesterId: identities[0].peerId, placementGeneration: 0, route };
    const input = { ...request(), mode: 'partition', route: identity,
      providers: [{ participantId: identities[1].peerId, weight: 1 }, { participantId: identities[2].peerId, weight: 2 }] };
    dispatch(input);
    const routeHash = await attemptRouteHash(identity), signedAt = new Date(at).toISOString();
    const receipts = await Promise.all([1, 2].map(async (owner, index) => createAttemptEvidenceSigner({ identity: identities[owner] }).sign(STAGE_RECEIPT_SCHEMA,
      { schema: STAGE_RECEIPT_SCHEMA, reservationId: input.id, attemptId: input.executionId, routeHash, partitionIndex: index,
        participantId: identities[owner].peerId, sequence: 2, status: 'settled', steps: 7, tokens: { prompt: 12, processed: 19 },
        timing: { reservedAt: signedAt, firstStepAt: signedAt, lastStepAt: signedAt, closedAt: signedAt },
        output: index === 1 ? { count: 7, chain: other, done: true, stopReason: 'eos' } : null, signedAt })));
    const acknowledgment = await createAttemptEvidenceSigner({ identity: identities[0] }).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA,
      { schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA, reservationId: input.id, attemptId: input.executionId, routeHash,
        requesterId: identities[0].peerId, count: 7, chain: other, signedAt });
    await expect(ledger.settle(input.id, { identity, receipts: receipts.slice(1), acknowledgment })).rejects.toThrow();
    await expect(ledger.settle(input.id, { identity, receipts, acknowledgment: { ...acknowledgment, chain: hash } })).rejects.toThrow();
    const result = await ledger.settle(input.id, { identity, receipts, acknowledgment });
    expect(result.credits.map(row => row.amount)).toEqual([2, 5]);
    expect(ledger.snapshot().accounts.map(row => row.balance)).toEqual([-7, 2, 5]);
  });
});
