import { describe, expect, it } from 'vitest';

import {
  STANDARD_CHANGE_TRIGGER_KINDS,
  buildStandardChangeTriggerObservation
} from '../../server/change-control/triggers.js';

const digest = (character) => `sha256:${character.repeat(64)}`;
const rule = {
  ruleId: 'rule:standard',
  sourceKind: 'production_monitor',
  observationKind: 'metric_threshold_crossed',
  targetId: 'service:agent',
  sensorAuthorityId: 'authority:monitor'
};

describe('standard Change Passport triggers', () => {
  it('builds content-addressed observations for all bounded trigger classes', async () => {
    const inputs = {
      candidate_artifact_changed: { previousHash: digest('1'), currentHash: digest('2') },
      security_advisory: { advisoryId: 'GHSA-test', dependencyId: 'dependency:test', severity: 'high', affected: true },
      policy_superseded: { previousPolicyHash: digest('3'), currentPolicyHash: digest('4'), superseded: true },
      metric_threshold_crossed: { metricId: 'error-rate', value: 0.2, threshold: 0.1, direction: 'above' },
      post_deployment_evaluation_failed: { evaluationId: 'evaluation:post', contractHash: digest('5'), failed: true }
    };
    for (const kind of STANDARD_CHANGE_TRIGGER_KINDS) {
      const observation = await buildStandardChangeTriggerObservation({
        kind,
        rule,
        data: inputs[kind],
        observedAt: '2026-08-22T20:00:00.000Z',
        deduplicationKey: `trigger:${kind}`
      });
      expect(observation).toMatchObject({
        schema: 'change.passport-standard-trigger/v1',
        kind,
        ruleId: 'rule:standard'
      });
      expect(observation.observationHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    }
  });

  it('computes threshold and artifact changes rather than trusting declared booleans', async () => {
    const metric = await buildStandardChangeTriggerObservation({
      kind: 'metric_threshold_crossed',
      rule,
      data: { metricId: 'error-rate', value: 0.05, threshold: 0.1, direction: 'above', crossed: true },
      observedAt: '2026-08-22T20:00:00.000Z',
      deduplicationKey: 'metric:1'
    });
    expect(metric.condition.crossed).toBe(false);
    const artifact = await buildStandardChangeTriggerObservation({
      kind: 'candidate_artifact_changed',
      rule,
      data: { previousHash: digest('1'), currentHash: digest('1'), changed: true },
      observedAt: '2026-08-22T20:00:00.000Z',
      deduplicationKey: 'artifact:1'
    });
    expect(artifact.condition.changed).toBe(false);
  });
});
