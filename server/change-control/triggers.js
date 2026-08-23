/**
 * @fileoverview Standard bounded trigger observations for Change Passports.
 */

import { hashChangePassportValue } from '../../self/shared/change-passport/contract.js';

export const STANDARD_CHANGE_TRIGGER_KINDS = Object.freeze([
  'candidate_artifact_changed',
  'security_advisory',
  'policy_superseded',
  'metric_threshold_crossed',
  'post_deployment_evaluation_failed'
]);

const text = (value, label) => {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
};

const hash = (value, label) => {
  const normalized = text(value, label).toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized)) throw new Error(`${label} must be a SHA-256 identity`);
  return normalized;
};

const buildCondition = (kind, data = {}) => {
  switch (kind) {
    case 'candidate_artifact_changed': {
      const previousHash = hash(data.previousHash, 'previousHash');
      const currentHash = hash(data.currentHash, 'currentHash');
      return { previousHash, currentHash, changed: previousHash !== currentHash };
    }
    case 'security_advisory':
      return {
        advisoryId: text(data.advisoryId, 'advisoryId'),
        dependencyId: text(data.dependencyId, 'dependencyId'),
        severity: text(data.severity, 'severity'),
        affected: data.affected === true
      };
    case 'policy_superseded':
      return {
        previousPolicyHash: hash(data.previousPolicyHash, 'previousPolicyHash'),
        currentPolicyHash: hash(data.currentPolicyHash, 'currentPolicyHash'),
        superseded: data.superseded === true
      };
    case 'metric_threshold_crossed': {
      const value = Number(data.value);
      const threshold = Number(data.threshold);
      const direction = ['above', 'below'].includes(data.direction) ? data.direction : 'above';
      if (!Number.isFinite(value) || !Number.isFinite(threshold)) throw new Error('metric value and threshold must be finite');
      return {
        metricId: text(data.metricId, 'metricId'),
        value,
        threshold,
        direction,
        crossed: direction === 'above' ? value > threshold : value < threshold
      };
    }
    case 'post_deployment_evaluation_failed':
      return {
        evaluationId: text(data.evaluationId, 'evaluationId'),
        contractHash: hash(data.contractHash, 'contractHash'),
        failed: data.failed === true
      };
    default:
      throw new Error(`Unsupported standard trigger kind: ${kind}`);
  }
};

export async function buildStandardChangeTriggerObservation({
  kind,
  rule,
  data,
  observedAt = new Date().toISOString(),
  deduplicationKey
} = {}) {
  if (!STANDARD_CHANGE_TRIGGER_KINDS.includes(kind)) throw new Error('Standard trigger kind is unsupported');
  if (!rule?.ruleId) throw new Error('Declared reopening rule is required');
  const condition = buildCondition(kind, data);
  const observation = {
    schema: 'change.passport-standard-trigger/v1',
    kind,
    ruleId: rule.ruleId,
    sourceKind: rule.sourceKind,
    observationKind: rule.observationKind,
    targetId: rule.targetId,
    sensorAuthorityId: rule.sensorAuthorityId,
    condition,
    observedAt: text(observedAt, 'observedAt'),
    deduplicationKey: text(deduplicationKey, 'deduplicationKey')
  };
  if (!Number.isFinite(Date.parse(observation.observedAt))) throw new Error('observedAt must be an ISO timestamp');
  observation.observationHash = await hashChangePassportValue(observation);
  return observation;
}

export default { STANDARD_CHANGE_TRIGGER_KINDS, buildStandardChangeTriggerObservation };
