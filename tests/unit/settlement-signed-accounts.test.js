// @vitest-environment node
// Signed accounts (docs/settlement-replay.md, step 8): the requester signs the account it is charged from into its
// terms, and each stage signs the account its share is paid into into its acceptance. Proves the replay then takes who
// is charged and who is paid from those signatures and not from the caller's grouping, and what it refuses. The
// records are signed here with test keys; this replays no physical trade.
import { describe, expect, it } from 'vitest';
import { createAttemptEvidenceSigner } from '../../packages/reploid/src/mesh/partitions/partition-attempt-evidence.js';
import { replaySettlement } from '../../server/fleet/settlement-replay.js';
import {
  SETTLEMENT_ACCEPTANCE_SCHEMA, acceptSettlementTerms, verifySettlementAcceptance, verifySettlementTerms
} from '../../server/fleet/settlement-terms.js';
import { POLICY, createParties, runAttempt } from '../../scripts/settlement/scenario.js';

const bodyOf = record => { const { publicJwk: _key, signature: _signature, ...body } = record; return body; };
const replay = (records, at, accountOf = null) => replaySettlement({ records, policies: [POLICY], at, ...(accountOf ? { accountOf } : {}) });
const ACCOUNTS = { requester: 'owner-requester', stages: ['owner-a', 'owner-b'] };
/** The same acceptance signed again by its stage with another payout account, or with none. */
const reaccept = async (parties, a, index, payoutAccount) => {
  const original = a.all().find(row => row.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && row.partitionIndex === index);
  const { payoutAccount: _old, ...body } = bodyOf(original);
  return createAttemptEvidenceSigner({ identity: parties.stages[index], now: () => Date.parse(original.signedAt) })
    .sign(SETTLEMENT_ACCEPTANCE_SCHEMA, { ...body, ...(payoutAccount === undefined ? {} : { payoutAccount }) });
};

describe('signed accounts', () => {
  it('are carried by terms and acceptances that verify, and reported on the row', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3], accounts: ACCOUNTS });
    expect(a.terms.debitAccount).toBe('owner-requester');
    expect(await verifySettlementTerms(a.terms)).toMatchObject({ ok: true });
    const acceptances = a.all().filter(row => row.schema === SETTLEMENT_ACCEPTANCE_SCHEMA);
    expect(acceptances.map(row => row.payoutAccount).sort()).toEqual(expect.arrayContaining(['owner-a', 'owner-b']));
    for (const row of acceptances) expect(await verifySettlementAcceptance(row)).toMatchObject({ ok: true });
    const out = await replay(a.all(), a.decidedAt);
    expect(out.reservations[0]).toMatchObject({ status: 'settled', debit: 15, accounts: { requester: 'owner-requester', stages: ['owner-a', 'owner-b'] } });
    expect(out.reservations[0].credits.map(credit => credit.amount)).toEqual([3, 12]);
    expect(out.balances).toEqual({ 'owner-a': 3, 'owner-b': 12, 'owner-requester': -15 });
  });

  it('decide who is the requester\'s own stage from the signatures alone', async () => {
    const parties = await createParties(2);
    // Stage 0 signs the requester's account as its own: its share is neither charged nor paid.
    const own = await runAttempt(parties, { weights: [1, 3], accounts: { requester: 'owner-requester', stages: ['owner-requester', 'owner-b'] } });
    const settled = (await replay(own.all(), own.decidedAt)).reservations[0];
    expect(settled).toMatchObject({ status: 'settled', debit: 12 });
    expect(settled.credits.map(credit => credit.amount)).toEqual([0, 12]);
    // Both stages signed their own accounts: both are paid, with no grouping supplied at all.
    const paid = await runAttempt(parties, { weights: [1, 3], accounts: ACCOUNTS });
    const row = (await replay(paid.all(), paid.decidedAt)).reservations[0];
    expect(row).toMatchObject({ status: 'settled', debit: 15 });
    expect(row.credits.map(credit => credit.amount)).toEqual([3, 12]);
    // Without signed accounts the caller's grouping decides it, and the row carries no accounts.
    const lumped = id => (id === parties.stages[0].peerId || id === parties.requester.peerId ? 'lumped' : id);
    const unsigned = await runAttempt(parties, { weights: [1, 3] });
    expect((await replay(unsigned.all(), unsigned.decidedAt, lumped)).reservations[0]).toMatchObject({ status: 'settled', debit: 12 });
    expect((await replay(unsigned.all(), unsigned.decidedAt)).reservations[0].accounts).toBeUndefined();
  });

  it('are refused when the caller\'s enrollment says a party is not under the account it signed', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3], accounts: ACCOUNTS });
    const enrollment = new Map([[parties.requester.peerId, 'owner-requester'], [parties.stages[0].peerId, 'owner-a'], [parties.stages[1].peerId, 'owner-b']]);
    const agreed = (await replay(a.all(), a.decidedAt, id => enrollment.get(id) ?? id)).reservations[0];
    expect(agreed).toMatchObject({ status: 'settled', debit: 15 });
    // A publisher that groups stage 0 with the requester contradicts what stage 0 signed: nothing is settled on it.
    const grouped = id => (id === parties.stages[0].peerId ? 'owner-requester' : enrollment.get(id) ?? id);
    expect((await replay(a.all(), a.decidedAt, grouped)).reservations[0]).toMatchObject({ status: 'invalid', debit: null, credits: null,
      reason: 'a participant signed an account it is not enrolled under' });
    // A stranger that signs someone else's account as the one to charge is refused the same way.
    const stranger = await createParties(2);
    const forged = await runAttempt(stranger, { tag: 'forged', weights: [1, 1], accounts: { requester: 'owner-requester', stages: ['owner-thief', 'owner-thief'] } });
    const known = id => enrollment.get(id) ?? id;
    const both = await replay([...a.all(), ...forged.all()], Math.max(a.decidedAt, forged.decidedAt), known);
    expect(both.reservations.find(item => item.reservationId === forged.reservationId)).toMatchObject({ status: 'invalid', debit: null });
    expect(both.balances).toEqual({ 'owner-a': 3, 'owner-b': 12, 'owner-requester': -15 });
  });

  it('refuse a stage that accepts such terms without naming its account, and leave the attempt unknown', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3], accounts: ACCOUNTS });
    const signer = createAttemptEvidenceSigner({ identity: parties.stages[0] });
    await expect(acceptSettlementTerms({ signer, terms: a.terms, partitionIndex: 0 })).rejects.toThrow(/payout account/);
    const bare = await reaccept(parties, a, 0, undefined);
    const records = [...a.all().filter(row => !(row.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && row.partitionIndex === 0)), bare];
    const row = (await replay(records, a.decidedAt)).reservations[0];
    expect(row).toMatchObject({ status: 'unknown', debit: null, accounts: { requester: 'owner-requester', stages: [null, 'owner-b'] } });
    expect(row.reason).toMatch(/stage 0/);
  });

  it('are a conflict when one participant names two accounts', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3], accounts: ACCOUNTS });
    const second = await reaccept(parties, a, 1, 'owner-elsewhere');
    const row = (await replay([...a.all(), second], a.decidedAt)).reservations[0];
    expect(row).toMatchObject({ status: 'conflict', debit: null });
    expect(row.conflicts).toContainEqual({ signer: parties.stages[1].peerId, kind: 'payout-account', blocking: true, accounts: ['owner-b', 'owner-elsewhere'] });
    // The requester's own key running a stage must name the requester's account there too.
    const self = { requester: parties.requester, stages: [parties.requester, parties.stages[1]] };
    const split = await runAttempt(self, { weights: [1, 3], accounts: { requester: 'owner-requester', stages: ['owner-other', 'owner-b'] } });
    const selfRow = (await replay(split.all(), split.decidedAt)).reservations[0];
    expect(selfRow.status).toBe('conflict');
    expect(selfRow.conflicts).toContainEqual({ signer: parties.requester.peerId, kind: 'payout-account', blocking: true, accounts: ['owner-other', 'owner-requester'] });
  });

  it('do not change an attempt whose terms name no account, even when a stage names one', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3] });
    const named = await reaccept(parties, a, 0, 'owner-a');
    const records = [...a.all().filter(row => !(row.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && row.partitionIndex === 0)), named];
    const plain = (await replay(a.all(), a.decidedAt)).reservations[0], withName = (await replay(records, a.decidedAt)).reservations[0];
    expect(withName).toEqual(plain);
    expect(withName.accounts).toBeUndefined();
  });

  it('refuse malformed account members', async () => {
    const parties = await createParties(2);
    const a = await runAttempt(parties, { weights: [1, 3], accounts: ACCOUNTS });
    const requester = createAttemptEvidenceSigner({ identity: parties.requester });
    for (const debitAccount of ['', 7, 'x'.repeat(129)]) {
      const record = await requester.sign('reploid.settlement-terms/v1', { ...bodyOf(a.terms), debitAccount });
      expect(await verifySettlementTerms(record)).toEqual({ ok: false, problem: 'terms_malformed' });
    }
    const stage = createAttemptEvidenceSigner({ identity: parties.stages[0] });
    const acceptance = a.all().find(row => row.schema === SETTLEMENT_ACCEPTANCE_SCHEMA && row.partitionIndex === 0);
    for (const payoutAccount of ['', null, 'x'.repeat(129)]) {
      const record = await stage.sign(SETTLEMENT_ACCEPTANCE_SCHEMA, { ...bodyOf(acceptance), payoutAccount });
      expect(await verifySettlementAcceptance(record)).toEqual({ ok: false, problem: 'acceptance_malformed' });
    }
  });
});
