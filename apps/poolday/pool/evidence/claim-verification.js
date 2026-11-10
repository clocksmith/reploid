/** Field verification for human claims, candidate actions, hypotheses, prior evidence and predictions. */
import {
  EVIDENCE_RELATIONS,
  HUMAN_CLAIM_KINDS,
  PREDICTION_OUTCOME_ACCESS,
  PRIOR_EVIDENCE_KINDS,
  PUBLIC_FINDING_EVIDENCE_KINDS,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_RECORD_KINDS,
  RESEARCH_REVIEW_DECISIONS
} from '../evidence-record-contract.js';
import {
  isHashList,
  isSha256,
  isUnitInterval,
  sameJson
} from './primitives.js';
import {
  normalizeContextualReuseReview,
  normalizeCrossRoomReuseContext
} from './cross-room-normalization.js';
import {
  normalizeTaskApprovalContract
} from './discovery-normalization.js';
import {
  annotationIdentityMissing,
  conditionsHaveContent,
  normalizeProteinAnnotationIdentity,
  normalizeReferenceIdentity,
  normalizeTransformations,
  publicProteinEvidenceProfileOf
} from './scientific-normalization.js';
import {
  checkCanonical,
  verifyAnalysisEvidence
} from './verification-checks.js';
import {
  normalizeDiscoveryCandidateAction
} from '../discovery-candidate-action.js';

const verifyHumanClaimFields = async (record, reasons, { legacyRecord }) => {
  if (!isSha256(record.targetHash)) reasons.push('claim targetHash is invalid');
  if (!HUMAN_CLAIM_KINDS.includes(record.claim?.kind)) reasons.push('human claim kind is invalid');
  if (!EVIDENCE_RELATIONS.includes(record.claim?.relation)) reasons.push('human claim relation is invalid');
  if (!record.claim?.text) reasons.push('human claim text is required');
  if (!isUnitInterval(record.claim?.confidence)) reasons.push('human claim confidence is invalid');
  if (!Array.isArray(record.claim?.evidenceLinks)) reasons.push('human claim evidenceLinks must be an array');
  for (const link of record.claim?.evidenceLinks || []) {
    try {
      const url = new URL(link?.url);
      if (!['http:', 'https:'].includes(url.protocol)) reasons.push('human claim evidence link protocol is invalid');
    } catch {
      reasons.push('human claim evidence link is invalid');
    }
  }
  if (record.claim?.kind === 'review_decision'
    && (!RESEARCH_REVIEW_DECISIONS.includes(record.claim?.decision) || record.claim?.relation !== 'reviews')) {
    reasons.push('human review decision is invalid');
  }
  if (record.claim?.kind === 'task_approval'
    && (record.claim?.decision !== 'approved' || record.claim?.relation !== 'approves' || !record.claim?.taskId)) {
    reasons.push('human task approval is invalid');
  } else if (record.claim?.kind === 'task_approval' && (!legacyRecord || record.claim?.taskContract)) {
    await checkCanonical(reasons, 'human task approval contract', record.claim.taskContract, () => normalizeTaskApprovalContract(
      record.claim?.taskContract,
      record.claim?.taskId,
      record.targetHash
    ));
  }
  if (record.claim?.kind === 'candidate_action_approval'
    && (record.claim?.decision !== 'approved'
      || record.claim?.relation !== 'approves'
      || !isSha256(record.claim?.actionContractHash))) {
    reasons.push('human candidate action approval is invalid');
  }
  if (record.claim?.contextAssessment) {
    if (record.claim?.kind !== 'review_decision') reasons.push('contextual reuse assessment requires a review decision');
    await checkCanonical(reasons, 'contextual reuse review', record.claim.contextAssessment,
      () => normalizeContextualReuseReview(record.claim.contextAssessment));
  }
};

const verifyCandidateActionFields = async (record, reasons) => {
  if (!isSha256(record.questionHash)) reasons.push('candidate action questionHash is invalid');
  try {
    const normalized = await normalizeDiscoveryCandidateAction(record.action);
    if (normalized.questionHash !== record.questionHash) reasons.push('candidate action question identity does not match its record');
    if (!sameJson(normalized, record.action)) reasons.push('candidate action contract is not canonical');
  } catch (error) {
    reasons.push(error.message);
  }
};

const verifyHypothesisFields = async (record, reasons) => {
  if (!isSha256(record.questionHash)) reasons.push('hypothesis questionHash is invalid');
  if (!record.hypothesis?.statement) reasons.push('hypothesis statement is required');
  if (!conditionsHaveContent(record.hypothesis?.conditions)) reasons.push('hypothesis conditions are required');
  if (!Array.isArray(record.hypothesis?.discriminatingObservations) || record.hypothesis.discriminatingObservations.length === 0) {
    reasons.push('hypothesis discriminating observations are required');
  }
  for (const hash of [...(record.hypothesis?.priorEvidenceHashes || []), ...(record.hypothesis?.alternativeToHashes || [])]) {
    if (!isSha256(hash)) reasons.push('hypothesis linked record hash is invalid');
  }
};

const verifyPriorEvidenceFields = async (record, reasons) => {
  if (!isSha256(record.questionHash)) reasons.push('prior evidence questionHash is invalid');
  if (!PRIOR_EVIDENCE_KINDS.includes(record.evidence?.kind)) reasons.push('prior evidence kind is invalid');
  if (!record.evidence?.summary) reasons.push('prior evidence summary is required');
  try {
    normalizeReferenceIdentity(record.evidence?.reference);
    const transformations = normalizeTransformations(record.evidence?.transformations);
    if (PUBLIC_FINDING_EVIDENCE_KINDS.includes(record.evidence?.kind)
      && record.evidence?.schema !== PUBLIC_PROTEIN_EVIDENCE_VERSION) {
      reasons.push('assay, negative-result, and failed-attempt evidence requires the public protein evidence contract');
    }
    if (record.evidence?.schema) {
      if (record.evidence.schema !== PUBLIC_PROTEIN_EVIDENCE_VERSION) {
        reasons.push('public protein evidence schema is unsupported');
      } else {
        const normalizedProfile = publicProteinEvidenceProfileOf(record.evidence, transformations);
        const declaredProfile = {
          schema: record.evidence.schema,
          access: record.evidence.access,
          finding: record.evidence.finding
        };
        if (!sameJson(normalizedProfile, declaredProfile)) {
          reasons.push('public protein evidence profile is not canonical');
        }
        if (annotationIdentityMissing(record.evidence)) {
          reasons.push('public annotation and domain evidence requires a normalized annotation identity');
        }
      }
    }
    if (record.evidence?.annotation) {
      const normalizedAnnotation = await normalizeProteinAnnotationIdentity(record.evidence.annotation);
      if (!sameJson(normalizedAnnotation, record.evidence.annotation)) {
        reasons.push('prior evidence protein annotation identity is not canonical');
      }
      if (record.evidence.kind === 'domain' && normalizedAnnotation.scope !== 'domain') {
        reasons.push('domain evidence requires a domain annotation scope');
      }
    }
    if (record.evidence?.reuseContext) {
      const normalizedReuseContext = await normalizeCrossRoomReuseContext(record.evidence.reuseContext);
      if (!sameJson(normalizedReuseContext, record.evidence.reuseContext)) {
        reasons.push('cross-room reuse context is not canonical');
      }
      if (record.evidence.reference?.contentHash !== normalizedReuseContext.originRecordHash) {
        reasons.push('cross-room reuse reference does not match its origin record');
      }
    }
  } catch (error) {
    reasons.push(error.message);
  }
  if (!record.evidence?.provenance?.retrievalMethod || !Number.isFinite(Date.parse(record.evidence?.provenance?.retrievedAt || ''))) {
    reasons.push('prior evidence provenance is incomplete');
  }
};

const verifyPredictionFields = async (record, reasons) => {
  if (!isSha256(record.questionHash) || !isSha256(record.hypothesisHash)) {
    reasons.push('prediction question or hypothesis identity is invalid');
  }
  if (!record.prediction?.expectedObservation || !record.prediction?.normalizedLabel) reasons.push('prediction observation and label are required');
  if (!isUnitInterval(record.prediction?.confidence)) reasons.push('prediction confidence is invalid');
  if (!PREDICTION_OUTCOME_ACCESS.includes(record.prediction?.outcomeAccess)) reasons.push('prediction outcome access is invalid');
  if (!Number.isFinite(Date.parse(record.prediction?.frozenAt || ''))) reasons.push('prediction frozenAt is invalid');
  if (!isHashList(record.prediction?.receiptHashes)) {
    reasons.push('prediction receipt hashes are invalid');
  }
  await verifyAnalysisEvidence(record.prediction?.method, reasons, 'prediction method');
  if (!record.prediction?.method?.artifactHash && record.prediction?.receiptHashes?.length === 0) {
    reasons.push('prediction exact method artifact or receipt evidence is required');
  }
};

export const claimRecordVerifiers = Object.freeze([
  [RESEARCH_RECORD_KINDS.claim, verifyHumanClaimFields],
  [RESEARCH_RECORD_KINDS.candidateAction, verifyCandidateActionFields],
  [RESEARCH_RECORD_KINDS.hypothesis, verifyHypothesisFields],
  [RESEARCH_RECORD_KINDS.priorEvidence, verifyPriorEvidenceFields],
  [RESEARCH_RECORD_KINDS.prediction, verifyPredictionFields]
]);
