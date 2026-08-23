/**
 * @fileoverview Fail-closed Change Passport policy, gate, effect, and trigger evaluation.
 */

import { CHANGE_CLASSES, hashChangePassportValue } from './contract.js';

export const CHANGE_PASSPORT_POLICY_SCHEMA = 'change.passport-policy/v1';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const cloneJson = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => String(value ?? '').trim();
const unique = (values = []) => [...new Set(values.map(text).filter(Boolean))];

const requireText = (value, label) => {
  const normalized = text(value);
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const positiveInteger = (value, label) => {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < 1) throw new Error(`${label} must be positive`);
  return normalized;
};

const normalizeRule = (rule = {}, index) => {
  const action = requireText(rule.action, `reopeningRules[${index}].action`);
  if (!['review', 'reevaluate', 'revoke', 'rollback_request'].includes(action)) {
    throw new Error(`reopeningRules[${index}].action is unsupported`);
  }
  const operator = requireText(rule.match?.operator || 'equals', `reopeningRules[${index}].match.operator`);
  if (!['equals', 'not_equals', 'contains', 'greater_than', 'less_than', 'exists'].includes(operator)) {
    throw new Error(`reopeningRules[${index}].match.operator is unsupported`);
  }
  const freshnessMilliseconds = Number(rule.freshnessMilliseconds);
  if (!Number.isFinite(freshnessMilliseconds) || freshnessMilliseconds < 0) {
    throw new Error(`reopeningRules[${index}].freshnessMilliseconds must be non-negative`);
  }
  return {
    ruleId: requireText(rule.ruleId, `reopeningRules[${index}].ruleId`),
    sourceKind: requireText(rule.sourceKind, `reopeningRules[${index}].sourceKind`),
    observationKind: requireText(rule.observationKind, `reopeningRules[${index}].observationKind`),
    targetId: requireText(rule.targetId, `reopeningRules[${index}].targetId`),
    sensorAuthorityId: requireText(rule.sensorAuthorityId, `reopeningRules[${index}].sensorAuthorityId`),
    freshnessMilliseconds,
    match: {
      field: requireText(rule.match?.field, `reopeningRules[${index}].match.field`),
      operator,
      value: rule.match?.value ?? null
    },
    action
  };
};

export function normalizeChangePassportPolicy(input = {}) {
  const changeClasses = unique(input.changeClasses);
  if (!changeClasses.length || changeClasses.some((entry) => !CHANGE_CLASSES.includes(entry))) {
    throw new Error('policy changeClasses must use supported Change Passport classes');
  }
  const requiredEvidenceKinds = unique(input.requiredEvidenceKinds);
  const requiredReviewerRoles = unique(input.requiredReviewerRoles);
  const allowedEffects = unique(input.allowedEffects);
  if (!requiredEvidenceKinds.length || !requiredReviewerRoles.length || !allowedEffects.length) {
    throw new Error('policy evidence, reviewer, and effect requirements cannot be empty');
  }
  const reopeningRules = (Array.isArray(input.reopeningRules) ? input.reopeningRules : [])
    .map(normalizeRule);
  if (new Set(reopeningRules.map((rule) => rule.ruleId)).size !== reopeningRules.length) {
    throw new Error('policy reopening rule IDs must be unique');
  }
  return {
    schema: CHANGE_PASSPORT_POLICY_SCHEMA,
    policyId: requireText(input.policyId, 'policy.policyId'),
    version: requireText(input.version, 'policy.version'),
    changeClasses,
    requiredEvidenceKinds,
    requiredEvaluationConclusion: ['pass', 'pass_or_inconclusive'].includes(input.requiredEvaluationConclusion)
      ? input.requiredEvaluationConclusion
      : 'pass',
    requiredReviewerRoles,
    minimumApprovals: positiveInteger(input.minimumApprovals, 'policy.minimumApprovals'),
    independence: {
      proposerEvaluator: input.independence?.proposerEvaluator !== false,
      proposerReviewer: input.independence?.proposerReviewer !== false,
      evaluatorReviewer: input.independence?.evaluatorReviewer !== false
    },
    allowedEffects,
    rollbackAuthorityId: requireText(input.rollbackAuthorityId, 'policy.rollbackAuthorityId'),
    reopeningRules,
    falseBlockTolerance: Number.isFinite(Number(input.falseBlockTolerance))
      ? Number(input.falseBlockTolerance)
      : 0,
    unresolvedBlocksActivation: input.unresolvedBlocksActivation !== false
  };
}

export async function buildChangePassportPolicy(input = {}, cryptoApi = globalThis.crypto) {
  const normalized = normalizeChangePassportPolicy(input);
  return Object.freeze({
    ...normalized,
    policyHash: await hashChangePassportValue(normalized, cryptoApi)
  });
}

export async function validateChangePassportPolicy(policy = {}, cryptoApi = globalThis.crypto) {
  const reasons = [];
  try {
    const { policyHash, ...input } = policy;
    const normalized = normalizeChangePassportPolicy(input);
    if (JSON.stringify(normalized) !== JSON.stringify(input)) reasons.push('policy is not canonical');
    if (await hashChangePassportValue(normalized, cryptoApi) !== policyHash) reasons.push('policyHash mismatch');
  } catch (error) {
    reasons.push(error.message);
  }
  return { valid: reasons.length === 0, reasons };
}

const unresolvedBlockingObjections = (projection) => projection.objections.filter((objection) => (
  objection.severity === 'blocking' && !objection.resolution
));

export function evaluateChangePassportGate(projection = {}) {
  const reasons = [];
  const policy = projection.policy || {};
  if (projection.integrity?.valid !== true) reasons.push('passport integrity is invalid');
  if (!policy.changeClasses?.includes(projection.changeClass)) reasons.push('change class is not allowed');
  if (projection.evidence?.state !== 'frozen') reasons.push('evidence is not frozen');
  const evidenceKinds = new Set((projection.evidence?.admitted || []).map((entry) => entry.kind));
  for (const requiredKind of policy.requiredEvidenceKinds || []) {
    if (!evidenceKinds.has(requiredKind)) reasons.push(`required evidence missing: ${requiredKind}`);
  }
  const evaluations = projection.evaluations || [];
  const acceptableEvaluations = evaluations.filter((entry) => (
    policy.requiredEvaluationConclusion === 'pass_or_inconclusive'
      ? ['pass', 'inconclusive'].includes(entry.conclusion)
      : entry.conclusion === 'pass'
  ));
  if (!acceptableEvaluations.length) reasons.push('required evaluation conclusion is missing');
  const reviews = (projection.reviews || []).filter((entry) => entry.verdict === 'approve');
  const requiredRoles = new Set(policy.requiredReviewerRoles || []);
  const approvingRoles = new Set(reviews.map((entry) => entry.actor?.role));
  for (const role of requiredRoles) {
    if (!approvingRoles.has(role)) reasons.push(`required reviewer role missing: ${role}`);
  }
  if (reviews.length < Number(policy.minimumApprovals || 1)) reasons.push('minimum approvals not met');
  const proposerId = projection.proposal?.proposerAuthorityId;
  const evaluatorId = projection.evaluator?.authorityId;
  if (policy.independence?.proposerEvaluator && proposerId === evaluatorId) {
    reasons.push('proposer and evaluator are not independent');
  }
  if (policy.independence?.proposerReviewer
    && reviews.some((entry) => entry.actor?.authorityId === proposerId)) {
    reasons.push('proposer and reviewer are not independent');
  }
  if (policy.independence?.evaluatorReviewer
    && reviews.some((entry) => entry.actor?.authorityId === evaluatorId)) {
    reasons.push('evaluator and reviewer are not independent');
  }
  const objections = unresolvedBlockingObjections(projection);
  if (objections.length) reasons.push(`${objections.length} blocking objection(s) unresolved`);
  if (projection.supersededBy) reasons.push('passport is superseded');
  if (projection.decision?.state === 'revoked') reasons.push('decision is revoked');
  if (projection.decision?.state === 'reopened') reasons.push('decision is reopened');
  return {
    eligible: reasons.length === 0,
    status: reasons.length === 0 ? 'eligible' : 'blocked',
    reasons,
    unresolvedObjectionIds: objections.map((entry) => entry.objectionId),
    acceptableEvaluationIds: acceptableEvaluations.map((entry) => entry.evaluationId),
    approvalReviewIds: reviews.map((entry) => entry.reviewId)
  };
}

export function authorizeChangePassportEffect(projection = {}, request = {}, actor = {}) {
  const reasons = [];
  const gate = evaluateChangePassportGate(projection);
  const effectKind = text(request.kind);
  if (projection.decision?.state !== 'approved') reasons.push('decision is not approved');
  if (!gate.eligible) reasons.push(...gate.reasons);
  if (!projection.policy?.allowedEffects?.includes(effectKind)) reasons.push('effect kind is not allowed');
  if (request.candidateHash !== projection.proposal?.candidateHash) reasons.push('candidate identity mismatch');
  if (actor.organizationId !== projection.organizationId) reasons.push('actor organization mismatch');
  return { authorized: reasons.length === 0, reasons };
}

const valueAtPath = (value, path) => text(path).split('.').reduce((current, segment) => (
  current === null || current === undefined ? undefined : current[segment]
), value);

const compareValue = (actual, operator, expected) => {
  switch (operator) {
    case 'equals': return actual === expected;
    case 'not_equals': return actual !== expected;
    case 'contains': return Array.isArray(actual)
      ? actual.includes(expected)
      : String(actual ?? '').includes(String(expected ?? ''));
    case 'greater_than': return Number(actual) > Number(expected);
    case 'less_than': return Number(actual) < Number(expected);
    case 'exists': return actual !== undefined && actual !== null;
    default: return false;
  }
};

export function matchChangePassportReopeningTrigger(projection = {}, observation = {}, now = Date.now()) {
  const reasons = [];
  const rule = (projection.policy?.reopeningRules || [])
    .find((entry) => entry.ruleId === observation.ruleId);
  if (!rule) return { matched: false, reasons: ['trigger rule is not declared'], rule: null };
  for (const field of ['sourceKind', 'observationKind', 'targetId', 'sensorAuthorityId']) {
    if (observation[field] !== rule[field]) reasons.push(`trigger ${field} mismatch`);
  }
  const observedAt = Date.parse(observation.observedAt);
  if (!Number.isFinite(observedAt)) reasons.push('trigger observedAt is invalid');
  else if (rule.freshnessMilliseconds > 0 && now - observedAt > rule.freshnessMilliseconds) {
    reasons.push('trigger observation is stale');
  }
  if (!compareValue(valueAtPath(observation.condition, rule.match.field), rule.match.operator, rule.match.value)) {
    reasons.push('trigger condition did not match');
  }
  return {
    matched: reasons.length === 0,
    reasons,
    rule: cloneJson(rule),
    requestedAction: rule.action
  };
}

export default {
  CHANGE_PASSPORT_POLICY_SCHEMA,
  authorizeChangePassportEffect,
  buildChangePassportPolicy,
  evaluateChangePassportGate,
  matchChangePassportReopeningTrigger,
  normalizeChangePassportPolicy,
  validateChangePassportPolicy
};
