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
import { SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_FAULT_SCHEMA, SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA } from '../../packages/reploid/src/mesh/settlement-terms.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { startFleetService, createFleetClient } from '../../server/fleet/service.js';
import { createFleetRequester } from '../../server/fleet/requester.js';
import { createFleetExecutionAdmission } from '../../server/fleet/execution-admission.js';
import { startFleetTextApi } from '../../server/fleet/text-api.js';
import { buildRecordsExport, buildTradeReceipt } from '../../server/fleet/trade-records.js';
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
async function route({ requester, provider, execute, signs = true, requireVerifiableCharge = false, drop = () => false, meshConfig = () => ({}) }) {
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
    execute, drop, meshConfig,
    // The provider's host hands its signed terminal record (cancelled or failed) to the ledger, as the native host does.
    onGenerationTerminal: proof => admission.terminal(proof),
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
  /**
   * The three readings of one finished request: the ledger's own record, the trade receipt under both replays
   * (verify-trade.js), and the records-only export under the second verifier alone (verify-records.js). All three
   * must give `debit` and `payout`, no hold may remain, and the replay must read `status`.
   */
  const agree = async (reservationId, { status, debit = 0, payout = 0, at = Date.now(), trace = null }) => {
    trace ??= await clients[requester].call('trace', { id: reservationId });
    const records = stored.get(reservationId)();
    expect(trace).toMatchObject({ state: 'settled', held: 0, charge: debit });
    expect(trace.journalByAccount.filter(row => row.delta > 0).reduce((sum, row) => sum + row.delta, 0)).toBe(payout);
    expect(openRequests()).toBe(0);
    const full = await verifyTrade({ receipt: buildTradeReceipt({ records, trace }), at });
    expect(full.attempts[0].problems).toEqual([]);
    expect(full).toMatchObject({ ok: true, attempts: [{ facts: { status, debit, payouts: payout ? { [keys[provider].peerId]: payout } : {} } }] });
    const only = await verifyRecords({ trade: buildRecordsExport({ id: 'drill', label: 'In-process drill with test keys', records, trace }), at });
    expect(only.attempts[0].problems).toEqual([]);
    expect(only).toMatchObject({ ok: true, attempts: [{ facts: { status, debit, payouts: payout ? { [`account-${provider}`]: payout } : {},
      hold: { basis: 'publisher-stated', remaining: 0 } } }] });
    return { trace, records, replay: full.attempts[0].facts, recordsOnly: only.attempts[0].facts };
  };
  return { ask, sent, exported, stored, providerRecords: kept, mesh, agree, wholeRequester };
}

/** A provider that streams some output and then waits: `running` resolves once the requester has been sent text. */
function midStream(text = '1 2') {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  return { running, execute: (_messages, update, controls) => new Promise((_, reject) => {
    update(text); started();
    controls.signal.addEventListener('abort', () => reject(controls.signal.reason), { once: true });
  }) };
}
const pastWindow = () => credits.policy.maxRequestMs + credits.policy.partitionUnclaimedReleaseMs + credits.policy.maxClockSkewMs + 1000;

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

// The drills of docs/settlement-replay.md, "Whole-model operations": what each way of not finishing settles. On this
// route output the requester already received is never charged: there is no acknowledged prefix.

it('drill a1, the person stops mid-stream: the signed stop releases the full hold at once and nothing is charged', async () => {
  const stream = midStream();
  const stopped = await route({ requester: 1, provider: 0, execute: stream.execute });
  const controller = new AbortController();
  let received = '';
  const asking = stopped.ask({ signal: controller.signal, onDelta: delta => { received += delta.text; } });
  asking.catch(() => {});
  await stream.running;
  await expect.poll(() => received).toBe('1 2');
  controller.abort(Object.assign(new Error('Stopped'), { requesterStop: true }));
  const failure = await asking.catch(error => error);
  // Output had arrived, and the charge is still zero: the whole hold of 16 tokens is back.
  expect(failure.serviceCredit).toMatchObject({ charge: 0 });
  expect(typeof failure.serviceCredit.settledAt).toBe('number');
  expect(openRequests()).toBe(0);
  expect(account(0).balance).toBe(0);

  const reservationId = failure.settlementRecords.reservationId;
  // The provider's close, which claims nothing, arrives after the request ended at the requester and is still kept.
  await expect.poll(() => schemas(stopped.stored.get(reservationId)().records)).toContain(STAGE_RECEIPT_SCHEMA);
  const { records } = await stopped.agree(reservationId, { status: 'settled' });
  expect(records).toMatchObject({ label: 'signed-records', stopped: true, faulted: false, acknowledged: null });
  expect(schemas(records.records)).toEqual([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, SETTLEMENT_ACCEPTANCE_SCHEMA, STAGE_RECEIPT_SCHEMA, SETTLEMENT_STOP_SCHEMA]);
  expect(records.records.find(row => row.schema === STAGE_RECEIPT_SCHEMA)).toMatchObject({ status: 'failed', steps: 0 });
});

it('drill a2, the tab closes mid-stream and the provider hears it: the provider\'s signed cancellation releases the full hold, nothing is charged', async () => {
  const stream = midStream();
  const closed = await route({ requester: 1, provider: 0, execute: stream.execute });
  const controller = new AbortController();
  const asking = closed.ask({ signal: controller.signal });
  asking.catch(() => {});
  await stream.running;
  controller.abort(new Error('Page closed'));
  const failure = await asking.catch(error => error);
  const reservationId = failure.settlementRecords.reservationId;
  // No stop was signed. The provider signs its cancelled terminal record for the ledger and a close that claims nothing.
  await expect.poll(() => credits.request(reservationId).state).toBe('settled');
  await expect.poll(() => schemas(closed.stored.get(reservationId)().records)).toContain(STAGE_RECEIPT_SCHEMA);
  expect(credits.request(reservationId).outcome).toMatchObject({ status: 'cancelled', charge: 0 });
  const { records } = await closed.agree(reservationId, { status: 'settled' });
  expect(records).toMatchObject({ label: 'signed-records', stopped: false, faulted: false });
  expect(schemas(records.records)).toEqual([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, SETTLEMENT_ACCEPTANCE_SCHEMA, STAGE_RECEIPT_SCHEMA]);
  expect(account(0).balance).toBe(0);
});

it('drill b1, the provider fails and signs its fault: the hold is released at once, nobody is charged or paid, and the records name the provider', async () => {
  const failing = await route({ requester: 1, provider: 0, execute: async (_messages, update) => { update('1'); throw new Error('GPU device lost'); } });
  const failure = await failing.ask().catch(error => error);
  expect(failure.message).toMatch(/GPU device lost/);
  const reservationId = failure.settlementRecords.reservationId;
  expect(credits.request(reservationId).outcome).toMatchObject({ status: 'failed', charge: 0 });
  const { records, replay } = await failing.agree(reservationId, { status: 'expired' });
  // The fault decides the outcome now: nobody waits for the release window.
  expect(records).toMatchObject({ label: 'signed-records', faulted: true, stopped: false, missing: [] });
  expect(schemas(records.records)).toEqual([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_FAULT_SCHEMA]);
  expect(records.records.at(-1)).toMatchObject({ participantId: keys[0].peerId, partitionIndex: 0 });
  expect(replay.status).toBe('expired');
  expect(account(0).balance).toBe(0);
});

it('drill b2, a provider that dies silently cannot be told from a requester whose connection was lost: both expire unattributed, with nobody charged or paid', async () => {
  // b2: the provider process is gone mid-answer. Nothing it would send arrives, and it signs nothing.
  let dead = false;
  const killed = await route({ requester: 1, provider: 0, meshConfig: index => (index === 0 ? { generationTimeoutMs: 400 } : {}),
    drop: (type, _payload, sender) => dead && (sender === 1 || type === 'reploid:generation-cancel'),
    execute: (_messages, update, controls) => new Promise((_, reject) => {
      update('1'); dead = true;
      controls.signal.addEventListener('abort', () => reject(controls.signal.reason), { once: true });
    }) });
  const silence = await killed.ask().catch(error => error);
  // The other side of the same picture: the requester's connection is lost and the provider never hears of it.
  const stream = midStream('1');
  const lost = await route({ requester: 1, provider: 0, drop: type => type === 'reploid:generation-cancel', execute: stream.execute });
  const controller = new AbortController();
  const asking = lost.ask({ signal: controller.signal });
  asking.catch(() => {});
  await stream.running;
  controller.abort(new Error('Connection lost'));
  const dropped = await asking.catch(error => error);

  const outcomes = [];
  for (const [fixture, failure] of [[killed, silence], [lost, dropped]]) {
    const reservationId = failure.settlementRecords.reservationId;
    // Neither is a stop: the hold stays until the deadline plus the release window.
    expect(failure.serviceCredit.settledAt).toBeUndefined();
    expect(credits.request(reservationId).state).not.toBe('settled');
    expect(failure.settlementRecords).toMatchObject({ label: 'no-verifiable-receipt', missing: ['close'], stopped: false, faulted: false });
    outcomes.push({ fixture, reservationId });
  }
  expect(openRequests()).toBe(2 * 16 * PRICE);
  // Before the window has passed the records decide nothing: the replay is still open.
  const early = await verifyTrade({ receipt: buildTradeReceipt({ records: killed.stored.get(outcomes[0].reservationId)(), trace: credits.trace(outcomes[0].reservationId) }), at: Date.now() });
  expect(early).toMatchObject({ ok: false, attempts: [{ facts: { status: 'open' } }] });

  clockOffset = pastWindow();
  const read = [];
  for (const { fixture, reservationId } of outcomes) {
    const trace = credits.trace(reservationId);
    expect(trace).toMatchObject({ status: 'expired', journal: [] });
    const { records, recordsOnly } = await fixture.agree(reservationId, { status: 'expired', at: ledgerNow(), trace: { ...trace, policyDigest: null } });
    // The replay lists the one stage as having no close in both cases. On a one-provider route that entry is not
    // attribution: the same list is read whichever side went away.
    expect(recordsOnly.forfeited).toEqual([0]);
    read.push(schemas(records.records));
  }
  // The same records in both cases, so no party is named as the cause.
  expect(read[0]).toEqual([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, SETTLEMENT_ACCEPTANCE_SCHEMA]);
  expect(read[1]).toEqual(read[0]);
  expect(account(0).balance).toBe(0);
  expect(account(1).balance).toBe(0);
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

it('the HTTP text API carries the settlement port: a request through it signs the same records', async () => {
  const token = 'synthetic-fleet-api-bearer-secret-0123456789abcdef';
  const served = await route({ requester: 1, provider: 0, execute: async (_messages, update) => { update('1 2'); return answer('1 2', 2); } });
  const reservations = [];
  const requesterOf = participant => createFleetRequester({ participant, identity: keys[1], credits: clients[1], maxOutputTokens: 16,
    onSettlementRecords: ({ reservationId, read }) => served.stored.set(reservationId, read) });
  // The ports the native host gives the text API (native-host.js): its accounted run wraps the adapter's own executor.
  const host = { identity: keys[1], credits: clients[1], allowsModel: candidate => candidate?.id === model.id && candidate?.identity === model.identity,
    async enrolledRecipients() { return new Set(((await clients[1].call('computers', {})).computers || []).flatMap(row => row.participantIds || [])); },
    textParticipant: { roomId: 'reploid-swarm-fleet-fixture', executionClass: 'private-pool', getState: () => ({ models: served.wholeRequester.getModels() }),
      getNetworkState: () => served.mesh.requesterMesh.getSwarmSnapshot(),
      generate: (request, controls) => served.wholeRequester.generate(request, controls),
      recoverGeneration: (request, reference, controls) => served.wholeRequester.recover(request, reference, controls) },
    chargeCeiling: request => requesterOf({ generate: () => { throw Error('not sent'); } }).chargeCeiling(request),
    async runAccountedGeneration(request, controls, run) {
      const result = await requesterOf({ generate: run }).generate(request, { ...controls, onReservation(id) { reservations.push(id); controls.onReservation?.(id); } });
      return { ...result, execution: { ...result.execution, serviceCredit: result.serviceCredit } };
    } };
  const api = await startFleetTextApi({ host, token, allowedRecipients: [keys[0].peerId] });
  cleanup.push(() => api.close());
  const response = await fetch(`${api.url}/chat/completions`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: model.id, messages }) });
  const body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200);
  expect(body.choices[0].message.content).toBe('1 2');
  expect(served.sent('reploid:generation-admit')[0].settlement.terms).toMatchObject({ schema: SETTLEMENT_TERMS_SCHEMA, requesterId: keys[1].peerId });
  expect(served.sent('reploid:generation-admitted')[0].settlementAcceptance).toMatchObject({ schema: SETTLEMENT_ACCEPTANCE_SCHEMA });
  const { records } = await served.agree(reservations[0], { status: 'settled', debit: 2 * PRICE, payout: 2 * PRICE });
  expect(records.label).toBe('signed-records');
});
