/**
 * @fileoverview Contribution reward rules: categories, explicit reward and
 * issuance policy, contribution offer terms and reward formulas.
 *
 * Nothing here supplies a reward amount, rate, share, limit or enabled
 * category. Amounts come only from an accepted offer's formula over settled
 * ledger meters; limits come only from the explicit issuance policy.
 */

import {
  PROVENANCE_KINDS,
  REWARD_CATEGORIES as LEDGER_REWARD_CATEGORIES,
  cloneJson,
  evaluateFormula,
  hashCanonical,
  isAmount,
  isIsoTime,
  isNonEmptyString,
  toMs
} from '../ledger/domain.js';

export const OFFER_SCHEMA = 'reploid.contribution-offer/v1';
export const VALIDATION_SCHEMA = 'reploid.reward-validation/v1';
export const ISSUANCE_STATE_SCHEMA = 'reploid.reward-issuance-state/v1';
export const ISSUANCE_DECISION_SCHEMA = 'reploid.reward-issuance-decision/v1';
export const CAPACITY_EVIDENCE_SCHEMA = 'reploid.admitted-capacity-evidence/v1';

/**
 * Reward category -> ledger lot category and validator. A category can be
 * enabled only when a validator here qualifies it AND the explicit reward
 * policy lists it. Delivery, contracted storage and prepared availability
 * (contracted readiness) have no validator, so they stay disabled.
 */
export const REWARD_CATEGORIES = Object.freeze({
  demanded_inference: Object.freeze({ ledgerCategory: 'computation', qualified: true }),
  verified_delivery: Object.freeze({ ledgerCategory: 'delivery', qualified: false }),
  contracted_storage: Object.freeze({ ledgerCategory: 'storage', qualified: false }),
  prepared_availability: Object.freeze({ ledgerCategory: 'readiness', qualified: false })
});
for (const { ledgerCategory } of Object.values(REWARD_CATEGORIES)) {
  if (!LEDGER_REWARD_CATEGORIES.includes(ledgerCategory)) throw new Error(`ledger has no ${ledgerCategory} reward category`);
}

// Presence is never work: these names fail with their own error.
const PRESENCE_CATEGORIES = new Set(['online_time', 'presence', 'uptime', 'availability_heartbeat']);

// Settled ledger meters a demanded-inference reward formula may read. None measures time online.
export const CATEGORY_METERS = Object.freeze({
  demanded_inference: Object.freeze(['settledCharge', 'context', 'output'])
});

const RETRYABLE_CODES = new Set(['storage_conflict']);

export class RewardError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'RewardError';
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export const fail = (code, message, details) => {
  throw new RewardError(code, message, details);
};

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

const unknownKeys = (value, allowed, label, errors) => {
  for (const key of Object.keys(value || {})) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not a recognized field`);
  }
};

const requireString = (value, path, errors) => {
  if (!isNonEmptyString(value)) errors.push(`${path} is required`);
};

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;

const distinctStrings = (value) => Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;

/** Fail with the category's own error unless a validator qualifies it and the policy enables it. */
export function assertRewardCategory(category, rewardPolicy) {
  if (PRESENCE_CATEGORIES.has(category)) {
    fail('presence_earns_nothing', 'online time and presence earn nothing; only validated useful work can earn', { category });
  }
  const entry = REWARD_CATEGORIES[category];
  if (!entry) fail('invalid_category', `reward category must be one of ${Object.keys(REWARD_CATEGORIES).join(', ')}`, { category });
  if (!entry.qualified) {
    fail('reward_category_disabled',
      `${category} rewards are disabled pending the user's reward eligibility decision; no validator qualifies this category`,
      { category });
  }
  if (rewardPolicy && !rewardPolicy.enabledCategories.includes(category)) {
    fail('reward_category_disabled', `${category} rewards are not enabled by the active reward policy`, { category });
  }
  return entry;
}

/**
 * Explicit reward policy. There is no default: the enabled categories, the
 * validator identity and the account-link kinds that disqualify demand are
 * product decisions. Same-account, same-owner and same-participant demand is
 * always rejected regardless of configuration.
 */
export function validateRewardPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') fail('invalid_policy', 'reward policy is required', { errors: ['policy missing'] });
  unknownKeys(policy, ['rewardPolicyVersion', 'validatorId', 'enabledCategories', 'collusion'], 'policy', errors);
  requireString(policy.rewardPolicyVersion, 'policy.rewardPolicyVersion', errors);
  requireString(policy.validatorId, 'policy.validatorId', errors);
  if (!distinctStrings(policy.enabledCategories)) {
    errors.push('policy.enabledCategories must list distinct reward categories (empty enables none)');
  } else {
    for (const category of policy.enabledCategories) assertRewardCategory(category, null);
  }
  unknownKeys(policy.collusion, ['rejectLinkKinds'], 'policy.collusion', errors);
  if (!distinctStrings(policy.collusion?.rejectLinkKinds)) {
    errors.push('policy.collusion.rejectLinkKinds must list distinct account-link kinds (empty rejects only same account, owner and participant)');
  }
  if (errors.length) fail('invalid_policy', 'reward policy is incomplete or not permitted', { errors });
  return deepFreeze(cloneJson({
    rewardPolicyVersion: policy.rewardPolicyVersion,
    validatorId: policy.validatorId,
    enabledCategories: [...policy.enabledCategories],
    collusion: { rejectLinkKinds: [...policy.collusion.rejectLinkKinds] }
  }));
}

const validateRatio = (ratio, path, errors) => {
  unknownKeys(ratio, ['numerator', 'denominator'], path, errors);
  if (!isAmount(ratio?.numerator)) errors.push(`${path}.numerator must be a non-negative integer`);
  if (!isPositiveInteger(ratio?.denominator)) errors.push(`${path}.denominator must be a positive integer`);
};

/**
 * Explicit earned-issuance limits. Cumulative authorized earned credit stays
 * within `demand.share` of measured net settled spending by the listed
 * provenance; outstanding obligations after issuance stay within
 * `capacity.coverage` of fresh admitted-capacity evidence.
 */
export function validateIssuancePolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') fail('invalid_policy', 'issuance policy is required', { errors: ['policy missing'] });
  unknownKeys(policy, ['policyId', 'accountingVersion', 'demand', 'capacity'], 'policy', errors);
  requireString(policy.policyId, 'policy.policyId', errors);
  requireString(policy.accountingVersion, 'policy.accountingVersion', errors);
  unknownKeys(policy.demand, ['provenance', 'share'], 'policy.demand', errors);
  const provenance = policy.demand?.provenance;
  if (!distinctStrings(provenance) || provenance.length === 0 || provenance.some((kind) => !PROVENANCE_KINDS.includes(kind))) {
    errors.push(`policy.demand.provenance must list distinct spending provenance from ${PROVENANCE_KINDS.join(', ')}`);
  }
  validateRatio(policy.demand?.share, 'policy.demand.share', errors);
  unknownKeys(policy.capacity, ['coverage', 'evidenceMaxAgeMs'], 'policy.capacity', errors);
  validateRatio(policy.capacity?.coverage, 'policy.capacity.coverage', errors);
  if (!isPositiveInteger(policy.capacity?.evidenceMaxAgeMs)) errors.push('policy.capacity.evidenceMaxAgeMs must be a positive integer');
  if (errors.length) fail('invalid_policy', 'issuance policy is incomplete', { errors });
  return deepFreeze(cloneJson(policy));
}

const validateFormula = (formula, meters, path, errors) => {
  if (formula?.kind === 'fixed') {
    unknownKeys(formula, ['kind', 'amount'], path, errors);
    if (!isAmount(formula.amount)) errors.push(`${path}.amount must be a non-negative integer`);
    return;
  }
  if (formula?.kind !== 'metered') {
    errors.push(`${path}.kind must be fixed or metered`);
    return;
  }
  unknownKeys(formula, ['kind', 'base', 'rates'], path, errors);
  if (!isAmount(formula.base)) errors.push(`${path}.base must be a non-negative integer`);
  if (!Array.isArray(formula.rates) || formula.rates.length === 0) {
    errors.push(`${path}.rates must list at least one metered rate`);
    return;
  }
  formula.rates.forEach((rate, index) => {
    if (!meters.includes(rate?.meter)) errors.push(`${path}.rates[${index}].meter must be one of ${meters.join(', ')}`);
    if (!isAmount(rate?.numerator)) errors.push(`${path}.rates[${index}].numerator must be a non-negative integer`);
    if (!isPositiveInteger(rate?.denominator)) errors.push(`${path}.rates[${index}].denominator must be a positive integer`);
  });
};

const validateWork = (work, errors) => {
  unknownKeys(work, ['category', 'participantId', 'model'], 'work', errors);
  requireString(work?.participantId, 'work.participantId', errors);
  unknownKeys(work?.model, ['modelId', 'modelIdentity', 'planId'], 'work.model', errors);
  for (const field of ['modelId', 'modelIdentity', 'planId']) requireString(work?.model?.[field], `work.model.${field}`, errors);
};

const validateBounds = (bounds, errors) => {
  unknownKeys(bounds, ['context', 'output'], 'resourceBounds', errors);
  for (const meter of ['context', 'output']) {
    unknownKeys(bounds?.[meter], ['max', 'unit'], `resourceBounds.${meter}`, errors);
    if (!isPositiveInteger(bounds?.[meter]?.max)) errors.push(`resourceBounds.${meter}.max must be a positive integer`);
    requireString(bounds?.[meter]?.unit, `resourceBounds.${meter}.unit`, errors);
  }
};

export const OFFER_INPUT_KEYS = Object.freeze([
  'offerId', 'accountId', 'work', 'reward', 'resourceBounds', 'duration', 'paymentTiming', 'failureCompensation', 'validUntil'
]);

/**
 * Build an immutable contribution offer. The store binds contract, accounting
 * version, unit and rounding from the ledger policy and the validator's
 * disclosed conditions from the reward policy; reward terms come from the caller.
 */
export function buildOffer(input, { ledgerPolicy, rewardPolicy, conditions, now }) {
  const errors = [];
  unknownKeys(input, OFFER_INPUT_KEYS, 'offer', errors);
  const { offerId, accountId, work, reward, resourceBounds, duration, paymentTiming, failureCompensation, validUntil } = input;
  const category = work?.category;
  const entry = assertRewardCategory(category, rewardPolicy);
  if (failureCompensation?.kind !== 'none' || Object.keys(failureCompensation).length !== 1) {
    fail('failure_compensation_unsupported',
      'failureCompensation must be { kind: "none" }; compensating failed attempts awaits a product decision and an adjudication owner');
  }
  validateWork(work, errors);
  unknownKeys(reward, ['basis', 'formula', 'maxReward'], 'reward', errors);
  requireString(reward?.basis?.kind, 'reward.basis.kind', errors);
  validateFormula(reward?.formula, CATEGORY_METERS[category], 'reward.formula', errors);
  if (!isPositiveInteger(reward?.maxReward)) errors.push('reward.maxReward must be a positive integer');
  validateBounds(resourceBounds, errors);
  unknownKeys(duration, ['startsAt', 'endsAt'], 'duration', errors);
  if (!isIsoTime(duration?.startsAt) || !isIsoTime(duration?.endsAt) || toMs(duration.endsAt) <= toMs(duration.startsAt)) {
    errors.push('duration must state ISO startsAt before endsAt');
  } else if (toMs(duration.endsAt) <= toMs(now)) {
    errors.push('duration.endsAt must be in the future');
  }
  if (!isIsoTime(validUntil) || toMs(validUntil) <= toMs(now)) errors.push('validUntil must be a future ISO time');
  else if (isIsoTime(duration?.endsAt) && toMs(validUntil) > toMs(duration.endsAt)) errors.push('validUntil must not follow duration.endsAt');
  unknownKeys(paymentTiming, ['trigger', 'claimWindowMs'], 'paymentTiming', errors);
  if (paymentTiming?.trigger !== 'on_validation') errors.push('paymentTiming.trigger must be on_validation');
  if (!isPositiveInteger(paymentTiming?.claimWindowMs)) errors.push('paymentTiming.claimWindowMs must be a positive integer');
  if (errors.length) fail('invalid_offer', 'offer terms are incomplete or inconsistent', { errors });
  const bound = cloneJson({
    schema: OFFER_SCHEMA,
    offerId,
    accountId,
    category,
    ledgerCategory: entry.ledgerCategory,
    contract: ledgerPolicy.contract,
    accountingVersion: ledgerPolicy.accountingVersion,
    unit: ledgerPolicy.unit,
    rounding: ledgerPolicy.rounding,
    rewardPolicyVersion: rewardPolicy.rewardPolicyVersion,
    work,
    reward,
    resourceBounds,
    duration,
    paymentTiming,
    failureCompensation,
    validUntil,
    validation: {
      validatorId: rewardPolicy.validatorId,
      category,
      conditions: [...conditions],
      collusion: { alwaysRejected: ['same_account', 'same_owner', 'same_participant'], rejectLinkKinds: rewardPolicy.collusion.rejectLinkKinds }
    },
    createdAt: now
  });
  return { ...bound, offerHash: hashCanonical(bound) };
}

/** Reward from the accepted formula over settled meters, capped at the offer's maximum. */
export function computeReward(offer, meters) {
  const uncapped = evaluateFormula(offer.reward.formula, meters, offer.rounding);
  const amount = Math.min(uncapped, offer.reward.maxReward);
  return { meters: cloneJson(meters), uncapped, amount, maxReward: offer.reward.maxReward, capped: uncapped > amount };
}

const scaleFloor = (value, { numerator, denominator }) => {
  const scaled = (BigInt(value) * BigInt(numerator)) / BigInt(denominator);
  return scaled > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(scaled);
};

const capacityEvidenceProblem = (capacity, policy, now) => {
  if (capacity?.schema !== CAPACITY_EVIDENCE_SCHEMA || !isNonEmptyString(capacity.evidenceId)
    || !isAmount(capacity.serviceCredits) || !isIsoTime(capacity.observedAt) || toMs(capacity.observedAt) > toMs(now)) {
    return 'capacity_evidence_unavailable';
  }
  if (capacity.accountingVersion !== policy.accountingVersion) return 'capacity_evidence_unavailable';
  if (toMs(now) - toMs(capacity.observedAt) > policy.capacity.evidenceMaxAgeMs) return 'capacity_evidence_stale';
  return null;
};

/**
 * Pure earned-issuance decision. `authorizedTotal` is every earned amount this
 * authority has already allowed, issued or still pending in the ledger.
 * Issuing credit creates no capacity, so both limits must hold.
 */
export function evaluateIssuanceLimits({ policy, snapshot, capacity, authorizedTotal, amount, now }) {
  const decline = (reason, figures = {}) => ({ allowed: false, reason, figures });
  if (snapshot?.accountingVersion !== policy.accountingVersion) return decline('accounting_version_mismatch');
  const earnedIssued = snapshot.issued.byProvenance.earned;
  if (earnedIssued > authorizedTotal) {
    return decline('unaccounted_earned_issuance', { earnedIssued, authorizedTotal });
  }
  const measuredDemand = policy.demand.provenance
    .reduce((sum, kind) => sum + snapshot.spent.byProvenance[kind] - snapshot.refunded.byProvenance[kind], 0);
  const figures = {
    snapshotAt: snapshot.generatedAt,
    measuredDemand,
    demandLimit: scaleFloor(measuredDemand, policy.demand.share),
    authorizedBefore: authorizedTotal,
    authorizedAfter: authorizedTotal + amount,
    earnedIssued
  };
  if (figures.authorizedAfter > figures.demandLimit) return decline('demand_limit', figures);
  const evidence = capacityEvidenceProblem(capacity, policy, now);
  if (evidence) return decline(evidence, figures);
  figures.capacityEvidenceId = capacity.evidenceId;
  figures.admittedServiceCredits = capacity.serviceCredits;
  figures.capacityLimit = scaleFloor(capacity.serviceCredits, policy.capacity.coverage);
  // Outstanding balances plus earned credit allowed but not yet visible in the ledger.
  figures.obligationsAfter = snapshot.outstanding.total + (authorizedTotal - earnedIssued) + amount;
  if (figures.obligationsAfter > figures.capacityLimit) return decline('capacity_limit', figures);
  return { allowed: true, reason: null, figures };
}

export default {
  REWARD_CATEGORIES,
  RewardError,
  assertRewardCategory,
  validateRewardPolicy,
  validateIssuancePolicy,
  buildOffer,
  computeReward,
  evaluateIssuanceLimits
};
