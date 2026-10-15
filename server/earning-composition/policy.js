/**
 * @fileoverview The operator's earning policy file: every price, rate, budget,
 * deadline and limit the composed earning routes use. The file lives outside
 * the repository (its path comes from REPLOID_EARNING_POLICY_FILE); this
 * module only reads and checks its envelope. Each component validates its own
 * section when it is constructed (accounts, ledger, rewards, issuance,
 * payments, Community Access, route limits), so nothing here restates their
 * rules or supplies a default.
 *
 * Sections:
 *   schema, policyVersion   policyVersion names this record; quotes and offers carry it in pricing.basis and
 *                           reward.basis, so the templates never name it themselves
 *   effectiveFrom           optional absolute ISO time with a zone: the composition refuses to start before it
 *   accounts, ledger, reversals, rewards, issuance, routes   component policies
 *   conversions   { authority: { actorId, decisionId }, records: [conversion record] }
 *   payments      { policyVersion, topUps, polling } (the processor id comes from the configured processor)
 *   funding       { authorities: [actorId] }   who may allocate registered funding
 *   services      [quote template]   what a quote offers per model, its complete-answer deadline and an
 *                                    optional first-output deadline (both relative to quote time)
 *   offers        [offer template]   what a contribution offer pays per category and model
 *   communityAccess   optional Community Access policy
 *   scheduler     optional durable schedule { scheduleVersion, leaseMs, jobs: { jobId: { intervalMs, batchLimit } } }
 *                 (server/scheduler validates it against the jobs this composition registers)
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export const EARNING_POLICY_SCHEMA = 'reploid.earning-policy/v1';

const SECTIONS = Object.freeze(['schema', 'policyVersion', 'effectiveFrom', 'accounts', 'ledger', 'reversals', 'rewards', 'issuance', 'routes',
  'conversions', 'payments', 'funding', 'services', 'offers', 'communityAccess', 'scheduler']);
// An absolute time: date, time and an explicit zone, so no reader resolves it in its own local time.
const ABSOLUTE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const REQUIRED = Object.freeze(['accounts', 'ledger', 'rewards', 'issuance', 'routes', 'conversions', 'funding', 'services', 'offers']);
const SERVICE_KEYS = Object.freeze(['request', 'service', 'deadlines', 'pricing', 'terms']);
const OFFER_KEYS = Object.freeze(['category', 'model', 'hosts', 'reward', 'resourceBounds', 'durationMs', 'validForMs', 'paymentTiming', 'failureCompensation']);
const HOSTS = Object.freeze(['browser', 'native']);

export class EarningPolicyError extends Error {
  constructor(code, message, errors = []) {
    super(errors.length ? `${message}: ${errors.join('; ')}` : message);
    this.name = 'EarningPolicyError';
    this.code = code;
    this.errors = errors;
  }
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim().length > 0;
const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const unknown = (value, allowed, label, errors) => {
  for (const key of Object.keys(isObject(value) ? value : {})) if (!allowed.includes(key)) errors.push(`${label}.${key} is not a recognized field`);
};

/** The model a quote or offer names; ids only, never terms. */
const checkModel = (model, label, errors, { planId }) => {
  if (!isObject(model) || !isText(model.modelId) || !isText(model.modelIdentity)) errors.push(`${label} must name modelId and modelIdentity`);
  if (planId && !isText(model?.planId)) errors.push(`${label}.planId is required`);
};

function checkServices(services, errors) {
  if (!Array.isArray(services) || services.length === 0) {
    errors.push('services must list at least one quote template');
    return;
  }
  const seen = new Set();
  services.forEach((entry, index) => {
    const label = `services[${index}]`;
    unknown(entry, SERVICE_KEYS, label, errors);
    const request = entry?.request;
    unknown(request, ['modelId', 'modelIdentity', 'operation'], `${label}.request`, errors);
    checkModel(request, `${label}.request`, errors, { planId: false });
    if (!isText(request?.operation)) errors.push(`${label}.request.operation is required`);
    const key = JSON.stringify([request?.modelId, request?.modelIdentity, request?.operation]);
    if (seen.has(key)) errors.push(`${label} repeats the request of an earlier template`);
    seen.add(key);
    if (!isObject(entry?.service)) errors.push(`${label}.service is required`);
    if (entry?.service && 'deadline' in entry.service) errors.push(`${label}.service.deadline comes from deadlines.completeMs at quote time`);
    if (entry?.service?.model?.modelId !== undefined && entry.service.model.modelId !== request?.modelId) {
      errors.push(`${label}.service.model.modelId must equal the request's modelId`);
    }
    unknown(entry?.deadlines, ['firstOutputMs', 'completeMs'], `${label}.deadlines`, errors);
    if (!isPositiveInteger(entry?.deadlines?.completeMs)) errors.push(`${label}.deadlines.completeMs must be a positive integer of milliseconds`);
    const firstOutputMs = entry?.deadlines?.firstOutputMs;
    if (firstOutputMs !== undefined && (!isPositiveInteger(firstOutputMs) || !(firstOutputMs < entry.deadlines.completeMs))) {
      errors.push(`${label}.deadlines.firstOutputMs must be a positive integer of milliseconds below completeMs`);
    }
    if (entry?.service && 'firstOutputDeadline' in entry.service) errors.push(`${label}.service.firstOutputDeadline comes from deadlines.firstOutputMs at quote time`);
    if (!isObject(entry?.pricing)) errors.push(`${label}.pricing is required`);
    if (isObject(entry?.pricing?.basis) && 'policyVersion' in entry.pricing.basis) errors.push(`${label}.pricing.basis.policyVersion comes from policy.policyVersion at quote time`);
    if (!isObject(entry?.terms)) errors.push(`${label}.terms is required`);
    if (entry?.terms && 'validUntil' in entry.terms) errors.push(`${label}.terms.validUntil comes from terms.validForMs at quote time`);
    if (!isPositiveInteger(entry?.terms?.validForMs)) errors.push(`${label}.terms.validForMs must be a positive integer of milliseconds`);
    if (isPositiveInteger(entry?.terms?.validForMs) && isPositiveInteger(entry?.deadlines?.completeMs)
      && entry.deadlines.completeMs <= entry.terms.validForMs) {
      errors.push(`${label}.deadlines.completeMs must exceed terms.validForMs (the deadline follows acceptance)`);
    }
  });
}

function checkOffers(offers, errors) {
  if (!Array.isArray(offers)) {
    errors.push('offers must be a list (empty offers no contribution rewards)');
    return;
  }
  const seen = new Set();
  offers.forEach((entry, index) => {
    const label = `offers[${index}]`;
    unknown(entry, OFFER_KEYS, label, errors);
    if (!isText(entry?.category)) errors.push(`${label}.category is required`);
    unknown(entry?.model, ['modelId', 'modelIdentity', 'planId'], `${label}.model`, errors);
    checkModel(entry?.model, `${label}.model`, errors, { planId: true });
    if (!Array.isArray(entry?.hosts) || entry.hosts.length === 0 || entry.hosts.some((host) => !HOSTS.includes(host))) {
      errors.push(`${label}.hosts must list browser and/or native`);
    }
    for (const field of ['reward', 'resourceBounds', 'paymentTiming', 'failureCompensation']) {
      if (!isObject(entry?.[field])) errors.push(`${label}.${field} is required`);
    }
    if (isObject(entry?.reward?.basis) && 'policyVersion' in entry.reward.basis) errors.push(`${label}.reward.basis.policyVersion comes from policy.policyVersion at offer time`);
    for (const field of ['durationMs', 'validForMs']) {
      if (!isPositiveInteger(entry?.[field])) errors.push(`${label}.${field} must be a positive integer of milliseconds`);
    }
    if (isPositiveInteger(entry?.durationMs) && isPositiveInteger(entry?.validForMs) && entry.validForMs > entry.durationMs) {
      errors.push(`${label}.validForMs must not exceed durationMs`);
    }
    const key = JSON.stringify([entry?.category, entry?.model?.modelId ?? null, entry?.model?.modelIdentity ?? null, entry?.model?.planId ?? null]);
    if (seen.has(key)) errors.push(`${label} repeats the category and model of an earlier template`);
    seen.add(key);
  });
}

/**
 * Check the policy envelope and the sections this composition reads itself
 * (conversions, funding, quote and offer templates). Returns a frozen deep copy.
 */
export function validateEarningPolicy(policy) {
  const errors = [];
  if (!isObject(policy)) throw new EarningPolicyError('policy_invalid', 'the earning policy must be a JSON object');
  unknown(policy, SECTIONS, 'policy', errors);
  if (policy.schema !== EARNING_POLICY_SCHEMA) errors.push(`policy.schema must be ${EARNING_POLICY_SCHEMA}`);
  if (!isText(policy.policyVersion)) errors.push('policy.policyVersion is required');
  if (policy.effectiveFrom !== undefined && !(typeof policy.effectiveFrom === 'string' && ABSOLUTE_TIME.test(policy.effectiveFrom)
    && Number.isFinite(Date.parse(policy.effectiveFrom)))) {
    errors.push('policy.effectiveFrom must be an absolute ISO time with a zone (Z or an offset)');
  }
  for (const section of REQUIRED) if (policy[section] === undefined) errors.push(`policy.${section} is required`);
  const conversions = policy.conversions;
  unknown(conversions, ['authority', 'records'], 'policy.conversions', errors);
  if (!isText(conversions?.authority?.actorId) || !isText(conversions?.authority?.decisionId)) {
    errors.push('policy.conversions.authority must name actorId and decisionId');
  }
  if (!Array.isArray(conversions?.records)) errors.push('policy.conversions.records must be a list');
  unknown(policy.funding, ['authorities'], 'policy.funding', errors);
  if (!Array.isArray(policy.funding?.authorities) || policy.funding.authorities.some((actor) => !isText(actor))) {
    errors.push('policy.funding.authorities must list actor ids (empty allows no funding)');
  }
  if (policy.payments !== undefined) {
    unknown(policy.payments, ['policyVersion', 'topUps', 'polling'], 'policy.payments', errors);
    if (policy.reversals === undefined) errors.push('policy.reversals is required with payments: refunds and chargebacks need a declared spent-credit treatment');
  }
  checkServices(policy.services, errors);
  checkOffers(policy.offers, errors);
  if (errors.length) throw new EarningPolicyError('policy_invalid', 'the earning policy is incomplete', errors);
  return deepFreeze(structuredClone(policy));
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** True when `file` lies inside `root` (or is it). */
export const isInside = (root, file) => {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

/**
 * Read an operator file named by an environment variable: an absolute path
 * outside the repository, parsed as JSON. The repository ships no policy or
 * credential, so a path inside it is refused.
 */
export async function readOperatorJsonFile(file, { variable, repositoryRoot }) {
  if (!isText(file) || !path.isAbsolute(file)) throw new EarningPolicyError('file_path_invalid', `${variable} must be an absolute path`);
  if (repositoryRoot && isInside(repositoryRoot, file)) {
    throw new EarningPolicyError('file_inside_repository', `${variable} must name a file outside the repository; the repository ships no policy or credential`);
  }
  let text;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    throw new EarningPolicyError('file_unreadable', `${variable} could not be read (${error.code || error.message})`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new EarningPolicyError('file_invalid_json', `${variable} is not valid JSON`);
  }
}

export async function readEarningPolicyFile(file, { repositoryRoot, variable = 'REPLOID_EARNING_POLICY_FILE' } = {}) {
  return validateEarningPolicy(await readOperatorJsonFile(file, { variable, repositoryRoot }));
}

export default { EARNING_POLICY_SCHEMA, validateEarningPolicy, readEarningPolicyFile, readOperatorJsonFile };
