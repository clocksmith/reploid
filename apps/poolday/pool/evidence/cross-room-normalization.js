/** Cross-room source identity, reuse context, and contextual reuse review normalization. */
import {
  CONTEXTUAL_REUSE_REVIEW_VERSION,
  CROSS_ROOM_REUSE_CONTEXT_VERSION,
  CROSS_ROOM_SOURCE_IDENTITY_VERSION,
  PRIOR_EVIDENCE_KINDS,
  ANNOTATION_EVIDENCE_KINDS,
  RESEARCH_RECORD_KINDS,
  compareDecisionContextSnapshots,
  decisionContextIntent,
  decisionContextSnapshot,
  normalizeRoomId
} from '../evidence-record-contract.js';
import {
  SHA256_PATTERN,
  compactText,
  hasPublicEvidenceConsent,
  requireHash,
  withContentHash
} from './primitives.js';
import {
  hashJson
} from '../../../../shared/pool/inference-receipt.js';

const normalizeDecisionContextSnapshot = async (snapshot = {}, label) => withContentHash({
  questionHash: requireHash(snapshot.questionHash, `${label} questionHash`),
  roomId: normalizeRoomId(snapshot.roomId),
  sequenceHash: requireHash(snapshot.sequenceHash, `${label} sequenceHash`),
  consent: {
    publicSequence: snapshot.consent?.publicSequence === true,
    publicEvidenceNetwork: snapshot.consent?.publicEvidenceNetwork === true
  },
  intent: decisionContextIntent(snapshot.intent)
}, 'snapshotHash');

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
  if (ANNOTATION_EVIDENCE_KINDS.includes(normalized.evidenceKind) && !normalized.annotationIdentityHash) {
    throw new TypeError('cross-room annotation source requires a normalized annotation identity');
  }
  return withContentHash(normalized, 'identityHash');
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
    if (!hasPublicEvidenceConsent(question)) {
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
  return withContentHash(normalized, 'assessmentHash');
};
