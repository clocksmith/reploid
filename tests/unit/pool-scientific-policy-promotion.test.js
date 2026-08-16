import { describe, expect, it } from 'vitest';

import {
  SCIENTIFIC_POLICY_EVALUATION_METRICS,
  buildPooldayScientificPolicyPromotionDecision,
  buildScientificPolicyShadowEvaluation,
  buildZeroScientificPolicyCandidate,
  freezeScientificPolicyShadowCohort,
  validateScientificPolicyShadowCohort,
  validateScientificPolicyShadowEvaluation,
  validatePooldayScientificPolicyActivation,
  validateZeroScientificPolicyCandidate
} from '../../self/pool/scientific-policy-promotion.js';

const hash = (character) => `sha256:${character.repeat(64)}`;
const methodKinds = [
  'hypothesis_decomposition',
  'uncertainty_estimation',
  'contradiction_detection',
  'action_selection'
];

const candidateInput = () => ({
  candidateId: 'zero-public-protein-policy-1',
  proposer: {
    identityRootId: 'zero-proposer-root',
    roleId: 'zero-policy-proposer',
    authority: 'Propose Shadow-only scientific methods; no evaluation or activation authority.'
  },
  objective: {
    objectiveId: 'reduce-verified-adjudication-cost',
    statement: 'Reduce cost to the same bounded curator conclusion without reducing quality.',
    evaluationMetricIds: Object.keys(SCIENTIFIC_POLICY_EVALUATION_METRICS)
  },
  hypothesis: {
    observation: 'The baseline repeats low-value retrieval after a contradiction is already visible.',
    suspectedCause: 'The baseline ranks actions without a contradiction-aware feature.',
    alternativeExplanations: ['The task mix changed.', 'The evaluator rewards shorter traces.'],
    expectedResult: 'Contradictions are detected with fewer actions at equivalent conclusion quality.',
    falsifyingResult: 'Held-out families show no paired cost gain or more missed contradictions.'
  },
  methods: methodKinds.map((kind, index) => ({
    kind,
    methodId: `zero-${kind}`,
    version: '1.0.0',
    artifactHash: hash(String(index + 1)),
    inputContractHash: hash(String(index + 5)),
    outputContractHash: hash(['9', 'a', 'b', 'c'][index]),
    expectedBehavior: `Produce a bounded ${kind} proposal under the frozen input contract.`,
    falsifyingBehavior: `Change evidence, evaluator, promotion, audit, rollback, or Poolday policy while running ${kind}.`
  })),
  change: {
    revisionHash: hash('d'),
    sourceTreeHash: hash('e'),
    changedModules: ['zero/contradiction-detector.js', 'zero/action-ranker.js'],
    semanticScope: 'Candidate-only contradiction detection and action ranking in Shadow.'
  },
  invariants: ['Never mutate source evidence.', 'Never activate or evaluate itself.'],
  failureModes: ['Evaluator gaming.', 'Family-specific overfit.', 'Higher safety regression count.'],
  resourceBudget: {
    tokens: 10000,
    calls: 50,
    elapsedMilliseconds: 600000,
    costAmount: 25,
    costUnit: 'USD'
  },
  createdAt: '2026-08-15T20:00:00.000Z'
});

const metricDefinitions = () => Object.entries(SCIENTIFIC_POLICY_EVALUATION_METRICS)
  .map(([role, direction], index) => ({
    role,
    metricId: `promotion-${role}`,
    direction,
    unit: role.endsWith('Count') || role === 'actionCount' ? 'count' : 'fraction',
    definitionHash: hash(['1', '2', '3', '4', '5', '6', '7'][index]),
    aggregation: 'Paired median across frozen contracts.',
    validityConditions: 'Complete paired baseline and candidate observations under the frozen budget.',
    minimumSampleSize: 2,
    promotionThreshold: role.endsWith('Count') || role === 'actionCount' || role === 'costToSameConclusion' ? 0 : 0.01
  }));

const shadowInput = (candidate) => ({
  candidate,
  baseline: {
    policyId: 'poolday.baseline-action-policy',
    version: '1.0.0',
    revisionHash: hash('1'),
    artifactHash: hash('2'),
    inputContractHash: hash('3'),
    budgetContractHash: hash('4')
  },
  historicalContracts: [{
    contractId: 'historical-room-1',
    checkpointHash: hash('5'),
    questionHash: hash('6'),
    familyHash: hash('7'),
    evidenceCutoff: '2026-08-14T00:00:00.000Z',
    outcomeCommitmentHash: hash('8'),
    contaminationAuditHash: hash('9')
  }],
  prospectiveContracts: [{
    contractId: 'prospective-room-1',
    checkpointHash: hash('a'),
    questionHash: hash('b'),
    familyHash: hash('c'),
    evidenceCutoff: '2026-08-15T00:00:00.000Z',
    contaminationAuditHash: hash('d')
  }],
  evaluator: {
    identityRootId: 'x-evaluator-root',
    roleId: 'x-shadow-evaluator',
    authority: 'Evaluate only the frozen candidate and baseline in Shadow.',
    methodId: 'x-paired-policy-evaluator',
    version: '1.0.0',
    artifactHash: hash('e'),
    blinded: true
  },
  metrics: metricDefinitions(),
  frozenAt: '2026-08-15T20:30:00.000Z'
});

const evaluationInput = (candidate, cohort) => ({
  candidate,
  cohort,
  run: {
    runId: 'x-shadow-run-1',
    evaluatorArtifactHash: cohort.evaluator.artifactHash,
    inputOrderHash: hash('1'),
    seedSetHash: hash('2'),
    resourceBudgetHash: hash('3'),
    failureAndTimeoutPolicyHash: hash('4'),
    rawObservationSetHash: hash('5')
  },
  observations: [...cohort.historicalContracts, ...cohort.prospectiveContracts].map((contract, index) => ({
    contractId: contract.contractId,
    baseline: {
      conclusionHash: hash(index ? '7' : '6'),
      actionCount: 5,
      costVectorHash: hash('8'),
      failureDetectionHash: hash('9'),
      replicationEvidenceHash: hash('a'),
      safetyEvidenceHash: hash('b'),
      rollbackEvidenceHash: hash('c')
    },
    candidate: {
      conclusionHash: hash(index ? '7' : '6'),
      actionCount: 4,
      costVectorHash: hash('d'),
      failureDetectionHash: hash('e'),
      replicationEvidenceHash: hash('f'),
      safetyEvidenceHash: hash('1'),
      rollbackEvidenceHash: hash('2')
    }
  })),
  metricResults: cohort.metrics.map((metric) => {
    const lowerIsBetter = metric.direction === 'lower_is_better';
    const unchangedSafety = metric.role === 'safetyRegressionCount';
    return {
      metricId: metric.metricId,
      baselineValue: lowerIsBetter ? (unchangedSafety ? 0 : 10) : 0.5,
      candidateValue: lowerIsBetter ? (unchangedSafety ? 0 : 8) : 0.7,
      effectInterval: { lower: unchangedSafety ? 0 : 0.1, upper: unchangedSafety ? 0 : 3 },
      pairedSampleCount: 2
    };
  }),
  safeguards: {
    safetyRegressionCount: 0,
    safetyReviewHash: hash('3'),
    rollbackExerciseHash: hash('4'),
    rollbackSuccessful: true,
    revocationExerciseHash: hash('5')
  },
  evaluatedAt: '2026-08-15T21:00:00.000Z'
});

const promotionInput = (candidate, cohort, evaluation) => ({
  candidate,
  cohort,
  evaluation,
  approver: {
    identityRootId: 'human-approver-root',
    roleId: 'scientific-policy-approver',
    authority: 'Approve the exact evaluated candidate; no Poolday configuration authority.'
  },
  pooldayOwner: {
    identityRootId: 'poolday-policy-owner-root',
    roleId: 'poolday-policy-owner',
    authority: 'Admit an approved candidate into exact Poolday configuration and user contracts.'
  },
  humanApproval: {
    decision: 'approved',
    evidenceHash: hash('6'),
    approvedCandidateHash: candidate.candidateHash
  },
  pooldayAdmission: {
    policyId: 'poolday.promoted-contradiction-aware-policy',
    version: '1.0.0',
    configurationHash: hash('7'),
    policyRegistryHash: hash('8'),
    userContractHash: hash('9')
  },
  operationalProof: {
    status: 'passes',
    evidenceHash: hash('a'),
    prospectiveCheckpointHashes: cohort.prospectiveContracts.map((contract) => contract.checkpointHash),
    reviewedOutcomeSetHash: hash('b')
  },
  safeguards: {
    safetyReviewHash: hash('c'),
    revocationPlanHash: hash('d'),
    rollbackArtifactHash: hash('e'),
    rollbackTestHash: hash('f')
  },
  decidedAt: '2026-08-15T22:00:00.000Z'
});

describe('Zero to X scientific-policy promotion contracts', () => {
  it('binds a hypothesis-driven Zero candidate with no self-evaluation or activation authority', async () => {
    const candidate = await buildZeroScientificPolicyCandidate(candidateInput());

    expect(await validateZeroScientificPolicyCandidate(candidate)).toEqual({ ok: true, reasons: [] });
    expect(candidate).toMatchObject({
      schema: 'poolday.zero_scientific_policy_candidate/v1',
      state: 'proposed_for_shadow_only',
      authority: {
        activationAuthority: 'none',
        selfEvaluationAllowed: false,
        selfApprovalAllowed: false,
        protectedSurfaces: ['audit_log', 'evaluator', 'promotion_policy', 'rollback']
      }
    });
    expect(candidate.methods.map((method) => method.kind)).toEqual(methodKinds);

    const tampered = structuredClone(candidate);
    tampered.authority.selfEvaluationAllowed = true;
    expect(await validateZeroScientificPolicyCandidate(tampered)).toEqual(expect.objectContaining({
      ok: false,
      reasons: expect.arrayContaining(['Zero scientific-policy candidate is not canonical'])
    }));
  });

  it('freezes family-disjoint historical and prospective Discovery Contracts before X evaluation', async () => {
    const candidate = await buildZeroScientificPolicyCandidate(candidateInput());
    const cohort = await freezeScientificPolicyShadowCohort(shadowInput(candidate));

    expect(await validateScientificPolicyShadowCohort(cohort, candidate)).toEqual({ ok: true, reasons: [] });
    expect(cohort).toMatchObject({
      schema: 'poolday.x_scientific_policy_shadow_cohort/v1',
      state: 'frozen_shadow',
      candidateHash: candidate.candidateHash,
      evaluator: { surface: 'x', candidateEditable: false, blinded: true },
      pairedEvaluation: {
        sameContracts: true,
        sameInputOrder: true,
        sameEvidenceCutoff: true,
        sameResourceBudget: true
      },
      activationAuthority: 'none'
    });
    expect(cohort.metrics.map((metric) => metric.role).sort()).toEqual(
      Object.keys(SCIENTIFIC_POLICY_EVALUATION_METRICS).sort()
    );
  });

  it('rejects evaluator self-review and family leakage across historical and prospective partitions', async () => {
    const candidate = await buildZeroScientificPolicyCandidate(candidateInput());
    const selfEvaluated = shadowInput(candidate);
    selfEvaluated.evaluator.identityRootId = candidate.proposer.identityRootId;
    await expect(freezeScientificPolicyShadowCohort(selfEvaluated)).rejects.toThrow(
      'Zero candidate proposer and X evaluator must be independent'
    );

    const leaked = shadowInput(candidate);
    leaked.prospectiveContracts[0].familyHash = leaked.historicalContracts[0].familyHash;
    await expect(freezeScientificPolicyShadowCohort(leaked)).rejects.toThrow(
      'historical and prospective protein families must be disjoint'
    );
  });

  it('compares the complete frozen metric vector on paired same-conclusion observations in Shadow', async () => {
    const candidate = await buildZeroScientificPolicyCandidate(candidateInput());
    const cohort = await freezeScientificPolicyShadowCohort(shadowInput(candidate));
    const evaluation = await buildScientificPolicyShadowEvaluation(evaluationInput(candidate, cohort));

    expect(await validateScientificPolicyShadowEvaluation(evaluation, cohort, candidate)).toEqual({ ok: true, reasons: [] });
    expect(evaluation).toMatchObject({
      schema: 'poolday.x_scientific_policy_shadow_evaluation/v1',
      state: 'evaluated_in_shadow',
      assessment: { conclusion: 'passes' },
      safeguards: { safetyRegressionCount: 0, rollbackSuccessful: true },
      promotionAuthority: 'none'
    });
    expect(evaluation.metricResults).toHaveLength(Object.keys(SCIENTIFIC_POLICY_EVALUATION_METRICS).length);
    expect(evaluation.observations.every((observation) => (
      observation.baseline.conclusionHash === observation.candidate.conclusionHash
    ))).toBe(true);
  });

  it('requires four-way authority separation, human approval, Poolday admission, prospective proof, safety, revocation, and rollback', async () => {
    const candidate = await buildZeroScientificPolicyCandidate(candidateInput());
    const cohort = await freezeScientificPolicyShadowCohort(shadowInput(candidate));
    const evaluation = await buildScientificPolicyShadowEvaluation(evaluationInput(candidate, cohort));
    const promotion = await buildPooldayScientificPolicyPromotionDecision(promotionInput(candidate, cohort, evaluation));

    expect(promotion).toMatchObject({
      schema: 'poolday.scientific_policy_promotion/v1',
      state: 'promotion_eligible_not_activated',
      activationAuthority: 'poolday_configuration_owner_only',
      humanApproval: { approvedCandidateHash: candidate.candidateHash },
      operationalProof: { status: 'passes' }
    });
    expect(await validatePooldayScientificPolicyActivation({
      promotionDecision: promotion,
      activeConfiguration: {
        ownerIdentityRootId: promotion.pooldayOwner.identityRootId,
        ...promotion.pooldayAdmission
      }
    })).toEqual({ ok: true, reasons: [] });

    const selfApproved = promotionInput(candidate, cohort, evaluation);
    selfApproved.approver.identityRootId = candidate.proposer.identityRootId;
    await expect(buildPooldayScientificPolicyPromotionDecision(selfApproved)).rejects.toThrow(
      'candidate, evaluator, approver, and Poolday policy-owner identities must be distinct'
    );

    expect(await validatePooldayScientificPolicyActivation({
      promotionDecision: promotion,
      activeConfiguration: {
        ownerIdentityRootId: promotion.pooldayOwner.identityRootId,
        ...promotion.pooldayAdmission,
        configurationHash: hash('0')
      }
    })).toEqual(expect.objectContaining({ ok: false }));
  });
});
