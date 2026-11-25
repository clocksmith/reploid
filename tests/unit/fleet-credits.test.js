// @vitest-environment node
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { createReceiptDraft, signReceiptDraft, countersignReceipt } from '../../packages/reploid/src/artifacts/receipt.js';
import { acceptFleetTerminalPolicy } from '../../server/fleet/terminal-policy.js';
import { signGenerationTerminal } from '../../packages/reploid/src/artifacts/generation-terminal.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { DEFAULT_UNCLAIMED_RELEASE_MS } from '../../server/fleet/contract.js';
import { migrateFleetCredits } from '../../server/fleet/credit-migration.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { signSettlementStop } from '../../server/fleet/settlement-terms.js';
import { createAttemptEvidenceSigner, attemptRouteHash, STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';

const hash = 'sha256:' + 'a'.repeat(64), other = 'sha256:' + 'b'.repeat(64);
const policy = { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
  creditsPerOutputToken: 1, maxDebt: 20, maxOutputTokens: 20, maxPendingPerComputer: 2,
  maxClockSkewMs: 1000, maxRequestMs: 60000, allowSameOwner: true, wholeModelTerminalCharge: 0 };
describe('enrolled fleet service credits', () => {
  let directory, ledger, identities, computers, options;
  // Signed cleanup carries the signer's real clock, so the ledger clock starts now: claim windows are measured from it.
  const at = Date.now();
  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), 'reploid-fleet-credit-'));
    identities = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    computers = identities.map((identity, index) => ({ id: `computer-${index}`, name: `Computer ${index}`, ownerId: `computer-${index}`,
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
  async function terminal(input, changes = {}, status = 'cancelled') {
    const proof = await signGenerationTerminal({ requestId: input.executionId, provider: input.providers[0].participantId,
      consumer: input.consumer, model: input.model.id, modelIdentity: input.model.identity,
      adapterIdentities: input.model.adapterIdentities, inputDigest: input.inputDigest, ...changes }, status, identities[1]);
    return proof;
  }
  it('releases an unclaimed whole-model hold only after the opt-in claim window, then refuses a late claim', async () => {
    const window = 30000, input = request('abandoned');
    const open = clock => openFleetCredits({ ...options, file: path.join(directory, 'bounded.sqlite'),
      policy: { ...policy, wholeModelUnclaimedReleaseMs: window }, now: clock });
    ledger.close(); ledger = await open(() => at);
    dispatch(input); ledger.admit(input.id, 0);
    // The provider admitted the work and then never returned. Inside the window the hold stays.
    ledger.close(); ledger = await open(() => at + policy.maxRequestMs + window - 1);
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 10 });
    expect(ledger.request(input.id).state).toBe('closing');
    ledger.close(); ledger = await open(() => at + policy.maxRequestMs + window);
    expect(ledger.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(ledger.request(input.id)).toMatchObject({ state: 'settled',
      outcome: { status: 'expired', charge: 0, outputTokens: 0, credits: [], reason: 'provider-unclaimed-after-window' } });
    expect(ledger.snapshot().journal).toHaveLength(0);
    // A provider that comes back after the window is not paid for this request, with either kind of evidence.
    const late = await terminal(input, {}, 'failed');
    ledger.close(); ledger = await open(() => late.timestamp);
    await expect(ledger.settle(input.id, late)).rejects.toThrow('Claim window closed');
    await expect(ledger.collect(input.id, { terminal: late })).rejects.toThrow('Claim window closed');
    expect(ledger.snapshot().accounts.every(row => row.balance === 0 && row.held === 0)).toBe(true);
  });
  it('releases an unclaimed whole-model hold at deadline plus the default window when the policy names none', async () => {
    expect(policy.wholeModelUnclaimedReleaseMs).toBeUndefined();
    expect(ledger.policy.wholeModelUnclaimedReleaseMs).toBe(DEFAULT_UNCLAIMED_RELEASE_MS);
    const input = request('unbounded'); dispatch(input); ledger.admit(input.id, 0);
    ledger.close(); ledger = await openFleetCredits({ ...options, now: () => at + policy.maxRequestMs + DEFAULT_UNCLAIMED_RELEASE_MS - 1 });
    expect(ledger.snapshot().accounts[0]).toMatchObject({ held: 10 });
    expect(ledger.request(input.id).state).toBe('closing');
    ledger.close(); ledger = await openFleetCredits({ ...options, now: () => at + policy.maxRequestMs + DEFAULT_UNCLAIMED_RELEASE_MS });
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 0 });
    expect(ledger.request(input.id).outcome).toMatchObject({ status: 'expired', charge: 0, reason: 'provider-unclaimed-after-window' });
  });
  const stopOf = (input, { by = 0, acknowledged = 0 } = {}) => signSettlementStop({ signer: createAttemptEvidenceSigner({ identity: identities[by] }),
    acknowledged, terms: { requesterId: identities[by].peerId, reservationId: input.id, attemptId: input.executionId } });
  it('settles a whole-model Stop after the provider finished on the requester’s signed stop, at zero, once', async () => {
    const input = request('stopped'); dispatch(input); ledger.admit(input.id, 0);
    // Only the requester's own stop of exactly this request, with nothing acknowledged, is accepted.
    await expect(ledger.settle(input.id, await stopOf(input, { by: 2 }))).rejects.toThrow('Requester stop');
    await expect(ledger.settle(input.id, await stopOf(input, { acknowledged: 1 }))).rejects.toThrow('Requester stop');
    await expect(ledger.settle(input.id, await stopOf(request('another')))).rejects.toThrow('Requester stop');
    const stop = await stopOf(input);
    const outcome = await ledger.settle(input.id, stop);
    expect(outcome).toMatchObject({ status: 'cancelled', charge: 0, outputTokens: null, usage: null, credits: [expect.objectContaining({ amount: 0 })] });
    expect(ledger.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[0, 0], [0, 0], [0, 0]]);
    const journal = ledger.snapshot().journal.length;
    // The provider's own cancelled cleanup has the same effect and is accepted once; anything else conflicts.
    expect(await ledger.collect(input.id, { terminal: await terminal(input) })).toEqual(outcome);
    await expect(ledger.settle(input.id, await terminal(input, {}, 'failed'))).rejects.toThrow('Conflicting');
    await expect(ledger.settle(input.id, await evidence(input))).rejects.toThrow('Conflicting');
    expect(ledger.snapshot().journal).toHaveLength(journal);
    // A countersigned receipt that arrived first wins; a later stop conflicts.
    const paid = request('paid'); dispatch(paid); ledger.admit(paid.id, 0);
    await ledger.settle(paid.id, await evidence(paid));
    await expect(ledger.settle(paid.id, await stopOf(paid))).rejects.toThrow('Conflicting');
    const checked = await verifyCreditStatement(ledger.statement('computer-0'), { participantIds: [identities[0].peerId] });
    expect(checked).toMatchObject({ ok: true, recomputedBalance: -6, verifiedCount: 2, uncheckedCount: 0 });
  });
  it('lets no hold outlive its deadline plus the release window (and, for a split hold, the clock allowance), whatever went missing', async () => {
    ledger.close();
    let clock = at;
    ledger = await openFleetCredits({ ...options, file: path.join(directory, 'bounded-all.sqlite'), policy: { ...policy, maxPendingPerComputer: 8, maxDebt: 100 },
      now: () => clock });
    ledger.reserve(request('never-dispatched'));
    dispatch(request('never-admitted'));
    const admitted = request('admitted-silent'); dispatch(admitted); ledger.admit(admitted.id, 0);
    const fenced = request('fenced-silent'); dispatch(fenced); ledger.admit(fenced.id, 0); await ledger.fence(fenced.id, fenced.consumer);
    const cleaned = request('cleanup-without-terms'); dispatch(cleaned); ledger.admit(cleaned.id, 0);
    const split = await splitRequest('split-silent', 3);
    dispatch(split.input); ledger.admit(split.input.id, 0); ledger.admit(split.input.id, 1);
    await ledger.collect(split.input.id, { identity: split.identity, receipts: [split.receipts[1]], acknowledgment: split.acknowledgment });
    expect(ledger.snapshot().accounts[0].held).toBe(60);
    clock = at + policy.maxRequestMs + DEFAULT_UNCLAIMED_RELEASE_MS - 1;
    expect(ledger.snapshot().accounts[0].held).toBe(50);
    clock = at + policy.maxRequestMs + DEFAULT_UNCLAIMED_RELEASE_MS;
    // Whole-model holds are released at deadline plus the window; a split hold one clock allowance later, the last
    // instant one of its closing receipts still counts.
    expect(ledger.snapshot().accounts[0].held).toBe(10);
    clock += policy.maxClockSkewMs;
    expect(ledger.snapshot().accounts[0].held).toBe(10);
    clock += 1;
    expect(ledger.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[0, 0], [0, 0], [0, 0]]);
  });
  it.each(['cancelled', 'failed'])('settles signed %s cleanup without inventing token usage, even after the deadline', async status => {
    const input = request('terminal'); dispatch(input); ledger.admit(input.id, 0);
    const proof = await terminal(input, {}, status);
    ledger.close(); ledger = await openFleetCredits({ ...options, now: () => proof.timestamp + policy.maxRequestMs });
    const outcome = await ledger.settle(input.id, proof);
    expect(outcome).toMatchObject({ status, charge: 0, outputTokens: null, usage: null });
    expect(ledger.request(input.id).evidence).toEqual(proof);
    expect(ledger.snapshot().accounts.map(row => [row.balance, row.held])).toEqual([[0, 0], [0, 0], [0, 0]]);
    const journalLength = ledger.snapshot().journal.length;
    expect(await ledger.settle(input.id, proof)).toEqual(outcome);
    expect(ledger.snapshot().journal).toHaveLength(journalLength);
    await expect(ledger.settle(input.id, await evidence(input))).rejects.toThrow('Conflicting');
    ledger.close(); ledger = await openFleetCredits({ ...options, now: () => proof.timestamp + policy.maxRequestMs });
    expect(await ledger.recover(input.id)).toEqual(outcome);
  });
  it('keeps the hold for mismatched or unsigned terminal evidence and rejects failure after paid completion', async () => {
    const input = request('terminal'); dispatch(input); ledger.admit(input.id, 0);
    const proof = await terminal(input);
    ledger.close(); ledger = await openFleetCredits({ ...options, now: () => proof.timestamp });
    for (const change of [{ inputDigest: other }, { modelIdentity: other }, { consumer: identities[2].peerId },
      { requestId: 'another' }, { signature: '' }, { cleanup: 'pending' }]) {
      await expect(ledger.settle(input.id, { ...proof, ...change })).rejects.toThrow('Terminal cleanup');
    }
    await expect(ledger.settle(input.id, await terminal(input, { inputDigest: other }))).rejects.toThrow('Terminal cleanup');
    expect(ledger.snapshot().accounts[0].held).toBe(10);
    await ledger.settle(input.id, await evidence(input));
    await expect(ledger.settle(input.id, proof)).rejects.toThrow('Conflicting');
    expect(ledger.snapshot().accounts.map(row => row.balance)).toEqual([-6, 6, 0]);
  });
  it('retains verified terminal evidence and the hold when no fixed terminal charge was accepted', async () => {
    ledger.close();
    const { wholeModelTerminalCharge: _charge, ...unmeteredPolicy } = policy;
    ledger = await openFleetCredits({ ...options, file: path.join(directory, 'no-terminal-terms.sqlite'),
      policy: unmeteredPolicy, now: Date.now });
    const input = request('without-terms'); dispatch(input); ledger.admit(input.id, 0);
    const proof = await terminal(input);
    expect(await ledger.collect(input.id, { terminal: proof })).toEqual({ id: input.id, status: 'pending' });
    await expect(ledger.settle(input.id, proof)).rejects.toThrow('fixed terminal terms');
    expect(ledger.snapshot().accounts[0].held).toBe(10);
    expect(ledger.request(input.id).state).toBe('closing');
  });
  it('accepts the operator’s explicit terminal terms without changing balances or forgiving unknown work', async () => {
    ledger.close();
    const { wholeModelTerminalCharge: _charge, ...originalPolicy } = policy;
    const file = path.join(directory, 'migration.sqlite');
    ledger = await openFleetCredits({ ...options, file, policy: originalPolicy, now: Date.now });
    const input = request('accepted'), unknown = request('unknown');
    dispatch(input); ledger.admit(input.id, 0); dispatch(unknown); ledger.admit(unknown.id, 0);
    const proof = await terminal(input);
    await ledger.collect(input.id, { terminal: proof });
    ledger.close(); ledger = null;
    const acceptedPolicy = { ...policy, version: 'test/terminal-2' };
    const migration = { file, previousVersion: originalPolicy.version, policy: acceptedPolicy, requestIds: [input.id] };
    await expect(acceptFleetTerminalPolicy({ ...migration, policy: { ...acceptedPolicy, creditsPerOutputToken: 2 } }))
      .rejects.toThrow('cannot change metered');
    const accepted = await acceptFleetTerminalPolicy(migration);
    expect(await acceptFleetTerminalPolicy(migration)).toEqual(accepted);
    await expect(acceptFleetTerminalPolicy({ ...migration, requestIds: [unknown.id] })).rejects.toThrow('scope changed');
    ledger = await openFleetCredits({ ...options, file, policy: acceptedPolicy, now: Date.now });
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 20 });
    expect(await ledger.recover(input.id)).toMatchObject({ charge: 0, status: 'cancelled', outputTokens: null });
    expect(await ledger.fence(unknown.id, unknown.consumer)).toEqual({ id: unknown.id, status: 'pending' });
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 10 });
    expect(ledger.request(input.id).binding.terminalPolicyVersion).toBe(acceptedPolicy.version);
    expect(ledger.request(unknown.id).binding.terminalCharge).toBeNull();
  });
  it('reserves against outstanding debt and concurrent holds before execution', () => {
    ledger.reserve(request('one')); ledger.reserve(request('two'));
    expect(() => ledger.reserve(request('three'))).toThrow('2 unfinished answers on this account. Nothing was sent.');
    ledger.abandonBeforeDispatch('two', identities[0].peerId);
    expect(ledger.reserve(request('three')).maximum).toBe(10);
  });
  it('refuses an answer the account cannot cover before any hold, naming the quote and what can be spent', async () => {
    ledger.close();
    ledger = await openFleetCredits({ ...options, file: path.join(directory, 'no-debt.sqlite'),
      policy: { ...policy, maxDebt: 0, maxPendingPerComputer: 4 } });
    expect(() => ledger.reserve(request('broke'))).toThrow(
      'not enough service credits. This answer can cost up to 10 and 0 can be spent now. Nothing was sent.');
    expect(ledger.request('broke')).toBeNull();
    expect(ledger.snapshot().accounts.every(row => row.balance === 0 && row.held === 0)).toBe(true);
    // A smaller output limit that fits is still refused at zero credit and no debt: nothing is spendable.
    expect(() => ledger.reserve({ ...request('smaller'), maxOutputTokens: 1 })).toThrow('can cost up to 1 and 0 can be spent now');
    // The refusal carries a stable code and the quote it refused, for the HTTP API's 402.
    let refusal = null;
    try { ledger.reserve(request('coded')); } catch (error) { refusal = error.creditRefusal; }
    expect(refusal).toEqual({ code: 'SERVICE_CREDIT_INSUFFICIENT', spendable: 0, accountId: 'computer-0',
      quote: expect.objectContaining({ maximum: 10, maxOutputTokens: 10, unit: 'noncash-service-credit' }) });
  });
  it('lets a new account with a zero balance make its first answer under the default starter debt limit', async () => {
    ledger.close();
    const { maxDebt: _explicit, ...shipped } = policy;
    ledger = await openFleetCredits({ ...options, file: path.join(directory, 'starter.sqlite'), policy: shipped });
    // The default debt limit is one answer at the policy's output ceiling: non-cash, bounded, recorded in the policy.
    expect(ledger.policy.maxDebt).toBe(policy.maxOutputTokens * policy.creditsPerOutputToken);
    const first = { ...request('first'), maxOutputTokens: policy.maxOutputTokens }; dispatch(first);
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 20, available: -20 });
    // A second answer needs earned credit first.
    expect(() => ledger.reserve(request('second'))).toThrow('not enough service credits');
    await ledger.settle(first.id, await evidence(first));
    expect(ledger.snapshot().accounts.map(row => row.balance)).toEqual([-6, 6, 0]);
    // An explicit zero stays zero.
    ledger.close();
    ledger = await openFleetCredits({ ...options, file: path.join(directory, 'explicit-zero.sqlite'), policy: { ...policy, maxDebt: 0 } });
    expect(() => ledger.reserve(request('none'))).toThrow('not enough service credits');
  });
  it('keeps one balance per owner account: credit earned on one computer pays for asking from another', async () => {
    ledger.close();
    // Your laptop (0) asks; your desktop (2) serves; another person's computer (1) does both.
    const yours = computers.map((row, index) => ({ ...row, ownerId: index === 1 ? 'them' : 'you' }));
    ledger = await openFleetCredits({ ...options, file: path.join(directory, 'owners.sqlite'), computers: yours,
      policy: { ...policy, maxDebt: 8 } });
    expect(ledger.snapshot().accounts.map(({ id, computerIds, name }) => ({ id, computerIds, name }))).toEqual([
      { id: 'them', computerIds: ['computer-1'], name: 'Computer 1' },
      { id: 'you', computerIds: ['computer-0', 'computer-2'], name: 'Computer 0, Computer 2' }]);
    // With nothing earned, the debt limit alone does not cover a 16-credit answer from your laptop.
    expect(() => ledger.reserve({ ...request('too-early'), maxOutputTokens: 16 })).toThrow('can cost up to 16 and 8 can be spent now');
    // The other person's computer asks your desktop and pays 8.
    const earn = { ...request('earn', 1, 2), maxOutputTokens: 8 }; dispatch(earn);
    await ledger.settle(earn.id, await evidence(earn, 8, 2, 1));
    expect(ledger.snapshot().accounts.map(row => [row.id, row.balance])).toEqual([['them', -8], ['you', 8]]);
    // Your laptop spends what your desktop earned: the same 16-credit answer now fits.
    const spend = { ...request('spend', 0, 1), maxOutputTokens: 16 }; dispatch(spend);
    expect(ledger.snapshot().accounts[1]).toMatchObject({ id: 'you', balance: 8, held: 16, available: -8 });
    const paid = await ledger.settle(spend.id, await evidence(spend, 5, 1, 0));
    expect(paid).toMatchObject({ charge: 5, credits: [{ participantId: identities[1].peerId, computerId: 'computer-1', accountId: 'them', amount: 5 }] });
    expect(ledger.snapshot().accounts.map(row => [row.id, row.balance, row.held])).toEqual([['them', -3, 0], ['you', 3, 0]]);
    // The journal keeps which computer each delta belongs to.
    expect(ledger.snapshot().journal.map(row => [row.request_id, row.account_id, row.computer_id, row.delta])).toEqual([
      ['earn', 'them', 'computer-1', -8], ['earn', 'you', 'computer-2', 8], ['spend', 'you', 'computer-0', -5], ['spend', 'them', 'computer-1', 5]]);
    // Asking your own desktop moves nothing: the owner's own work is unbilled.
    const own = { ...request('own', 0, 2), maxOutputTokens: 3 }; dispatch(own);
    expect(await ledger.settle(own.id, await evidence(own, 3, 2, 0))).toMatchObject({ charge: 0, ownComputeUnits: 3, credits: [] });
    expect(ledger.snapshot().accounts.map(row => row.balance)).toEqual([-3, 3]);
    // The account's statement lists both computers and verifies offline.
    const statement = ledger.statement('you');
    expect(statement).toMatchObject({ schema: 'reploid.fleet-credit-statement/v2', accountId: 'you', computerIds: ['computer-0', 'computer-2'], balance: 3 });
    expect(statement.entries.map(row => [row.requestId, row.delta, row.attribution.map(item => [item.computerId, item.delta])])).toEqual([
      ['earn', 8, [['computer-2', 8]]], ['spend', -5, [['computer-0', -5]]], ['own', 0, [['computer-0', 0]]]]);
    const checked = await verifyCreditStatement(statement, { participantIds: [identities[0].peerId, identities[2].peerId] });
    expect(checked).toMatchObject({ ok: true, accountId: 'you', recomputedBalance: 3, uncheckedCount: 0 });
    // A statement that moves a delta to another computer of the same account no longer verifies.
    const moved = structuredClone(statement); moved.entries[0].attribution[0].computerId = 'computer-0';
    expect((await verifyCreditStatement(moved)).unchecked[0].reason).toContain('attribution');
    expect((await verifyCreditStatement(ledger.statement('them'))).ok).toBe(true);
  });
  it('migrates an open self-serve ledger written before owner accounts', async () => {
    ledger.close();
    const file = path.join(directory, 'open-legacy.sqlite');
    ledger = await openFleetCredits({ file, computers: [], policy, now: () => at, openEnrollment: true });
    await ledger.enrollAccount({ ...computers[0], id: 'acct-a', ownerId: 'acct-a' });
    await ledger.enrollAccount({ ...computers[1], id: 'acct-b', ownerId: 'acct-b' });
    ledger.close(); ledger = null;
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(file); db.exec("DELETE FROM fleet_metadata WHERE id='account-unit'"); db.close();
    await expect(openFleetCredits({ file, computers: [], policy, openEnrollment: true })).rejects.toThrow('migrate it to owner accounts');
    expect(await migrateFleetCredits({ file, computers: [], policy })).toMatchObject({ previousAccountUnit: 'computer',
      accountsAfter: [{ id: 'acct-a', balance: 0, held: 0 }, { id: 'acct-b', balance: 0, held: 0 }] });
    ledger = await openFleetCredits({ file, computers: [], policy, now: () => at, openEnrollment: true });
    const input = request('after-migration'); dispatch(input);
    await ledger.settle(input.id, await evidence(input));
    expect(ledger.snapshot().accounts.map(row => [row.id, row.balance])).toEqual([['acct-a', -6], ['acct-b', 6]]);
    expect((await verifyCreditStatement(ledger.statement('acct-a'))).ok).toBe(true);
  });
  it('migrates a per-computer ledger to owner accounts explicitly, keeping attribution and settling old holds as accepted', async () => {
    ledger.close();
    let clock = at;
    const yours = computers.map((row, index) => ({ ...row, ownerId: index === 1 ? 'them' : 'you' }));
    const { DatabaseSync } = await import('node:sqlite');
    const file = path.join(directory, 'legacy.sqlite');
    // Before owner accounts: no release windows, balances kept per computer.
    const legacyPolicy = { ...policy, version: 'legacy/1', maxDebt: 40 };
    ledger = await openFleetCredits({ ...options, file, computers: yours, policy: legacyPolicy, now: () => clock });
    const settled = request('settled-before', 0, 1); dispatch(settled);
    await ledger.settle(settled.id, await evidence(settled, 6, 1, 0));
    const open = request('open-before', 2, 1); dispatch(open); ledger.admit(open.id, 0);
    const lost = request('lost-before', 2, 1); dispatch(lost); ledger.admit(lost.id, 0);
    ledger.close(); ledger = null;
    // Rewrite it as the older code left it.
    const db = new DatabaseSync(file);
    db.exec("DELETE FROM fleet_metadata WHERE id='account-unit'");
    const { wholeModelUnclaimedReleaseMs: _w, partitionUnclaimedReleaseMs: _p, ...storedPolicy } = JSON.parse(db.prepare("SELECT value FROM fleet_metadata WHERE id='policy'").get().value);
    db.prepare("UPDATE fleet_metadata SET value=? WHERE id='policy'").run(JSON.stringify(Object.fromEntries(Object.entries(storedPolicy).sort())));
    for (const row of db.prepare('SELECT id,binding,outcome FROM fleet_requests').all()) {
      const { accountId: _accountId, ...binding } = JSON.parse(row.binding);
      const outcome = row.outcome && JSON.parse(row.outcome);
      if (outcome) outcome.credits = outcome.credits.map(({ accountId: _account, ...credit }) => credit);
      db.prepare('UPDATE fleet_requests SET binding=?,outcome=? WHERE id=?').run(JSON.stringify(binding), outcome && JSON.stringify(outcome), row.id);
    }
    db.exec('DELETE FROM fleet_accounts');
    for (const [id, balance, held] of [['computer-0', -6, 0], ['computer-1', 6, 0], ['computer-2', 0, 20]]) {
      db.prepare('INSERT INTO fleet_accounts (id,balance,held) VALUES (?,?,?)').run(id, balance, held);
    }
    db.exec('UPDATE fleet_journal SET account_id=computer_id, computer_id=NULL');
    db.close();
    await expect(openFleetCredits({ ...options, file, computers: yours, policy: legacyPolicy })).rejects.toThrow('migrate it to owner accounts');
    const { wholeModelUnclaimedReleaseMs: _a, partitionUnclaimedReleaseMs: _b, ...shipped } = legacyPolicy;
    await expect(migrateFleetCredits({ file, computers: yours, policy: shipped })).rejects.toThrow('new policy version');
    await expect(migrateFleetCredits({ file, computers: yours, policy: { ...shipped, version: 'legacy/2', creditsPerOutputToken: 2 } }))
      .rejects.toThrow('only add release windows');
    const migration = { file, computers: yours, policy: { ...shipped, version: 'legacy/2' }, now: () => clock };
    const record = await migrateFleetCredits(migration);
    expect(record).toMatchObject({ previousAccountUnit: 'computer', accountUnit: 'owner/v1',
      accountsAfter: [{ id: 'them', balance: 6, held: 0 }, { id: 'you', balance: -6, held: 20 }],
      policy: { version: 'legacy/2', wholeModelUnclaimedReleaseMs: DEFAULT_UNCLAIMED_RELEASE_MS } });
    expect(await migrateFleetCredits(migration)).toEqual(record);
    ledger = await openFleetCredits({ ...options, file, computers: yours, policy: migration.policy, now: () => clock });
    expect(ledger.snapshot().journal.map(row => [row.account_id, row.computer_id, row.delta])).toEqual([['you', 'computer-0', -6], ['them', 'computer-1', 6]]);
    // A hold reserved before the migration settles with the per-computer arithmetic it was accepted under.
    await ledger.settle(open.id, await evidence(open, 4, 1, 2));
    expect(ledger.snapshot().accounts.map(row => [row.id, row.balance, row.held])).toEqual([['them', 10, 0], ['you', -10, 10]]);
    // An old hold nobody claims now clears at its deadline plus the release window.
    clock = at + policy.maxRequestMs + DEFAULT_UNCLAIMED_RELEASE_MS;
    expect(ledger.snapshot().accounts[1]).toMatchObject({ id: 'you', held: 0 });
    expect(ledger.request(lost.id).outcome).toMatchObject({ status: 'expired', charge: 0 });
    const checked = await verifyCreditStatement(ledger.statement('you'), { participantIds: [identities[0].peerId, identities[2].peerId] });
    expect(checked).toMatchObject({ ok: true, recomputedBalance: -10, expiredCount: 1, uncheckedCount: 0 });
  });
  it('lets a migration publish K, the acknowledgment bound, in the policy, and never change it once published', async () => {
    ledger.close(); ledger = null;
    const file = path.join(directory, 'publish-k.sqlite');
    (await openFleetCredits({ ...options, file })).close();
    const published = { ...policy, version: 'test/2', maxUnacknowledgedOutputs: 2 };
    await expect(openFleetCredits({ ...options, file, policy: published })).rejects.toThrow('explicit migration required');
    expect((await migrateFleetCredits({ file, computers, policy: published })).policy).toMatchObject({ maxUnacknowledgedOutputs: 2 });
    await expect(migrateFleetCredits({ file, computers, policy: { ...published, version: 'test/3', maxUnacknowledgedOutputs: 3 } }))
      .rejects.toThrow('cannot change an existing maxUnacknowledgedOutputs');
    ledger = await openFleetCredits({ ...options, file, policy: published });
    expect(ledger.policy.maxUnacknowledgedOutputs).toBe(2);
    await expect(openFleetCredits({ ...options, file: path.join(directory, 'bad-k.sqlite'), policy: { ...policy, maxUnacknowledgedOutputs: -1 } }))
      .rejects.toThrow('Explicit non-cash credit policy required');
  });
  it('expires only never-dispatched reservations and fences a late dispatch after restart', async () => {
    const input = request('crash-before-dispatch');
    ledger.reserve(input); ledger.close();
    ledger = await openFleetCredits({ ...options, now: () => at + policy.maxRequestMs + 1 });
    expect(ledger.snapshot().accounts[0].held).toBe(0);
    expect(ledger.request(input.id).state).toBe('abandoned');
    expect(() => ledger.dispatch(input.id, input.consumer)).toThrow('cannot dispatch');
    expect(ledger.snapshot().accounts[0].held).toBe(0);
  });
  it('deadline expiry fences new admissions but never releases an admitted unknown owner', async () => {
    const input = request('unknown-owner'); dispatch(input); ledger.admit(input.id, 0); ledger.close();
    ledger = await openFleetCredits({ ...options, now: () => at + policy.maxRequestMs + 1 });
    expect(await ledger.recover(input.id)).toEqual({ id: input.id, status: 'pending' });
    expect(ledger.request(input.id).state).toBe('closing');
    expect(ledger.snapshot().accounts[0].held).toBe(10);
    expect(() => ledger.admit(input.id, 0)).toThrow('closed');
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
    ledger.close(); ledger = await openFleetCredits({ ...options, file: path.join(directory, 'unrelated.sqlite'),
      computers: computers.map(row => ({ ...row, ownerId: 'same-owner' })), policy: { ...policy, allowSameOwner: false } });
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
    ledger.admit(input.id, 0);
    ledger.admit(input.id, 1);
    expect(await ledger.fence(input.id, input.consumer)).toMatchObject({
      status: 'pending', heldCredits: 10, acknowledgedOutputTokens: null, awaitingStages: [0, 1]
    });
    // Only the final stage and its matching acknowledgment survived this interruption.
    await ledger.collect(input.id, { identity, receipts: [receipts[1]], acknowledgment });
    ledger.close(); ledger = await openFleetCredits(options);
    expect(await ledger.recover(input.id)).toMatchObject({
      status: 'pending', heldCredits: 10, acknowledgedOutputTokens: 7, awaitingStages: [0]
    });
    expect(ledger.snapshot().journal).toHaveLength(0);
    const result = await ledger.settle(input.id, { identity, receipts, acknowledgment });
    expect(result.credits.map(row => row.amount)).toEqual([2, 5]);
    expect(ledger.snapshot().accounts.map(row => row.balance)).toEqual([-7, 2, 5]);
  });
  it('lets one account earn by serving, then spend that balance on a two-provider split that reconciles exactly', async () => {
    // Monday: computer 0 serves computer 1 and earns six credits.
    const monday = request('monday', 1, 0); dispatch(monday);
    await ledger.settle(monday.id, await evidence(monday, 6, 0, 1));
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 6, held: 0, available: 6 });

    // Tuesday: the same account spends on a split run by the two other enrolled computers, reserving up to ten.
    const route = { schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: hash, planId: hash,
      stages: identities.slice(1).map((identity, index) => ({ index, participantId: identity.peerId,
        transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `stage-${index}` })),
      activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 1024, precision: 'f32', components: 1, elementStrideBytes: 4 } };
    const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: 'execution-tuesday',
      requesterId: identities[0].peerId, placementGeneration: 0, route };
    const tuesday = { ...request('tuesday'), mode: 'partition', route: identity,
      providers: [{ participantId: identities[1].peerId, weight: 1 }, { participantId: identities[2].peerId, weight: 2 }] };
    dispatch(tuesday);
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 6, held: 10, available: -4 });
    const routeHash = await attemptRouteHash(identity), signedAt = new Date(at).toISOString();
    const receipts = await Promise.all([1, 2].map(async (owner, index) => createAttemptEvidenceSigner({ identity: identities[owner] }).sign(STAGE_RECEIPT_SCHEMA,
      { schema: STAGE_RECEIPT_SCHEMA, reservationId: tuesday.id, attemptId: tuesday.executionId, routeHash, partitionIndex: index,
        participantId: identities[owner].peerId, sequence: 2, status: 'settled', steps: 4, tokens: { prompt: 12, processed: 16 },
        timing: { reservedAt: signedAt, firstStepAt: signedAt, lastStepAt: signedAt, closedAt: signedAt },
        output: index === 1 ? { count: 4, chain: other, done: true, stopReason: 'eos' } : null, signedAt })));
    const acknowledgment = await createAttemptEvidenceSigner({ identity: identities[0] }).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA,
      { schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA, reservationId: tuesday.id, attemptId: tuesday.executionId, routeHash,
        requesterId: identities[0].peerId, count: 4, chain: other, signedAt });
    ledger.admit(tuesday.id, 0); ledger.admit(tuesday.id, 1);
    const trade = await ledger.settle(tuesday.id, { identity, receipts, acknowledgment });

    // One debit that equals both rewards, paid from the earned balance, with the unused six credits released.
    expect(trade.charge).toBe(4);
    expect(trade.credits.map(row => row.amount)).toEqual([1, 3]);
    expect(trade.credits.reduce((sum, row) => sum + row.amount, 0)).toBe(trade.charge);
    const after = ledger.snapshot().accounts.map(row => [row.balance, row.held]);
    expect(after).toEqual([[2, 0], [-6 + 1, 0], [3, 0]]);
    // Replaying the same settlement pays nobody twice.
    await ledger.settle(tuesday.id, { identity, receipts, acknowledgment });
    expect(ledger.snapshot().accounts.map(row => [row.balance, row.held])).toEqual(after);
  });
  /** A two-stage split request from computer 0, run by computers 1 and 2, with every signed proof component. */
  async function splitRequest(id, count) {
    const route = { schema: 'reploid.partition-route/v1', modelId: 'model', modelIdentity: hash, planId: hash,
      stages: identities.slice(1).map((identity, index) => ({ index, participantId: identity.peerId,
        transportId: `transport-${index}`, residentId: `resident-${index}`, executionId: `stage-${index}` })),
      activation: { schema: 'doppler.activation-tensor/v1', dtype: 'f32', hiddenSize: 1024, precision: 'f32', components: 1, elementStrideBytes: 4 } };
    const identity = { schema: 'reploid.partition-attempt/v2', threadId: 'thread', attemptId: `execution-${id}`,
      requesterId: identities[0].peerId, placementGeneration: 0, route };
    const input = { ...request(id), mode: 'partition', route: identity,
      providers: [{ participantId: identities[1].peerId, weight: 1 }, { participantId: identities[2].peerId, weight: 2 }] };
    const routeHash = await attemptRouteHash(identity), signedAt = new Date(at).toISOString();
    const receipts = await Promise.all([1, 2].map(async (owner, index) => createAttemptEvidenceSigner({ identity: identities[owner] }).sign(STAGE_RECEIPT_SCHEMA,
      { schema: STAGE_RECEIPT_SCHEMA, reservationId: input.id, attemptId: input.executionId, routeHash, partitionIndex: index,
        participantId: identities[owner].peerId, sequence: 2, status: 'settled', steps: count, tokens: { prompt: 12, processed: 12 + count },
        timing: { reservedAt: signedAt, firstStepAt: signedAt, lastStepAt: signedAt, closedAt: signedAt },
        output: index === 1 ? { count, chain: other, done: true, stopReason: 'eos' } : null, signedAt })));
    const acknowledgment = await createAttemptEvidenceSigner({ identity: identities[0] }).sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA,
      { schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA, reservationId: input.id, attemptId: input.executionId, routeHash,
        requesterId: identities[0].peerId, count, chain: other, signedAt });
    return { input, identity, receipts, acknowledgment };
  }
  it('gives a split request one final outcome when a stage host never returns, and refuses its late receipt', async () => {
    ledger.close();
    let clock = at;
    const bounded = { ...options, file: path.join(directory, 'split-finality.sqlite'), now: () => clock,
      policy: { ...policy, partitionUnclaimedReleaseMs: 5000 } };
    ledger = await openFleetCredits(bounded);
    const balances = () => ledger.snapshot().accounts.map(row => [row.balance, row.held]);
    const { input, identity, receipts, acknowledgment } = await splitRequest('lost', 7);
    dispatch(input); ledger.admit(input.id, 0); ledger.admit(input.id, 1);
    // The first stage's host disappears mid-generation. The requester's stream breaks and it fences the request;
    // only the final stage and the requester ever sign.
    expect(await ledger.fence(input.id, input.consumer)).toMatchObject({ status: 'pending', heldCredits: 10, awaitingStages: [0, 1] });
    expect(await ledger.collect(input.id, { identity, receipts: [receipts[1]], acknowledgment })).toMatchObject({
      status: 'pending', heldCredits: 10, acknowledgedOutputTokens: 7, awaitingStages: [0] });

    // Past the request deadline the hold is still there: the silent host has its claim window.
    clock = at + policy.maxRequestMs + 1;
    expect(await ledger.recover(input.id)).toMatchObject({ status: 'pending', heldCredits: 10, awaitingStages: [0] });
    expect(balances()).toEqual([[0, 10], [0, 0], [0, 0]]);

    // After the stated window the request is final: nobody is charged or paid, and the hold is gone. The final stage
    // signed `done` and the requester acknowledged it, but stage 0 has no receipt covering the answer: the replay's
    // `unknown`, which the outcome names.
    clock = at + policy.maxRequestMs + 5000 + policy.maxClockSkewMs;
    expect(await ledger.recover(input.id)).toMatchObject({ status: 'pending', awaitingStages: [0] });
    clock += 1;
    const final = await ledger.recover(input.id);
    expect(final).toMatchObject({ status: 'expired', reason: 'unknown-delivered-answer-without-covering-receipt', charge: 0, credits: [],
      acknowledgedOutputTokens: 7, unclaimedStages: [{ stage: 0, participantId: identities[1].peerId, cleanup: 'unverified' }] });
    expect(balances()).toEqual([[0, 0], [0, 0], [0, 0]]);

    // The host comes back late with a valid receipt. Neither a claim nor new evidence can reopen or pay the request.
    await expect(ledger.settle(input.id, { identity, receipts, acknowledgment })).rejects.toThrow('Claim window closed');
    await expect(ledger.collect(input.id, { identity, receipts, acknowledgment })).rejects.toThrow();
    // The outcome survives a restart, and repeated recovery or claims change nothing.
    ledger.close(); ledger = await openFleetCredits(bounded);
    expect(await ledger.recover(input.id)).toEqual(final);
    await expect(ledger.settle(input.id, { identity, receipts, acknowledgment })).rejects.toThrow('Claim window closed');
    expect(balances()).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(ledger.snapshot().journal).toHaveLength(0);

    // The requester retries as a new request with both hosts present: charged once, both stages paid once.
    clock = at;
    const retry = await splitRequest('retry', 7);
    dispatch(retry.input); ledger.admit(retry.input.id, 0); ledger.admit(retry.input.id, 1);
    const paid = await ledger.settle(retry.input.id, { identity: retry.identity, receipts: retry.receipts, acknowledgment: retry.acknowledgment });
    expect(paid.charge).toBe(7);
    expect(paid.credits.map(row => row.amount)).toEqual([2, 5]);
    expect(balances()).toEqual([[-7, 0], [2, 0], [5, 0]]);
  });
  it('releases a split hold after deadline plus the default window and the clock allowance when the policy names none', async () => {
    ledger.close();
    let clock = at;
    const unbounded = { ...options, file: path.join(directory, 'split-open.sqlite'), now: () => clock };
    ledger = await openFleetCredits(unbounded);
    expect(ledger.policy.partitionUnclaimedReleaseMs).toBe(DEFAULT_UNCLAIMED_RELEASE_MS);
    const lost = await splitRequest('lost', 7);
    dispatch(lost.input); ledger.admit(lost.input.id, 0); ledger.admit(lost.input.id, 1);
    await ledger.fence(lost.input.id, lost.input.consumer);
    await ledger.collect(lost.input.id, { identity: lost.identity, receipts: [lost.receipts[1]], acknowledgment: lost.acknowledgment });
    clock = at + policy.maxRequestMs + DEFAULT_UNCLAIMED_RELEASE_MS + policy.maxClockSkewMs;
    expect(await ledger.recover(lost.input.id)).toMatchObject({ status: 'pending', heldCredits: 10, awaitingStages: [0] });
    clock += 1;
    expect(await ledger.recover(lost.input.id)).toMatchObject({ status: 'expired', charge: 0, reason: 'unknown-delivered-answer-without-covering-receipt' });
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 0 });
  });
  it('reconciles orphaned requester reservations on process restart without touching active or unresolved admitted holds', async () => {
    ledger.close();
    ledger = await openFleetCredits({
      ...options,
      file: path.join(directory, 'reconcile.sqlite'),
      policy: { ...policy, maxPendingPerComputer: 4, maxDebt: 100 }
    });
    const reservedOnly = request('orphan-reserved');
    ledger.reserve(reservedOnly);
    const unadmittedDispatched = request('orphan-unadmitted');
    dispatch(unadmittedDispatched);
    const admittedDispatched = request('orphan-admitted');
    dispatch(admittedDispatched);
    ledger.admit(admittedDispatched.id, 0);
    const stillActive = request('active-live');
    ledger.reserve(stillActive);
    expect(ledger.snapshot().accounts[0].held).toBe(40);

    const outcomes = await ledger.reconcileConsumer(identities[0].peerId, [stillActive.id]);
    expect(outcomes.map(row => ({ id: row.id, charge: row.charge }))).toEqual([
      { id: reservedOnly.id, charge: 0 },
      { id: unadmittedDispatched.id, charge: 0 }
    ]);
    expect(ledger.request(reservedOnly.id).state).toBe('abandoned');
    expect(ledger.request(unadmittedDispatched.id).state).toBe('settled');
    // Admitted work stays fenced in closing with its hold intact until provider proof arrives; active work stays reserved.
    expect(ledger.request(admittedDispatched.id).state).toBe('closing');
    expect(ledger.request(stillActive.id).state).toBe('reserved');
    expect(ledger.snapshot().accounts[0]).toMatchObject({ balance: 0, held: 20 });

    const receipt = await evidence(admittedDispatched);
    await ledger.settle(admittedDispatched.id, receipt);
    ledger.abandonBeforeDispatch(stillActive.id, identities[0].peerId);
    expect(ledger.snapshot().accounts.map(row => ({ balance: row.balance, held: row.held }))).toEqual([
      { balance: -6, held: 0 }, { balance: 6, held: 0 }, { balance: 0, held: 0 }
    ]);
  });
});
