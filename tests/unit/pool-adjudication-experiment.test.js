import { describe, expect, it } from 'vitest';

import {
  createSignedAdjudicationEvaluation,
  createSignedAdjudicationExperiment,
  createSignedHumanClaim,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';

const hash = (character) => `sha256:${character.repeat(64)}`;

const identity = async (kind, id) => {
  const keyPair = await createSigningKeyPair();
  return {
    resolve: async () => ({
      kind,
      roleId: `${kind}_${id}`,
      userId: `user_${id}`,
      deviceId: `device_${id}`,
      identityRootId: `root_${id}`
    }),
    getSigningKeyPair: async () => keyPair
  };
};

const campaignMetricDefinitions = () => [{
  id: 'information_gain_per_action', label: 'Information gained per approved action', unit: 'bits per action', direction: 'higher_is_better'
}, {
  id: 'contradiction_resolution_cost', label: 'Cost per resolved contradiction', unit: 'resource units', direction: 'lower_is_better'
}, {
  id: 'duplicate_work_avoided', label: 'Duplicate actions avoided', unit: 'actions', direction: 'higher_is_better'
}, {
  id: 'uncertainty_calibration_error', label: 'Uncertainty calibration error', unit: 'Brier score', direction: 'lower_is_better'
}, {
  id: 'held_out_family_performance', label: 'Held-out protein-family performance', unit: 'fraction', direction: 'higher_is_better'
}].map((metric) => ({
  ...metric,
  measurementSource: 'content-hashed paired case manifest',
  aggregationRule: 'paired mean over the frozen family-disjoint cohort',
  validityConditions: ['same paired cases', 'same evidence cutoff', 'reviewed outcomes only'],
  noiseModel: 'paired bootstrap over held-out protein families',
  minimumSampleSize: 20,
  confidenceLevel: 0.95
}));

const campaignMetricResults = (pairedSampleCount) => [{
  metricId: 'information_gain_per_action', baselineValue: 0.3, candidateValue: 0.4, effectInterval: { lower: 0.02, upper: 0.18 }
}, {
  metricId: 'contradiction_resolution_cost', baselineValue: 8, candidateValue: 7, effectInterval: { lower: 0.1, upper: 1.9 }
}, {
  metricId: 'duplicate_work_avoided', baselineValue: 1, candidateValue: 3, effectInterval: { lower: 0.4, upper: 3.6 }
}, {
  metricId: 'uncertainty_calibration_error', baselineValue: 0.2, candidateValue: 0.18, effectInterval: { lower: 0.001, upper: 0.04 }
}, {
  metricId: 'held_out_family_performance', baselineValue: 0.7, candidateValue: 0.76, effectInterval: { lower: 0.01, upper: 0.11 }
}].map((metric) => ({ ...metric, pairedSampleCount }));

const northStarMetricDefinition = () => ({
  id: 'cost_to_replicated_conclusion',
  label: 'Normalized cost to a predeclared independently replicated conclusion',
  unit: 'normalized 2026 USD',
  direction: 'lower_is_better',
  measurementSource: 'signed paired case cost and conclusion manifests',
  aggregationRule: 'paired median across the complete frozen family-disjoint cohort',
  validityConditions: ['all frozen cases included', 'failed and unresolved cases charged', 'independence audit passed'],
  noiseModel: 'paired bootstrap over protein-family-disjoint cases',
  minimumSampleSize: 20,
  confidenceLevel: 0.95
});

const northStarMetricResult = (pairedSampleCount) => ({
  metricId: 'cost_to_replicated_conclusion',
  baselineValue: 140,
  candidateValue: 110,
  effectInterval: { lower: 8, upper: 52 },
  pairedSampleCount
});

const northStarPolicy = () => ({
  costToReplicatedConclusionMetricId: 'cost_to_replicated_conclusion',
  costRepresentation: {
    componentIds: ['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime'],
    rawAmountsRemainInOriginalUnits: true,
    normalizedUnit: 'normalized 2026 USD',
    conversionPolicy: {
      policyId: 'catalog-real-cost-normalization',
      version: '2026.08',
      artifactHash: hash('d')
    },
    includeFailedAttempts: true,
    includeUnresolvedCases: true,
    stopRule: 'Stop at the first predeclared independently replicated conclusion or frozen budget exhaustion.'
  },
  conclusionCriteria: {
    policyId: 'catalog-resolution-criteria',
    version: '2026.08',
    artifactHash: hash('e'),
    decisionStates: ['retain', 'revise', 'reject', 'unresolved'],
    frozenBeforeActions: true,
    independentAcceptanceRequired: true,
    independentReplicationRequired: true,
    minimumIndependentReplications: 1
  },
  independenceCriteria: {
    policyId: 'catalog-replication-independence',
    version: '2026.08',
    artifactHash: hash('f'),
    requiredDimensions: ['reviewer_identity', 'evidence_source'],
    evaluatorExcludedFromCaseEvidence: true
  },
  aggregation: {
    intervalMethod: 'paired bootstrap over frozen family-disjoint cases',
    minimumPairedCases: 20,
    confidenceLevel: 0.95,
    minimumImprovementThreshold: 0
  },
  operationalMetrics: ['peers', 'jobs', 'receipts', 'records', 'claims', 'total_compute']
});

const northStarEvidence = ({ observed = 24, complete = true } = {}) => ({
  caseEvidenceManifestHash: hash('1'),
  rawCostObservationManifestHash: hash('2'),
  conclusionAuditManifestHash: hash('3'),
  independenceAuditManifestHash: hash('4'),
  conversionAuditArtifactHash: hash('5'),
  baseline: {
    observedCaseCount: observed,
    independentlyReplicatedConclusionCount: complete ? observed : 0
  },
  candidate: {
    observedCaseCount: observed,
    independentlyReplicatedConclusionCount: complete ? observed : 0
  },
  allFrozenCasesIncluded: complete,
  realWorldObserved: complete,
  criteriaAppliedBeforeOutcomeAccess: true,
  operationalMetricsExcludedFromSuccess: true
});

const experimentInput = () => ({
  roomId: 'adjudication-proof-room',
  target: {
    catalogId: 'DECLARED-CATALOG',
    catalogVersion: '2026.08',
    curatorRole: 'protein family annotation curator',
    decision: 'retain, revise, or reject one disputed family or domain annotation',
    disputedEvidencePattern: 'catalog sources, exact-model retrieval, and reviewer judgment disagree',
    actionableOutput: 'a signed retain, revise, reject, or unresolved decision with rationale',
    adopterOrPayer: 'declared public catalog governance owner'
  },
  baseline: {
    workflowId: 'catalog-current-workflow',
    version: '2026.08',
    revisionHash: hash('1'),
    description: 'The frozen existing adjudication process.',
    toolsAndHandoffs: ['catalog search', 'local analysis', 'curator spreadsheet handoff'],
    actionSelection: {
      policyId: 'catalog-current-action-selection',
      version: '2026.08',
      artifactHash: hash('9'),
      inputContractHash: hash('a'),
      budgetContractHash: hash('b'),
      rankingMethod: 'curator applies the frozen catalog triage rubric',
      rankingStatus: 'heuristic_not_calibrated',
      eligibleActionKinds: ['retrieval', 'review'],
      tieBreak: ['catalog accession ascending'],
      stopRule: 'Stop after a signed retain, revise, reject, or unresolved decision.'
    }
  },
  candidate: {
    policyId: 'reploid-research-room',
    version: '1',
    revisionHash: hash('2')
  },
  cohort: {
    manifest: { accession: 'COHORT:PUBLIC-ANNOTATION-1', version: '1', contentHash: hash('3') },
    caseCount: 24,
    familySplitHash: hash('4'),
    allocationHash: hash('5'),
    familyDisjoint: true
  },
  outcomeBoundary: {
    mode: 'prospective_future',
    accessAtFreeze: 'not_available',
    evidenceCutoffAt: '2026-08-15T11:59:00.000Z',
    outcomeManifestCommitmentHash: null,
    revealRule: 'Reveal outcomes only after both policies publish locked actions for every paired case.',
    contaminationAuditMethod: 'Compare access logs and artifact hashes against the frozen evidence cutoff.',
    contaminationAuditArtifactHash: hash('c')
  },
  comparison: {
    pairedTasks: true,
    sameInputOrder: true,
    sameEvidenceCutoff: true,
    resourceBudgetHash: hash('d'),
    failurePolicyHash: hash('e'),
    timeoutPolicyHash: hash('f'),
    seedManifestHash: hash('0')
  },
  evaluator: {
    authority: 'independent catalog adjudication evaluator',
    identityRootId: 'root_experiment-evaluator',
    methodId: 'paired-adjudication-comparison',
    version: '1',
    artifactHash: hash('6'),
    blinded: true
  },
  metrics: [{
    id: 'adjudication_quality',
    label: 'Adjudication quality against the frozen reference decision',
    unit: 'fraction',
    direction: 'higher_is_better',
    measurementSource: 'blinded independent adjudication rubric',
    aggregationRule: 'paired mean across the frozen cohort',
    validityConditions: ['same cases and evidence cutoff', 'evaluator remains blinded'],
    noiseModel: 'paired bootstrap over protein-family-disjoint cases',
    minimumSampleSize: 20,
    confidenceLevel: 0.95
  }, {
    id: 'curator_effort',
    label: 'Active curator effort per completed decision',
    unit: 'minutes per decision',
    direction: 'lower_is_better',
    measurementSource: 'task-active interaction log',
    aggregationRule: 'paired median across completed cases',
    validityConditions: ['same start and stop rule', 'unresolved cases remain counted'],
    noiseModel: 'paired bootstrap over protein-family-disjoint cases',
    minimumSampleSize: 20,
    confidenceLevel: 0.95
  }, ...campaignMetricDefinitions(), northStarMetricDefinition()],
  measurementPlan: {
    informationGainPerActionMetricId: 'information_gain_per_action',
    contradictionResolutionCostMetricId: 'contradiction_resolution_cost',
    duplicateWorkAvoidedMetricId: 'duplicate_work_avoided',
    uncertaintyCalibrationErrorMetricId: 'uncertainty_calibration_error',
    heldOutFamilyPerformanceMetricId: 'held_out_family_performance'
  },
  northStarPolicy: northStarPolicy(),
  successPolicy: {
    qualityMetricId: 'adjudication_quality',
    effortMetricId: 'curator_effort',
    qualityImprovementThreshold: 0.02,
    qualityNonInferiorityMargin: 0.01,
    effortImprovementThreshold: 2,
    effortComparabilityMargin: 2
  },
  resolution: {
    acceptanceRule: 'Accept only a predeclared success path whose lower paired confidence bound clears its threshold.',
    rejectionRule: 'Reject when the adequately sampled comparison clears neither success path.',
    reopeningRule: 'Reopen after evaluator drift, benchmark contamination, or a material catalog workflow revision.'
  },
  frozenAt: '2026-08-15T12:00:00.000Z',
  createdAt: '2026-08-15T12:00:00.000Z'
});

describe('Poolday annotation-adjudication product proof', () => {
  it('binds a frozen paired comparison and computes its success path under independent authority', async () => {
    const author = await identity('researcher', 'experiment-author');
    const experiment = await createSignedAdjudicationExperiment({ identity: author, ...experimentInput() });
    expect(await verifyResearchRecord(experiment)).toMatchObject({ ok: true });
    expect(validateResearchRecordLinks(experiment, [])).toMatchObject({ ok: true });
    expect(experiment.experiment).toMatchObject({
      schema: 'poolday.annotation_adjudication_experiment/v3',
      state: 'frozen',
      target: { catalogId: 'DECLARED-CATALOG', curatorRole: 'protein family annotation curator' },
      baseline: { actionSelection: { policyId: 'catalog-current-action-selection' } },
      outcomeBoundary: { mode: 'prospective_future', accessAtFreeze: 'not_available' },
      comparison: { pairedTasks: true, sameInputOrder: true, sameEvidenceCutoff: true },
      measurementPlan: { schema: 'poolday.adjudication_campaign_measurement_plan/v1' },
      northStarPolicy: {
        schema: 'poolday.adjudication_north_star_policy/v1',
        objective: 'median_normalized_cost_to_predeclared_independently_replicated_conclusion_relative_to_baseline',
        successAuthority: 'quality_or_effort_gate_plus_north_star_cost_only'
      },
      successPolicy: { mode: 'quality_or_effort' }
    });
    expect(experiment.experiment.contractHash).toMatch(/^sha256:[a-f0-9]{64}$/);

    const acceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'experiment-reviewer'),
      roomId: experiment.roomId,
      targetHash: experiment.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'The catalog, baseline, cohort, metrics, and evaluator were frozen before comparison.',
      confidence: 1,
      decision: 'accepted',
      createdAt: '2026-08-15T12:01:00.000Z'
    });
    await expect(createSignedAdjudicationEvaluation({
      identity: await identity('verifier', 'unfrozen-evaluator'),
      roomId: experiment.roomId,
      experiment,
      resultManifest: { accession: 'RESULTS:WRONG-AUTHORITY', version: '1', contentHash: hash('9') },
      metricResults: []
    })).rejects.toThrow('frozen evaluator identity root');
    const evaluation = await createSignedAdjudicationEvaluation({
      identity: await identity('verifier', 'experiment-evaluator'),
      roomId: experiment.roomId,
      experiment,
      resultManifest: { accession: 'RESULTS:PUBLIC-ANNOTATION-1', version: '1', contentHash: hash('7') },
      metricResults: [{
        metricId: 'adjudication_quality',
        baselineValue: 0.75,
        candidateValue: 0.82,
        effectInterval: { lower: 0.03, upper: 0.11 },
        pairedSampleCount: 24
      }, {
        metricId: 'curator_effort',
        baselineValue: 30,
        candidateValue: 29,
        effectInterval: { lower: -1, upper: 3 },
        pairedSampleCount: 24
      }, ...campaignMetricResults(24), northStarMetricResult(24)],
      northStarEvidence: northStarEvidence(),
      regressionCount: 1,
      missingCaseCount: 0,
      disagreementSummary: 'One case remained disputed by the independent evaluator.',
      failureAnalysis: 'The retained regression is bound in the result manifest.',
      createdAt: '2026-08-15T13:00:00.000Z'
    });

    expect(await verifyResearchRecord(evaluation)).toMatchObject({ ok: true });
    expect(evaluation.evaluation.schema).toBe('poolday.annotation_adjudication_evaluation/v3');
    expect(evaluation.evaluation.metricResults).toHaveLength(8);
    expect(evaluation.evaluation.metricResults.map((metric) => metric.metricId)).toEqual(expect.arrayContaining([
      'information_gain_per_action',
      'contradiction_resolution_cost',
      'duplicate_work_avoided',
      'uncertainty_calibration_error',
      'held_out_family_performance'
    ]));
    expect(validateResearchRecordLinks(evaluation, [experiment, acceptance])).toMatchObject({ ok: true });
    expect(evaluation.evaluation.northStarEvidence).toMatchObject({
      schema: 'poolday.adjudication_north_star_evidence/v1',
      reportingStatus: 'reportable',
      reportingBoundary: 'signed_evaluator_report_not_biological_truth'
    });
    expect(evaluation.evaluation.assessment).toEqual({
      mode: 'quality_or_effort',
      conclusion: 'passes',
      qualityImproved: true,
      qualityNonInferior: true,
      effortImproved: false,
      effortComparable: true,
      qualityPathPassed: true,
      effortPathPassed: false,
      qualityOrEffortPassed: true,
      northStarReportable: true,
      northStarImproved: true,
      northStarMetricId: 'cost_to_replicated_conclusion',
      operationalMetricsAffectSuccess: false
    });

    const incompleteNorthStar = await createSignedAdjudicationEvaluation({
      identity: await identity('verifier', 'experiment-evaluator'),
      roomId: experiment.roomId,
      experiment,
      resultManifest: { accession: 'RESULTS:INCOMPLETE-NORTH-STAR', version: '1', contentHash: hash('6') },
      metricResults: evaluation.evaluation.metricResults.map((metric) => ({
        metricId: metric.metricId,
        baselineValue: metric.baselineValue,
        candidateValue: metric.candidateValue,
        effectInterval: metric.effectInterval,
        pairedSampleCount: metric.pairedSampleCount
      })),
      northStarEvidence: northStarEvidence({ observed: 24, complete: false }),
      disagreementSummary: 'All paired metric summaries exist, but independent replication is incomplete.',
      failureAnalysis: 'The north-star evidence cannot support an improvement claim.',
      createdAt: '2026-08-15T13:01:00.000Z'
    });
    expect(incompleteNorthStar.evaluation.assessment).toMatchObject({
      conclusion: 'inconclusive',
      qualityOrEffortPassed: true,
      northStarReportable: false,
      northStarImproved: false,
      operationalMetricsAffectSuccess: false
    });
  });

  it('fails closed for inadequate samples and self-evaluation', async () => {
    const author = await identity('reviewer', 'shared-author');
    const input = experimentInput();
    input.evaluator.identityRootId = 'root_shared-author';
    const experiment = await createSignedAdjudicationExperiment({ identity: author, ...input });
    const acceptance = await createSignedHumanClaim({
      identity: await identity('reviewer', 'independent-reviewer'),
      roomId: experiment.roomId,
      targetHash: experiment.recordHash,
      claimKind: 'review_decision',
      relation: 'reviews',
      text: 'Freeze the comparison.',
      confidence: 1,
      decision: 'accepted'
    });
    const evaluation = await createSignedAdjudicationEvaluation({
      identity: author,
      roomId: experiment.roomId,
      experiment,
      resultManifest: { accession: 'RESULTS:UNDERPOWERED', version: '1', contentHash: hash('8') },
      metricResults: [{
        metricId: 'adjudication_quality', baselineValue: 0.75, candidateValue: 0.8,
        effectInterval: { lower: 0, upper: 0.1 }, pairedSampleCount: 8
      }, {
        metricId: 'curator_effort', baselineValue: 30, candidateValue: 25,
        effectInterval: { lower: 1, upper: 9 }, pairedSampleCount: 8
      }, ...campaignMetricResults(8), northStarMetricResult(8)],
      northStarEvidence: northStarEvidence({ observed: 8, complete: false }),
      disagreementSummary: 'The sample is below the frozen minimum.',
      failureAnalysis: 'The comparison is underpowered.',
      missingCaseCount: 16,
      createdAt: '2026-08-15T13:00:00.000Z'
    });

    expect(evaluation.evaluation.assessment.conclusion).toBe('inconclusive');
    expect(validateResearchRecordLinks(evaluation, [experiment, acceptance])).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['adjudication evaluation must be independently authored'])
    });
  });

  it('refuses to invent an unnamed catalog or movable cohort', async () => {
    const input = experimentInput();
    input.target.catalogId = '';
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'invalid-author'),
      ...input
    })).rejects.toThrow('adjudication target requires catalog');

    const movable = experimentInput();
    movable.cohort.familyDisjoint = false;
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'movable-author'),
      ...movable
    })).rejects.toThrow('family-disjoint');

    const leaked = experimentInput();
    leaked.outcomeBoundary.accessAtFreeze = 'blinded';
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'leaked-outcome-author'),
      ...leaked
    })).rejects.toThrow('outcome access at freeze');

    const movablePolicy = experimentInput();
    movablePolicy.comparison.sameEvidenceCutoff = false;
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'movable-policy-author'),
      ...movablePolicy
    })).rejects.toThrow('pair tasks, input order, and evidence cutoff');

    const collapsedMetrics = experimentInput();
    collapsedMetrics.measurementPlan.duplicateWorkAvoidedMetricId = 'information_gain_per_action';
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'collapsed-metric-author'),
      ...collapsedMetrics
    })).rejects.toThrow('measurement roles must use distinct metrics');

    const wrongDirection = experimentInput();
    wrongDirection.metrics.find((metric) => metric.id === 'uncertainty_calibration_error').direction = 'higher_is_better';
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'wrong-direction-author'),
      ...wrongDirection
    })).rejects.toThrow('uncertaintyCalibrationErrorMetricId must be lower_is_better');

    const activityAsSuccess = experimentInput();
    activityAsSuccess.northStarPolicy.operationalMetrics = ['peers', 'jobs', 'receipts', 'records', 'claims'];
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'activity-as-success-author'),
      ...activityAsSuccess
    })).rejects.toThrow('activity counter as operational');

    const hiddenFailureCost = experimentInput();
    hiddenFailureCost.northStarPolicy.costRepresentation.includeFailedAttempts = false;
    await expect(createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'hidden-failure-cost-author'),
      ...hiddenFailureCost
    })).rejects.toThrow('include failed and unresolved cases');

    const legacyExperiment = structuredClone(await createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'legacy-evaluation-author'),
      ...experimentInput()
    }));
    legacyExperiment.experiment = {
      ...legacyExperiment.experiment,
      schema: 'poolday.annotation_adjudication_experiment/v1'
    };
    await expect(createSignedAdjudicationEvaluation({
      identity: await identity('verifier', 'experiment-evaluator'),
      roomId: legacyExperiment.roomId,
      experiment: legacyExperiment,
      resultManifest: { accession: 'RESULTS:LEGACY', version: '1', contentHash: hash('7') },
      metricResults: []
    })).rejects.toThrow('current baseline-policy freeze contract');

    const historicalInput = experimentInput();
    historicalInput.outcomeBoundary = {
      ...historicalInput.outcomeBoundary,
      mode: 'historical_hidden',
      accessAtFreeze: 'blinded',
      outcomeManifestCommitmentHash: hash('7')
    };
    const historical = await createSignedAdjudicationExperiment({
      identity: await identity('researcher', 'historical-freeze-author'),
      ...historicalInput
    });
    await expect(createSignedAdjudicationEvaluation({
      identity: await identity('verifier', 'experiment-evaluator'),
      roomId: historical.roomId,
      experiment: historical,
      resultManifest: { accession: 'RESULTS:HISTORICAL', version: '1', contentHash: hash('8') },
      metricResults: [{
        metricId: 'adjudication_quality', baselineValue: 0.75, candidateValue: 0.8,
        effectInterval: { lower: 0, upper: 0.1 }, pairedSampleCount: 24
      }, {
        metricId: 'curator_effort', baselineValue: 30, candidateValue: 25,
        effectInterval: { lower: 1, upper: 9 }, pairedSampleCount: 24
      }, ...campaignMetricResults(24), northStarMetricResult(24)]
    })).rejects.toThrow('does not match the frozen outcome commitment');
  });
});
