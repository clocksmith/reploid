/**
 * @fileoverview Pure credit-ledger rules: accounting policy, issuance sources,
 * quote terms and settlement formulas.
 *
 * Product policy (prices, reward amounts, rounding, lot consumption order)
 * arrives as explicit input. Nothing here performs I/O or supplies a default
 * price, reward or policy value.
 */

import { createHash } from 'node:crypto';

export const PRODUCT_ECONOMICS_CONTRACT_ID = 'reploid.product-economics/1.0.0';
export const ACCOUNT_SCHEMA = 'reploid.credit-account/v1';
export const LOT_SCHEMA = 'reploid.credit-lot/v1';
export const QUOTE_SCHEMA = 'reploid.credit-quote/v1';
export const RESERVATION_SCHEMA = 'reploid.credit-reservation/v1';
export const SETTLEMENT_SCHEMA = 'reploid.credit-settlement/v1';
export const REFUND_SCHEMA = 'reploid.credit-refund/v1';
export const REVIEW_SCHEMA = 'reploid.credit-quality-review/v1';
export const JOURNAL_SCHEMA = 'reploid.credit-journal-entry/v1';
export const SOLVENCY_SCHEMA = 'reploid.credit-solvency-inputs/v1';

// `subsidized` is credit for validated contribution paid from an explicit operator or
// community funding reservation instead of settled demand; it stays apart from `earned`.
export const PROVENANCE_KINDS = Object.freeze(['earned', 'subsidized', 'purchased', 'donated', 'community_access']);
export const REWARD_PROVENANCE = Object.freeze(['earned', 'subsidized']);
export const REWARD_CATEGORIES = Object.freeze(['computation', 'delivery', 'storage', 'readiness']);
export const ROUNDING_MODES = Object.freeze(['floor', 'ceil', 'half_up']);
export const EXCEEDANCE_BEHAVIORS = Object.freeze(['reject', 'stop_and_report']);
export const SETTLEMENT_OUTCOMES = Object.freeze([
  'full', 'reduced', 'partial_delivery', 'cancellation', 'timeout', 'provider_failure', 'failed_quality'
]);
export const REVIEW_DISPOSITIONS = Object.freeze(['full', 'reduced', 'partial_delivery', 'failed_quality']);
export const REVIEW_AUTHORITY = 'operational_review';
export const REFUND_AUTHORITIES = Object.freeze(['quality_review', 'dispute', 'operator_adjustment']);
export const ATTEMPT_CLOSING_STATUSES = Object.freeze(['failed', 'abandoned']);
// transfer_out/transfer_in are reserved for approved transfer activation; nothing emits them.
export const ENTRY_TYPES = Object.freeze(['issue', 'reserve', 'charge', 'release', 'refund', 'reverse', 'transfer_out', 'transfer_in']);

// Quote settlement terms each outcome must name before acceptance. `reduced`
// may be null, meaning the quote offers no reduced settlement.
export const SETTLEMENT_TERM_KEYS = Object.freeze([
  'full', 'reduced', 'partialDelivery', 'cancellationQueued', 'cancellationDispatched',
  'timeout', 'providerFailure', 'failedQuality'
]);

const RETRYABLE_CODES = new Set(['attempt_not_bound', 'attempt_active', 'storage_conflict']);

export class LedgerError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export const fail = (code, message, details) => {
  throw new LedgerError(code, message, details);
};

export const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
};

export const sha256Hex = (value) => createHash('sha256').update(String(value)).digest('hex');
export const hashCanonical = (value) => `sha256:${sha256Hex(canonicalJson(value))}`;
export const cloneJson = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

// Doc-id safe: no slash, never `.`/`..`/`__x__`, bounded length.
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@+-]{0,159}$/;

export const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
export const isAmount = (value) => Number.isSafeInteger(value) && value >= 0;
export const toMs = (value) => (typeof value === 'string' ? Date.parse(value) : Number.NaN);
export const isIsoTime = (value) => Number.isFinite(toMs(value));

export const assertId = (value, field, maxLength = 160) => {
  if (typeof value !== 'string' || !ID_PATTERN.test(value) || value.length > maxLength) {
    fail('invalid_input', `${field} must be an identifier of at most ${maxLength} characters matching ${ID_PATTERN}`, { field });
  }
  return value;
};

// Derived reservation, settlement and review ids add at most 8 characters.
export const MAX_QUOTE_ID_LENGTH = 150;

export const assertIdempotencyKey = (value) => {
  if (!isNonEmptyString(value) || value.length > 256) {
    fail('idempotency_key_required', 'every ledger mutation requires an idempotency key of at most 256 characters');
  }
  return value;
};

const assertExactKeys = (value, allowed, label, errors) => {
  for (const key of Object.keys(value || {})) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not a recognized field`);
  }
};

/**
 * Validate explicit accounting policy. There is no default policy: units,
 * precision, rounding and lot consumption order are product decisions.
 */
export function validateAccountingPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') fail('invalid_policy', 'accounting policy is required', { errors: ['policy missing'] });
  assertExactKeys(policy, ['accountingVersion', 'contract', 'unit', 'rounding', 'lotConsumptionOrder', 'transfers'], 'policy', errors);
  if (!isNonEmptyString(policy.accountingVersion)) errors.push('policy.accountingVersion is required');
  if (policy.contract?.id !== PRODUCT_ECONOMICS_CONTRACT_ID) {
    errors.push(`policy.contract.id must be ${PRODUCT_ECONOMICS_CONTRACT_ID}`);
  }
  if (!isNonEmptyString(policy.contract?.documentRevision)) errors.push('policy.contract.documentRevision is required');
  if (!isNonEmptyString(policy.unit?.name)) errors.push('policy.unit.name is required');
  if (!Number.isSafeInteger(policy.unit?.minorUnitsPerCredit) || policy.unit.minorUnitsPerCredit <= 0) {
    errors.push('policy.unit.minorUnitsPerCredit must be a positive integer');
  }
  if (!ROUNDING_MODES.includes(policy.rounding)) errors.push(`policy.rounding must be one of ${ROUNDING_MODES.join(', ')}`);
  const order = policy.lotConsumptionOrder;
  if (!Array.isArray(order) || order.length !== PROVENANCE_KINDS.length
    || PROVENANCE_KINDS.some((kind) => !order.includes(kind))) {
    errors.push(`policy.lotConsumptionOrder must order every provenance kind: ${PROVENANCE_KINDS.join(', ')}`);
  }
  if (policy.transfers?.enabled !== false) {
    errors.push('policy.transfers.enabled must be false; transfer activation is not approved');
  }
  if (errors.length) fail('invalid_policy', 'accounting policy is incomplete or not permitted', { errors });
  return deepFreeze(cloneJson({
    accountingVersion: policy.accountingVersion,
    contract: { id: policy.contract.id, documentRevision: policy.contract.documentRevision },
    unit: { name: policy.unit.name, minorUnitsPerCredit: policy.unit.minorUnitsPerCredit },
    rounding: policy.rounding,
    lotConsumptionOrder: [...order],
    transfers: { enabled: false }
  }));
}

const REWARD_SOURCE_FIELDS = ['category', 'workId', 'offerId', 'validationId', 'validatorId', 'validatedAt'];
const SOURCE_FIELDS = Object.freeze({
  earned: REWARD_SOURCE_FIELDS,
  subsidized: [...REWARD_SOURCE_FIELDS, 'fundingId', 'funderKind', 'funderId'],
  purchased: ['processor', 'purchaseId', 'confirmationId'],
  donated: ['donationId', 'donorId'],
  community_access: ['fundingId', 'funderId', 'funderKind']
});

/**
 * Every lot names its issuance source. Earned and subsidized credit need an
 * explicit validated-work reference, and subsidized credit also names its
 * funding reservation; purchases keep their price apart from quantity.
 */
export function validateIssuanceSource(provenance, source) {
  if (!PROVENANCE_KINDS.includes(provenance)) {
    fail('invalid_provenance', `provenance must be one of ${PROVENANCE_KINDS.join(', ')}`, { provenance });
  }
  const errors = [];
  if (!source || typeof source !== 'object') errors.push('source reference is required');
  for (const field of SOURCE_FIELDS[provenance]) {
    if (!isNonEmptyString(source?.[field])) errors.push(`source.${field} is required`);
  }
  if (REWARD_PROVENANCE.includes(provenance)) {
    if (!REWARD_CATEGORIES.includes(source?.category)) errors.push(`source.category must be one of ${REWARD_CATEGORIES.join(', ')}`);
    if (source?.outcome !== 'accepted') errors.push('source.outcome must record an accepted validation');
    if (source?.validatedAt && !isIsoTime(source.validatedAt)) errors.push('source.validatedAt must be an ISO time');
  }
  if (provenance === 'purchased') {
    if (!isAmount(source?.price?.amountMinor) || !isNonEmptyString(source?.price?.currency)) {
      errors.push('source.price must state amountMinor and currency');
    }
  }
  if (errors.length) fail('invalid_source_reference', `${provenance} issuance requires an explicit source reference`, { errors });
  return cloneJson(source);
}

export function sourceClaimKey(provenance, source) {
  // One lot per unit of validated work, whichever basis funds it.
  if (REWARD_PROVENANCE.includes(provenance)) return `reward:${source.category}:${source.workId}`;
  if (provenance === 'purchased') return `purchased:${source.processor}:${source.purchaseId}`;
  if (provenance === 'donated') return `donated:${source.donationId}`;
  return `community_access:${source.fundingId}`;
}

export const lotIdForSource = (claimKey) => `lot_${sha256Hex(claimKey).slice(0, 32)}`;

const validateFormula = (formula, path, limits, errors) => {
  if (!formula || typeof formula !== 'object') {
    errors.push(`${path} must be a settlement formula`);
    return;
  }
  if (formula.kind === 'fixed') {
    if (!isAmount(formula.amount)) errors.push(`${path}.amount must be a non-negative integer`);
    return;
  }
  if (formula.kind !== 'metered') {
    errors.push(`${path}.kind must be fixed or metered`);
    return;
  }
  if (!isAmount(formula.base)) errors.push(`${path}.base must be a non-negative integer`);
  if (!Array.isArray(formula.rates) || formula.rates.length === 0) {
    errors.push(`${path}.rates must list at least one metered rate`);
    return;
  }
  formula.rates.forEach((rate, index) => {
    if (!limits?.[rate?.meter]) errors.push(`${path}.rates[${index}].meter must name a declared service limit`);
    if (!isAmount(rate?.numerator)) errors.push(`${path}.rates[${index}].numerator must be a non-negative integer`);
    if (!Number.isSafeInteger(rate?.denominator) || rate.denominator <= 0) {
      errors.push(`${path}.rates[${index}].denominator must be a positive integer`);
    }
  });
};

const divideRounded = (numerator, denominator, rounding) => {
  const n = BigInt(numerator);
  const d = BigInt(denominator);
  const quotient = n / d;
  const remainder = n % d;
  if (remainder === 0n || rounding === 'floor') return quotient;
  if (rounding === 'ceil') return quotient + 1n;
  return remainder * 2n >= d ? quotient + 1n : quotient;
};

/** Deterministic charge for a declared formula and metered units. */
export function evaluateFormula(formula, metering, rounding) {
  if (formula.kind === 'fixed') return formula.amount;
  let total = BigInt(formula.base);
  for (const rate of formula.rates) {
    const units = metering?.[rate.meter];
    if (!isAmount(units)) fail('metering_incomplete', `metering.${rate.meter} is required by the settlement formula`, { meter: rate.meter });
    total += divideRounded(BigInt(units) * BigInt(rate.numerator), rate.denominator, rounding);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) fail('charge_overflow', 'settlement formula exceeds safe integer range');
  return Number(total);
}

export const formulaMaximum = (formula, limits, rounding) => evaluateFormula(
  formula,
  Object.fromEntries(Object.entries(limits).map(([meter, limit]) => [meter, limit.max])),
  rounding
);

const requireString = (value, path, errors) => {
  if (!isNonEmptyString(value)) errors.push(`${path} is required`);
};

const validateService = (service, errors) => {
  if (!service || typeof service !== 'object') {
    errors.push('service is required');
    return;
  }
  requireString(service.serviceRecordId, 'service.serviceRecordId', errors);
  for (const field of ['modelId', 'checkpoint', 'deployedRepresentation', 'tokenizer']) {
    requireString(service.model?.[field], `service.model.${field}`, errors);
  }
  if (!Array.isArray(service.model?.adapters)) errors.push('service.model.adapters must list adapter identities (empty when none)');
  requireString(service.runtime?.runtimeId, 'service.runtime.runtimeId', errors);
  requireString(service.operation, 'service.operation', errors);
  for (const meter of ['context', 'output']) {
    if (!service.limits?.[meter]) errors.push(`service.limits.${meter} is required`);
  }
  for (const [meter, limit] of Object.entries(service.limits || {})) {
    if (!Number.isSafeInteger(limit?.max) || limit.max <= 0) errors.push(`service.limits.${meter}.max must be a positive integer`);
    requireString(limit?.unit, `service.limits.${meter}.unit`, errors);
    if (!EXCEEDANCE_BEHAVIORS.includes(limit?.exceedance)) {
      errors.push(`service.limits.${meter}.exceedance must be one of ${EXCEEDANCE_BEHAVIORS.join(', ')} (no silent truncation)`);
    }
  }
  requireString(service.qualityPolicyVersion, 'service.qualityPolicyVersion', errors);
  requireString(service.recipientScope?.policyId, 'service.recipientScope.policyId', errors);
  requireString(service.disclosureScope?.scopeId, 'service.disclosureScope.scopeId', errors);
  requireString(service.queueClass, 'service.queueClass', errors);
  if (!isIsoTime(service.deadline)) errors.push('service.deadline must be an absolute ISO time');
};

const validateTerms = (terms, service, maxCharge, rounding, errors) => {
  if (!terms || typeof terms !== 'object') {
    errors.push('terms are required');
    return;
  }
  if (!isIsoTime(terms.validUntil)) errors.push('terms.validUntil must be an absolute ISO time');
  if (!Number.isSafeInteger(terms.reservationPeriodMs) || terms.reservationPeriodMs <= 0) {
    errors.push('terms.reservationPeriodMs must be a positive integer');
  }
  requireString(terms.queue?.behavior, 'terms.queue.behavior', errors);
  if (!isAmount(terms.queue?.maxWaitMs)) errors.push('terms.queue.maxWaitMs must be a non-negative integer');
  if (!Number.isSafeInteger(terms.execution?.maxAttempts) || terms.execution.maxAttempts <= 0) {
    errors.push('terms.execution.maxAttempts must be a positive integer');
  }
  if (!Number.isSafeInteger(terms.execution?.maxDurationMs) || terms.execution.maxDurationMs <= 0) {
    errors.push('terms.execution.maxDurationMs must be a positive integer');
  }
  requireString(terms.refund?.policyId, 'terms.refund.policyId', errors);
  requireString(terms.qualityReview?.procedureId, 'terms.qualityReview.procedureId', errors);
  const settlement = terms.settlement || {};
  assertExactKeys(settlement, SETTLEMENT_TERM_KEYS, 'terms.settlement', errors);
  const limitsValid = Boolean(service?.limits) && Object.values(service.limits)
    .every((limit) => Number.isSafeInteger(limit?.max) && limit.max > 0);
  for (const key of SETTLEMENT_TERM_KEYS) {
    if (key === 'reduced' && settlement.reduced === null) continue;
    const before = errors.length;
    validateFormula(settlement[key], `terms.settlement.${key}`, service?.limits, errors);
    if (errors.length === before && isAmount(maxCharge) && limitsValid) {
      const worst = formulaMaximum(settlement[key], service.limits, rounding);
      if (worst > maxCharge) errors.push(`terms.settlement.${key} can charge ${worst}, above maxCharge ${maxCharge}`);
    }
  }
};

const QUOTE_INPUT_KEYS = ['quoteId', 'accountId', 'service', 'pricing', 'terms', 'idempotencyKey'];

/**
 * Build an immutable quote. The ledger binds contract, accounting version,
 * unit and rounding from the active policy; pricing arrives from the caller.
 */
export function buildQuote(input, { policy, now }) {
  const errors = [];
  assertExactKeys(input, QUOTE_INPUT_KEYS, 'quote', errors);
  const { quoteId, accountId, service, pricing, terms } = input;
  requireString(pricing?.basis?.kind, 'pricing.basis.kind', errors);
  if (!isAmount(pricing?.maxCharge)) errors.push('pricing.maxCharge must be a non-negative integer');
  validateService(service, errors);
  validateTerms(terms, service, pricing?.maxCharge, policy.rounding, errors);
  const nowMs = toMs(now);
  if (isIsoTime(terms?.validUntil) && toMs(terms.validUntil) <= nowMs) errors.push('terms.validUntil must be in the future');
  if (isIsoTime(service?.deadline) && isIsoTime(terms?.validUntil) && toMs(service.deadline) <= toMs(terms.validUntil)) {
    errors.push('service.deadline must follow terms.validUntil');
  }
  if (errors.length) fail('invalid_quote', 'quote terms are incomplete or inconsistent', { errors });
  const bound = cloneJson({
    schema: QUOTE_SCHEMA,
    quoteId,
    accountId,
    contract: policy.contract,
    accountingVersion: policy.accountingVersion,
    unit: policy.unit,
    rounding: policy.rounding,
    service,
    pricing,
    terms,
    createdAt: now
  });
  return { ...bound, quoteHash: hashCanonical(bound) };
}

export default {
  PRODUCT_ECONOMICS_CONTRACT_ID,
  LedgerError,
  validateAccountingPolicy,
  validateIssuanceSource,
  buildQuote,
  evaluateFormula
};
