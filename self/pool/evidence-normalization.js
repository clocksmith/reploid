/** Canonical record field normalization; no publication or admission authority. */
import {
  ADJUDICATION_CAMPAIGN_MEASUREMENT_PLAN_VERSION,
  ADJUDICATION_CAMPAIGN_MEASUREMENT_ROLES,
  ADJUDICATION_EXPERIMENT_VERSION,
  BASELINE_FREEZE_ADJUDICATION_EXPERIMENT_VERSION,
  CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM,
  CONTEXTUAL_REUSE_REVIEW_VERSION,
  CROSS_ROOM_REUSE_CONTEXT_VERSION,
  CROSS_ROOM_SOURCE_IDENTITY_VERSION,
  DISCOVERY_CHECKPOINT_VERSION,
  DISCOVERY_CONTRACT_PROJECTION_ID,
  DISCOVERY_CONTRACT_STATE_VERSION,
  EXPERIMENTAL_EXECUTION_CONTEXT_VERSION,
  LABORATORY_AVAILABILITY_STATUSES,
  LABORATORY_CAPABILITY_CLAIM_VERSION,
  LABORATORY_PROTOCOL_CUSTODY_ROLES,
  LEGACY_ADJUDICATION_EXPERIMENT_VERSION,
  LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID,
  LEGACY_DISCOVERY_CONTRACT_STATE_VERSION,
  PRIOR_EVIDENCE_KINDS,
  PROTEIN_ANNOTATION_COORDINATE_SYSTEMS,
  PROTEIN_ANNOTATION_IDENTITY_VERSION,
  PROTEIN_ANNOTATION_SCOPES,
  PUBLIC_PROTEIN_EVIDENCE_FINDINGS,
  PUBLIC_PROTEIN_EVIDENCE_KINDS,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  REPLICATION_INDEPENDENCE_DIMENSIONS,
  RESEARCH_FAILURE_CATEGORIES,
  RESEARCH_RECORD_KINDS,
  RESEARCH_RESOLUTION_POLICY_VERSION,
  RESEARCH_WORK_KINDS,
  RESEARCH_WORK_ORDER_CONTRACT_VERSION,
  RESOLUTION_REOPEN_TRIGGERS,
  RESOLUTION_UNCERTAINTY_TRIGGERS,
  SHA256_PATTERN,
  clone,
  compactText,
  compareDecisionContextSnapshots,
  decisionContextIntent,
  decisionContextSnapshot,
  normalizeRoomId,
  sameStringSet,
  stableTaskId,
  unique
} from './evidence-record-contract.js';
import {
  ADJUDICATION_NORTH_STAR_EVIDENCE_VERSION,
  ADJUDICATION_NORTH_STAR_POLICY_VERSION,
  normalizeAdjudicationNorthStarPolicy
} from './adjudication-north-star.js';
import {
  DISCOVERY_ACTION_VALUE_POLICY
} from './discovery-action-value.js';
import {
  DISCOVERY_CANDIDATE_ACTION_KINDS
} from './discovery-candidate-action.js';
import {
  SEQUENCE_ALPHABETS
} from './sequence-workload.js';
import {
  SIGNATURE_DOMAINS,
  hashJson,
  receiptSigningPayload,
  verifyCanonicalSignature
} from './inference-receipt.js';
import {
  exactModelContractKey
} from './model-contract.js';
export const normalizeVerifiedReceiptEvidence = async ({
  receiptEvidence = null,
  receiptRecord,
  receiptHash,
  agreement,
  modelContract,
  sequenceHash
}) => {
  const agreementStatus = compactText(agreement?.status, 64).toLowerCase();
  const agreementAccepted = ['accepted', 'agreed'].includes(agreementStatus);
  const supplied = Array.isArray(receiptEvidence) ? receiptEvidence : [];
  const primaryCandidate = receiptRecord?.receipt && receiptRecord?.providerPublicKey
    ? [{
      receiptHash,
      providerId: receiptRecord.providerId || receiptRecord.receipt.providerId,
      providerPublicKey: receiptRecord.providerPublicKey,
      receipt: receiptRecord.receipt
    }]
    : [];
  const candidates = supplied.length > 0 ? supplied : primaryCandidate;
  if (agreementAccepted && candidates.length < 2) {
    throw new TypeError('accepted compute agreement requires two verified receipt evidence records');
  }
  const normalized = [];
  for (const candidate of candidates) {
    const receipt = clone(candidate?.receipt || null);
    if (!receipt) throw new TypeError('compute receipt evidence requires the signed receipt');
    const computedReceiptHash = await hashJson(receipt);
    const evidenceReceiptHash = requireHash(candidate?.receiptHash, 'compute receipt evidence');
    if (computedReceiptHash !== evidenceReceiptHash) throw new TypeError('compute receipt evidence hash mismatch');
    const providerId = compactText(candidate?.providerId, 240);
    const providerPublicKey = compactText(candidate?.providerPublicKey, 12000);
    if (!providerId || receipt.providerId !== providerId) throw new TypeError('compute receipt evidence provider identity mismatch');
    if (!providerPublicKey || !receipt.providerSignature) throw new TypeError('compute receipt evidence signature material is required');
    if (receipt.signatureDomain !== SIGNATURE_DOMAINS.providerReceipt) {
      throw new TypeError('compute receipt evidence signature domain mismatch');
    }
    const signatureOk = await verifyCanonicalSignature(
      receiptSigningPayload(receipt),
      providerPublicKey,
      receipt.providerSignature,
      { domain: SIGNATURE_DOMAINS.providerReceipt }
    );
    if (!signatureOk) throw new TypeError('compute receipt evidence provider signature is invalid');
    if (exactModelContractKey(normalizeModelContract(receipt.model)) !== exactModelContractKey(modelContract)) {
      throw new TypeError('compute receipt evidence model contract mismatch');
    }
    if (receipt.inputHash !== sequenceHash) throw new TypeError('compute receipt evidence input identity mismatch');
    if (agreement?.jobId && receipt.jobId !== agreement.jobId) {
      throw new TypeError('compute receipt evidence job identity mismatch');
    }
    if (agreementAccepted) {
      const agreementField = compactText(agreement?.agreementField, 120);
      if (!agreementField || agreement?.agreementValue == null || receipt[agreementField] !== agreement.agreementValue) {
        throw new TypeError('compute receipt evidence does not match the accepted agreement value');
      }
    }
    normalized.push({ receiptHash: evidenceReceiptHash, providerId, providerPublicKey, receipt });
  }
  const evidenceReceiptHashes = normalized.map((entry) => entry.receiptHash);
  const evidenceProviderIds = normalized.map((entry) => entry.providerId);
  const evidenceProviderKeys = normalized.map((entry) => entry.providerPublicKey);
  if (agreementAccepted) {
    const declaredProviderIds = agreement?.providerIds ?? agreement?.acceptedProviderIds;
    if (!sameStringSet(evidenceReceiptHashes, agreement?.receiptHashes || [])) {
      throw new TypeError('compute agreement receipt identities do not match verified receipt evidence');
    }
    if (!Array.isArray(declaredProviderIds) || !sameStringSet(evidenceProviderIds, declaredProviderIds)) {
      throw new TypeError('compute agreement provider identities do not match verified receipt evidence');
    }
    if (unique(evidenceProviderIds).length < 2 || unique(evidenceProviderKeys).length < 2) {
      throw new TypeError('accepted compute agreement requires distinct verified provider identities and keys');
    }
  }
  if (normalized.length > 0 && !evidenceReceiptHashes.includes(receiptHash)) {
    throw new TypeError('verified receipt evidence does not include the primary receipt');
  }
  return normalized.sort((left, right) => left.receiptHash.localeCompare(right.receiptHash));
};

export const normalizeConsent = (consent = {}, alphabet = SEQUENCE_ALPHABETS.aminoAcid) => {
  if (consent.publicSequence !== true) throw new TypeError('public sequence consent is required');
  if (consent.publicEvidenceNetwork !== true) throw new TypeError('public evidence-network consent is required');
  return {
    scope: alphabet === SEQUENCE_ALPHABETS.nucleotide
      ? 'public_dna_evidence_network'
      : 'public_protein_evidence_network',
    publicSequence: true,
    publicEvidenceNetwork: true,
    publishEmbedding: consent.publishEmbedding === true,
    publishResidueEvidence: consent.publishResidueEvidence === true,
    acknowledgedAt: compactText(consent.acknowledgedAt, 64) || new Date().toISOString()
  };
};

export const normalizeModelContract = (model = {}) => {
  const sequence = model.sequence || model.requirements?.sequence || null;
  const contract = {
    id: compactText(model.id || model.modelId, 240),
    hash: compactText(model.hash || model.modelHash, 160),
    manifestHash: compactText(model.manifestHash, 160),
    tokenizerHash: compactText(model.tokenizerHash || model.requirements?.tokenizerHash, 160) || null,
    runtime: compactText(model.runtime, 120),
    backend: compactText(model.backend, 120),
    workload: compactText(model.workload || model.requirements?.workload, 120),
    executionMode: compactText(model.executionMode || model.requirements?.executionMode, 120),
    dimensions: Number(model.dimensions || model.embeddingDimensions || model.requirements?.embeddingDimensions || 0) || null,
    quantization: compactText(model.quantization || model.requirements?.quantization, 80) || null,
    contextLength: Number(model.contextLength || model.requirements?.contextLength || 0) || null,
    sequence: sequence ? clone(sequence) : null,
    outputs: clone(model.outputs || model.requirements?.outputs || null),
    runtimeCompatibility: clone(model.runtimeCompatibility || model.requirements?.runtimeCompatibility || null),
    runtimeContract: clone(model.runtimeContract || model.requirements?.runtimeContract || null),
    artifactIdentity: clone(model.artifactIdentity || model.requirements?.artifactIdentity || null),
    license: clone(model.license || model.requirements?.license || null),
    admission: clone(model.admission || model.requirements?.admission || null)
  };
  if (!contract.id || !contract.hash || !contract.manifestHash || !contract.runtime || !contract.workload) {
    throw new TypeError('exact model id, hash, manifest hash, runtime, and workload are required');
  }
  return contract;
};

export const requireHash = (value, label) => {
  const normalized = compactText(value, 160);
  if (!SHA256_PATTERN.test(normalized)) throw new TypeError(`${label} must be a SHA-256 identity`);
  return normalized;
};

export const normalizeHashList = (values, label, { min = 0, max = 128 } = {}) => {
  const hashes = unique(Array.isArray(values) ? values : []).slice(0, max);
  if (hashes.length < min) throw new TypeError(`${label} requires at least ${min} record ${min === 1 ? 'identity' : 'identities'}`);
  return hashes.map((value) => requireHash(value, label));
};

export const normalizeTextList = (values, { min = 0, max = 64, itemMax = 1000, label = 'values' } = {}) => {
  const normalized = unique((Array.isArray(values) ? values : []).map((value) => compactText(value, itemMax))).slice(0, max);
  if (normalized.length < min) throw new TypeError(`${label} requires at least ${min} ${min === 1 ? 'entry' : 'entries'}`);
  return normalized;
};

const normalizeDecisionContextSnapshot = async (snapshot = {}, label) => {
  const normalized = {
    questionHash: requireHash(snapshot.questionHash, `${label} questionHash`),
    roomId: normalizeRoomId(snapshot.roomId),
    sequenceHash: requireHash(snapshot.sequenceHash, `${label} sequenceHash`),
    consent: {
      publicSequence: snapshot.consent?.publicSequence === true,
      publicEvidenceNetwork: snapshot.consent?.publicEvidenceNetwork === true
    },
    intent: decisionContextIntent(snapshot.intent)
  };
  normalized.snapshotHash = await hashJson(normalized);
  return normalized;
};

const crossRoomSourceIdentityFields = (source = {}) => {
  const reference = source.reference || source.evidence?.reference || {};
  const annotation = source.annotation || source.evidence?.annotation || {};
  return {
    schema: CROSS_ROOM_SOURCE_IDENTITY_VERSION,
    evidenceKind: compactText(source.evidenceKind || source.evidence?.kind, 40).toLowerCase(),
    reference: {
      uri: compactText(reference.uri, 2000),
      accession: compactText(reference.accession, 240),
      version: compactText(reference.version, 240),
      contentHash: compactText(reference.contentHash, 160).toLowerCase()
    },
    annotationIdentityHash: compactText(source.annotationIdentityHash || annotation.identityHash, 160).toLowerCase() || null
  };
};

export const crossRoomSourceIdentityKey = (source = {}) => JSON.stringify(crossRoomSourceIdentityFields(source));

const normalizeCrossRoomSourceIdentity = async (source = {}) => {
  const normalized = crossRoomSourceIdentityFields(source);
  if (!PRIOR_EVIDENCE_KINDS.includes(normalized.evidenceKind)) {
    throw new TypeError('cross-room source evidence kind is not supported');
  }
  if (!normalized.reference.uri && !normalized.reference.accession) {
    throw new TypeError('cross-room source identity requires a URI or accession');
  }
  if (!normalized.reference.version && !normalized.reference.contentHash) {
    throw new TypeError('cross-room source identity requires a version or content hash');
  }
  if (normalized.reference.contentHash && !SHA256_PATTERN.test(normalized.reference.contentHash)) {
    throw new TypeError('cross-room source content hash must be a SHA-256 identity');
  }
  if (normalized.annotationIdentityHash && !SHA256_PATTERN.test(normalized.annotationIdentityHash)) {
    throw new TypeError('cross-room annotation identity hash must be a SHA-256 identity');
  }
  if (['annotation', 'domain'].includes(normalized.evidenceKind) && !normalized.annotationIdentityHash) {
    throw new TypeError('cross-room annotation source requires a normalized annotation identity');
  }
  normalized.identityHash = await hashJson(normalized);
  return normalized;
};

export const normalizeCrossRoomReuseContext = async (reuseContext = {}) => {
  const originRecordHash = requireHash(reuseContext.originRecordHash, 'cross-room origin record hash');
  const originSource = await normalizeCrossRoomSourceIdentity(reuseContext.originSource);
  const origin = await normalizeDecisionContextSnapshot(reuseContext.origin, 'cross-room origin context');
  const current = await normalizeDecisionContextSnapshot(reuseContext.current, 'cross-room current context');
  if (origin.roomId === current.roomId) throw new TypeError('cross-room reuse context requires distinct rooms');
  if (origin.sequenceHash !== current.sequenceHash) throw new TypeError('cross-room reuse context requires exact sequence identity');
  if (!origin.consent.publicSequence || !origin.consent.publicEvidenceNetwork
    || !current.consent.publicSequence || !current.consent.publicEvidenceNetwork) {
    throw new TypeError('cross-room reuse context requires public sequence and evidence-network consent');
  }
  const comparison = compareDecisionContextSnapshots(origin, current);
  const normalized = {
    schema: CROSS_ROOM_REUSE_CONTEXT_VERSION,
    originRecordHash,
    originSource,
    origin,
    current,
    comparison,
    admission: 'requires_explicit_current_room_context_review'
  };
  normalized.comparisonHash = await hashJson({
    originRecordHash,
    originSnapshotHash: origin.snapshotHash,
    currentSnapshotHash: current.snapshotHash,
    comparison
  });
  return normalized;
};

export async function createCrossRoomReuseContext({
  originRecord,
  originQuestion,
  currentQuestion
} = {}) {
  if (originRecord?.kind !== RESEARCH_RECORD_KINDS.priorEvidence) {
    throw new TypeError('cross-room reuse requires a prior-evidence origin record');
  }
  if (originQuestion?.kind !== RESEARCH_RECORD_KINDS.submission
    || currentQuestion?.kind !== RESEARCH_RECORD_KINDS.submission) {
    throw new TypeError('cross-room reuse requires origin and current question records');
  }
  if (originRecord.questionHash !== originQuestion.recordHash) {
    throw new TypeError('cross-room origin evidence does not belong to its declared question');
  }
  if (originRecord.roomId !== originQuestion.roomId) {
    throw new TypeError('cross-room origin evidence and question do not share a room');
  }
  for (const [question, label] of [[originQuestion, 'origin'], [currentQuestion, 'current']]) {
    if (question.consent?.publicSequence !== true || question.consent?.publicEvidenceNetwork !== true) {
      throw new TypeError(`cross-room ${label} question did not consent to public evidence reuse`);
    }
  }
  return normalizeCrossRoomReuseContext({
    originRecordHash: originRecord.recordHash,
    originSource: crossRoomSourceIdentityFields(originRecord),
    origin: decisionContextSnapshot(originQuestion),
    current: decisionContextSnapshot(currentQuestion)
  });
}

export const normalizeContextualReuseReview = async (assessment = {}) => {
  const determination = compactText(assessment.determination, 40).toLowerCase();
  if (!['relevant', 'not_relevant', 'uncertain'].includes(determination)) {
    throw new TypeError('contextual reuse determination must be relevant, not_relevant, or uncertain');
  }
  const normalized = {
    schema: CONTEXTUAL_REUSE_REVIEW_VERSION,
    determination,
    originRecordHash: requireHash(assessment.originRecordHash, 'contextual reuse originRecordHash'),
    originQuestionHash: requireHash(assessment.originQuestionHash, 'contextual reuse originQuestionHash'),
    currentQuestionHash: requireHash(assessment.currentQuestionHash, 'contextual reuse currentQuestionHash'),
    comparisonHash: requireHash(assessment.comparisonHash, 'contextual reuse comparisonHash'),
    rationale: compactText(assessment.rationale, 2000)
  };
  if (!normalized.rationale) throw new TypeError('contextual reuse review rationale is required');
  normalized.assessmentHash = await hashJson(normalized);
  return normalized;
};

export const projectDiscoveryTaskContract = (task = {}) => {
  const kind = compactText(task.kind || task.actionKind, 120);
  const targetHash = requireHash(task.targetHash, 'discovery task target');
  const reason = compactText(task.reason);
  const basis = compactText(task.basis, 64) || 'governance';
  const basisHashes = normalizeHashList(task.basisHashes?.length ? task.basisHashes : [targetHash], 'discovery task basis', { min: 1, max: 128 });
  if (!kind || !reason) throw new TypeError('discovery task kind and reason are required');
  if (!['question_anchor', 'governance', 'accepted_memory'].includes(basis)) {
    throw new TypeError('discovery task basis is invalid');
  }
  return {
    schema: 'poolday.discovery_task_contract/v1',
    taskId: stableTaskId(kind, targetHash),
    kind,
    targetHash,
    reason,
    basis,
    basisHashes: [...basisHashes].sort(),
    rankingPolicyId: DISCOVERY_ACTION_VALUE_POLICY.policyId,
    rankingPolicyVersion: DISCOVERY_ACTION_VALUE_POLICY.version,
    rankingMethod: DISCOVERY_ACTION_VALUE_POLICY.method,
    rankingStatus: DISCOVERY_ACTION_VALUE_POLICY.status
  };
};

export const normalizeTaskApprovalContract = (taskContract, taskId, targetHash) => {
  const normalized = projectDiscoveryTaskContract(taskContract);
  if (normalized.taskId !== taskId || normalized.targetHash !== targetHash) {
    throw new TypeError('task approval contract does not match its task or target identity');
  }
  if (taskContract?.schema !== normalized.schema
    || taskContract?.rankingPolicyId !== normalized.rankingPolicyId
    || taskContract?.rankingPolicyVersion !== normalized.rankingPolicyVersion
    || taskContract?.rankingMethod !== normalized.rankingMethod
    || taskContract?.rankingStatus !== normalized.rankingStatus) {
    throw new TypeError('task approval contract schema or ranking policy is invalid');
  }
  return normalized;
};

export const normalizeConditions = (conditions = {}) => {
  const normalized = {
    organism: compactText(conditions.organism, 240),
    biologicalSystem: compactText(conditions.biologicalSystem || conditions.system, 500),
    cellType: compactText(conditions.cellType, 240),
    compartment: compactText(conditions.compartment, 240),
    background: compactText(conditions.background, 500),
    variant: compactText(conditions.variant, 500),
    partners: normalizeTextList(conditions.partners, { max: 32, itemMax: 240 }),
    ligands: normalizeTextList(conditions.ligands, { max: 32, itemMax: 240 }),
    modifications: normalizeTextList(conditions.modifications, { max: 32, itemMax: 240 }),
    concentration: compactText(conditions.concentration, 240),
    temperature: compactText(conditions.temperature, 120),
    pH: compactText(conditions.pH, 120),
    timepoint: compactText(conditions.timepoint, 240),
    notes: compactText(conditions.notes, 2000)
  };
  return normalized;
};

export const conditionsHaveContent = (conditions = {}) => Object.values(conditions).some((value) => (
  Array.isArray(value) ? value.length > 0 : Boolean(value)
));

export const normalizeUncertainty = (uncertainty = {}) => ({
  method: compactText(uncertainty.method, 240),
  value: Number.isFinite(Number(uncertainty.value)) ? Number(uncertainty.value) : null,
  unit: compactText(uncertainty.unit, 120),
  interval: compactText(uncertainty.interval, 240),
  description: compactText(uncertainty.description, 2000)
});

export const normalizeReferenceIdentity = (reference = {}, label = 'reference') => {
  const normalized = {
    uri: compactText(reference.uri || reference.url, 2000),
    accession: compactText(reference.accession, 240),
    version: compactText(reference.version, 240),
    contentHash: compactText(reference.contentHash, 160)
  };
  if (normalized.uri) {
    const url = new URL(normalized.uri);
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError(`${label} URI must use http or https`);
    normalized.uri = url.href;
  }
  if (!normalized.uri && !normalized.accession) throw new TypeError(`${label} URI or accession is required`);
  if (!normalized.version && !SHA256_PATTERN.test(normalized.contentHash)) {
    throw new TypeError(`${label} requires a version or content hash`);
  }
  if (normalized.contentHash && !SHA256_PATTERN.test(normalized.contentHash)) {
    throw new TypeError(`${label} content hash must be a SHA-256 identity`);
  }
  return normalized;
};

export const requiredInteger = (value, label) => {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new TypeError(`${label} is required`);
  }
  const normalized = Number(value);
  if (!Number.isInteger(normalized)) throw new TypeError(`${label} must be an integer`);
  return normalized;
};

export const normalizeProteinAnnotationIdentity = async (annotation = {}) => {
  const scope = compactText(annotation.scope || annotation.type, 40).toLowerCase();
  if (!PROTEIN_ANNOTATION_SCOPES.includes(scope)) {
    throw new TypeError('protein annotation scope must be family or domain');
  }
  const ontology = {
    namespace: compactText(annotation.ontology?.namespace, 240),
    termId: compactText(annotation.ontology?.termId || annotation.ontology?.accession, 240),
    version: compactText(annotation.ontology?.version, 240),
    label: compactText(annotation.ontology?.label, 500)
  };
  if (!ontology.namespace || !ontology.termId || !ontology.version) {
    throw new TypeError('protein annotation ontology namespace, term id, and version are required');
  }
  const sequence = {
    hash: compactText(annotation.sequence?.hash || annotation.sequenceHash, 160).toLowerCase(),
    length: requiredInteger(annotation.sequence?.length ?? annotation.sequenceLength, 'protein annotation sequence length')
  };
  if (!SHA256_PATTERN.test(sequence.hash)) throw new TypeError('protein annotation sequence hash must be a SHA-256 identity');
  if (sequence.length < 1) throw new TypeError('protein annotation sequence length must be positive');

  const sourceSystem = compactText(
    annotation.coordinates?.sourceSystem || annotation.coordinates?.system || annotation.coordinateSystem,
    80
  ).toLowerCase();
  if (!PROTEIN_ANNOTATION_COORDINATE_SYSTEMS.includes(sourceSystem)) {
    throw new TypeError('protein annotation source coordinate system is invalid');
  }
  const sourceStart = requiredInteger(
    annotation.coordinates?.sourceStart ?? annotation.coordinates?.start ?? annotation.start,
    'protein annotation coordinate start'
  );
  const sourceEnd = requiredInteger(
    annotation.coordinates?.sourceEnd ?? annotation.coordinates?.end ?? annotation.end,
    'protein annotation coordinate end'
  );
  const start = sourceSystem === 'protein_residue_zero_based_half_open' ? sourceStart + 1 : sourceStart;
  const end = sourceEnd;
  if (sourceSystem === 'protein_residue_zero_based_half_open' && (sourceStart < 0 || sourceEnd <= sourceStart)) {
    throw new TypeError('zero-based half-open protein annotation coordinates are invalid');
  }
  if (sourceSystem === 'protein_residue_one_based_closed' && (sourceStart < 1 || sourceEnd < sourceStart)) {
    throw new TypeError('one-based closed protein annotation coordinates are invalid');
  }
  if (end > sequence.length) throw new TypeError('protein annotation coordinates exceed the bound sequence');
  const normalized = {
    schema: PROTEIN_ANNOTATION_IDENTITY_VERSION,
    scope,
    ontology,
    sequence,
    coordinates: {
      sourceSystem,
      sourceStart,
      sourceEnd,
      canonicalSystem: CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM,
      start,
      end
    }
  };
  normalized.identityHash = await hashJson(normalized);
  return normalized;
};

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
      || !['higher_is_better', 'lower_is_better'].includes(direction)
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
  normalized.contractHash = await hashJson(normalized);
  return normalized;
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

export const normalizeDiscoveryCheckpoint = async (checkpoint = {}, roomId) => {
  const questionHash = requireHash(checkpoint.questionHash, 'discovery checkpoint questionHash');
  const policyId = compactText(checkpoint.policyId, 240);
  if (!policyId) throw new TypeError('discovery checkpoint policyId is required');
  const projection = {
    id: compactText(checkpoint.projection?.id, 240),
    artifactHash: requireHash(checkpoint.projection?.artifactHash, 'discovery checkpoint projection artifactHash')
  };
  const stateSchemaByProjection = {
    [LEGACY_DISCOVERY_CONTRACT_PROJECTION_ID]: LEGACY_DISCOVERY_CONTRACT_STATE_VERSION,
    [DISCOVERY_CONTRACT_PROJECTION_ID]: DISCOVERY_CONTRACT_STATE_VERSION
  };
  if (!stateSchemaByProjection[projection.id]) {
    throw new TypeError('discovery checkpoint projection id is unsupported');
  }
  const inputRecordHashes = normalizeHashList(checkpoint.inputRecordHashes, 'discovery checkpoint inputs', {
    min: 1,
    max: 1000
  });
  const activeInputRecordHashes = normalizeHashList(
    checkpoint.activeInputRecordHashes,
    'discovery checkpoint active inputs',
    { min: 1, max: 1000 }
  );
  if (!activeInputRecordHashes.every((hash) => inputRecordHashes.includes(hash))) {
    throw new TypeError('discovery checkpoint active inputs must be part of the complete input set');
  }
  if (!activeInputRecordHashes.includes(questionHash)) {
    throw new TypeError('discovery checkpoint question must remain an active input');
  }
  const parentCheckpointHashes = normalizeHashList(
    checkpoint.parentCheckpointHashes,
    'discovery checkpoint parents',
    { max: 32 }
  );
  const contractIdentity = {
    schema: 'poolday.discovery_contract_identity/v1',
    roomId: normalizeRoomId(roomId),
    questionHash,
    policyId
  };
  const contractId = await hashJson(contractIdentity);
  if (checkpoint.contractId && checkpoint.contractId !== contractId) {
    throw new TypeError('discovery checkpoint contractId does not match its question, room, and policy');
  }
  const state = clone(checkpoint.state);
  if (!state || state.schema !== stateSchemaByProjection[projection.id]
    || !['open', 'reopened'].includes(state.status)
    || state.contractId !== contractId
    || state.questionHash !== questionHash
    || state.policyId !== policyId) {
    throw new TypeError('discovery checkpoint state identity or status is invalid');
  }
  const normalized = {
    schema: DISCOVERY_CHECKPOINT_VERSION,
    contractId,
    questionHash,
    policyId,
    parentCheckpointHashes,
    projection,
    inputRecordHashes,
    inputSetHash: await hashJson(inputRecordHashes),
    activeInputRecordHashes,
    activeInputSetHash: await hashJson(activeInputRecordHashes),
    state,
    stateHash: await hashJson(state)
  };
  return normalized;
};

export const normalizeTransformations = (values = []) => (Array.isArray(values) ? values : []).slice(0, 32).map((value, index) => {
  const normalized = {
    id: compactText(value.id || value.name, 240),
    version: compactText(value.version, 120),
    parametersHash: compactText(value.parametersHash, 160),
    description: compactText(value.description, 1000)
  };
  if (!normalized.id || !normalized.version) throw new TypeError(`transformation ${index + 1} requires id and version`);
  if (normalized.parametersHash && !SHA256_PATTERN.test(normalized.parametersHash)) {
    throw new TypeError(`transformation ${index + 1} parametersHash must be a SHA-256 identity`);
  }
  return normalized;
});

const normalizePublicProteinEvidenceFinding = (evidenceKind, finding = {}) => {
  const kind = compactText(evidenceKind, 40).toLowerCase();
  const defaults = kind === 'negative_result'
    ? { classification: 'negative', status: 'completed', failureCategory: 'none' }
    : kind === 'failed_attempt'
      ? { classification: 'not_observed', status: 'failed', failureCategory: '' }
      : ['assay'].includes(kind)
        ? { classification: '', status: 'completed', failureCategory: 'none' }
        : { classification: 'not_applicable', status: 'not_applicable', failureCategory: 'none' };
  const normalized = {
    classification: compactText(finding.classification, 40).toLowerCase() || defaults.classification,
    attempt: {
      status: compactText(finding.attempt?.status || finding.attemptStatus, 40).toLowerCase() || defaults.status,
      failureCategory: compactText(
        finding.attempt?.failureCategory || finding.failureCategory,
        80
      ).toLowerCase() || defaults.failureCategory
    }
  };
  if (!PUBLIC_PROTEIN_EVIDENCE_FINDINGS.includes(normalized.classification)) {
    throw new TypeError('public protein evidence finding classification is invalid');
  }
  if (!['not_applicable', 'completed', 'failed'].includes(normalized.attempt.status)) {
    throw new TypeError('public protein evidence attempt status is invalid');
  }
  if (!RESEARCH_FAILURE_CATEGORIES.includes(normalized.attempt.failureCategory)) {
    throw new TypeError('public protein evidence failure category is invalid');
  }
  if (kind === 'assay'
    && (!['positive', 'negative', 'ambiguous'].includes(normalized.classification)
      || normalized.attempt.status !== 'completed'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('assay evidence requires a completed positive, negative, or ambiguous finding');
  }
  if (kind === 'negative_result'
    && (normalized.classification !== 'negative'
      || normalized.attempt.status !== 'completed'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('negative-result evidence requires a completed negative finding');
  }
  if (kind === 'failed_attempt'
    && (normalized.classification !== 'not_observed'
      || normalized.attempt.status !== 'failed'
      || normalized.attempt.failureCategory === 'none')) {
    throw new TypeError('failed-attempt evidence requires a named failure category and no claimed observation');
  }
  if (!['assay', 'negative_result', 'failed_attempt'].includes(kind)
    && (normalized.classification !== 'not_applicable'
      || normalized.attempt.status !== 'not_applicable'
      || normalized.attempt.failureCategory !== 'none')) {
    throw new TypeError('non-assay public evidence cannot claim an assay finding');
  }
  return normalized;
};

export const normalizePublicProteinEvidenceProfile = ({
  evidenceKind,
  conditions,
  transformations,
  provenance,
  finding
} = {}) => {
  const kind = compactText(evidenceKind, 40).toLowerCase();
  if (!PUBLIC_PROTEIN_EVIDENCE_KINDS.includes(kind)) {
    throw new TypeError('public protein evidence kind is not supported');
  }
  if (!conditionsHaveContent(conditions)) {
    throw new TypeError('public protein evidence requires an explicit condition declaration');
  }
  if (!Array.isArray(transformations) || transformations.length === 0) {
    throw new TypeError('public protein evidence requires at least one versioned transformation');
  }
  if (!compactText(provenance?.sourceIdentity, 500)) {
    throw new TypeError('public protein evidence source identity is required');
  }
  if (!compactText(provenance?.license, 240)) {
    throw new TypeError('public protein evidence license is required');
  }
  if (!compactText(provenance?.retrievalMethod, 500)
    || !Number.isFinite(Date.parse(provenance?.retrievedAt || ''))) {
    throw new TypeError('public protein evidence retrieval provenance is incomplete');
  }
  return {
    schema: PUBLIC_PROTEIN_EVIDENCE_VERSION,
    access: 'public',
    finding: normalizePublicProteinEvidenceFinding(kind, finding)
  };
};

export const normalizeAnalysisIdentity = async (analysis = {}) => {
  const normalized = {
    methodId: compactText(analysis.methodId || analysis.id, 240),
    version: compactText(analysis.version, 120),
    artifactHash: compactText(analysis.artifactHash, 160),
    parametersHash: compactText(analysis.parametersHash, 160),
    runtimeIdentity: compactText(analysis.runtimeIdentity, 500),
    lineageHashes: normalizeHashList(analysis.lineageHashes || [], 'analysis lineage', { max: 64 })
  };
  if (!normalized.methodId || !normalized.version) throw new TypeError('analysis method id and version are required');
  if (normalized.artifactHash && !SHA256_PATTERN.test(normalized.artifactHash)) throw new TypeError('analysis artifactHash must be a SHA-256 identity');
  if (normalized.parametersHash && !SHA256_PATTERN.test(normalized.parametersHash)) throw new TypeError('analysis parametersHash must be a SHA-256 identity');
  normalized.analysisHash = await hashJson(normalized);
  return normalized;
};

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
  return { ...normalized, criteriaHash: await hashJson(normalized) };
};

export const normalizeAssayProtocol = async (protocol = {}) => {
  const normalized = {
    protocolId: compactText(protocol.protocolId || protocol.id, 240),
    version: compactText(protocol.version, 120),
    assayType: compactText(protocol.assayType, 240),
    executableUri: compactText(protocol.executableUri, 2000),
    referenceIdentities: (Array.isArray(protocol.referenceIdentities) ? protocol.referenceIdentities : [])
      .slice(0, 32)
      .map((entry, index) => normalizeReferenceIdentity(entry, `protocol reference ${index + 1}`)),
    conditions: normalizeConditions(protocol.conditions),
    controls: normalizeTextList(protocol.controls, { min: 1, max: 32, itemMax: 500, label: 'assay controls' }),
    readouts: normalizeTextList(protocol.readouts, { min: 1, max: 32, itemMax: 500, label: 'assay readouts' }),
    normalization: {
      method: compactText(protocol.normalization?.method, 240),
      version: compactText(protocol.normalization?.version, 120),
      reference: compactText(protocol.normalization?.reference, 500)
    },
    transformations: normalizeTransformations(protocol.transformations),
    uncertaintyPlan: compactText(protocol.uncertaintyPlan, 2000),
    acceptanceCriteria: compactText(protocol.acceptanceCriteria, 2000)
  };
  if (!normalized.protocolId || !normalized.version || !normalized.assayType) {
    throw new TypeError('protocol id, version, and assay type are required');
  }
  if (!conditionsHaveContent(normalized.conditions)) throw new TypeError('protocol conditions are required');
  if (!normalized.normalization.method || !normalized.normalization.version) {
    throw new TypeError('protocol normalization method and version are required');
  }
  if (!normalized.uncertaintyPlan || !normalized.acceptanceCriteria) {
    throw new TypeError('protocol uncertainty plan and acceptance criteria are required');
  }
  if (normalized.executableUri) {
    const url = new URL(normalized.executableUri);
    if (!['http:', 'https:'].includes(url.protocol)) throw new TypeError('protocol executable URI must use http or https');
    normalized.executableUri = url.href;
  }
  return { ...normalized, protocolHash: await hashJson(normalized) };
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
  return { ...normalized, contractHash: await hashJson(normalized) };
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
  return { ...normalized, profileHash: await hashJson(normalized) };
};
