// Shared conversion-record fixture. Test-only rates; none is a product price or issuance rate.

export const CONVERSION_ADMIN = 'pricing_admin_test';
// Conversion-authority double: one test actor may publish. Who may publish in production is policy.
export const conversionAuthority = async ({ authority }) => (authority.actorId === CONVERSION_ADMIN
  ? { allowed: true }
  : { allowed: false, reason: 'not_a_conversion_authority' });
export const publishedBy = (decisionId, actorId = CONVERSION_ADMIN) => ({ actorId, decisionId });

// One credit per minor unit, so a test price states its quantity directly.
export const UNIT_RATE = Object.freeze({ credits: 1, perMinorUnits: 1 });
export const UNIT_CONVERSION_ID = 'conv_test_usd_unit';

/** Publish a test-only conversion record effective now (or at `effectiveFrom`). */
export const publishConversion = (ledger, {
  conversionId = UNIT_CONVERSION_ID, currency = 'USD', rate = UNIT_RATE, rounding = 'floor', effectiveFrom, clock, policyVersion = `test-pricing:${conversionId}`
} = {}) => ledger.publishConversion({
  conversionId, policyVersion, currency, rate, rounding, effectiveFrom: effectiveFrom ?? clock(),
  authority: publishedBy(`decision:${conversionId}`), idempotencyKey: `publish:${conversionId}`
});

/** The stamp of the unit conversion, publishing it on first use. */
export async function unitStamp(ledger, clock) {
  const record = await ledger.getConversion(UNIT_CONVERSION_ID) ?? await publishConversion(ledger, { clock });
  return { conversionId: record.conversionId, recordHash: record.recordHash };
}

/** A purchased-lot source whose price converts to `amount` under the unit conversion. */
export const purchaseSource = async (ledger, clock, { purchaseId, amount, processor = 'test-processor', ...extra }) => ({
  processor, purchaseId, confirmationId: `confirm:${purchaseId}`, price: { amountMinor: amount, currency: 'USD' },
  conversion: await unitStamp(ledger, clock), ...extra
});
