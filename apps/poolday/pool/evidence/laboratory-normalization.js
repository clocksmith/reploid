/** Resolution criteria, governed work orders, laboratory capability claims, and execution context. */
import {
  EXPERIMENTAL_EXECUTION_CONTEXT_VERSION,
  LABORATORY_AVAILABILITY_STATUSES,
  LABORATORY_CAPABILITY_CLAIM_VERSION,
  LABORATORY_PROTOCOL_CUSTODY_ROLES,
  REPLICATION_INDEPENDENCE_DIMENSIONS,
  RESEARCH_FAILURE_CATEGORIES,
  RESEARCH_RESOLUTION_POLICY_VERSION,
  RESEARCH_WORK_KINDS,
  RESEARCH_WORK_ORDER_CONTRACT_VERSION,
  RESOLUTION_REOPEN_TRIGGERS,
  RESOLUTION_UNCERTAINTY_TRIGGERS
} from '../evidence-record-contract.js';
import {
  SHA256_PATTERN,
  compactText,
  normalizeTextList,
  requireHash,
  sameStringSet,
  withContentHash
} from './primitives.js';
import {
  normalizeAnalysisIdentity,
  normalizeAssayProtocol
} from './scientific-normalization.js';

const resolutionCount = (value, label, { min = 0, max = 100 } = {}) => {
  const count = Number(value);
  if (!Number.isInteger(count) || count < min || count > max) {
    throw new TypeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return count;
};

const normalizeResolutionOutcomeRule = (rule = {}, label) => {
  const outcomeClassifications = normalizeTextList(rule.outcomeClassifications, {
    min: 1, max: 2, itemMax: 40, label: `${label} outcome classifications`
  }).map((entry) => entry.toLowerCase());
  if (new Set(outcomeClassifications).size !== outcomeClassifications.length
    || outcomeClassifications.some((entry) => !['positive', 'negative'].includes(entry))) {
    throw new TypeError(`${label} outcome classifications must be unique positive or negative values`);
  }
  const uncertainty = {
    methodId: compactText(rule.uncertainty?.methodId, 240),
    version: compactText(rule.uncertainty?.version, 120),
    metricId: compactText(rule.uncertainty?.metricId, 240),
    maximumValue: Number(rule.uncertainty?.maximumValue),
    unit: compactText(rule.uncertainty?.unit, 120)
  };
  if (!uncertainty.methodId || !uncertainty.version || !uncertainty.metricId
    || !Number.isFinite(uncertainty.maximumValue) || uncertainty.maximumValue < 0 || !uncertainty.unit) {
    throw new TypeError(`${label} requires a versioned non-negative uncertainty threshold`);
  }
  return {
    outcomeClassifications,
    minimumAcceptedCompletedOutcomes: resolutionCount(
      rule.minimumAcceptedCompletedOutcomes,
      `${label} minimum accepted completed outcomes`,
      { min: 1 }
    ),
    minimumIndependentReplications: resolutionCount(
      rule.minimumIndependentReplications,
      `${label} minimum independent replications`
    ),
    maximumAmbiguousOutcomes: resolutionCount(
      rule.maximumAmbiguousOutcomes,
      `${label} maximum ambiguous outcomes`
    ),
    requiredDistinctReviewerIdentities: resolutionCount(
      rule.requiredDistinctReviewerIdentities,
      `${label} required distinct reviewer identities`,
      { min: 1 }
    ),
    requiredControlStatus: 'passed',
    uncertainty
  };
};

export const normalizeResearchResolutionPolicy = async (policy = {}) => {
  const provisionalAcceptance = normalizeResolutionOutcomeRule(policy.provisionalAcceptance, 'provisional acceptance');
  const rejection = normalizeResolutionOutcomeRule(policy.rejection, 'rejection');
  if (provisionalAcceptance.outcomeClassifications.some((value) => rejection.outcomeClassifications.includes(value))) {
    throw new TypeError('provisional acceptance and rejection outcome classifications must be disjoint');
  }
  const continuedUncertaintyTriggers = normalizeTextList(policy.continuedUncertainty?.triggers, {
    min: 1,
    max: RESOLUTION_UNCERTAINTY_TRIGGERS.length,
    itemMax: 80,
    label: 'continued uncertainty triggers'
  }).map((entry) => entry.toLowerCase());
  if (new Set(continuedUncertaintyTriggers).size !== continuedUncertaintyTriggers.length
    || continuedUncertaintyTriggers.some((trigger) => !RESOLUTION_UNCERTAINTY_TRIGGERS.includes(trigger))) {
    throw new TypeError('continued uncertainty triggers must be unique supported values');
  }
  const reopeningTriggers = normalizeTextList(policy.reopening?.triggers, {
    min: RESOLUTION_REOPEN_TRIGGERS.length,
    max: RESOLUTION_REOPEN_TRIGGERS.length,
    itemMax: 80,
    label: 'resolution reopening triggers'
  }).map((entry) => entry.toLowerCase());
  if (!sameStringSet(reopeningTriggers, RESOLUTION_REOPEN_TRIGGERS)) {
    throw new TypeError('resolution reopening criteria must include every mandatory trigger');
  }
  const closure = {
    minimumAcceptedCompletedOutcomes: resolutionCount(
      policy.closure?.minimumAcceptedCompletedOutcomes,
      'closure minimum accepted completed outcomes',
      { min: provisionalAcceptance.minimumAcceptedCompletedOutcomes }
    ),
    minimumIndependentReplications: resolutionCount(
      policy.closure?.minimumIndependentReplications,
      'closure minimum independent replications',
      { min: provisionalAcceptance.minimumIndependentReplications }
    ),
    maximumAmbiguousOutcomes: resolutionCount(
      policy.closure?.maximumAmbiguousOutcomes,
      'closure maximum ambiguous outcomes'
    ),
    requiredDistinctReviewerIdentities: resolutionCount(
      policy.closure?.requiredDistinctReviewerIdentities,
      'closure required distinct reviewer identities',
      { min: Math.max(2, provisionalAcceptance.requiredDistinctReviewerIdentities) }
    ),
    requireAllControlsPassed: policy.closure?.requireAllControlsPassed === true,
    requireNoDisputedReviews: policy.closure?.requireNoDisputedReviews === true,
    requireNoActiveContradictions: policy.closure?.requireNoActiveContradictions === true,
    authority: 'separate_human_closure_checkpoint_required',
    implementationStatus: 'criteria_only_closure_not_implemented'
  };
  if (!closure.requireAllControlsPassed || !closure.requireNoDisputedReviews || !closure.requireNoActiveContradictions) {
    throw new TypeError('closure criteria must require passed controls and no disputed reviews or active contradictions');
  }
  const normalized = {
    schema: RESEARCH_RESOLUTION_POLICY_VERSION,
    state: 'frozen_criteria',
    targetHypothesisHash: requireHash(policy.targetHypothesisHash, 'resolution targetHypothesisHash'),
    conclusionLabel: compactText(policy.conclusionLabel, 500),
    decisionScope: compactText(policy.decisionScope, 2000),
    frozenAt: compactText(policy.frozenAt, 64),
    provisionalAcceptance,
    continuedUncertainty: { triggers: continuedUncertaintyTriggers, state: 'continue_investigation' },
    rejection,
    reopening: { triggers: reopeningTriggers, effect: 'reopen_without_erasing_prior_decision' },
    closure
  };
  if (!normalized.conclusionLabel || !normalized.decisionScope || !Number.isFinite(Date.parse(normalized.frozenAt))) {
    throw new TypeError('resolution conclusion label, decision scope, and frozenAt are required');
  }
  return withContentHash(normalized, 'criteriaHash');
};

export const normalizeResearchWorkOrderContract = async ({
  workKind,
  title,
  protocol,
  replicaTarget,
  blindness,
  feasibility,
  analysis,
  failureCategories,
  custody,
  publication,
  replication,
  scopeBoundary
} = {}) => {
  const kind = compactText(workKind, 40).toLowerCase();
  if (!RESEARCH_WORK_KINDS.includes(kind)) throw new TypeError('research work kind is not supported');
  const normalizedTitle = compactText(title, 500);
  if (!normalizedTitle) throw new TypeError('work order title is required');
  const replicas = Number(replicaTarget);
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 100) {
    throw new TypeError('replicaTarget must be an integer from 1 to 100');
  }
  const allocationHash = compactText(blindness?.allocationHash, 160);
  if (blindness?.required !== false && !SHA256_PATTERN.test(allocationHash)) {
    throw new TypeError('blinded work requires an allocationHash');
  }
  const normalizedProtocol = await normalizeAssayProtocol(protocol);
  const plannedAnalysis = await normalizeAnalysisIdentity(analysis);
  if (!plannedAnalysis.artifactHash || !plannedAnalysis.parametersHash) {
    throw new TypeError('work order analysis requires exact artifactHash and parametersHash identities');
  }
  const allowedFailureCategories = normalizeTextList(failureCategories, {
    min: 1, max: RESEARCH_FAILURE_CATEGORIES.length - 1, itemMax: 80, label: 'work order failure categories'
  }).map((entry) => entry.toLowerCase());
  if (allowedFailureCategories.includes('none')
    || allowedFailureCategories.some((entry) => !RESEARCH_FAILURE_CATEGORIES.includes(entry))) {
    throw new TypeError('work order failure categories must be supported named failures');
  }
  const custodyPlan = {
    planId: compactText(custody?.planId, 240),
    version: compactText(custody?.version, 120),
    artifactHash: requireHash(custody?.artifactHash, 'work order custody artifactHash'),
    protocolHash: normalizedProtocol.protocolHash,
    requiredRoles: normalizeTextList(custody?.requiredRoles, {
      min: 1, max: LABORATORY_PROTOCOL_CUSTODY_ROLES.length, itemMax: 80, label: 'work order custody roles'
    }).map((entry) => entry.toLowerCase()),
    materialsPolicy: compactText(custody?.materialsPolicy, 1000),
    samplesPolicy: compactText(custody?.samplesPolicy, 1000),
    instrumentsPolicy: compactText(custody?.instrumentsPolicy, 1000)
  };
  if (!custodyPlan.planId || !custodyPlan.version
    || custodyPlan.requiredRoles.some((role) => !LABORATORY_PROTOCOL_CUSTODY_ROLES.includes(role))
    || !custodyPlan.materialsPolicy || !custodyPlan.samplesPolicy || !custodyPlan.instrumentsPolicy) {
    throw new TypeError('work order custody plan, roles, and material, sample, and instrument policies are required');
  }
  const publicationScope = {
    scope: compactText(publication?.scope, 80).toLowerCase(),
    license: compactText(publication?.license, 240),
    publishLaboratoryIdentity: publication?.publishLaboratoryIdentity === true,
    publishQualification: publication?.publishQualification === true,
    publishProtocol: publication?.publishProtocol === true,
    publishRawObservations: publication?.publishRawObservations === true,
    publishFailures: publication?.publishFailures === true
  };
  if (publicationScope.scope !== 'public_complete_record'
    || !publicationScope.license
    || Object.entries(publicationScope).some(([key, value]) => key.startsWith('publish') && value !== true)) {
    throw new TypeError('work order publication must cover the public laboratory, qualification, protocol, raw observations, and failures');
  }
  const requiredDimensions = normalizeTextList(replication?.requiredIndependentDimensions, {
    min: 2,
    max: REPLICATION_INDEPENDENCE_DIMENSIONS.length,
    itemMax: 80,
    label: 'replication independence dimensions'
  }).map((entry) => entry.toLowerCase());
  if (new Set(requiredDimensions).size !== requiredDimensions.length
    || !requiredDimensions.includes('operator_identity')
    || requiredDimensions.some((dimension) => !REPLICATION_INDEPENDENCE_DIMENSIONS.includes(dimension))) {
    throw new TypeError('replication plan requires unique supported dimensions including operator_identity and at least one additional dimension');
  }
  const replicationPlan = {
    requiredIndependentDimensions: requiredDimensions,
    comparisonRule: 'all_declared_dimensions_must_differ',
    sameProtocolRequired: true,
    sameAnalysisRequired: true
  };
  const boundedScope = {
    biologicalInterpretation: compactText(scopeBoundary?.biologicalInterpretation, 120).toLowerCase(),
    medicalUse: compactText(scopeBoundary?.medicalUse, 80).toLowerCase(),
    protocolSafetyClassification: compactText(scopeBoundary?.protocolSafetyClassification, 160).toLowerCase(),
    sampleScope: compactText(scopeBoundary?.sampleScope, 160).toLowerCase(),
    privateSamples: compactText(scopeBoundary?.privateSamples, 80).toLowerCase(),
    laboratoryAuthority: compactText(scopeBoundary?.laboratoryAuthority, 80).toLowerCase(),
    safetyReview: compactText(scopeBoundary?.safetyReview, 120).toLowerCase()
  };
  const requiredScope = {
    biologicalInterpretation: 'evidence_only_no_interpretation_authority',
    medicalUse: 'prohibited',
    protocolSafetyClassification: 'public_non_pathogenic_non_clinical',
    sampleScope: 'explicitly_public_synthetic_or_public_reference_only',
    privateSamples: 'prohibited',
    laboratoryAuthority: 'none',
    safetyReview: 'independent_human_required_before_execution'
  };
  if (JSON.stringify(boundedScope) !== JSON.stringify(requiredScope)) {
    throw new TypeError('work order scope must prohibit biological interpretation authority, medical use, unsafe protocols, private samples, and laboratory authority');
  }
  const normalizedFeasibility = {
    resources: compactText(feasibility?.resources, 2000),
    biosafety: compactText(feasibility?.biosafety, 1000),
    limitations: compactText(feasibility?.limitations, 2000)
  };
  if (!normalizedFeasibility.resources || !normalizedFeasibility.biosafety || !normalizedFeasibility.limitations) {
    throw new TypeError('work order resources, public non-clinical biosafety declaration, and limitations are required');
  }
  const normalized = {
    schema: RESEARCH_WORK_ORDER_CONTRACT_VERSION,
    kind,
    title: normalizedTitle,
    status: 'proposed',
    allocationState: 'unallocated',
    allocationGate: 'independent_acceptance_and_qualified_claim',
    protocol: normalizedProtocol,
    replicaTarget: replicas,
    blindness: {
      required: blindness?.required !== false,
      allocationHash: allocationHash || null,
      revealRule: compactText(blindness?.revealRule, 1000) || 'Reveal only after all planned outcomes are signed.'
    },
    feasibility: normalizedFeasibility,
    plannedAnalysis,
    allowedFailureCategories,
    custody: custodyPlan,
    publication: publicationScope,
    replication: replicationPlan,
    scopeBoundary: boundedScope
  };
  return withContentHash(normalized, 'contractHash');
};

export const normalizeExperimentalExecutionContext = (executionContext = {}) => ({
  schema: EXPERIMENTAL_EXECUTION_CONTEXT_VERSION,
  institutionIdentityHash: requireHash(executionContext.institutionIdentityHash, 'outcome institutionIdentityHash'),
  instrumentIdentityHash: requireHash(executionContext.instrumentIdentityHash, 'outcome instrumentIdentityHash'),
  sampleBatchHash: requireHash(executionContext.sampleBatchHash, 'outcome sampleBatchHash'),
  preparationBatchHash: requireHash(executionContext.preparationBatchHash, 'outcome preparationBatchHash'),
  analysisExecutionHash: requireHash(executionContext.analysisExecutionHash, 'outcome analysisExecutionHash')
});

export const normalizeLaboratoryCapabilityClaim = async ({
  laboratory,
  capabilityClaims,
  protocolCustody,
  safety,
  availability,
  consent,
  conflictDisclosure,
  createdAt
} = {}) => {
  const lab = {
    id: compactText(laboratory?.id, 240),
    name: compactText(laboratory?.name, 500),
    institution: compactText(laboratory?.institution, 500),
    institutionIdentityHash: requireHash(laboratory?.institutionIdentityHash, 'laboratory institutionIdentityHash'),
    ror: compactText(laboratory?.ror, 500)
  };
  if (!lab.id || !lab.name || !lab.institution) {
    throw new TypeError('laboratory id, name, and institution are required');
  }
  const capabilities = (Array.isArray(capabilityClaims) ? capabilityClaims : []).slice(0, 32).map((entry, index) => {
    const capability = {
      id: compactText(entry?.id, 240),
      version: compactText(entry?.version, 120),
      evidenceHash: requireHash(entry?.evidenceHash, `laboratory capability ${index + 1} evidenceHash`),
      description: compactText(entry?.description, 1000)
    };
    if (!capability.id || !capability.version || !capability.description) {
      throw new TypeError(`laboratory capability ${index + 1} id, version, and description are required`);
    }
    return capability;
  });
  if (!capabilities.length) throw new TypeError('at least one versioned laboratory capability claim is required');
  const custody = {
    protocolHash: requireHash(protocolCustody?.protocolHash, 'laboratory protocol custody protocolHash'),
    role: compactText(protocolCustody?.role, 80).toLowerCase(),
    evidenceHash: requireHash(protocolCustody?.evidenceHash, 'laboratory protocol custody evidenceHash')
  };
  if (!LABORATORY_PROTOCOL_CUSTODY_ROLES.includes(custody.role)) {
    throw new TypeError('laboratory protocol custody role is invalid');
  }
  const safetyProfile = {
    classification: compactText(safety?.classification, 240),
    oversightAuthority: compactText(safety?.oversightAuthority, 500),
    approvalHash: requireHash(safety?.approvalHash, 'laboratory safety approvalHash'),
    limitations: normalizeTextList(safety?.limitations, {
      min: 1, max: 32, itemMax: 1000, label: 'laboratory safety limitations'
    })
  };
  if (!safetyProfile.classification || !safetyProfile.oversightAuthority) {
    throw new TypeError('laboratory safety classification and oversight authority are required');
  }
  const validFrom = compactText(availability?.validFrom, 64);
  const validUntil = compactText(availability?.validUntil, 64);
  const availabilityProfile = {
    status: compactText(availability?.status, 80).toLowerCase(),
    capacity: compactText(availability?.capacity, 1000),
    validFrom,
    validUntil
  };
  if (!LABORATORY_AVAILABILITY_STATUSES.includes(availabilityProfile.status)
    || !availabilityProfile.capacity
    || !Number.isFinite(Date.parse(validFrom))
    || !Number.isFinite(Date.parse(validUntil))
    || Date.parse(validUntil) < Date.parse(validFrom)
    || !Number.isFinite(Date.parse(createdAt || ''))
    || Date.parse(createdAt) < Date.parse(validFrom)
    || Date.parse(createdAt) > Date.parse(validUntil)) {
    throw new TypeError('laboratory availability status, capacity, and validity interval are required');
  }
  if (consent?.publicLaboratoryIdentity !== true
    || consent?.publishOutcome !== true
    || consent?.publishQualification !== true) {
    throw new TypeError('laboratory identity, qualification, and outcome publication consent are required');
  }
  const normalized = {
    schema: LABORATORY_CAPABILITY_CLAIM_VERSION,
    status: 'claimed',
    laboratory: lab,
    capabilities: capabilities.map((entry) => entry.id),
    capabilityClaims: capabilities,
    protocolCustody: custody,
    safety: safetyProfile,
    availability: availabilityProfile,
    consent: {
      publicLaboratoryIdentity: true,
      publishQualification: true,
      publishOutcome: true,
      acknowledgedAt: compactText(consent?.acknowledgedAt, 64) || createdAt
    },
    conflictDisclosure: compactText(conflictDisclosure, 2000) || 'none declared'
  };
  if (!Number.isFinite(Date.parse(normalized.consent.acknowledgedAt))) {
    throw new TypeError('laboratory consent acknowledgement must be an ISO timestamp');
  }
  return withContentHash(normalized, 'profileHash');
};
