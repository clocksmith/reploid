/**
 * @fileoverview Exact-contract evidence requirements for Poolday browser model qualification.
 *
 * This contract makes browser qualification replayable without treating a Node
 * WebGPU receipt, a catalog entry, or a passing test as browser evidence.
 */

import { exactModelContractKey as computeExactModelContractKey } from './model-contract.js';

export const BROWSER_QUALIFICATION_SCHEMA = 'poolday.browser_model_qualification/v1';

export const BROWSER_QUALIFICATION_CHECKS = Object.freeze([
  'immutableArtifactDelivery',
  'completeHashVerification',
  'webGpuExecution',
  'opfsPersistence',
  'opfsRestoration',
  'receiptIntegrity',
  'cancellation',
  'staleResultRejection',
  'corruptionRejection',
  'interruptionRecovery',
  'independentReproduction'
]);

export const BROWSER_QUALIFICATION_CHECK_STATUSES = Object.freeze([
  'not_run', 'passed', 'failed'
]);

const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const nonEmptyText = (value) => typeof value === 'string' && value.trim().length > 0;
const isSha256 = (value) => SHA256_PATTERN.test(String(value || ''));
const isIsoDate = (value) => Number.isFinite(Date.parse(value));

const qualificationBindings = (record = {}) => ({
  modelId: record.identity?.modelId || null,
  modelHash: record.identity?.modelHash || null,
  manifestHash: record.artifacts?.manifestHash || null,
  tokenizerHash: record.artifacts?.tokenizerHash || null,
  shardSetHash: record.artifacts?.shardSetHash || null,
  runtime: record.identity?.runtime || null,
  backend: record.identity?.backend || null,
  exactModelContractKey: record.identity?.exactModelContractKey || null,
  sourceTreeHash: record.release?.sourceTreeHash || null,
  browserBundleHash: record.release?.browserBundleHash || null,
  userAgentHash: record.browser?.userAgentHash || null,
  gpuAdapterIdentity: record.gpu?.adapterIdentity || null,
  policyHash: record.policyHash || null,
  outputHash: record.outputHash || null,
  receiptHash: record.receiptHash || null
});

const validateCheckEvidence = (check, evidence = {}) => {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return false;
  const bindings = evidence.bindings || {};
  return evidence.schema === 'poolday.browser_qualification_check/v1'
    && evidence.check === check
    && nonEmptyText(evidence.browserRunId)
    && isIsoDate(evidence.observedAt)
    && isSha256(evidence.resultHash)
    && isSha256(evidence.artifactHash)
    && nonEmptyText(bindings.modelId)
    && isSha256(bindings.modelHash)
    && isSha256(bindings.manifestHash)
    && isSha256(bindings.tokenizerHash)
    && isSha256(bindings.shardSetHash)
    && nonEmptyText(bindings.runtime)
    && nonEmptyText(bindings.backend)
    && nonEmptyText(bindings.exactModelContractKey)
    && isSha256(bindings.sourceTreeHash)
    && isSha256(bindings.browserBundleHash)
    && isSha256(bindings.userAgentHash)
    && nonEmptyText(bindings.gpuAdapterIdentity)
    && isSha256(bindings.policyHash)
    && isSha256(bindings.outputHash)
    && isSha256(bindings.receiptHash);
};

const validateIndependentReproduction = (reproduction = {}, record = {}) => {
  if (!nonEmptyText(reproduction.reproductionId) || !nonEmptyText(reproduction.participantId)
    || !nonEmptyText(reproduction.browserRunId) || !nonEmptyText(reproduction.browserIdentity)
    || !isIsoDate(reproduction.observedAt) || !isSha256(reproduction.userAgentHash)
    || !nonEmptyText(reproduction.gpuAdapterIdentity) || !isSha256(reproduction.resultHash)
    || !isSha256(reproduction.outputHash) || !isSha256(reproduction.receiptHash)) {
    return false;
  }
  const bindings = reproduction.bindings || {};
  return bindings.modelHash === record.identity?.modelHash
    && bindings.manifestHash === record.artifacts?.manifestHash
    && bindings.tokenizerHash === record.artifacts?.tokenizerHash
    && bindings.shardSetHash === record.artifacts?.shardSetHash
    && bindings.runtime === record.identity?.runtime
    && bindings.backend === record.identity?.backend
    && bindings.exactModelContractKey === record.identity?.exactModelContractKey
    && bindings.sourceTreeHash === record.release?.sourceTreeHash
    && bindings.browserBundleHash === record.release?.browserBundleHash
    && bindings.policyHash === record.policyHash
    && reproduction.outputHash === record.outputHash
    && reproduction.receiptHash === record.receiptHash;
};

export function browserQualificationIdentity(model = {}, exactModelContractKey = '') {
  const computedContractKey = computeExactModelContractKey(model);
  return Object.freeze({
    modelId: String(model.modelId || model.id || '').trim(),
    modelHash: String(model.modelHash || model.hash || '').trim(),
    manifestHash: String(model.manifestHash || '').trim(),
    tokenizerHash: String(model.tokenizerHash || '').trim(),
    runtime: String(model.runtime || '').trim(),
    backend: String(model.backend || '').trim(),
    // The model descriptor is the authority. Callers may provide a key for
    // compatibility, but cannot substitute one for the descriptor's exact
    // contract identity.
    exactModelContractKey: computedContractKey
  });
}

export function buildBrowserQualificationPlan(model = {}, exactModelContractKey = '') {
  return Object.freeze({
    schema: BROWSER_QUALIFICATION_SCHEMA,
    identity: browserQualificationIdentity(model, exactModelContractKey),
    requiredChecks: BROWSER_QUALIFICATION_CHECKS
  });
}

/**
 * Starts a browser-qualification observation in a non-promotable state.
 * Browser harnesses add one signed/hash-addressed observation per required
 * check, then call finalizeBrowserQualificationObservation. This function
 * deliberately never manufactures a passed check.
 */
export function buildBrowserQualificationObservation({
  model = {},
  exactModelContractKey = '',
  release = {},
  browser = {},
  gpu = {},
  policyHash = null,
  outputHash = null,
  receiptHash = null,
  artifacts = {},
  independentReproductions = []
} = {}) {
  const plan = buildBrowserQualificationPlan(model, exactModelContractKey);
  return {
    schema: BROWSER_QUALIFICATION_SCHEMA,
    status: 'incomplete',
    identity: plan.identity,
    release: { ...release },
    browser: { ...browser },
    gpu: { ...gpu },
    policyHash,
    outputHash,
    receiptHash,
    artifacts: { ...artifacts },
    requiredChecks: [...plan.requiredChecks],
    checks: Object.fromEntries(plan.requiredChecks.map((check) => [check, 'not_run'])),
    checkEvidence: {},
    independentReproductions: [...independentReproductions]
  };
}

/**
 * Build an individual browser-run check observation with the identity bindings
 * copied from its parent qualification observation. The caller still supplies
 * the event-specific hash; this helper cannot turn an unperformed check into a
 * passed one.
 */
export function buildBrowserQualificationCheckEvidence(observation = {}, {
  check,
  browserRunId,
  observedAt,
  resultHash,
  artifactHash
} = {}) {
  if (!BROWSER_QUALIFICATION_CHECKS.includes(check)) {
    throw new TypeError(`Unknown browser qualification check: ${check}`);
  }
  return {
    schema: 'poolday.browser_qualification_check/v1',
    check,
    browserRunId,
    observedAt,
    resultHash,
    artifactHash,
    bindings: qualificationBindings(observation)
  };
}

export function recordBrowserQualificationCheck(observation = {}, {
  check,
  status,
  evidence = null
} = {}) {
  if (!BROWSER_QUALIFICATION_CHECKS.includes(check)) {
    throw new TypeError(`Unknown browser qualification check: ${check}`);
  }
  if (!BROWSER_QUALIFICATION_CHECK_STATUSES.includes(status)) {
    throw new TypeError(`Invalid browser qualification check status: ${status}`);
  }
  if (status === 'passed' && !validateCheckEvidence(check, evidence)) {
    throw new TypeError(`Passed ${check} check requires hash-addressed browser evidence`);
  }
  return {
    ...observation,
    checks: { ...(observation.checks || {}), [check]: status },
    checkEvidence: status === 'passed'
      ? { ...(observation.checkEvidence || {}), [check]: { ...evidence } }
      : { ...(observation.checkEvidence || {}), [check]: evidence }
  };
}

export function finalizeBrowserQualificationObservation(observation = {}, options = {}) {
  const record = { ...observation, status: 'qualified' };
  const validation = validateBrowserQualificationRecord(record, options);
  return {
    record: { ...record, status: validation.ok ? 'qualified' : 'incomplete' },
    validation
  };
}

/**
 * Validate evidence emitted by an authentic browser journey. This verifies the
 * shape and exact bindings of the evidence record. The harness still owns the
 * underlying browser actions and must attach its artifacts separately.
 */
export function validateBrowserQualificationRecord(record = {}, {
  model = {},
  exactModelContractKey = ''
} = {}) {
  const reasons = [];
  const expected = browserQualificationIdentity(model, exactModelContractKey);
  if (record.schema !== BROWSER_QUALIFICATION_SCHEMA) reasons.push('browser qualification schema is invalid');
  if (record.status !== 'qualified') reasons.push('browser qualification record is not finalized as qualified');
  for (const [field, value] of Object.entries(expected)) {
    if (!nonEmptyText(value)) reasons.push(`expected browser qualification ${field} is missing`);
    if (record.identity?.[field] !== value) reasons.push(`browser qualification ${field} does not match the exact model contract`);
  }
  if (!nonEmptyText(record.release?.sourceRevision)
    || !isSha256(record.release?.sourceTreeHash)
    || !isSha256(record.release?.browserBundleHash)) {
    reasons.push('browser qualification exact release identity is required');
  }
  if (!nonEmptyText(record.browser?.family) || !nonEmptyText(record.browser?.version)) {
    reasons.push('browser qualification browser identity is required');
  }
  if (!isSha256(record.browser?.userAgentHash)) reasons.push('browser qualification browser user-agent hash is invalid');
  if (!nonEmptyText(record.gpu?.adapterIdentity)) reasons.push('browser qualification GPU identity is required');
  if (!isSha256(record.policyHash)) reasons.push('browser qualification policy hash is invalid');
  if (!isSha256(record.outputHash)) reasons.push('browser qualification output hash is invalid');
  if (!isSha256(record.receiptHash)) reasons.push('browser qualification receipt hash is invalid');
  if (!isSha256(record.artifacts?.manifestHash) || !isSha256(record.artifacts?.tokenizerHash)
    || !isSha256(record.artifacts?.shardSetHash)) {
    reasons.push('browser qualification artifact hashes are invalid');
  }
  if (record.artifacts?.manifestHash !== expected.manifestHash) {
    reasons.push('browser qualification manifest hash does not match the exact model contract');
  }
  if (record.artifacts?.tokenizerHash !== expected.tokenizerHash) {
    reasons.push('browser qualification tokenizer hash does not match the exact model contract');
  }
  const expectedShardSetHash = String(model.artifactIdentity?.shardSetHash || '').trim();
  if (!isSha256(expectedShardSetHash) || record.artifacts?.shardSetHash !== expectedShardSetHash) {
    reasons.push('browser qualification shard set hash does not match the exact model contract');
  }
  if (!Array.isArray(record.requiredChecks)
    || record.requiredChecks.length !== BROWSER_QUALIFICATION_CHECKS.length
    || BROWSER_QUALIFICATION_CHECKS.some((check) => !record.requiredChecks.includes(check))) {
    reasons.push('browser qualification required checks do not match the governed plan');
  }
  for (const check of BROWSER_QUALIFICATION_CHECKS) {
    if (record.checks?.[check] !== 'passed') reasons.push(`browser qualification check did not pass: ${check}`);
    if (!validateCheckEvidence(check, record.checkEvidence?.[check])) {
      reasons.push(`browser qualification check evidence is invalid: ${check}`);
    } else {
      for (const [field, value] of Object.entries(qualificationBindings(record))) {
        if (record.checkEvidence[check].bindings?.[field] !== value) {
          reasons.push(`browser qualification check evidence is not bound to ${field}: ${check}`);
        }
      }
    }
  }
  const reproductions = Array.isArray(record.independentReproductions) ? record.independentReproductions : [];
  const reproductionIds = new Set();
  const participantIds = new Set();
  const browserRunIds = new Set();
  const browserIdentities = new Set();
  for (const reproduction of reproductions) {
    if (!validateIndependentReproduction(reproduction, record)) {
      reasons.push('browser qualification independent reproduction is invalid');
      continue;
    }
    reproductionIds.add(reproduction.reproductionId);
    participantIds.add(reproduction.participantId);
    browserRunIds.add(reproduction.browserRunId);
    browserIdentities.add(reproduction.browserIdentity);
  }
  if (reproductionIds.size < 2 || participantIds.size < 2 || browserRunIds.size < 2
    || browserIdentities.size < 2) {
    reasons.push('browser qualification requires two independent reproductions');
  }
  return { ok: reasons.length === 0, reasons };
}

export default {
  BROWSER_QUALIFICATION_SCHEMA,
  BROWSER_QUALIFICATION_CHECKS,
  BROWSER_QUALIFICATION_CHECK_STATUSES,
  browserQualificationIdentity,
  buildBrowserQualificationPlan,
  buildBrowserQualificationObservation,
  buildBrowserQualificationCheckEvidence,
  recordBrowserQualificationCheck,
  finalizeBrowserQualificationObservation,
  validateBrowserQualificationRecord
};
