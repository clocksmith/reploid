/** Frozen adjudication experiment contracts, metric results, and their success assessment. */
import {
  ADJUDICATION_CAMPAIGN_MEASUREMENT_PLAN_VERSION,
  ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES,
  ADJUDICATION_EXPERIMENT_VERSION,
  BASELINE_FREEZE_ADJUDICATION_EXPERIMENT_VERSION,
  LEGACY_ADJUDICATION_EXPERIMENT_VERSION,
  METRIC_DIRECTIONS
} from '../evidence-record-contract.js';
import {
  SHA256_PATTERN,
  compactText,
  normalizeTextList,
  requireHash,
  requiredInteger,
  unique,
  withContentHash
} from './primitives.js';
import {
  normalizeReferenceIdentity
} from './scientific-normalization.js';
import {
  ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION,
  ADJUDICATION_NORTH_STAR_POLICY_VERSION,
  normalizeAdjudicationNorthStarPolicy
} from '../adjudication-north-star.js';
import {
  DISCOVERY_CANDIDATE_ACTION_KINDS
} from '../discovery-candidate-action.js';

const nonNegativeNumber = (value, label) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${label} is required`);
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) throw new TypeError(`${label} must be a non-negative number`);
  return normalized;
};

const normalizeAdjudicationMetricDefinitions = (metrics = []) => {
  const normalized = (Array.isArray(metrics) ? metrics : []).slice(0, 32).map((metric, index) => {
    const direction = compactText(metric.direction, 40).toLowerCase();
    const confidenceLevel = Number(metric.confidenceLevel);
    const definition = {
      id: compactText(metric.id, 120),
      label: compactText(metric.label, 500),
      unit: compactText(metric.unit, 120),
      direction,
      measurementSource: compactText(metric.measurementSource, 1000),
      aggregationRule: compactText(metric.aggregationRule, 1000),
      validityConditions: normalizeTextList(metric.validityConditions, {
        min: 1,
        max: 32,
        itemMax: 1000,
        label: `adjudication metric ${index + 1} validity conditions`
      }),
      noiseModel: compactText(metric.noiseModel, 1000),
      minimumSampleSize: requiredInteger(metric.minimumSampleSize, `adjudication metric ${index + 1} minimum sample size`),
      confidenceLevel
    };
    if (!definition.id || !definition.label || !definition.unit
      || !METRIC_DIRECTIONS.includes(direction)
      || !definition.measurementSource || !definition.aggregationRule || !definition.noiseModel
      || !Number.isFinite(confidenceLevel) || confidenceLevel <= 0 || confidenceLevel > 1) {
      throw new TypeError(`adjudication metric ${index + 1} definition is incomplete`);
    }
    if (definition.minimumSampleSize < 2) throw new TypeError(`adjudication metric ${index + 1} minimum sample size must be at least 2`);
    return definition;
  });
  if (normalized.length < 2) throw new TypeError('adjudication experiment requires quality and effort metrics');
  if (new Set(normalized.map((metric) => metric.id)).size !== normalized.length) {
    throw new TypeError('adjudication metric ids must be unique');
  }
  return normalized;
};

export const normalizeAdjudicationExperimentContract = async (experiment = {}) => {
  const declaredSchema = compactText(experiment.schema, 120);
  if (declaredSchema
    && ![
      LEGACY_ADJUDICATION_EXPERIMENT_VERSION,
      BASELINE_FREEZE_ADJUDICATION_EXPERIMENT_VERSION,
      ADJUDICATION_EXPERIMENT_VERSION
    ].includes(declaredSchema)) {
    throw new TypeError('adjudication experiment schema is not supported');
  }
  const schema = declaredSchema || ADJUDICATION_EXPERIMENT_VERSION;
  const legacy = schema === LEGACY_ADJUDICATION_EXPERIMENT_VERSION;
  const northStarRequired = schema === ADJUDICATION_EXPERIMENT_VERSION;
  const target = {
    catalogId: compactText(experiment.target?.catalogId, 240),
    catalogVersion: compactText(experiment.target?.catalogVersion, 240),
    curatorRole: compactText(experiment.target?.curatorRole, 500),
    decision: compactText(experiment.target?.decision, 2000),
    disputedEvidencePattern: compactText(experiment.target?.disputedEvidencePattern, 2000),
    actionableOutput: compactText(experiment.target?.actionableOutput, 2000),
    adopterOrPayer: compactText(experiment.target?.adopterOrPayer, 1000)
  };
  if (Object.values(target).some((value) => !value)) {
    throw new TypeError('adjudication target requires catalog, curator role, decision, disputed evidence, output, and adopter or payer');
  }
  const baseline = {
    workflowId: compactText(experiment.baseline?.workflowId, 240),
    version: compactText(experiment.baseline?.version, 240),
    revisionHash: requireHash(experiment.baseline?.revisionHash, 'baseline workflow revisionHash'),
    description: compactText(experiment.baseline?.description, 2000),
    toolsAndHandoffs: normalizeTextList(experiment.baseline?.toolsAndHandoffs, {
      min: 1,
      max: 32,
      itemMax: 1000,
      label: 'baseline tools and handoffs'
    })
  };
  if (!baseline.workflowId || !baseline.version || !baseline.description) {
    throw new TypeError('adjudication baseline workflow id, version, and description are required');
  }
  if (!legacy) {
    const actionSelection = {
      policyId: compactText(experiment.baseline?.actionSelection?.policyId, 240),
      version: compactText(experiment.baseline?.actionSelection?.version, 240),
      artifactHash: requireHash(experiment.baseline?.actionSelection?.artifactHash, 'baseline action-selection artifactHash'),
      inputContractHash: requireHash(experiment.baseline?.actionSelection?.inputContractHash, 'baseline action-selection inputContractHash'),
      budgetContractHash: requireHash(experiment.baseline?.actionSelection?.budgetContractHash, 'baseline action-selection budgetContractHash'),
      rankingMethod: compactText(experiment.baseline?.actionSelection?.rankingMethod, 1000),
      rankingStatus: compactText(experiment.baseline?.actionSelection?.rankingStatus, 80).toLowerCase(),
      eligibleActionKinds: unique(normalizeTextList(experiment.baseline?.actionSelection?.eligibleActionKinds, {
        min: 1,
        max: DISCOVERY_CANDIDATE_ACTION_KINDS.length,
        itemMax: 80,
        label: 'baseline eligible action kinds'
      }).map((kind) => kind.toLowerCase())),
      tieBreak: normalizeTextList(experiment.baseline?.actionSelection?.tieBreak, {
        min: 1,
        max: 16,
        itemMax: 240,
        label: 'baseline action-selection tie break'
      }),
      stopRule: compactText(experiment.baseline?.actionSelection?.stopRule, 2000)
    };
    if (!actionSelection.policyId || !actionSelection.version || !actionSelection.rankingMethod
      || !['heuristic_not_calibrated', 'calibrated'].includes(actionSelection.rankingStatus)
      || !actionSelection.stopRule) {
      throw new TypeError('baseline action-selection policy identity, ranking, status, and stop rule are required');
    }
    if (actionSelection.eligibleActionKinds.some((kind) => !DISCOVERY_CANDIDATE_ACTION_KINDS.includes(kind))) {
      throw new TypeError('baseline action-selection policy contains an unsupported action kind');
    }
    baseline.actionSelection = actionSelection;
  }
  const candidate = {
    policyId: compactText(experiment.candidate?.policyId, 240),
    version: compactText(experiment.candidate?.version, 240),
    revisionHash: requireHash(experiment.candidate?.revisionHash, 'candidate policy revisionHash')
  };
  if (!candidate.policyId || !candidate.version) throw new TypeError('candidate policy id and version are required');
  const manifest = normalizeReferenceIdentity(experiment.cohort?.manifest, 'adjudication cohort manifest');
  if (!manifest.contentHash) throw new TypeError('adjudication cohort manifest requires a content hash');
  const cohort = {
    manifest,
    caseCount: requiredInteger(experiment.cohort?.caseCount, 'adjudication cohort case count'),
    familySplitHash: requireHash(experiment.cohort?.familySplitHash, 'adjudication cohort family split hash'),
    allocationHash: requireHash(experiment.cohort?.allocationHash, 'adjudication cohort allocation hash'),
    familyDisjoint: experiment.cohort?.familyDisjoint === true
  };
  if (cohort.caseCount < 2) throw new TypeError('adjudication cohort requires at least two cases');
  if (!cohort.familyDisjoint) throw new TypeError('adjudication cohort must declare a family-disjoint evaluation split');
  const evaluator = {
    authority: compactText(experiment.evaluator?.authority, 500),
    identityRootId: compactText(experiment.evaluator?.identityRootId, 500),
    methodId: compactText(experiment.evaluator?.methodId, 240),
    version: compactText(experiment.evaluator?.version, 240),
    artifactHash: requireHash(experiment.evaluator?.artifactHash, 'adjudication evaluator artifactHash'),
    blinded: experiment.evaluator?.blinded === true
  };
  if (!evaluator.authority || !evaluator.identityRootId || !evaluator.methodId || !evaluator.version || !evaluator.blinded) {
    throw new TypeError('adjudication evaluator authority, identity root, method, version, and blinding are required');
  }
  const metrics = normalizeAdjudicationMetricDefinitions(experiment.metrics);
  if (metrics.some((metric) => metric.minimumSampleSize > cohort.caseCount)) {
    throw new TypeError('adjudication metric minimum sample size exceeds the frozen cohort');
  }
  const metricIds = new Set(metrics.map((metric) => metric.id));
  let measurementPlan;
  if (!legacy) {
    measurementPlan = {
      schema: ADJUDICATION_CAMPAIGN_MEASUREMENT_PLAN_VERSION,
      ...Object.fromEntries(Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES).map((role) => [
        role,
        compactText(experiment.measurementPlan?.[role], 120)
      ]))
    };
    const campaignMetricIds = Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES)
      .map((role) => measurementPlan[role]);
    if (campaignMetricIds.some((metricId) => !metricIds.has(metricId))) {
      throw new TypeError('campaign measurement plan must map every role to a frozen metric');
    }
    if (new Set(campaignMetricIds).size !== campaignMetricIds.length) {
      throw new TypeError('campaign measurement roles must use distinct metrics');
    }
    const metricsById = new Map(metrics.map((metric) => [metric.id, metric]));
    for (const [role, direction] of Object.entries(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES)) {
      if (metricsById.get(measurementPlan[role])?.direction !== direction) {
        throw new TypeError(`campaign measurement ${role} must be ${direction}`);
      }
    }
  }
  const successPolicy = {
    mode: 'quality_or_effort',
    qualityMetricId: compactText(experiment.successPolicy?.qualityMetricId, 120),
    effortMetricId: compactText(experiment.successPolicy?.effortMetricId, 120),
    qualityImprovementThreshold: nonNegativeNumber(experiment.successPolicy?.qualityImprovementThreshold, 'quality improvement threshold'),
    qualityNonInferiorityMargin: nonNegativeNumber(experiment.successPolicy?.qualityNonInferiorityMargin, 'quality non-inferiority margin'),
    effortImprovementThreshold: nonNegativeNumber(experiment.successPolicy?.effortImprovementThreshold, 'effort improvement threshold'),
    effortComparabilityMargin: nonNegativeNumber(experiment.successPolicy?.effortComparabilityMargin, 'effort comparability margin')
  };
  if (successPolicy.qualityMetricId === successPolicy.effortMetricId
    || !metricIds.has(successPolicy.qualityMetricId)
    || !metricIds.has(successPolicy.effortMetricId)) {
    throw new TypeError('adjudication success policy requires distinct declared quality and effort metrics');
  }
  if (!legacy) {
    const distinctTradeoffIds = new Set([
      successPolicy.qualityMetricId,
      successPolicy.effortMetricId,
      ...Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES).map((role) => measurementPlan[role]),
      ...(northStarRequired ? [compactText(experiment.northStarPolicy?.costToReplicatedConclusionMetricId, 120)] : [])
    ]);
    const requiredDistinctMetrics = 2 + Object.keys(ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES).length
      + (northStarRequired ? 1 : 0);
    if (distinctTradeoffIds.size !== requiredDistinctMetrics) {
      throw new TypeError('quality, effort, campaign, and north-star measurement roles must remain a distinct tradeoff vector');
    }
  }
  const northStarPolicy = northStarRequired
    ? await normalizeAdjudicationNorthStarPolicy(experiment.northStarPolicy, {
      metricDefinitions: metrics,
      cohortCaseCount: cohort.caseCount
    })
    : null;
  const resolution = {
    acceptanceRule: compactText(experiment.resolution?.acceptanceRule, 2000),
    rejectionRule: compactText(experiment.resolution?.rejectionRule, 2000),
    reopeningRule: compactText(experiment.resolution?.reopeningRule, 2000)
  };
  if (Object.values(resolution).some((value) => !value)) {
    throw new TypeError('adjudication acceptance, rejection, and reopening rules are required');
  }
  const frozenAt = compactText(experiment.frozenAt, 64);
  if (!Number.isFinite(Date.parse(frozenAt))) throw new TypeError('adjudication experiment frozenAt must be an ISO timestamp');
  let outcomeBoundary;
  let comparison;
  if (!legacy) {
    const mode = compactText(experiment.outcomeBoundary?.mode, 80).toLowerCase();
    const accessAtFreeze = compactText(experiment.outcomeBoundary?.accessAtFreeze, 80).toLowerCase();
    const evidenceCutoffAt = compactText(experiment.outcomeBoundary?.evidenceCutoffAt, 64);
    const commitment = compactText(experiment.outcomeBoundary?.outcomeManifestCommitmentHash, 160);
    if (!['historical_hidden', 'prospective_future'].includes(mode)) {
      throw new TypeError('outcome boundary mode must be historical_hidden or prospective_future');
    }
    if ((mode === 'historical_hidden' && accessAtFreeze !== 'blinded')
      || (mode === 'prospective_future' && accessAtFreeze !== 'not_available')) {
      throw new TypeError('outcome access at freeze does not match the declared boundary mode');
    }
    if (!Number.isFinite(Date.parse(evidenceCutoffAt)) || Date.parse(evidenceCutoffAt) > Date.parse(frozenAt)) {
      throw new TypeError('outcome evidence cutoff must be an ISO timestamp no later than the freeze');
    }
    if (mode === 'historical_hidden' && !SHA256_PATTERN.test(commitment)) {
      throw new TypeError('historical hidden outcomes require a committed outcome manifest hash');
    }
    if (mode === 'prospective_future' && commitment) {
      throw new TypeError('prospective future outcomes cannot declare an existing outcome manifest commitment');
    }
    outcomeBoundary = {
      mode,
      accessAtFreeze,
      evidenceCutoffAt,
      outcomeManifestCommitmentHash: commitment || null,
      revealRule: compactText(experiment.outcomeBoundary?.revealRule, 2000),
      contaminationAuditMethod: compactText(experiment.outcomeBoundary?.contaminationAuditMethod, 1000),
      contaminationAuditArtifactHash: requireHash(
        experiment.outcomeBoundary?.contaminationAuditArtifactHash,
        'outcome contamination-audit artifactHash'
      )
    };
    if (!outcomeBoundary.revealRule || !outcomeBoundary.contaminationAuditMethod) {
      throw new TypeError('outcome reveal rule and contamination audit method are required');
    }
    comparison = {
      pairedTasks: experiment.comparison?.pairedTasks === true,
      sameInputOrder: experiment.comparison?.sameInputOrder === true,
      sameEvidenceCutoff: experiment.comparison?.sameEvidenceCutoff === true,
      resourceBudgetHash: requireHash(experiment.comparison?.resourceBudgetHash, 'comparison resourceBudgetHash'),
      failurePolicyHash: requireHash(experiment.comparison?.failurePolicyHash, 'comparison failurePolicyHash'),
      timeoutPolicyHash: requireHash(experiment.comparison?.timeoutPolicyHash, 'comparison timeoutPolicyHash'),
      seedManifestHash: requireHash(experiment.comparison?.seedManifestHash, 'comparison seedManifestHash')
    };
    if (!comparison.pairedTasks || !comparison.sameInputOrder || !comparison.sameEvidenceCutoff) {
      throw new TypeError('adjudication comparison must pair tasks, input order, and evidence cutoff');
    }
  }
  const normalized = {
    schema,
    state: 'frozen',
    target,
    baseline,
    candidate,
    cohort,
    ...(!legacy ? { outcomeBoundary, comparison } : {}),
    evaluator,
    metrics,
    ...(!legacy ? { measurementPlan } : {}),
    ...(northStarPolicy ? { northStarPolicy } : {}),
    successPolicy,
    resolution,
    frozenAt
  };
  return withContentHash(normalized, 'contractHash');
};

export const adjudicationMetricResult = (definition, result = {}, index = 0) => {
  for (const [value, label] of [
    [result.baselineValue, 'baseline value'],
    [result.candidateValue, 'candidate value'],
    [result.effectInterval?.lower, 'effect interval lower bound'],
    [result.effectInterval?.upper, 'effect interval upper bound']
  ]) {
    if (value === null || value === undefined || String(value).trim() === '') {
      throw new TypeError(`adjudication metric result ${index + 1} ${label} is required`);
    }
  }
  const baselineValue = Number(result.baselineValue);
  const candidateValue = Number(result.candidateValue);
  const pairedSampleCount = requiredInteger(result.pairedSampleCount, `adjudication metric result ${index + 1} paired sample count`);
  const lower = Number(result.effectInterval?.lower);
  const upper = Number(result.effectInterval?.upper);
  if (!Number.isFinite(baselineValue) || !Number.isFinite(candidateValue)
    || !Number.isFinite(lower) || !Number.isFinite(upper) || lower > upper) {
    throw new TypeError(`adjudication metric result ${index + 1} values or effect interval are invalid`);
  }
  const effect = definition.direction === 'higher_is_better'
    ? candidateValue - baselineValue
    : baselineValue - candidateValue;
  if (effect < lower || effect > upper) throw new TypeError(`adjudication metric result ${index + 1} effect is outside its interval`);
  return {
    metricId: definition.id,
    direction: definition.direction,
    baselineValue,
    candidateValue,
    orientedEffect: effect,
    effectInterval: { lower, upper },
    pairedSampleCount,
    minimumSampleSize: definition.minimumSampleSize,
    confidenceLevel: definition.confidenceLevel,
    sampleAdequate: pairedSampleCount >= definition.minimumSampleSize
  };
};

export const assessAdjudicationExperiment = (experiment, metricResults, northStarEvidence = null) => {
  const byId = new Map(metricResults.map((metric) => [metric.metricId, metric]));
  const policy = experiment.successPolicy;
  const quality = byId.get(policy.qualityMetricId);
  const effort = byId.get(policy.effortMetricId);
  const evaluable = Boolean(quality?.sampleAdequate && effort?.sampleAdequate);
  const qualityImproved = evaluable && quality.effectInterval.lower >= policy.qualityImprovementThreshold;
  const qualityNonInferior = evaluable && quality.effectInterval.lower >= -policy.qualityNonInferiorityMargin;
  const effortImproved = evaluable && effort.effectInterval.lower >= policy.effortImprovementThreshold;
  const effortComparable = evaluable && effort.effectInterval.lower >= -policy.effortComparabilityMargin;
  const qualityPathPassed = qualityImproved && effortComparable;
  const effortPathPassed = effortImproved && qualityNonInferior;
  const baseAssessment = {
    mode: policy.mode,
    conclusion: !evaluable ? 'inconclusive' : qualityPathPassed || effortPathPassed ? 'passes' : 'fails',
    qualityImproved,
    qualityNonInferior,
    effortImproved,
    effortComparable,
    qualityPathPassed,
    effortPathPassed
  };
  if (experiment.northStarPolicy?.schema !== ADJUDICATION_NORTH_STAR_POLICY_VERSION) {
    return baseAssessment;
  }
  const northStarMetric = byId.get(experiment.northStarPolicy.costToReplicatedConclusionMetricId);
  const northStarReportable = northStarEvidence?.schema === ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION
    && northStarEvidence.reportingStatus === 'reportable';
  const northStarImproved = northStarReportable
    && northStarMetric?.sampleAdequate === true
    && northStarMetric.effectInterval.lower
      >= experiment.northStarPolicy.aggregation.minimumImprovementThreshold;
  const qualityOrEffortPassed = qualityPathPassed || effortPathPassed;
  return {
    ...baseAssessment,
    conclusion: !evaluable || !northStarReportable || !northStarMetric?.sampleAdequate
      ? 'inconclusive'
      : qualityOrEffortPassed && northStarImproved ? 'passes' : 'fails',
    qualityOrEffortPassed,
    northStarReportable,
    northStarImproved,
    northStarMetricId: experiment.northStarPolicy.costToReplicatedConclusionMetricId,
    operationalMetricsAffectSuccess: false
  };
};
