import { describe, expect, it } from 'vitest';

import { buildImprovementEpisodePassportSeed } from '../../self/core/change-passport-improvement-adapter.js';
import { buildChangePassportPolicy } from '../../self/core/change-passport-policy.js';

const digest = (character) => `sha256:${character.repeat(64)}`;

const episode = () => ({
  schema: 'rsi.improvement-episode/v1',
  episodeId: 'episode:zero-x:1',
  surface: 'zero',
  objective: {
    statement: 'Promote the held-out retrieval policy only if it improves the frozen task.',
    successMetricId: 'retrieval-quality'
  },
  baseline: {
    generationId: 'generation:12',
    hashes: {
      code: digest('1'),
      config: digest('2'),
      model: digest('3'),
      prompt: digest('4'),
      artifacts: digest('5'),
      contract: digest('6')
    }
  },
  proposer: { authorityId: 'reploid:zero' },
  generator: {
    authorityId: 'reploid:zero',
    implementation: 'self/capabilities/system/doppler-optimizer.js',
    implementationHash: digest('0'),
    frozenBeforeCandidate: true
  },
  evaluator: {
    evaluatorId: 'reploid-x-held-out',
    authorityId: 'reploid:x:evaluator',
    version: '1.0.0',
    evaluatorHash: digest('7'),
    testSuiteDigest: digest('8'),
    frozenBeforeCandidate: true
  },
  resourceBudget: { calls: 12, elapsedMs: 60000 },
  promotionAuthority: {
    repositoryId: 'clocksmith/reploid',
    authorityId: 'reploid:release:authority',
    scope: 'retrieval_policy',
    allowedCandidatePaths: ['/self/config/retrieval-policy.json'],
    allowedEffectKinds: ['deployment'],
    frozenBeforeCandidate: true
  },
  negativeEvidence: [{
    evidenceId: 'baseline-miss',
    kind: 'baseline_failure',
    digest: digest('d'),
    summary: 'Baseline missed the frozen threshold.',
    retained: true
  }],
  candidate: {
    candidateId: 'candidate:retrieval:1',
    candidateHash: digest('9'),
    patchHash: digest('a'),
    generationId: 'generation:13',
    changedFiles: ['/self/config/retrieval-policy.json'],
    semanticScope: ['retrieval policy'],
    expectedBehavior: 'Surface relevant prior decisions and contradictions with less curator work.'
  },
  execution: { isolated: true, sandboxId: 'sandbox:1' },
  verification: { passed: true, verifierId: 'reploid:x:verifier', checks: [{ passed: true }] },
  evaluation: {
    metrics: [{ metricId: 'retrieval-quality', value: 0.91, valid: true }],
    sampleCount: 20
  },
  comparison: { conclusion: 'improved', regressions: [] },
  createdAt: '2026-08-22T20:00:00.000Z',
  updatedAt: '2026-08-22T20:10:00.000Z',
  integrity: { valid: true, eventCount: 7, headHash: digest('b') }
});

const policy = () => buildChangePassportPolicy({
  policyId: 'policy:reploid-internal-promotion',
  version: '1.0.0',
  changeClasses: ['agent_policy'],
  requiredEvidenceKinds: ['tests', 'evaluation'],
  requiredEvaluationConclusion: 'pass',
  requiredReviewerRoles: ['release_reviewer'],
  minimumApprovals: 1,
  independence: {
    proposerEvaluator: true,
    proposerReviewer: true,
    evaluatorReviewer: true
  },
  allowedEffects: ['deployment'],
  rollbackAuthorityId: 'reploid:release:rollback',
  reopeningRules: [{
    ruleId: 'rule:held-out-regression',
    sourceKind: 'post_deployment_evaluator',
    observationKind: 'evaluation_failed',
    targetId: 'reploid:retrieval-policy',
    sensorAuthorityId: 'reploid:x:post-deployment',
    freshnessMilliseconds: 300000,
    match: { field: 'failed', operator: 'equals', value: true },
    action: 'rollback_request'
  }],
  unresolvedBlocksActivation: true
});

describe('Change Passport improvement episode adapter', () => {
  it('imports attributed Zero/X evidence without manufacturing review or effect authority', async () => {
    const seed = await buildImprovementEpisodePassportSeed({
      episode: episode(),
      passportId: 'passport:zero-x:1',
      organizationId: 'org:reploid',
      changeClass: 'agent_policy',
      policy: await policy(),
      repository: {
        provider: 'github',
        owner: 'reploid',
        name: 'reploid',
        repositoryId: 'github:repo:reploid',
        defaultBranch: 'main',
        visibility: 'private'
      },
      target: {
        kind: 'agent_policy',
        targetId: 'reploid:retrieval-policy',
        environment: 'production'
      },
      rollback: {
        kind: 'github_revert',
        targetId: 'reploid:retrieval-policy',
        revision: 'generation:12',
        artifactHash: digest('c'),
        authorityId: 'reploid:release:rollback'
      },
      createdAt: '2026-08-22T20:11:00.000Z'
    });

    expect(seed).toMatchObject({
      schema: 'change.passport-improvement-adapter/v1',
      start: {
        proposal: { proposerAuthorityId: 'reploid:zero' },
        evaluator: { authorityId: 'reploid:x:evaluator' },
        sourceEpisode: { episodeId: 'episode:zero-x:1' }
      },
      evaluation: {
        evaluatorAuthorityId: 'reploid:x:evaluator',
        conclusion: 'pass'
      }
    });
    expect(seed.admittedEvidence.map((entry) => entry.kind)).toEqual([
      'improvement_episode',
      'tests',
      'evaluation'
    ]);
    expect(seed.authorityBindings).toMatchObject({
      generator: { authorityId: 'reploid:zero' },
      evaluator: { authorityId: 'reploid:x:evaluator' },
      promotion: { authorityId: 'reploid:release:authority' }
    });
    expect(seed.negativeEvidence).toHaveLength(1);
    expect(seed.requiredSubmissions).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'release_reviewer' }),
      expect.objectContaining({ role: 'activator' })
    ]));
    expect(seed.authorityBoundary).toContain('No review, decision, effect');
  });

  it('rejects an unsigned or incomplete source projection', async () => {
    await expect(buildImprovementEpisodePassportSeed({
      episode: { ...episode(), integrity: { valid: false } }
    })).rejects.toThrow('valid rsi.improvement-episode/v1');
  });
});
