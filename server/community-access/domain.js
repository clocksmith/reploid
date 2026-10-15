/**
 * @fileoverview Pure Community Access rules: policy and its guarantee switch,
 * usage and rate windows, fair queue order, lanes and availability views.
 *
 * Every limit arrives as explicit policy. Nothing here performs I/O or
 * supplies a default limit, funding amount or guarantee.
 */

import { FUNDER_KINDS, assertId, isNonEmptyString, toMs } from '../ledger/domain.js';

export const FUNDING_SCHEMA = 'reploid.community-access-funding/v2';
export const FUNDING_USE = 'community_access_pool';
export const ENTRY_SCHEMA = 'reploid.community-access-request/v1';
export const CAPACITY_EVIDENCE_SCHEMA = 'reploid.community-capacity-evidence/v1';
export const SUBSIDY_REPORT_SCHEMA = 'reploid.community-access-subsidy/v1';

// Funder kinds, from the ledger's one vocabulary, whose commitments may fund Community Access pools.
export const POOL_FUNDER_KINDS = Object.freeze(['donor', 'operator']);
for (const kind of POOL_FUNDER_KINDS) {
  if (!FUNDER_KINDS.includes(kind)) throw new Error(`ledger has no ${kind} funder kind`);
}
// `none` is the proposed default: queue or explicit retry, no guaranteed minimum or completion.
export const GUARANTEE_MODES = Object.freeze(['none', 'funded_floor']);
export const FLOOR_SHORTFALL_BEHAVIORS = Object.freeze(['queue', 'unavailable']);
export const ENTRY_STATES = Object.freeze(['waiting', 'admitting', 'admitted', 'completed', 'unavailable']);
export const LANES = Object.freeze(['floor', 'general']);
export const POOL_OWNER_ID = 'community_access_pool';
export const OCCUPANCY_ID = 'current';

const RETRYABLE_CODES = new Set(['storage_conflict']);

export class CommunityAccessError extends Error {
  constructor(code, message = code, details = {}) {
    super(message);
    this.name = 'CommunityAccessError';
    this.code = code;
    this.details = details;
    this.retryable = RETRYABLE_CODES.has(code);
  }
}

export const fail = (code, message, details) => {
  throw new CommunityAccessError(code, message, details);
};

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

const unknownKeys = (value, allowed, label, errors) => {
  for (const key of Object.keys(value || {})) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not a recognized field`);
  }
};

const validId = (value) => {
  try {
    assertId(value, 'id');
    return true;
  } catch {
    return false;
  }
};

const requirePositive = (value, path, errors) => {
  if (!isPositiveInteger(value)) errors.push(`${path} must be a positive integer`);
};

/**
 * Validate explicit Community Access policy. `guarantee.mode` is required:
 * `none` queues or asks for explicit retry and never promises completion;
 * `funded_floor` must declare its allocation (a dedicated funding pool and
 * committed funding ids), admission limits, reserved slots, reliability
 * coverage evidence and shortfall behavior.
 */
export function validateCommunityAccessPolicy(policy) {
  const errors = [];
  if (!policy || typeof policy !== 'object') fail('invalid_policy', 'Community Access policy is required', { errors: ['policy missing'] });
  unknownKeys(policy, ['policyVersion', 'poolAccountId', 'guarantee', 'queue', 'usage', 'rateLimits', 'capacity'], 'policy', errors);
  if (!isNonEmptyString(policy.policyVersion)) errors.push('policy.policyVersion is required');
  if (!validId(policy.poolAccountId)) errors.push('policy.poolAccountId must name the general funding pool account');

  const guarantee = policy.guarantee;
  if (!GUARANTEE_MODES.includes(guarantee?.mode)) errors.push(`policy.guarantee.mode must be one of ${GUARANTEE_MODES.join(', ')}`);
  if (guarantee?.mode === 'none') unknownKeys(guarantee, ['mode'], 'policy.guarantee', errors);
  if (guarantee?.mode === 'funded_floor') {
    unknownKeys(guarantee, ['mode', 'floor'], 'policy.guarantee', errors);
    const floor = guarantee.floor;
    unknownKeys(floor, ['poolAccountId', 'fundingIds', 'admissionsPerAccount', 'reservedSlots', 'reliabilityCoverage', 'shortfall'], 'policy.guarantee.floor', errors);
    if (!validId(floor?.poolAccountId) || floor.poolAccountId === policy.poolAccountId) {
      errors.push('policy.guarantee.floor.poolAccountId must name a dedicated floor funding pool');
    }
    if (!Array.isArray(floor?.fundingIds) || floor.fundingIds.length === 0 || !floor.fundingIds.every(validId)) {
      errors.push('policy.guarantee.floor.fundingIds must list the committed funding records');
    }
    requirePositive(floor?.admissionsPerAccount, 'policy.guarantee.floor.admissionsPerAccount', errors);
    requirePositive(floor?.reservedSlots, 'policy.guarantee.floor.reservedSlots', errors);
    if (!isNonEmptyString(floor?.reliabilityCoverage?.evidenceRef)) {
      errors.push('policy.guarantee.floor.reliabilityCoverage.evidenceRef must name replacement-coverage evidence');
    }
    if (!FLOOR_SHORTFALL_BEHAVIORS.includes(floor?.shortfall)) {
      errors.push(`policy.guarantee.floor.shortfall must be one of ${FLOOR_SHORTFALL_BEHAVIORS.join(', ')}`);
    }
  }

  unknownKeys(policy.queue, ['maxLength', 'maxPerAccount', 'maxWaitMs'], 'policy.queue', errors);
  requirePositive(policy.queue?.maxLength, 'policy.queue.maxLength', errors);
  requirePositive(policy.queue?.maxPerAccount, 'policy.queue.maxPerAccount', errors);
  requirePositive(policy.queue?.maxWaitMs, 'policy.queue.maxWaitMs', errors);
  unknownKeys(policy.usage, ['windowMs', 'maxAdmissions', 'maxAuthorizedCredits'], 'policy.usage', errors);
  requirePositive(policy.usage?.windowMs, 'policy.usage.windowMs', errors);
  requirePositive(policy.usage?.maxAdmissions, 'policy.usage.maxAdmissions', errors);
  requirePositive(policy.usage?.maxAuthorizedCredits, 'policy.usage.maxAuthorizedCredits', errors);
  unknownKeys(policy.rateLimits, ['account', 'device'], 'policy.rateLimits', errors);
  for (const scope of ['account', 'device']) {
    unknownKeys(policy.rateLimits?.[scope], ['windowMs', 'maxRequests'], `policy.rateLimits.${scope}`, errors);
    requirePositive(policy.rateLimits?.[scope]?.windowMs, `policy.rateLimits.${scope}.windowMs`, errors);
    requirePositive(policy.rateLimits?.[scope]?.maxRequests, `policy.rateLimits.${scope}.maxRequests`, errors);
  }
  unknownKeys(policy.capacity, ['evidenceMaxAgeMs'], 'policy.capacity', errors);
  requirePositive(policy.capacity?.evidenceMaxAgeMs, 'policy.capacity.evidenceMaxAgeMs', errors);
  if (errors.length) fail('invalid_policy', 'Community Access policy is incomplete or inconsistent', { errors });
  return Object.freeze(JSON.parse(JSON.stringify(policy)));
}

export const isFloorMode = (policy) => policy.guarantee.mode === 'funded_floor';
export const poolAccountIds = (policy) => (isFloorMode(policy)
  ? [policy.poolAccountId, policy.guarantee.floor.poolAccountId]
  : [policy.poolAccountId]);
export const laneForPool = (policy, poolAccountId) => (isFloorMode(policy) && poolAccountId === policy.guarantee.floor.poolAccountId ? 'floor' : 'general');
export const poolForLane = (policy, lane) => (lane === 'floor' ? policy.guarantee.floor.poolAccountId : policy.poolAccountId);

export const windowStart = (nowMs, windowMs) => Math.floor(nowMs / windowMs) * windowMs;
const iso = (ms) => new Date(ms).toISOString();

/** Usage in the current fixed window; queued counts are not windowed. */
export function rollUsage(usage, accountId, policy, now) {
  const start = iso(windowStart(toMs(now), policy.usage.windowMs));
  const base = usage ?? { accountId, waiting: 0 };
  if (base.windowStart === start) return { ...base };
  return { ...base, windowStart: start, admissions: 0, floorAdmissions: 0, authorizedCredits: 0 };
}

export function rollCounter(counter, { scope, subject }, limit, now) {
  const start = iso(windowStart(toMs(now), limit.windowMs));
  if (counter?.windowStart === start) return { ...counter };
  return { scope, subject, windowStart: start, count: 0 };
}

export const windowEnd = (record, windowMs) => iso(toMs(record.windowStart) + windowMs);

export function rateLimitProblem({ accountCounter, deviceCounter }, policy) {
  for (const [scope, counter] of [['account', accountCounter], ['device', deviceCounter]]) {
    const limit = policy.rateLimits[scope];
    if (counter.count >= limit.maxRequests) return { reason: 'rate_limited', scope, retryAfter: windowEnd(counter, limit.windowMs) };
  }
  return null;
}

export function usageProblem(usage, maxCharge, policy) {
  if (usage.admissions >= policy.usage.maxAdmissions || usage.authorizedCredits + maxCharge > policy.usage.maxAuthorizedCredits) {
    return { reason: 'usage_limit_reached', resetsAt: windowEnd(usage, policy.usage.windowMs) };
  }
  return null;
}

export function queueProblem(usage, occupancy, policy) {
  if (usage.waiting >= policy.queue.maxPerAccount) return { reason: 'account_queue_full' };
  if (occupancy.waiting >= policy.queue.maxLength) return { reason: 'queue_full' };
  return null;
}

export const floorEligible = (policy, usage) => isFloorMode(policy)
  && (usage?.floorAdmissions ?? 0) < policy.guarantee.floor.admissionsPerAccount;

/**
 * Fair order: accounts take turns. An entry's round is its account's
 * admissions in the current usage window plus its place among that account's
 * waiting entries, so an account already served, or with a backlog, never
 * runs ahead of another account's earlier turn. Floor-eligible entries go
 * first under a funded floor. Ties break by arrival, then request id.
 */
export function fairOrder(entries, { policy, usageByAccount, now }) {
  const queued = new Map();
  const sorted = [...entries].sort((left, right) => toMs(left.enqueuedAt) - toMs(right.enqueuedAt) || left.requestId.localeCompare(right.requestId));
  const ranked = sorted.map((entry) => {
    const place = queued.get(entry.accountId) ?? 0;
    queued.set(entry.accountId, place + 1);
    const usage = rollUsage(usageByAccount.get(entry.accountId), entry.accountId, policy, now);
    const floor = floorEligible(policy, usage) && place < policy.guarantee.floor.admissionsPerAccount - usage.floorAdmissions;
    return { entry, round: usage.admissions + place, floor };
  });
  return ranked.sort((left, right) => Number(right.floor) - Number(left.floor)
    || left.round - right.round
    || toMs(left.entry.enqueuedAt) - toMs(right.entry.enqueuedAt)
    || left.entry.requestId.localeCompare(right.entry.requestId));
}

/**
 * Admitted-capacity evidence from the execution owners: how many concurrent
 * Community Access requests they admit. Missing, malformed, future or stale
 * evidence admits nothing.
 */
export function readCapacityEvidence(evidence, policy, now) {
  if (evidence?.schema !== CAPACITY_EVIDENCE_SCHEMA || !isNonEmptyString(evidence.evidenceId)
    || !isCount(evidence.admittedSlots) || !Number.isFinite(toMs(evidence.observedAt)) || toMs(evidence.observedAt) > toMs(now)) {
    return { ok: false, reason: 'capacity_evidence_unavailable' };
  }
  if (toMs(now) - toMs(evidence.observedAt) > policy.capacity.evidenceMaxAgeMs) return { ok: false, reason: 'capacity_evidence_stale' };
  if (evidence.admittedSlots === 0) return { ok: false, reason: 'no_admitted_capacity' };
  const reserved = isFloorMode(policy) ? policy.guarantee.floor.reservedSlots : 0;
  return {
    ok: true,
    evidenceId: evidence.evidenceId,
    admittedSlots: evidence.admittedSlots,
    meanOccupancyMs: isPositiveInteger(evidence.meanOccupancyMs) ? evidence.meanOccupancyMs : null,
    // A floor whose reserved slots exceed admitted capacity is in shortfall.
    floorShortfall: isFloorMode(policy) && evidence.admittedSlots < reserved,
    lanes: {
      floor: Math.min(reserved, evidence.admittedSlots),
      general: Math.max(0, evidence.admittedSlots - reserved)
    }
  };
}

/** An estimate, never a commitment: rounds of occupancy ahead of this position. */
export function estimateWaitMs(position, capacity) {
  if (!capacity?.ok || !capacity.meanOccupancyMs) return null;
  const slots = Math.max(1, capacity.lanes.floor + capacity.lanes.general);
  return Math.ceil(position / slots) * capacity.meanOccupancyMs;
}

/** The visible availability state of one request. */
export function entryView(entry, { policy, position = null, capacity = null } = {}) {
  const base = { requestId: entry.requestId, accountId: entry.accountId, guarantee: policy.guarantee.mode };
  if (entry.state === 'waiting' || entry.state === 'admitting') {
    return {
      ...base,
      state: 'queued',
      position,
      estimatedWaitMs: position === null ? null : estimateWaitMs(position, capacity),
      queuedUntil: iso(toMs(entry.enqueuedAt) + policy.queue.maxWaitMs),
      completion: 'not_guaranteed'
    };
  }
  if (entry.state === 'admitted') {
    return {
      ...base,
      state: 'available',
      guarantee: entry.lane === 'floor' ? 'funded_floor' : 'none',
      reservationId: entry.reservationId,
      quoteId: entry.quoteId,
      quoteHash: entry.quoteHash,
      authorizedMax: entry.maxCharge,
      poolAccountId: entry.poolAccountId,
      completion: 'not_guaranteed'
    };
  }
  if (entry.state === 'completed') return { ...base, state: 'completed', outcome: entry.outcome, charge: entry.charge };
  return { ...base, state: 'unavailable', reason: entry.reason, ...entry.reasonDetails, retry: 'explicit' };
}

export default {
  POOL_FUNDER_KINDS,
  GUARANTEE_MODES,
  validateCommunityAccessPolicy,
  fairOrder,
  readCapacityEvidence,
  entryView
};
