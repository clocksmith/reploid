import { beforeEach, describe, expect, it } from 'vitest';

import { CONVERSION_SCHEMA, convertMinorUnits } from '../../server/ledger/conversion/records.js';
import { sha256Hex } from '../../server/ledger/domain.js';
import { createPaymentStore, createPurchaseIssuanceAuthority } from '../../server/payments/engine.js';
import { createTestPaymentProcessor } from '../../server/payments/test-processor.js';
import {
  DAY, MIN, accounts, advance, at, clock, composeIssuance, fx, harnesses, rejectsWith, resetFixture
} from '../helpers/access-fixture.js';
import { publishConversion, publishedBy } from '../helpers/conversion-fixture.js';

// Test-only rates, prices and records; none is a product price or issuance rate.
const PAYMENT_POLICY = Object.freeze({
  policyVersion: 'test-payments/1',
  processorId: 'test-processor',
  topUps: [{ topUpId: 'test-topup', price: { amountMinor: 999, currency: 'USD' } }],
  polling: { minAgeMs: MIN, reversalWatchMs: 30 * DAY }
});
const V1 = { conversionId: 'conv_usd_v1', rate: { credits: 100, perMinorUnits: 999 } };
const V2 = { conversionId: 'conv_usd_v2', rate: { credits: 120, perMinorUnits: 999 } };

describe.each(Object.keys(harnesses))('credit conversion records (%s store)', (kind) => {
  let harness;
  let processor;
  let ledger;
  let payments;
  let paymentBackend;

  const open = () => {
    paymentBackend = harness.openPaymentBackend();
    ledger = harness.openLedger({
      issuanceAuthority: composeIssuance({ purchased: createPurchaseIssuanceAuthority({ backend: paymentBackend }) }),
      reversalPolicy: { refund: { spentCredit: 'operator_absorbs' }, chargeback: { spentCredit: 'account_deficit' } }
    });
    payments = createPaymentStore({ backend: paymentBackend, ledger, processor, accounts, policy: PAYMENT_POLICY, clock });
  };
  const publish = (version, options = {}) => publishConversion(ledger, { ...version, clock, ...options });
  const checkout = (key) => payments.startCheckout({ participantId: 'peer_alice', topUpId: 'test-topup', idempotencyKey: key });

  beforeEach(async () => {
    resetFixture();
    harness = harnesses[kind]();
    processor = createTestPaymentProcessor({ id: 'test-processor', clock, signatureToleranceMs: 5 * MIN, checkoutTtlMs: DAY });
    open();
    fx.participants.set('peer_alice', 'acct_alice');
    await ledger.openAccount({ accountId: 'acct_alice', ownerId: 'uid_alice' });
  });

  it('publishes immutable, ordered versions only under a named, port-allowed authority', async () => {
    const input = { conversionId: 'conv_x', policyVersion: 'test-pricing/x', currency: 'USD', rate: V1.rate, rounding: 'floor', effectiveFrom: clock(), idempotencyKey: 'publish:x' };
    await rejectsWith(ledger.publishConversion(input), 'conversion_authority_required');
    await expect(ledger.publishConversion({ ...input, authority: publishedBy('decision:x', 'stranger') }))
      .rejects.toMatchObject({ code: 'conversion_not_authorized', details: { reason: 'not_a_conversion_authority' } });
    await rejectsWith(harness.openLedger({ conversionAuthority: null }).publishConversion({ ...input, authority: publishedBy('decision:x') }), 'conversion_authority_required');
    for (const invalid of [{ rate: { credits: 0, perMinorUnits: 1 } }, { rate: { credits: 1 } }, { currency: 'usd' }, { rounding: 'nearest' }, { effectiveFrom: at(-MIN) }]) {
      await rejectsWith(ledger.publishConversion({ ...input, ...invalid, authority: publishedBy('decision:x') }), 'invalid_conversion');
    }
    expect(await ledger.listConversions({ currency: 'USD' })).toEqual([]);

    const v1 = await publish(V1);
    expect(v1).toMatchObject({
      schema: CONVERSION_SCHEMA, conversionId: 'conv_usd_v1', currency: 'USD', unit: 'credit', rate: V1.rate, rounding: 'floor',
      effectiveFrom: clock(), authority: publishedBy('decision:conv_usd_v1'), recordHash: expect.stringMatching(/^sha256:/)
    });
    // Republishing the same terms converges; different terms under a used id are refused.
    expect(await ledger.publishConversion({
      conversionId: 'conv_usd_v1', policyVersion: v1.policyVersion, currency: 'USD', rate: V1.rate, rounding: 'floor',
      effectiveFrom: v1.effectiveFrom, authority: publishedBy('decision:again'), idempotencyKey: 'publish:again'
    })).toEqual(v1);
    await rejectsWith(ledger.publishConversion({
      conversionId: 'conv_usd_v1', policyVersion: 'test-pricing:conv_usd_v1', currency: 'USD', rate: V2.rate, rounding: 'floor',
      effectiveFrom: clock(), authority: publishedBy('decision:change'), idempotencyKey: 'publish:change'
    }), 'conversion_exists');
    expect(await ledger.getConversion('conv_usd_v1')).toEqual(v1);
    // Versions take effect in publication order and never before publication.
    const v2 = await publish(V2, { effectiveFrom: at(DAY) });
    await rejectsWith(publish({ conversionId: 'conv_usd_v3', rate: V1.rate }, { effectiveFrom: at(60 * MIN) }), 'conversion_not_after_current');
    expect((await ledger.listConversions({ currency: 'USD' })).map((record) => record.conversionId)).toEqual(['conv_usd_v1', 'conv_usd_v2']);
    expect(await ledger.quoteConversion({ currency: 'USD', amountMinor: 999 })).toMatchObject({ conversionId: 'conv_usd_v1', recordHash: v1.recordHash, credits: 100, quotedAt: clock() });
    advance(DAY);
    expect(await ledger.quoteConversion({ currency: 'USD', amountMinor: 999 })).toMatchObject({ conversionId: 'conv_usd_v2', recordHash: v2.recordHash, credits: 120 });
    await rejectsWith(ledger.quoteConversion({ currency: 'EUR', amountMinor: 999 }), 'conversion_unavailable');
    // Rounding follows the record: 1000 minor units at 100 per 999 is 100.1 credits.
    expect(convertMinorUnits(v1, 1000)).toBe(100);
    expect(convertMinorUnits({ ...v1, rounding: 'ceil' }, 1000)).toBe(101);
    expect(convertMinorUnits({ ...v1, rounding: 'half_up' }, 1990)).toBe(199);
  });

  it('stamps each purchase quote and lot with its record, so a later version rewrites nothing', async () => {
    await publish(V1);
    const early = await checkout('buy:early');
    expect(early).toMatchObject({ credits: 100, quote: { conversionId: 'conv_usd_v1', amountMinor: 999, credits: 100 } });
    await publish(V2, { effectiveFrom: at(60 * MIN) });
    advance(60 * MIN);
    const late = await checkout('buy:late');
    expect(late).toMatchObject({ credits: 120, quote: { conversionId: 'conv_usd_v2' } });
    // A retried checkout keeps its original quote.
    expect(await checkout('buy:early')).toMatchObject({ credits: 100, quote: { conversionId: 'conv_usd_v1' } });

    // Paid after the new version took effect, the early checkout still issues what it quoted.
    const earlyPaid = await payments.receiveNotification(processor.pay(early.purchaseId));
    const latePaid = await payments.receiveNotification(processor.pay(late.purchaseId));
    expect(earlyPaid.payment).toMatchObject({ phase: 'issued' });
    expect(latePaid.payment).toMatchObject({ phase: 'issued' });
    const earlyLot = await ledger.getLot(earlyPaid.payment.issuance.lotId);
    const lateLot = await ledger.getLot(latePaid.payment.issuance.lotId);
    expect(earlyLot).toMatchObject({ quantity: 100, source: { price: { amountMinor: 999, currency: 'USD' }, conversion: { conversionId: 'conv_usd_v1' } } });
    expect(lateLot).toMatchObject({ quantity: 120, source: { conversion: { conversionId: 'conv_usd_v2' } } });
    // Verification recomputes each lot from the record it stamped, not from the record now in effect.
    expect(await ledger.verifyConversion({ lotId: earlyLot.lotId })).toMatchObject({ consistent: true, conversionId: 'conv_usd_v1', recordedCredits: 100, recomputedCredits: 100 });
    expect(await ledger.verifyConversion({ lotId: lateLot.lotId })).toMatchObject({ consistent: true, conversionId: 'conv_usd_v2', recomputedCredits: 120 });
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 220 });
  });

  it('refuses purchased credit that its stamped record does not recompute', async () => {
    const v1 = await publish(V1);
    const v2 = await publish(V2, { effectiveFrom: at(DAY) });
    const permissive = harness.openLedger({ issuanceAuthority: composeIssuance({}) });
    const issue = (amount, conversion, purchaseId) => permissive.issueCredits({
      accountId: 'acct_alice', provenance: 'purchased', amount, idempotencyKey: `issue:${purchaseId}`,
      source: { processor: 'direct', purchaseId, confirmationId: `confirm:${purchaseId}`, price: { amountMinor: 999, currency: 'USD' }, ...(conversion ? { conversion } : {}) }
    });
    const stamp = ({ conversionId, recordHash }) => ({ conversionId, recordHash });
    await rejectsWith(issue(100, null, 'p_unstamped'), 'invalid_source_reference');
    await expect(issue(120, stamp(v1), 'p_wrong_amount')).rejects.toMatchObject({ code: 'conversion_mismatch', details: { expected: 100 } });
    await rejectsWith(issue(100, { ...stamp(v1), recordHash: `sha256:${'0'.repeat(64)}` }, 'p_wrong_hash'), 'conversion_mismatch');
    await rejectsWith(issue(120, stamp(v2), 'p_not_effective'), 'conversion_not_effective');
    await rejectsWith(issue(100, { conversionId: 'conv_missing', recordHash: v1.recordHash }, 'p_missing'), 'conversion_not_found');
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 0 });
    expect(await issue(100, stamp(v1), 'p_ok')).toMatchObject({ quantity: 100 });
    expect(await ledger.verifyConversion({ conversionId: 'conv_usd_v1', recordHash: v1.recordHash, currency: 'USD', amountMinor: 999, credits: 101 }))
      .toMatchObject({ consistent: false, reasons: [expect.objectContaining({ code: 'conversion_mismatch' })] });
  });

  it('never issues a pre-conversion payment record; it waits for review instead of being re-priced', async () => {
    await publish(V1);
    // A v1 record from before conversion records: policy credits, no conversion stamp.
    const created = await processor.createCheckout({ checkoutId: 'chk_legacy', accountId: 'acct_alice', credits: 250, amount: { amountMinor: 999, currency: 'USD' }, idempotencyKey: 'chk_legacy' });
    await paymentBackend.runTransaction(async (tx) => {
      tx.create('payments', 'chk_legacy', {
        schema: 'reploid.payment-record/v1', checkoutId: 'chk_legacy', accountId: 'acct_alice', participantId: 'peer_alice', processor: 'test-processor',
        purchaseId: created.purchaseId, topUp: { topUpId: 'test-topup', credits: 250, price: { amountMinor: 999, currency: 'USD' } },
        paymentPolicyVersion: 'test-payments/0', requestHash: 'sha256:legacy', phase: 'open', checkout: created.checkout,
        observed: null, issuance: null, reversal: null, review: null, lastError: null, createdAt: clock(), updatedAt: clock()
      });
      tx.create('claims', sha256Hex(`purchase\u0000test-processor\u0000${created.purchaseId}`), {
        kind: 'purchase', processor: 'test-processor', purchaseId: created.purchaseId, checkoutId: 'chk_legacy', recordedAt: clock()
      });
    });
    const result = await payments.receiveNotification(processor.pay(created.purchaseId));
    expect(result.payment).toMatchObject({ phase: 'review_required', review: { reason: 'conversion_unstamped' }, issuance: null, quote: null, credits: 250 });
    expect(await payments.pollPending()).toEqual([]);
    expect(await ledger.getAccount('acct_alice')).toMatchObject({ available: 0 });
  });
});
