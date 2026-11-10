/**
 * @fileoverview Signed adjudication experiments and their evaluations from lifecycle forms.
 * The experiment freezes baseline, candidate, cohort, metrics and north star before outcomes.
 */
import { createSignedAdjudicationEvaluation, createSignedAdjudicationExperiment } from '../../pool/evidence-network.js';
import { commaList } from './research-form-values.js';

const adjudicationExperimentRecord = (values, { researcher, roomId }) => {
  const metricPrefixes = [
    'quality',
    'effort',
    'informationGain',
    'contradictionCost',
    'duplicateWork',
    'uncertaintyCalibration',
    'heldOutFamily',
    'northStar'
  ];
  return createSignedAdjudicationExperiment({
    identity: researcher,
    roomId,
    target: {
      catalogId: values.get('catalogId'),
      catalogVersion: values.get('catalogVersion'),
      curatorRole: values.get('curatorRole'),
      decision: values.get('adjudicationDecision'),
      disputedEvidencePattern: values.get('disputedEvidencePattern'),
      actionableOutput: values.get('actionableOutput'),
      adopterOrPayer: values.get('adopterOrPayer')
    },
    baseline: {
      workflowId: values.get('baselineWorkflowId'),
      version: values.get('baselineVersion'),
      revisionHash: values.get('baselineRevisionHash'),
      description: values.get('baselineDescription'),
      toolsAndHandoffs: commaList(values.get('baselineTools')),
      actionSelection: {
        policyId: values.get('baselinePolicyId'),
        version: values.get('baselinePolicyVersion'),
        artifactHash: values.get('baselinePolicyArtifactHash'),
        inputContractHash: values.get('baselineInputContractHash'),
        budgetContractHash: values.get('baselineBudgetContractHash'),
        rankingMethod: values.get('baselineRankingMethod'),
        rankingStatus: values.get('baselineRankingStatus'),
        eligibleActionKinds: commaList(values.get('baselineEligibleActionKinds')),
        tieBreak: commaList(values.get('baselineTieBreak')),
        stopRule: values.get('baselineStopRule')
      }
    },
    candidate: {
      policyId: values.get('candidatePolicyId'),
      version: values.get('candidateVersion'),
      revisionHash: values.get('candidateRevisionHash')
    },
    cohort: {
      manifest: {
        accession: values.get('cohortAccession'),
        version: values.get('cohortVersion'),
        contentHash: values.get('cohortContentHash')
      },
      caseCount: values.get('cohortCaseCount'),
      familySplitHash: values.get('familySplitHash'),
      allocationHash: values.get('allocationHash'),
      familyDisjoint: values.get('familyDisjoint') === 'on'
    },
    outcomeBoundary: {
      mode: values.get('outcomeBoundaryMode'),
      accessAtFreeze: values.get('outcomeBoundaryMode') === 'historical_hidden' ? 'blinded' : 'not_available',
      evidenceCutoffAt: values.get('outcomeEvidenceCutoffAt'),
      outcomeManifestCommitmentHash: values.get('outcomeManifestCommitmentHash'),
      revealRule: values.get('outcomeRevealRule'),
      contaminationAuditMethod: values.get('contaminationAuditMethod'),
      contaminationAuditArtifactHash: values.get('contaminationAuditArtifactHash')
    },
    comparison: {
      pairedTasks: values.get('pairedTasks') === 'on',
      sameInputOrder: values.get('sameInputOrder') === 'on',
      sameEvidenceCutoff: values.get('sameEvidenceCutoff') === 'on',
      resourceBudgetHash: values.get('comparisonResourceBudgetHash'),
      failurePolicyHash: values.get('comparisonFailurePolicyHash'),
      timeoutPolicyHash: values.get('comparisonTimeoutPolicyHash'),
      seedManifestHash: values.get('comparisonSeedManifestHash')
    },
    evaluator: {
      authority: values.get('evaluatorAuthority'),
      identityRootId: values.get('evaluatorIdentityRootId'),
      methodId: values.get('evaluatorMethodId'),
      version: values.get('evaluatorVersion'),
      artifactHash: values.get('evaluatorArtifactHash'),
      blinded: values.get('evaluatorBlinded') === 'on'
    },
    metrics: metricPrefixes.map((prefix) => ({
      id: values.get(`${prefix}MetricId`),
      label: values.get(`${prefix}MetricLabel`),
      unit: values.get(`${prefix}MetricUnit`),
      direction: values.get(`${prefix}Direction`),
      measurementSource: values.get(`${prefix}MeasurementSource`),
      aggregationRule: values.get(`${prefix}AggregationRule`),
      validityConditions: commaList(values.get(`${prefix}ValidityConditions`)),
      noiseModel: values.get(`${prefix}NoiseModel`),
      minimumSampleSize: values.get(`${prefix}MinimumSample`),
      confidenceLevel: values.get(`${prefix}ConfidenceLevel`)
    })),
    measurementPlan: {
      informationGainPerActionMetricId: values.get('informationGainMetricId'),
      contradictionResolutionCostMetricId: values.get('contradictionCostMetricId'),
      duplicateWorkAvoidedMetricId: values.get('duplicateWorkMetricId'),
      uncertaintyCalibrationErrorMetricId: values.get('uncertaintyCalibrationMetricId'),
      heldOutFamilyPerformanceMetricId: values.get('heldOutFamilyMetricId')
    },
    northStarPolicy: {
      costToReplicatedConclusionMetricId: values.get('northStarMetricId'),
      costRepresentation: {
        componentIds: ['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime'],
        rawAmountsRemainInOriginalUnits: values.get('rawCostUnitsPreserved') === 'on',
        normalizedUnit: values.get('northStarMetricUnit'),
        conversionPolicy: {
          policyId: values.get('costConversionPolicyId'),
          version: values.get('costConversionPolicyVersion'),
          artifactHash: values.get('costConversionArtifactHash')
        },
        includeFailedAttempts: values.get('failedAttemptsIncluded') === 'on',
        includeUnresolvedCases: values.get('unresolvedCasesIncluded') === 'on',
        stopRule: values.get('northStarCostStopRule')
      },
      conclusionCriteria: {
        policyId: values.get('conclusionPolicyId'),
        version: values.get('conclusionPolicyVersion'),
        artifactHash: values.get('conclusionPolicyArtifactHash'),
        decisionStates: ['retain', 'revise', 'reject', 'unresolved'],
        frozenBeforeActions: values.get('conclusionFrozenBeforeActions') === 'on',
        independentAcceptanceRequired: values.get('conclusionIndependentAcceptance') === 'on',
        independentReplicationRequired: values.get('conclusionIndependentReplication') === 'on',
        minimumIndependentReplications: values.get('minimumIndependentReplications')
      },
      independenceCriteria: {
        policyId: values.get('independencePolicyId'),
        version: values.get('independencePolicyVersion'),
        artifactHash: values.get('independencePolicyArtifactHash'),
        requiredDimensions: commaList(values.get('northStarIndependenceDimensions')),
        evaluatorExcludedFromCaseEvidence: values.get('evaluatorExcludedFromCaseEvidence') === 'on'
      },
      aggregation: {
        intervalMethod: values.get('northStarIntervalMethod'),
        minimumPairedCases: values.get('northStarMinimumPairedCases'),
        confidenceLevel: values.get('northStarAggregationConfidence'),
        minimumImprovementThreshold: values.get('northStarMinimumImprovement')
      },
      operationalMetrics: ['peers', 'jobs', 'receipts', 'records', 'claims', 'total_compute']
    },
    successPolicy: {
      qualityMetricId: values.get('qualityMetricId'),
      effortMetricId: values.get('effortMetricId'),
      qualityImprovementThreshold: values.get('qualityImprovementThreshold'),
      qualityNonInferiorityMargin: values.get('qualityNonInferiorityMargin'),
      effortImprovementThreshold: values.get('effortImprovementThreshold'),
      effortComparabilityMargin: values.get('effortComparabilityMargin')
    },
    resolution: {
      acceptanceRule: values.get('experimentAcceptanceRule'),
      rejectionRule: values.get('experimentRejectionRule'),
      reopeningRule: values.get('experimentReopeningRule')
    }
  });
};

const adjudicationEvaluationRecord = (values, { researcher, roomId, byHash }) => {
  const experiment = byHash.get(values.get('adjudicationExperimentHash'));
  if (experiment?.kind !== 'research_adjudication_experiment') throw new Error('Selected adjudication experiment is unavailable');
  const policy = experiment.experiment.successPolicy;
  const measurementPlan = experiment.experiment.measurementPlan;
  const metricResults = [
    [policy.qualityMetricId, 'quality'],
    [policy.effortMetricId, 'effort'],
    [measurementPlan.informationGainPerActionMetricId, 'informationGain'],
    [measurementPlan.contradictionResolutionCostMetricId, 'contradictionCost'],
    [measurementPlan.duplicateWorkAvoidedMetricId, 'duplicateWork'],
    [measurementPlan.uncertaintyCalibrationErrorMetricId, 'uncertaintyCalibration'],
    [measurementPlan.heldOutFamilyPerformanceMetricId, 'heldOutFamily'],
    [experiment.experiment.northStarPolicy.costToReplicatedConclusionMetricId, 'northStar']
  ].map(([metricId, prefix]) => ({
    metricId,
    baselineValue: values.get(`${prefix}BaselineValue`),
    candidateValue: values.get(`${prefix}CandidateValue`),
    effectInterval: {
      lower: values.get(`${prefix}EffectLower`),
      upper: values.get(`${prefix}EffectUpper`)
    },
    pairedSampleCount: values.get('pairedSampleCount')
  }));
  return createSignedAdjudicationEvaluation({
    identity: researcher,
    roomId,
    experiment,
    resultManifest: {
      accession: values.get('resultManifestAccession'),
      version: values.get('resultManifestVersion'),
      contentHash: values.get('resultManifestHash')
    },
    metricResults,
    northStarEvidence: {
      caseEvidenceManifestHash: values.get('northStarCaseEvidenceManifestHash'),
      rawCostObservationManifestHash: values.get('northStarRawCostManifestHash'),
      conclusionAuditManifestHash: values.get('northStarConclusionAuditHash'),
      independenceAuditManifestHash: values.get('northStarIndependenceAuditHash'),
      conversionAuditArtifactHash: values.get('northStarConversionAuditHash'),
      baseline: {
        observedCaseCount: values.get('northStarBaselineObservedCases'),
        independentlyReplicatedConclusionCount: values.get('northStarBaselineReplicatedCases')
      },
      candidate: {
        observedCaseCount: values.get('northStarCandidateObservedCases'),
        independentlyReplicatedConclusionCount: values.get('northStarCandidateReplicatedCases')
      },
      allFrozenCasesIncluded: values.get('northStarAllCasesIncluded') === 'on',
      realWorldObserved: values.get('northStarRealWorldObserved') === 'on',
      criteriaAppliedBeforeOutcomeAccess: values.get('northStarCriteriaPredatedOutcomes') === 'on',
      operationalMetricsExcludedFromSuccess: values.get('northStarOperationalMetricsExcluded') === 'on'
    },
    regressionCount: values.get('adjudicationRegressionCount'),
    missingCaseCount: values.get('adjudicationMissingCaseCount'),
    disagreementSummary: values.get('adjudicationDisagreementSummary'),
    failureAnalysis: values.get('adjudicationFailureAnalysis')
  });
};

export const adjudicationRecordBuilders = Object.freeze({
  'adjudication-experiment': adjudicationExperimentRecord,
  'adjudication-evaluation': adjudicationEvaluationRecord
});
