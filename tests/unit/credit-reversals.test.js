import { beforeEach, describe, expect, it } from 'vitest';

import { validateReversalPolicy } from '../../server/ledger/reversals.js';
import { LEDGER_STORE_OPERATIONS } from '../../server/ledger/store-contract.js';
import {
  MIN, advance, clock, composeIssuance, crash, deliver, harnesses, journalShape, rejectsWith, reserve, resetFixture, spend
} from '../helpers/access-fixture.js';

// Test-only treatments. Which treatment applies to which kind is an open product decision.
const DEFICIT_ON_CHARGEBACK = { refund: { spentCredit: 'operator_absorbs' }, chargeback: { spentCredit: 'account_deficit' } };
const issuanceAuthority = composeIssuance({});

const buy = (ledger, accountId, amount, purchaseId) => ledger.issueCredits({
  accountId,
  provenance: 'purchased',
  amount,
  source: { processor: 'test-processor', purchaseId, confirmationId: `confirm:${purchaseId}`, price: { amountMinor: 999, currency: 'USD' } },
  idempotencyKey: `issue:${purchaseId}`
});

const reverse = (ledger, lotId, kind, { reversalId = `${kind}:${lotId}`, key, authority } = {}) => ledger.reverseIssuance({
  lotId,
  reversalId,
  kind,
  authority: authority ?? { kind: 'payment_processor', decisionId: reversalId, actorId: 'test-processor' },
  idempotencyKey: key ?? `reverse:${lotId}`
});

describe.each(Object.keys(harnesses))('credit reversals (%s store)', (kind) => {
  let harness;
  let ledger;

  beforeEach(async () => {
    resetFixture();
    harness = harnesses[kind]();
    ledger = harness.openLedger({ issuanceAuthority, reversalPolicy: DEFICIT_ON_CHARGEBACK });
    await ledger.openAccount({ accountId: 'acct_alice', ownerId: 'uid_alice' });
  });

  it('exposes reversal in the ledger store contract', () => {
    expect(LEDGER_STORE_OPERATIONS).toEqual(expect.arrayContaining(['reverseIssuance', 'getReversal']));
  });

  it('removes the unspent balance; a chargeback turns spent credit into a deficit that blocks new spending', async () => {
    const { lotId } = await buy(ledger, 'acct_alice', 100, 'purchase:1');
    await ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'earned', amount: 50, idempotencyKey: 'issue:work:1',
      source: { category: 'computation', workId: 'work:1', offerId: 'o', validationId: 'v', validatorId: 'val', outcome: 'accepted', validatedAt: clock() }
    });
    // Earned credit is consumed first, so draw it down before touching the purchase.
    await spend(ledger, 'acct_alice', 'q_earned');
    await spend(ledger, 'acct_alice', 'q_mixed');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ byProvenance: { earned: { available: 0 }, purchased: { available: 90 } } });

    const reversal = await reverse(ledger, lotId, 'chargeback');
    expect(reversal).toMatchObject({
      lotId, kind: 'chargeback', treatment: 'account_deficit', quantity: 100, removed: 90, pendingHeld: 0, shortfall: 10,
      status: 'complete', deficit: 10, balance: { available: 0, held: 0 }
    });
    expect(await reverse(ledger, lotId, 'chargeback')).toEqual(reversal);
    await rejectsWith(reverse(ledger, lotId, 'refund', { key: 'reverse:again' }), 'duplicate_reversal');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({
      available: 0, deficit: 10, byProvenance: { purchased: { issued: 100, spent: 10, reversed: 90, available: 0 }, earned: { spent: 50 } }
    });

    await buy(ledger, 'acct_alice', 100, 'purchase:2');
    await rejectsWith(reserve(ledger, 'acct_alice', 'q_blocked'), 'account_in_deficit');
    expect((await journalShape(ledger, 'acct_alice')).filter(([type]) => type === 'reverse')).toEqual([['reverse', 90]]);
    expect(await ledger.auditAccount('acct_alice')).toMatchObject({ consistent: true });
    expect(await ledger.getSolvencySnapshot()).toMatchObject({
      reversed: { total: 90, byProvenance: { purchased: 90 } },
      reversalShortfall: { deficit: 10, absorbed: 0 },
      subsidy: { reversalAbsorbed: 0 }
    });
  });

  it('lets a refund record spent credit as operator-absorbed subsidy without blocking the account', async () => {
    const { lotId } = await buy(ledger, 'acct_alice', 100, 'purchase:1');
    await spend(ledger, 'acct_alice', 'q1');
    expect(await reverse(ledger, lotId, 'refund')).toMatchObject({ treatment: 'operator_absorbs', removed: 70, shortfall: 30, deficit: 0 });
    await buy(ledger, 'acct_alice', 100, 'purchase:2');
    expect(await spend(ledger, 'acct_alice', 'q2')).toMatchObject({ charge: 30 });
    expect(await ledger.getSolvencySnapshot()).toMatchObject({
      reversalShortfall: { deficit: 0, absorbed: 30 },
      subsidy: { reversalAbsorbed: 30, communityAccessConsumed: 0 },
      outstanding: { byProvenance: { purchased: 70 } }
    });
  });

  it('resolves held credit when its reservation settles, expires or is refunded', async () => {
    const { lotId } = await buy(ledger, 'acct_alice', 200, 'purchase:1');
    const settled = await reserve(ledger, 'acct_alice', 'q_settled');
    const expiring = await reserve(ledger, 'acct_alice', 'q_expiring');
    expect(await reverse(ledger, lotId, 'refund')).toMatchObject({ removed: 80, pendingHeld: 120, shortfall: 0, status: 'awaiting_holds' });
    await rejectsWith(reserve(ledger, 'acct_alice', 'q_new'), 'insufficient_balance');

    const receipt = await deliver(ledger, settled);
    expect(receipt).toMatchObject({ charge: 30, released: 30 });
    expect(await ledger.getReversal(lotId)).toMatchObject({ removed: 110, pendingHeld: 60, shortfall: 30, status: 'awaiting_holds' });
    advance(11 * MIN);
    expect(await ledger.expireReservations()).toHaveLength(1);
    expect(await ledger.getReversal(lotId)).toMatchObject({ removed: 170, pendingHeld: 0, shortfall: 30, status: 'complete' });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 0, held: 0 });

    // A later service refund restored to the reversed lot is removed too and shrinks the shortfall.
    await ledger.refundSettlement({
      reservationId: settled, refundId: 'refund:service', amount: 10, idempotencyKey: 'refund:service',
      authority: { kind: 'operator_adjustment', decisionId: 'decision:1', actorId: 'operator_test' }
    });
    expect(await ledger.getReversal(lotId)).toMatchObject({ removed: 180, shortfall: 20 });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 0, byProvenance: { purchased: { reversed: 180, spent: 30, refunded: 10 } } });
    expect((await ledger.getSolvencySnapshot()).reversalShortfall).toEqual({ deficit: 0, absorbed: 20 });
    expect(await journalShape(ledger, 'acct_alice')).toEqual([
      ['issue', 200], ['reserve', 60], ['reserve', 60], ['reverse', 80],
      ['charge', 30], ['release', 30], ['reverse', 30],
      ['release', 60], ['reverse', 60],
      ['refund', 10], ['reverse', 10]
    ]);
    expect(await ledger.auditAccount('acct_alice')).toMatchObject({ consistent: true });
  });

  it('reverses only purchased lots, keeping earned and subsidized credit distinct', async () => {
    const work = { category: 'storage', workId: 'work:s', offerId: 'o', validationId: 'v', validatorId: 'val', outcome: 'accepted', validatedAt: clock() };
    const subsidized = await ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'subsidized', amount: 7, idempotencyKey: 'issue:subsidized',
      source: { ...work, fundingId: 'funding:operator', funderKind: 'operator', funderId: 'operator_test' }
    });
    const earned = await ledger.issueCredits({
      accountId: 'acct_alice', provenance: 'earned', amount: 5, idempotencyKey: 'issue:earned', source: { ...work, workId: 'work:e' }
    });
    await rejectsWith(reverse(ledger, subsidized.lotId, 'chargeback'), 'reversal_not_permitted');
    await rejectsWith(reverse(ledger, earned.lotId, 'refund'), 'reversal_not_permitted');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ byProvenance: { subsidized: { available: 7, reversed: 0 }, earned: { available: 5 } } });
  });

  it('fails closed without an explicit spent-credit treatment or reversal authority', async () => {
    const { lotId } = await buy(ledger, 'acct_alice', 100, 'purchase:1');
    const undeclared = harness.openLedger({ issuanceAuthority });
    await rejectsWith(reverse(undeclared, lotId, 'refund'), 'reversal_policy_required');
    await rejectsWith(reverse(ledger, lotId, 'refund', { authority: { kind: 'automatic_grader', decisionId: 'x', actorId: 'y' } }), 'reversal_authority_required');
    await rejectsWith(reverse(ledger, lotId, 'goodwill'), 'invalid_input');
    expect(() => validateReversalPolicy({ refund: { spentCredit: 'account_deficit' } })).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
    expect(() => validateReversalPolicy({ ...DEFICIT_ON_CHARGEBACK, chargeback: { spentCredit: 'forgive' } })).toThrow(expect.objectContaining({ code: 'invalid_policy' }));
    expect(await ledger.getReversal(lotId)).toBeNull();
  });

  it('recovers a crash during reversal with exactly one effect', async () => {
    const { lotId } = await buy(ledger, 'acct_alice', 100, 'purchase:1');
    harness.faults.ledger.beforeCommit = crash('simulated crash before commit');
    await expect(reverse(ledger, lotId, 'refund')).rejects.toThrow('simulated crash before commit');
    expect(await ledger.getReversal(lotId)).toBeNull();
    harness.faults.ledger.afterCommit = crash('simulated crash after commit');
    await expect(reverse(ledger, lotId, 'refund')).rejects.toThrow('simulated crash after commit');
    const restarted = harness.openLedger({ issuanceAuthority, reversalPolicy: DEFICIT_ON_CHARGEBACK });
    expect(await reverse(restarted, lotId, 'refund')).toMatchObject({ removed: 100, shortfall: 0 });
    expect((await journalShape(restarted, 'acct_alice')).filter(([type]) => type === 'reverse')).toEqual([['reverse', 100]]);
    expect(await restarted.auditAccount('acct_alice')).toMatchObject({ consistent: true });
  });
});
