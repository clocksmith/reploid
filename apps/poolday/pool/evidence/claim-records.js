/** Signed human claims, hypotheses, prior and public protein evidence, and predictions. */
import {
  ANNOTATION_EVIDENCE_KINDS,
  EVIDENCE_RELATIONS,
  HUMAN_CLAIM_KINDS,
  PREDICTION_OUTCOME_ACCESS,
  PRIOR_EVIDENCE_KINDS,
  PUBLIC_FINDING_EVIDENCE_KINDS,
  RESEARCH_RECORD_KINDS,
  RESEARCH_REVIEW_DECISIONS
} from '../evidence-record-contract.js';
import {
  compactText,
  isSha256,
  isUnitInterval,
  normalizeHashList,
  normalizeTextList,
  requireHash,
  requireHttpUrl
} from './primitives.js';
import {
  normalizeContextualReuseReview,
  normalizeCrossRoomReuseContext
} from './cross-room-normalization.js';
import {
  normalizeTaskApprovalContract
} from './discovery-normalization.js';
import {
  conditionsHaveContent,
  normalizeAnalysisIdentity,
  normalizeConditions,
  normalizeProteinAnnotationIdentity,
  normalizePublicProteinEvidenceProfile,
  normalizeReferenceIdentity,
  normalizeTransformations,
  normalizeUncertainty
} from './scientific-normalization.js';
import {
  createAuthor,
  signResearchRecord
} from './record-signing.js';

export async function createSignedHumanClaim({
  identity,
  roomId,
  targetHash,
  claimKind,
  relation,
  text,
  confidence,
  evidenceLinks = [],
  decision = null,
  contextAssessment = null,
  taskId = null,
  taskContract = null,
  actionContractHash = null,
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.claim);
  const kind = compactText(claimKind, 40).toLowerCase();
  const edge = compactText(relation, 40).toLowerCase();
  if (!HUMAN_CLAIM_KINDS.includes(kind)) throw new TypeError('human claim kind is not supported');
  if (!EVIDENCE_RELATIONS.includes(edge)) throw new TypeError('evidence relation is not supported');
  if (!isSha256(targetHash)) throw new TypeError('targetHash must be a SHA-256 record identity');
  const normalizedText = compactText(text);
  if (!normalizedText) throw new TypeError('human claim text is required');
  const normalizedConfidence = Number(confidence);
  if (!isUnitInterval(normalizedConfidence)) {
    throw new TypeError('confidence must be between 0 and 1');
  }
  const links = evidenceLinks.map((link) => ({
    url: requireHttpUrl(typeof link === 'string' ? link : link.url, 'evidence links must use http or https'),
    label: compactText(link.label, 240)
  })).slice(0, 24);
  const normalizedDecision = decision ? compactText(decision, 32).toLowerCase() : null;
  if (kind === 'review_decision' && !RESEARCH_REVIEW_DECISIONS.includes(normalizedDecision)) {
    throw new TypeError(`review decision must be one of: ${RESEARCH_REVIEW_DECISIONS.join(', ')}`);
  }
  if (kind === 'task_approval' && normalizedDecision !== 'approved') {
    throw new TypeError('task approval decision must be approved');
  }
  if (kind === 'candidate_action_approval'
    && (normalizedDecision !== 'approved' || edge !== 'approves')) {
    throw new TypeError('candidate action approval must approve the proposed action');
  }
  if (contextAssessment && kind !== 'review_decision') {
    throw new TypeError('contextual reuse assessment is valid only for review decisions');
  }
  const normalizedContextAssessment = contextAssessment
    ? await normalizeContextualReuseReview(contextAssessment)
    : null;
  const normalizedTaskId = compactText(taskId, 240) || null;
  const normalizedTaskContract = kind === 'task_approval'
    ? normalizeTaskApprovalContract(taskContract, normalizedTaskId, targetHash)
    : null;
  const normalizedActionContractHash = kind === 'candidate_action_approval'
    ? requireHash(actionContractHash, 'candidate action contract hash')
    : null;
  return signResearchRecord(RESEARCH_RECORD_KINDS.claim, { roomId, createdAt, author, privateKey }, async () => ({
    targetHash,
    claim: {
      kind,
      relation: edge,
      text: normalizedText,
      confidence: normalizedConfidence,
      evidenceLinks: links,
      decision: normalizedDecision,
      ...(normalizedContextAssessment ? { contextAssessment: normalizedContextAssessment } : {}),
      taskId: normalizedTaskId,
      taskContract: normalizedTaskContract,
      actionContractHash: normalizedActionContractHash
    }
  }));
}

export async function createSignedResearchHypothesis({
  identity,
  roomId,
  questionHash,
  statement,
  rationale = '',
  conditions = {},
  discriminatingObservations = [],
  priorEvidenceHashes = [],
  alternativeToHashes = [],
  createdAt = new Date().toISOString()
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.hypothesis);
  const normalizedStatement = compactText(statement);
  if (!normalizedStatement) throw new TypeError('hypothesis statement is required');
  const normalizedConditions = normalizeConditions(conditions);
  if (!conditionsHaveContent(normalizedConditions)) throw new TypeError('hypothesis conditions are required');
  return signResearchRecord(RESEARCH_RECORD_KINDS.hypothesis, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: requireHash(questionHash, 'questionHash'),
    hypothesis: {
      statement: normalizedStatement,
      rationale: compactText(rationale),
      conditions: normalizedConditions,
      discriminatingObservations: normalizeTextList(discriminatingObservations, {
        min: 1,
        max: 32,
        itemMax: 1000,
        label: 'discriminating observations'
      }),
      priorEvidenceHashes: normalizeHashList(priorEvidenceHashes, 'prior evidence', { max: 128 }),
      alternativeToHashes: normalizeHashList(alternativeToHashes, 'alternative hypotheses', { max: 64 })
    }
  }));
}

const createSignedPriorEvidenceRecord = async ({
  identity,
  roomId,
  questionHash,
  evidenceKind,
  summary,
  reference,
  annotation = null,
  reuseContext = null,
  conditions = {},
  transformations = [],
  uncertainty = {},
  provenance = {},
  finding = {},
  createdAt = new Date().toISOString()
} = {}, { publicProteinEvidence = false } = {}) => {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.priorEvidence);
  const category = compactText(evidenceKind, 40).toLowerCase();
  if (!PRIOR_EVIDENCE_KINDS.includes(category)) throw new TypeError('prior evidence kind is not supported');
  if (PUBLIC_FINDING_EVIDENCE_KINDS.includes(category) && !publicProteinEvidence) {
    throw new TypeError('assay, negative-result, and failed-attempt imports require the public protein evidence contract');
  }
  const normalizedSummary = compactText(summary);
  if (!normalizedSummary) throw new TypeError('prior evidence summary is required');
  const retrievalMethod = compactText(provenance.retrievalMethod || provenance.method, 500);
  const retrievedAt = compactText(provenance.retrievedAt, 64) || createdAt;
  if (!retrievalMethod || !Number.isFinite(Date.parse(retrievedAt))) {
    throw new TypeError('prior evidence retrieval method and timestamp are required');
  }
  const normalizedReference = normalizeReferenceIdentity(reference);
  const normalizedAnnotation = annotation ? await normalizeProteinAnnotationIdentity(annotation) : null;
  const normalizedReuseContext = reuseContext ? await normalizeCrossRoomReuseContext(reuseContext) : null;
  const normalizedConditions = normalizeConditions(conditions);
  const normalizedTransformations = normalizeTransformations(transformations);
  const normalizedProvenance = {
    retrievedAt,
    retrievalMethod,
    retrievedBy: compactText(provenance.retrievedBy, 500) || author.roleId,
    sourceIdentity: compactText(provenance.sourceIdentity, 500),
    license: compactText(provenance.license, 240)
  };
  const publicProfile = publicProteinEvidence
    ? normalizePublicProteinEvidenceProfile({
      evidenceKind: category,
      conditions: normalizedConditions,
      transformations: normalizedTransformations,
      provenance: normalizedProvenance,
      finding
    })
    : null;
  if (publicProteinEvidence && ANNOTATION_EVIDENCE_KINDS.includes(category) && !normalizedAnnotation) {
    throw new TypeError('public annotation and domain evidence requires a normalized annotation identity');
  }
  if (category === 'domain' && normalizedAnnotation?.scope !== 'domain') {
    throw new TypeError('domain evidence requires a domain annotation scope');
  }
  if (normalizedReuseContext && normalizedReference.contentHash !== normalizedReuseContext.originRecordHash) {
    throw new TypeError('cross-room reuse reference must bind the exact origin record hash');
  }
  return signResearchRecord(RESEARCH_RECORD_KINDS.priorEvidence, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: requireHash(questionHash, 'questionHash'),
    evidence: {
      ...(publicProfile || {}),
      kind: category,
      summary: normalizedSummary,
      reference: normalizedReference,
      ...(normalizedAnnotation ? { annotation: normalizedAnnotation } : {}),
      ...(normalizedReuseContext ? { reuseContext: normalizedReuseContext } : {}),
      conditions: normalizedConditions,
      transformations: normalizedTransformations,
      uncertainty: normalizeUncertainty(uncertainty),
      provenance: normalizedProvenance
    }
  }));
};

export async function createSignedPriorEvidence(options = {}) {
  return createSignedPriorEvidenceRecord(options);
}

export async function createSignedPublicProteinEvidence(options = {}) {
  return createSignedPriorEvidenceRecord(options, { publicProteinEvidence: true });
}

export async function createSignedResearchPrediction({
  identity,
  roomId,
  questionHash,
  hypothesisHash,
  method,
  expectedObservation,
  normalizedLabel,
  conditions = {},
  confidence,
  outcomeAccess = 'blinded',
  receiptHashes = [],
  frozenAt = new Date().toISOString(),
  createdAt = frozenAt
} = {}) {
  const { author, privateKey } = await createAuthor(identity, RESEARCH_RECORD_KINDS.prediction);
  const normalizedObservation = compactText(expectedObservation);
  const label = compactText(normalizedLabel, 240).toLowerCase();
  if (!normalizedObservation || !label) throw new TypeError('predicted observation and normalized label are required');
  const normalizedConfidence = Number(confidence);
  if (!isUnitInterval(normalizedConfidence)) {
    throw new TypeError('prediction confidence must be between 0 and 1');
  }
  if (!PREDICTION_OUTCOME_ACCESS.includes(outcomeAccess)) throw new TypeError('prediction outcome access must be blinded or not_available');
  if (!Number.isFinite(Date.parse(frozenAt))) throw new TypeError('prediction frozenAt must be an ISO timestamp');
  const analysis = await normalizeAnalysisIdentity(method);
  const linkedReceipts = normalizeHashList(receiptHashes, 'prediction receipt', { max: 64 });
  if (!analysis.artifactHash && linkedReceipts.length === 0) {
    throw new TypeError('prediction requires an exact method artifact hash or receipt hash');
  }
  return signResearchRecord(RESEARCH_RECORD_KINDS.prediction, { roomId, createdAt, author, privateKey }, async () => ({
    questionHash: requireHash(questionHash, 'questionHash'),
    hypothesisHash: requireHash(hypothesisHash, 'hypothesisHash'),
    prediction: {
      method: analysis,
      expectedObservation: normalizedObservation,
      normalizedLabel: label,
      conditions: normalizeConditions(conditions),
      confidence: normalizedConfidence,
      outcomeAccess,
      receiptHashes: linkedReceipts,
      frozenAt
    }
  }));
}
