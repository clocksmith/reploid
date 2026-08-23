import { buildChangePassportPolicy } from '../../../self/core/change-passport-policy.js';
import { hashChangePassportValue } from '../../../self/core/change-passport.js';

export const digest = (character) => `sha256:${character.repeat(64)}`;
export const fixtureTimestamp = (seconds) => `2026-08-22T20:00:${String(seconds).padStart(2, '0')}.000Z`;

export const auth = (authorityId, roles, organizationId = 'org:test') => ({
  subject: authorityId,
  authorityId,
  organizationId,
  roles,
  authenticationKind: 'test_identity'
});

export async function createServiceFixturePolicy() {
  return buildChangePassportPolicy({
    policyId: 'policy:service:1',
    version: '1.0.0',
    changeClasses: ['agent_configuration'],
    requiredEvidenceKinds: ['tests'],
    requiredEvaluationConclusion: 'pass',
    requiredReviewerRoles: ['security_reviewer'],
    minimumApprovals: 1,
    independence: {
      proposerEvaluator: true,
      proposerReviewer: true,
      evaluatorReviewer: true
    },
    allowedEffects: ['deployment'],
    rollbackAuthorityId: 'authority:rollback',
    reopeningRules: [{
      ruleId: 'rule:metric-regression',
      sourceKind: 'production_monitor',
      observationKind: 'metric_threshold_crossed',
      targetId: 'service:agent-runtime',
      sensorAuthorityId: 'authority:monitor',
      freshnessMilliseconds: 60000,
      match: { field: 'regressed', operator: 'equals', value: true },
      action: 'rollback_request'
    }],
    falseBlockTolerance: 0.05,
    unresolvedBlocksActivation: true
  });
}

export function createServiceStartPayload(policy, options = {}) {
  return {
    passportId: options.passportId || 'passport:service:1',
    organizationId: options.organizationId || 'org:test',
    changeClass: 'agent_configuration',
    proposal: {
      proposalId: options.proposalId || 'proposal:service:1',
      title: 'Promote agent configuration',
      summary: 'Promote the exact agent configuration after frozen evaluation.',
      repository: {
        provider: 'github',
        owner: 'clocksmith',
        name: 'agent-runtime',
        repositoryId: 'github:repo:service',
        installationId: options.installationId || null,
        visibility: 'private'
      },
      pullRequestNumber: 11,
      baseRevision: 'base-sha',
      candidateRevision: 'candidate-sha',
      baselineHash: digest('1'),
      candidateHash: digest('2'),
      manifestHash: digest('3'),
      target: {
        kind: 'agent_runtime',
        targetId: 'service:agent-runtime',
        environment: 'production'
      },
      proposerAuthorityId: options.proposerAuthorityId || 'authority:proposer'
    },
    policy,
    evaluator: {
      evaluatorId: 'evaluator:service',
      authorityId: 'authority:evaluator',
      version: '1.0.0',
      evaluatorHash: digest('4'),
      suiteHash: digest('5'),
      contractHash: digest('6'),
      frozenBeforeCandidate: true
    },
    budget: {
      calls: 10,
      elapsedMilliseconds: 60000,
      costAmount: 1,
      costUnit: 'usd'
    },
    rollback: {
      kind: 'github_revert',
      targetId: 'service:agent-runtime',
      revision: 'base-sha',
      artifactHash: digest('7'),
      authorityId: 'authority:rollback'
    },
    evidenceCutoff: fixtureTimestamp(0),
    createdAt: fixtureTimestamp(1)
  };
}

export async function advanceServiceToApproval(service, passportId = 'passport:service:1') {
  const changeAuth = auth('authority:change', ['change_authority']);
  const evaluatorAuth = auth('authority:evaluator', ['evaluator', 'evidence_producer']);
  const reviewerAuth = auth('authority:reviewer', ['security_reviewer']);
  await service.appendEvent({
    passportId,
    type: 'trigger.declared',
    role: 'change_authority',
    idempotencyKey: 'trigger-declared',
    payload: {
      ruleId: 'rule:metric-regression',
      sourceKind: 'production_monitor',
      observationKind: 'metric_threshold_crossed',
      targetId: 'service:agent-runtime',
      sensorAuthorityId: 'authority:monitor',
      freshnessMilliseconds: 60000,
      condition: {
        field: 'regressed',
        operator: 'equals',
        value: true
      },
      action: 'rollback_request'
    }
  }, changeAuth);
  await service.appendEvent({
    passportId,
    type: 'evidence.admitted',
    role: 'evidence_producer',
    idempotencyKey: 'evidence-tests',
    payload: {
      evidenceId: 'evidence:tests',
      kind: 'tests',
      digest: digest('8'),
      source: 'CI test run',
      uri: 'https://github.example/run/1',
      summary: 'All frozen tests passed.',
      observedAt: fixtureTimestamp(2),
      custody: { mode: 'reference_only', accessRequired: true, retention: 'source_owned' }
    }
  }, evaluatorAuth);
  const manifestHash = await hashChangePassportValue([['evidence:tests', digest('8')]]);
  await service.appendEvent({
    passportId,
    type: 'evidence.frozen',
    role: 'change_authority',
    idempotencyKey: 'evidence-freeze',
    payload: {
      manifestHash,
      evidenceIds: ['evidence:tests'],
      cutoff: fixtureTimestamp(3)
    }
  }, changeAuth);
  await service.appendEvent({
    passportId,
    type: 'evaluation.recorded',
    role: 'evaluator',
    idempotencyKey: 'evaluation',
    payload: {
      evaluationId: 'evaluation:service:1',
      evaluatorId: 'evaluator:service',
      evaluatorAuthorityId: 'authority:evaluator',
      evaluatorHash: digest('4'),
      suiteHash: digest('5'),
      contractHash: digest('6'),
      baselineHash: digest('1'),
      candidateHash: digest('2'),
      evidenceManifestHash: manifestHash,
      conclusion: 'pass',
      metrics: [{ metricId: 'task-success', value: 1 }],
      limitations: [],
      observedAt: fixtureTimestamp(4)
    }
  }, evaluatorAuth);
  await service.appendEvent({
    passportId,
    type: 'review.recorded',
    role: 'security_reviewer',
    idempotencyKey: 'review',
    payload: {
      reviewId: 'review:service:1',
      verdict: 'approve',
      rationale: 'The frozen evidence satisfies the policy.',
      resolvesObjectionIds: [],
      evidenceIds: ['evidence:tests']
    }
  }, reviewerAuth);
  return service.appendEvent({
    passportId,
    type: 'decision.recorded',
    role: 'change_authority',
    idempotencyKey: 'decision',
    payload: {
      decisionId: 'decision:service:1',
      state: 'approved',
      policyHash: (await service.getPassport(passportId, changeAuth)).projection.policy.policyHash,
      evaluationIds: ['evaluation:service:1'],
      reviewIds: ['review:service:1'],
      rationale: 'Policy gate passed.'
    }
  }, changeAuth);
}
