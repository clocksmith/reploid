/**
 * @fileoverview Credit conversion records: published, versioned policy that
 * turns a currency amount into credits.
 *
 * A record names its currency, its rate as credits per currency minor units
 * (`rate.credits` per `rate.perMinorUnits`, so either direction is exact), a
 * rounding mode and the time it takes effect. Records are append-only: a
 * conversion id holds one record forever, and each currency's versions take
 * effect in publication order, never before they are published. Purchase
 * quotes, purchased lots and currency-funded allocations stamp the record
 * they used, so a later version never changes an earlier transaction and
 * verification recomputes from the stamped record. The rate values are
 * product policy supplied by a named authority through the ledger's
 * conversion-authority port; nothing here supplies one.
 */

import {
  ROUNDING_MODES,
  assertId,
  cloneJson,
  divideRounded,
  fail,
  hashCanonical,
  isAmount,
  isIsoTime,
  isNonEmptyString,
  toMs
} from '../domain.js';

export const CONVERSION_SCHEMA = 'reploid.credit-conversion/v1';
export const CONVERSION_QUOTE_SCHEMA = 'reploid.credit-conversion-quote/v1';
// Refusals that are final for the record that asked (an allocation or a checkout).
export const CONVERSION_REFUSAL_CODES = Object.freeze(['conversion_unavailable', 'conversion_mismatch']);

const CURRENCY_CODE = /^[A-Z]{3}$/;
const TERM_FIELDS = Object.freeze(['schema', 'conversionId', 'policyVersion', 'currency', 'unit', 'rate', 'rounding', 'effectiveFrom']);
const insert = (collection, id, value) => ({ create: true, collection, id, value });
const put = (collection, id, value) => ({ create: false, collection, id, value });
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const assertKnownKeys = (input, allowed, operation) => {
  const unknown = Object.keys(input || {}).filter((key) => !allowed.includes(key));
  if (unknown.length) fail('invalid_input', `${operation} does not accept: ${unknown.join(', ')}`, { unknown });
};

/** Hash of a record's economic terms; publication metadata is outside it. */
export const conversionHash = (record) => hashCanonical(Object.fromEntries(TERM_FIELDS.map((field) => [field, record[field]])));
export const conversionStamp = (record) => ({ conversionId: record.conversionId, recordHash: record.recordHash });

function validateConversion(input, { unitName, now }) {
  const errors = [];
  const { conversionId, policyVersion, currency, rate, rounding, effectiveFrom } = input;
  if (!isNonEmptyString(policyVersion)) errors.push('policyVersion must name the pricing policy version');
  if (!CURRENCY_CODE.test(currency ?? '')) errors.push('currency must be an ISO 4217 code');
  const rateKeys = rate && typeof rate === 'object' ? Object.keys(rate) : [];
  if (rateKeys.length !== 2 || !isPositiveInteger(rate?.credits) || !isPositiveInteger(rate?.perMinorUnits)) {
    errors.push('rate must be { credits, perMinorUnits }: positive integers, credits per that many minor units');
  }
  if (!ROUNDING_MODES.includes(rounding)) errors.push(`rounding must be one of ${ROUNDING_MODES.join(', ')}`);
  if (!isIsoTime(effectiveFrom)) errors.push('effectiveFrom must be an ISO time');
  else if (toMs(effectiveFrom) < toMs(now)) errors.push('effectiveFrom must not precede publication; a version never applies retroactively');
  if (errors.length) fail('invalid_conversion', 'conversion record is incomplete', { errors });
  const record = {
    schema: CONVERSION_SCHEMA,
    conversionId,
    policyVersion,
    currency,
    unit: unitName,
    rate: { credits: rate.credits, perMinorUnits: rate.perMinorUnits },
    rounding,
    effectiveFrom
  };
  return { ...record, recordHash: conversionHash(record) };
}

/** Credits for `amountMinor` under one record: amountMinor x credits / perMinorUnits, rounded by the record. */
export function convertMinorUnits(record, amountMinor) {
  if (!isAmount(amountMinor)) fail('invalid_input', 'amountMinor must be a non-negative integer');
  const credits = divideRounded(BigInt(amountMinor) * BigInt(record.rate.credits), record.rate.perMinorUnits, record.rounding);
  if (credits > BigInt(Number.MAX_SAFE_INTEGER)) fail('conversion_overflow', 'conversion exceeds the safe integer range');
  return Number(credits);
}

/** The record in effect at `at`: the latest effectiveFrom at or before it. */
export function conversionAt(records, at) {
  return records
    .filter((record) => toMs(record.effectiveFrom) <= toMs(at))
    .sort((left, right) => toMs(right.effectiveFrom) - toMs(left.effectiveFrom))[0] ?? null;
}

// Why a stamped figure disagrees with its record, or [] when it recomputes exactly.
const recomputeProblems = (record, stamp, { currency, amountMinor, credits, at }) => {
  if (!record) return [{ code: 'conversion_not_found', message: 'the stamped conversion record is not published' }];
  const problems = [];
  if (record.recordHash !== stamp.recordHash || conversionHash(record) !== record.recordHash) {
    problems.push({ code: 'conversion_mismatch', message: 'the stamped record differs from the published record' });
  }
  if (record.currency !== currency) problems.push({ code: 'conversion_mismatch', message: `the record converts ${record.currency}, not ${currency}` });
  if (at !== undefined && toMs(at) < toMs(record.effectiveFrom)) {
    problems.push({ code: 'conversion_not_effective', message: 'the record was not yet in effect' });
  }
  if (!problems.length) {
    const expected = convertMinorUnits(record, amountMinor);
    if (expected !== credits) {
      problems.push({ code: 'conversion_mismatch', message: `${amountMinor} ${currency} minor units convert to ${expected} credits, not ${credits}`, expected });
    }
  }
  return problems;
};

/**
 * Inside a ledger transaction: the stamped record, unchanged and effective by
 * `now`, converts `amountMinor` of `currency` to exactly `credits`.
 */
export async function checkStampedConversion(tx, stamp, { currency, amountMinor, credits, now }) {
  const record = isNonEmptyString(stamp?.conversionId) ? await tx.get('conversions', stamp.conversionId) : null;
  const [problem] = recomputeProblems(record, stamp ?? {}, { currency, amountMinor, credits, at: now });
  if (problem) fail(problem.code, problem.message, { conversionId: stamp?.conversionId ?? null, expected: problem.expected ?? null });
  return record;
}

/**
 * Conversion operations for the ledger store over its backend and idempotent
 * `mutate`. `conversionAuthority(request) -> { allowed, reason? }` decides
 * publication; without it publishing fails closed.
 */
export function createConversionOperations({ backend, policy, clock, mutate, conversionAuthority = null }) {
  const inEffect = async (currency, at) => conversionAt(await backend.list('conversions', { field: 'currency', value: currency }), at);

  const operations = {
    /**
     * Publish one immutable version. Republishing identical terms under the
     * same id converges; different terms under a used id are refused, and a
     * currency's next version must take effect after its latest.
     */
    async publishConversion(input = {}) {
      assertKnownKeys(input, ['conversionId', 'policyVersion', 'currency', 'rate', 'rounding', 'effectiveFrom', 'authority', 'idempotencyKey'], 'publishConversion');
      const { idempotencyKey, authority: named, ...fields } = input;
      assertId(fields.conversionId, 'conversionId');
      if (!named || typeof named !== 'object' || Object.keys(named).some((key) => !['actorId', 'decisionId'].includes(key))
        || !isNonEmptyString(named.actorId) || !isNonEmptyString(named.decisionId)) {
        fail('conversion_authority_required', 'publishing a conversion needs authority { actorId, decisionId }');
      }
      const authority = { actorId: named.actorId, decisionId: named.decisionId };
      const now = clock();
      const record = validateConversion(fields, { unitName: policy.unit.name, now });
      if (typeof conversionAuthority !== 'function') {
        fail('conversion_authority_required', 'publishing a conversion needs the ledger\'s conversion-authority decision port');
      }
      const decision = await conversionAuthority(cloneJson({
        action: 'publish_conversion', conversionId: record.conversionId, policyVersion: record.policyVersion, currency: record.currency, authority
      }));
      if (decision?.allowed !== true) fail('conversion_not_authorized', 'the conversion authority did not allow this decision', { reason: decision?.reason ?? null });
      return mutate({
        operation: 'publishConversion', scopeId: record.conversionId, idempotencyKey, request: { ...fields, authority }, now,
        body: async (tx) => {
          const existing = await tx.get('conversions', record.conversionId);
          const head = await tx.get('conversionHeads', record.currency);
          if (existing) {
            if (existing.recordHash === record.recordHash) return { result: existing, writes: [] };
            fail('conversion_exists', 'this conversion id already holds different terms; publish a new version', { conversionId: record.conversionId });
          }
          if (head && toMs(record.effectiveFrom) <= toMs(head.effectiveFrom)) {
            fail('conversion_not_after_current', 'a new version takes effect after every earlier version of its currency', {
              current: head.conversionId, effectiveFrom: head.effectiveFrom
            });
          }
          const published = { ...record, authority, publishedAt: now };
          return {
            result: published,
            writes: [
              insert('conversions', record.conversionId, published),
              put('conversionHeads', record.currency, { currency: record.currency, conversionId: record.conversionId, effectiveFrom: record.effectiveFrom, updatedAt: now })
            ]
          };
        }
      });
    },

    async getConversion(conversionId) {
      return backend.get('conversions', conversionId);
    },

    async listConversions({ currency } = {}) {
      if (!CURRENCY_CODE.test(currency ?? '')) fail('invalid_input', 'currency must be an ISO 4217 code');
      return (await backend.list('conversions', { field: 'currency', value: currency }))
        .sort((left, right) => toMs(left.effectiveFrom) - toMs(right.effectiveFrom));
    },

    /** Credits for a currency amount now, stamped with the record in effect. Nothing is stored. */
    async quoteConversion({ currency, amountMinor } = {}) {
      if (!CURRENCY_CODE.test(currency ?? '')) fail('invalid_input', 'currency must be an ISO 4217 code');
      const now = clock();
      const record = await inEffect(currency, now);
      if (!record) fail('conversion_unavailable', `no conversion for ${currency} is in effect`, { currency });
      return {
        schema: CONVERSION_QUOTE_SCHEMA,
        ...conversionStamp(record),
        policyVersion: record.policyVersion,
        currency,
        amountMinor,
        credits: convertMinorUnits(record, amountMinor),
        rounding: record.rounding,
        quotedAt: now
      };
    },

    /**
     * Recompute a stamped figure from its own record: a purchased lot
     * ({ lotId }), a currency allocation ({ allocationId }) or an explicit
     * { conversionId, recordHash, currency, amountMinor, credits }.
     */
    async verifyConversion(input = {}) {
      let figure = input;
      if (input.lotId !== undefined) {
        const lot = await backend.get('lots', input.lotId);
        if (!lot) fail('lot_not_found', `lot ${input.lotId} was not found`);
        if (lot.provenance !== 'purchased') return { applicable: false, consistent: true, reasons: [] };
        figure = {
          ...(lot.source.conversion ?? {}), currency: lot.source.price.currency, amountMinor: lot.source.price.amountMinor, credits: lot.quantity, at: lot.issuedAt
        };
      } else if (input.allocationId !== undefined) {
        const allocation = await backend.get('allocations', input.allocationId);
        if (!allocation) fail('allocation_not_found', `allocation ${input.allocationId} was not found`);
        if (allocation.unit.kind !== 'currency') return { applicable: false, consistent: true, reasons: [] };
        figure = {
          ...(allocation.conversion ?? {}), currency: allocation.unit.currency, amountMinor: allocation.amount, credits: allocation.credits, at: allocation.allocatedAt
        };
      }
      if (!isNonEmptyString(figure.conversionId)) {
        return { applicable: true, consistent: false, conversionId: null, reasons: [{ code: 'conversion_unstamped', message: 'the figure names no conversion record' }] };
      }
      const record = await backend.get('conversions', figure.conversionId);
      const reasons = recomputeProblems(record, figure, figure);
      return {
        applicable: true,
        consistent: reasons.length === 0,
        conversionId: figure.conversionId,
        recordedCredits: figure.credits,
        recomputedCredits: record ? convertMinorUnits(record, figure.amountMinor) : null,
        reasons
      };
    }
  };
  return { operations, conversionInEffect: inEffect };
}

export default { CONVERSION_SCHEMA, convertMinorUnits, conversionAt, checkStampedConversion, createConversionOperations };
