// @vitest-environment node
// An ordinary whole-model request with signed settlement records, end to end in one process: a SQLite ledger behind the
// signed fleet service, the fleet requester, two meshes joined in memory and the provider's credit admission. The
// requester holds no weights and runs only library code a browser can run. Provider execution is a function and the
// two parties are keys on one machine: this shows the records, the refusals and that the ledger's debit and payout
// can be reproduced from them, not model inference, a physical peer or two separate people.
import { afterEach, beforeEach, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
import { STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA } from '../../packages/reploid/src/mesh/settlement-terms.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { buildTradeReceipt } from '../../server/fleet/trade-records.js';
import { createWholeModelRequester } from '../../server/whole-model-requester.js';
import { verifyTrade } from '../../scripts/settlement/verify-trade.js';
import { exportFromReceipt } from '../../scripts/settlement/records-export.js';
import { verifyRecords } from '../../scripts/settlement/verify-records.js';
import { createRecoveryMesh } from '../helpers/generation-recovery-mesh.js';

const run = promisify(execFile);
const model = { id: 'qwen-3-5-2b-q4k-ef16-af32', identity: 'sha256:' + 'a'.repeat(64), provider: 'doppler', generation: { maxTokens: 16 } };
const messages = [{ role: 'user', content: 'Count upward from one.' }];
const PRICE = 2;
const answer = (content, tokens) => ({ model: model.id, modelIdentity: model.identity, adapterIdentities: [], content,
  completion: { schema: 'doppler.generation-completion/v1', promptTokenCount: 11, generatedTokenCount: tokens, stopReason: 'eos-token' } });
const schemas = records => records.map(record => record.schema);

let root, keys, credits, service, clients, clockOffset, cleanup;
const ledgerNow = () => Date.now() + clockOffset;
const account = index => credits.snapshot().accounts.find(row => row.id === `account-${index}`);
const openRequests = () => credits.snapshot().accounts.reduce((sum, row) => sum + row.held, 0);

beforeEach(async () => {
  clockOffset = 0; cleanup = [];
  root = await mkdtemp(path.join(os.tmpdir(), 'whole-model-signed-charge-'));
  keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'), now: ledgerNow,
    // Account 0 has no starter credit: it can spend only what it earned by serving. Each account is its own owner.
    computers: keys.map((key, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: `account-${index}`,
      ...(index === 0 ? { debtLimit: 0 } : {}), providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] })),
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: PRICE, maxDebt: 100, maxOutputTokens: 16, maxPendingPerComputer: 2,
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: false, wholeModelTerminalCharge: 0 } });
  service = await startFleetService({ credits, models: [model],
    placementPolicy: { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 } });
  clients = keys.map(identity => createFleetClient({ url: service.url, identity }));
});
afterEach(async () => {
  for (const close of cleanup.reverse()) await close();
  await service?.close();
  credits?.close();
  await rm(root, { recursive: true, force: true });
});

/**
 * One requester and one provider on the shared ledger. `signs: false` is a contributor on code that predates the
 * signed records: it has no payout-account port, so it advertises nothing and is sent exactly the earlier wire.
 */
async function route({ requester, provider, execute, signs = true, requireVerifiableCharge = false, drop = () => false }) {
  const kept = [];
  const admission = createFleetExecutionAdmission({ credits: clients[provider], model });
  let wholeRequester;
  const mesh = await createRecoveryMesh(cleanup, {
    identities: [keys[requester], keys[provider]], modelId: model.id, modelIdentity: model.identity,
    authorize: async input => {
      if (input.action === 'mesh.dispatch') return wholeRequester.authorize(input);
      if (input.action === 'mesh.admit') return admission.preadmit({ request: input.request, consumer: keys[requester].peerId });
      if (input.action === 'mesh.execute') return admission.whole({ request: input.request, consumer: keys[requester].peerId });
      return true;
    },
    execute, drop,
    // The provider's host settles the countersigned receipt, as the native host does.
    ports: index => (index ? { onReceipt: receipt => admission.receipt(receipt),
      ...(signs ? { settlementAccount: () => admission.settlementAccount(), onSettlementRecords: value => { kept.push(value); } } : {}) } : {})
  });
  wholeRequester = createWholeModelRequester({ mesh: mesh.requesterMesh, models: [model] });
  const stored = new Map();
  const fleet = createFleetRequester({ participant: { generate: (request, controls) => wholeRequester.generate(request, controls) },
    identity: keys[requester], credits: clients[requester], maxOutputTokens: 16, requireVerifiableCharge,
    onSettlementRecords: ({ reservationId, read }) => stored.set(reservationId, read) });
  const ask = ({ signal = new AbortController().signal, onDelta = () => {}, verifiableCharge } = {}) => fleet.generate({
    threadId: 'thread-1', attemptId: crypto.randomUUID(), model, messages,
    privacy: createExecutionPolicy({ placement: 'network-allowed', recipients: { kind: 'open', ids: [] } }),
    ...(verifiableCharge ? { verifiableCharge } : {}) }, { signal, requestApproval: async () => true, onDelta });
  const sent = type => mesh.wire.filter(item => item.type === type).map(item => item.payload);
  /** What the page exports for one request: the requester's records with the ledger's own record of the reservation. */
  const exported = async reservationId => buildTradeReceipt({ records: stored.get(reservationId)(),
    trace: await clients[requester].call('trace', { id: reservationId }) });
  return { ask, sent, exported, stored, providerRecords: kept, mesh };
}

it('a requester with no weights spends credits it earned by serving, and both verifiers reproduce the debit and payout from the exported records', async () => {
  // Earn. Account 0 cannot spend yet: no starter credit and nothing earned.
  const broke = await route({ requester: 0, provider: 1, execute: async () => answer('never', 1) });
  await expect(broke.ask()).rejects.toMatchObject({ creditRefusal: { code: 'SERVICE_CREDIT_INSUFFICIENT' } });
  expect(broke.sent('reploid:generation-admit')).toHaveLength(0);
  // It serves one full-length answer, which earns exactly the hold its own next request needs.
  const EARNED = 16 * PRICE;
  const earning = await route({ requester: 1, provider: 0, execute: async (_messages, update) => { update('sixteen tokens'); return answer('sixteen tokens', 16); } });
  const earned = await earning.ask();
  expect(earned.serviceCredit).toMatchObject({ charge: EARNED, outputTokens: 16 });
  expect(account(0).balance).toBe(EARNED);

  // Spend, from a requester that holds no model: the terms and the charge binding leave with the admission question,
  // the acceptance comes back before the prompt is sent, and the close and its acknowledgment follow the answer.
  const spending = await route({ requester: 0, provider: 1, execute: async (_messages, update) => { update('1 2 3'); return answer('1 2 3', 3); } });
  const result = await spending.ask();
  expect(result.content).toBe('1 2 3');
  expect(result.serviceCredit).toMatchObject({ charge: 3 * PRICE, outputTokens: 3 });
  expect(account(0)).toMatchObject({ balance: EARNED - 3 * PRICE, held: 0 });
  expect(account(1)).toMatchObject({ balance: -EARNED + 3 * PRICE, held: 0 });

  const admit = spending.sent('reploid:generation-admit')[0], admitted = spending.sent('reploid:generation-admitted')[0];
  expect(admit.messages).toBeUndefined();
  expect(admit.settlement.terms).toMatchObject({ schema: SETTLEMENT_TERMS_SCHEMA, requesterId: keys[0].peerId, debitAccount: 'account-0',
    creditsPerOutputToken: PRICE, maxOutputTokens: 16, maximum: 16 * PRICE, shares: [{ partitionIndex: 0, participantId: keys[1].peerId, weight: 1 }] });
  expect(admitted.settlementAcceptance).toMatchObject({ schema: SETTLEMENT_ACCEPTANCE_SCHEMA, participantId: keys[1].peerId, payoutAccount: 'account-1' });
  // The prompt left only after the acceptance was on the wire.
  const order = spending.mesh.wire.map(item => item.type);
  expect(order.indexOf('reploid:generation-admitted')).toBeLessThan(order.indexOf('reploid:generation-request'));

  const records = result.settlementRecords;
  expect(records).toMatchObject({ label: 'signed-records', missing: [], acknowledged: 3, stopped: false });
  expect(schemas(records.records)).toEqual([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, SETTLEMENT_ACCEPTANCE_SCHEMA, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA]);
  // The provider holds the same attempt's records, with the requester's acknowledgment of its close.
  expect(schemas(spending.providerRecords[0].records)).toEqual(schemas(records.records));

  const receipt = await spending.exported(records.reservationId);
  expect(receipt).toMatchObject({ label: 'signed-records', ledgerRecord: 'included',
    requester: { participantId: keys[0].peerId, accountId: 'account-0' }, hosts: [{ participantId: keys[1].peerId, accountId: 'account-1' }] });
  const verdict = await verifyTrade({ receipt, at: Date.now() });
  expect(verdict.attempts[0].problems).toEqual([]);
  expect(verdict).toMatchObject({ ok: true, attempts: [{ name: 'answer', facts: { status: 'settled', debit: 3 * PRICE,
    payouts: { [keys[1].peerId]: 3 * PRICE }, accounts: { requester: 'account-0', stages: ['account-1'] }, enrollmentChecked: true } }] });

  // The same check as an outsider runs it: the exported file and the command, no ledger and no keys.
  const directory = path.join(root, 'trade');
  await mkdir(directory);
  await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
  const cli = await run(process.execPath, ['scripts/settlement/verify-trade.js', directory], { cwd: path.resolve(import.meta.dirname, '../..') });
  expect(cli.stdout).toMatch(/PASS answer: settled debit 6/);
  expect(cli.stdout).toMatch(/The trade verifies\./);

  // The records-only form of the same trade (no answer text, no ledger journal) verifies with the second verifier alone.
  const trade = exportFromReceipt({ id: 'whole-model-test-trade', label: 'In-process whole-model trade with test keys', receipt });
  const recordsOnly = await verifyRecords({ trade, at: Date.now() });
  expect(recordsOnly.ok, JSON.stringify(recordsOnly)).toBe(true);

  // A ledger that posted another amount, or records without the acknowledgment, do not verify.
  const overcharged = structuredClone(receipt);
  overcharged.answer.settlement.charge = 4 * PRICE;
  expect((await verifyTrade({ receipt: overcharged, at: Date.now() })).ok).toBe(false);
  const unacknowledged = structuredClone(receipt);
  unacknowledged.answer.settlementReplay.records = unacknowledged.answer.settlementReplay.records.filter(row => !(row.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && row.count > 0));
  expect((await verifyTrade({ receipt: unacknowledged, at: Date.now() })).ok).toBe(false);
});

it('a stopped answer leaves no hold and its records reproduce a charge of zero', async () => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const stopped = await route({ requester: 1, provider: 0, execute: (_messages, update, controls) => new Promise((_, reject) => {
    update('1 2'); started();
    controls.signal.addEventListener('abort', () => reject(controls.signal.reason), { once: true });
  }) });
  const controller = new AbortController();
  const asking = stopped.ask({ signal: controller.signal });
  asking.catch(() => {});
  await running;
  controller.abort(Object.assign(new Error('Stopped'), { requesterStop: true }));
  const failure = await asking.catch(error => error);
  expect(failure.serviceCredit).toMatchObject({ charge: 0 });
  expect(typeof failure.serviceCredit.settledAt).toBe('number');
  expect(openRequests()).toBe(0);
  expect(account(0).balance).toBe(0);

  const reservationId = failure.settlementRecords.reservationId;
  // The provider's own failed close arrives after the request ended at the requester and is still kept.
  await expect.poll(() => schemas(stopped.stored.get(reservationId)().records)).toContain(STAGE_RECEIPT_SCHEMA);
  const records = stopped.stored.get(reservationId)();
  expect(records).toMatchObject({ label: 'signed-records', stopped: true, acknowledged: null });
  expect(schemas(records.records)).toEqual([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, SETTLEMENT_ACCEPTANCE_SCHEMA, STAGE_RECEIPT_SCHEMA, SETTLEMENT_STOP_SCHEMA]);
  expect(records.records.find(row => row.schema === STAGE_RECEIPT_SCHEMA)).toMatchObject({ status: 'failed', steps: 0 });
  const verdict = await verifyTrade({ receipt: await stopped.exported(reservationId), at: Date.now() });
  expect(verdict.attempts[0].problems).toEqual([]);
  expect(verdict).toMatchObject({ ok: true, attempts: [{ facts: { status: 'settled', debit: 0, payouts: {} } }] });
});

it('a lost connection leaves no hold once the release window has passed, and nothing is charged', async () => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  // The provider never answers and never hears the requester again (its cancellation is lost on the link), so no
  // close reaches the requester.
  const lost = await route({ requester: 1, provider: 0, drop: type => type === 'reploid:generation-cancel',
    execute: (_messages, update, controls) => new Promise((_, reject) => {
      update('1'); started();
      controls.signal.addEventListener('abort', () => reject(controls.signal.reason), { once: true });
    }) });
  const controller = new AbortController();
  const asking = lost.ask({ signal: controller.signal });
  asking.catch(() => {});
  await running;
  controller.abort(new Error('Connection lost'));
  const failure = await asking.catch(error => error);
  // Not a stop: the hold stays until the deadline plus the release window, then the ledger releases it itself.
  expect(failure.serviceCredit.settledAt).toBeUndefined();
  expect(openRequests()).toBe(16 * PRICE);
  const reservationId = failure.settlementRecords.reservationId;
  expect(failure.settlementRecords).toMatchObject({ label: 'no-verifiable-receipt', missing: ['close', 'acknowledgment'] });

  clockOffset = credits.policy.maxRequestMs + credits.policy.partitionUnclaimedReleaseMs + credits.policy.maxClockSkewMs + 1000;
  const trace = credits.trace(reservationId);
  expect(trace).toMatchObject({ state: 'settled', status: 'expired', held: 0, journal: [] });
  expect(openRequests()).toBe(0);
  expect(account(0).balance).toBe(0);
  // The records alone give the same answer once the window has passed: expired, nobody charged or paid.
  const receipt = buildTradeReceipt({ records: lost.stored.get(reservationId)(), trace: { ...trace, policyDigest: null } });
  const verdict = await verifyTrade({ receipt, at: ledgerNow() });
  expect(verdict.attempts[0].problems).toEqual([]);
  expect(verdict).toMatchObject({ ok: true, attempts: [{ facts: { status: 'expired', debit: 0, payouts: {} } }] });
});

it('a contributor that does not sign is served and labelled, or refused before any hold when a verifiable charge is required', async () => {
  const execute = async (_messages, update) => { update('1 2'); return answer('1 2', 2); };
  // Served: the earlier wire exactly, the ledger charges as before, and the answer says it has no verifiable receipt.
  const older = await route({ requester: 1, provider: 0, signs: false, execute });
  const result = await older.ask();
  expect(result.serviceCredit).toMatchObject({ charge: 2 * PRICE });
  expect(older.sent('reploid:generation-admit')[0].settlement).toBeUndefined();
  expect(older.sent('reploid:generation-request')[0].settlement).toBeUndefined();
  expect(older.sent('reploid:generation-admitted')[0].settlementAcceptance).toBeUndefined();
  expect(result.settlementRecords).toMatchObject({ label: 'no-verifiable-receipt', reason: 'provider-does-not-sign', records: [] });
  const receipt = await older.exported(result.settlementRecords.reservationId);
  expect(receipt.label).toBe('no-verifiable-receipt');
  expect((await verifyTrade({ receipt, at: Date.now() })).ok).toBe(false);

  // Required: refused from the advertisement, before a quote, a hold or a wire byte.
  for (const options of [{ requireVerifiableCharge: true }, { verifiableCharge: 'required' }]) {
    const strict = await route({ requester: 1, provider: 0, signs: false, execute, requireVerifiableCharge: options.requireVerifiableCharge === true });
    const before = credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }));
    await expect(strict.ask({ verifiableCharge: options.verifiableCharge })).rejects.toMatchObject({ code: 'VERIFIABLE_CHARGE_UNAVAILABLE' });
    expect(strict.sent('reploid:generation-admit')).toHaveLength(0);
    expect(strict.stored.size).toBe(0);
    expect(credits.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual(before);
  }
  // The same policy against a contributor that signs is served with its records.
  const signing = await route({ requester: 1, provider: 0, execute, requireVerifiableCharge: true });
  expect((await signing.ask()).settlementRecords.label).toBe('signed-records');
});
