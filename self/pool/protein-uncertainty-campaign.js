/**
 * @fileoverview Deterministic cross-protein disagreement queue for Poolday.
 */

import {
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  activeResearchRecords,
  projectAcceptedResearchMemory,
  projectResearchReviewStates
} from './evidence-network.js';
import { canonicalize } from './canonical-json.js';
import { exactModelContractKey } from './model-contract.js';

export const PROTEIN_UNCERTAINTY_CAMPAIGN_QUEUE_VERSION = 'poolday.protein_uncertainty_campaign_queue/v1';
export const PROTEIN_UNCERTAINTY_CAMPAIGN_POLICY = Object.freeze({
  policyId: 'poolday.public_protein_disagreement_queue',
  version: '1.0.0',
  method: 'count_declared_disagreement_dimensions',
  status: 'heuristic_not_calibrated',
  dimensions: Object.freeze([
    'exact_contract_embedding',
    'public_annotation',
    'independent_reviewer',
    'experimental_evidence'
  ]),
  tieBreak: Object.freeze(['disagreementCount:descending', 'sequenceHash:ascending'])
});

const asArray = (value) => Array.isArray(value) ? value : [];
const unique = (values) => [...new Set(values.filter(Boolean))];
const sortedUnique = (values) => unique(values).sort();
const recordOrder = (left, right) => (
  String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''))
  || String(left?.recordHash || '').localeCompare(String(right?.recordHash || ''))
);

const questionHashForRecord = (record, recordsByHash, seen = new Set()) => {
  if (!record || seen.has(record.recordHash)) return null;
  seen.add(record.recordHash);
  if (record.kind === 'research_submission') return record.recordHash;
  if (record.questionHash) return record.questionHash;
  if (record.kind === 'research_result') return record.submissionHash || null;
  if (record.kind === 'human_claim') {
    return questionHashForRecord(recordsByHash.get(record.targetHash), recordsByHash, seen);
  }
  if (record.kind === 'research_work_claim') {
    return questionHashForRecord(recordsByHash.get(record.workOrderHash), recordsByHash, seen);
  }
  return null;
};

const dimension = (status, evidenceRecordHashes, detail, extra = {}) => ({
  status,
  evidenceRecordHashes: sortedUnique(evidenceRecordHashes),
  detail,
  ...extra
});

const projectEmbeddingDisagreement = (records) => {
  const groups = new Map();
  for (const record of records.filter((entry) => (
    entry.kind === 'research_result' && entry.embedding?.vectorHash
  ))) {
    const key = exactModelContractKey(record.modelContract);
    const group = groups.get(key) || [];
    group.push(record);
    groups.set(key, group);
  }
  const comparable = [...groups.entries()].filter(([, group]) => group.length >= 2);
  const disagreements = comparable.filter(([, group]) => (
    new Set(group.map((record) => record.embedding.vectorHash)).size > 1
  ));
  const evidence = (disagreements.length ? disagreements : comparable)
    .flatMap(([, group]) => group.map((record) => record.recordHash));
  if (disagreements.length) {
    return dimension(
      'disagreement',
      evidence,
      'At least one exact model contract produced distinct signed embedding commitments for this exact sequence.',
      { exactContractCount: comparable.length, disagreeingContractCount: disagreements.length }
    );
  }
  if (comparable.length) {
    return dimension(
      'no_disagreement_observed',
      evidence,
      'Repeated accepted embeddings agree within each exact model contract; no cross-contract vector comparison was performed.',
      { exactContractCount: comparable.length, disagreeingContractCount: 0 }
    );
  }
  return dimension(
    'insufficient_evidence',
    records.filter((record) => record.kind === 'research_result').map((record) => record.recordHash),
    'Fewer than two accepted embeddings share an exact model contract.',
    { exactContractCount: 0, disagreeingContractCount: 0 }
  );
};

const projectAnnotationDisagreement = (records) => {
  const annotations = records.filter((record) => (
    record.kind === 'research_prior_evidence'
    && record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
    && ['annotation', 'domain'].includes(record.evidence?.kind)
    && record.evidence?.annotation?.identityHash
  ));
  const groups = new Map();
  for (const record of annotations) {
    const annotation = record.evidence.annotation;
    const coordinates = annotation.coordinates || {};
    if (!annotation.scope || !Number.isInteger(coordinates.start) || !Number.isInteger(coordinates.end)) continue;
    const key = canonicalize({
      scope: annotation.scope,
      sequenceHash: annotation.sequence?.hash || null,
      coordinateSystem: coordinates.canonicalSystem,
      start: coordinates.start,
      end: coordinates.end
    });
    groups.set(key, [...(groups.get(key) || []), record]);
  }
  const comparable = [...groups.values()].filter((group) => group.length >= 2);
  const disagreements = comparable.filter((group) => (
    new Set(group.map((record) => record.evidence.annotation.identityHash)).size > 1
  ));
  const evidence = (disagreements.length ? disagreements : comparable)
    .flatMap((group) => group.map((record) => record.recordHash));
  const identities = sortedUnique((disagreements.length ? disagreements.flat() : annotations)
    .map((record) => record.evidence.annotation.identityHash));
  if (disagreements.length) {
    return dimension(
      'disagreement',
      evidence,
      'Accepted public sources declare different normalized identities for the same annotation scope and canonical residue interval.',
      { annotationIdentityHashes: identities, comparableLocusCount: comparable.length, disagreeingLocusCount: disagreements.length }
    );
  }
  if (comparable.length) {
    return dimension(
      'no_disagreement_observed',
      evidence,
      'Comparable accepted public annotations resolve to one normalized identity.',
      { annotationIdentityHashes: identities, comparableLocusCount: comparable.length, disagreeingLocusCount: 0 }
    );
  }
  return dimension(
    'insufficient_evidence',
    annotations.map((record) => record.recordHash),
    'Fewer than two accepted normalized public annotations share a scope and canonical residue interval.',
    { annotationIdentityHashes: identities, comparableLocusCount: 0, disagreeingLocusCount: 0 }
  );
};

const projectReviewerDisagreement = (reviewStates, questionHashes, recordsByHash) => {
  const relevant = reviewStates.filter((entry) => {
    const target = recordsByHash.get(entry.recordHash);
    return questionHashes.has(questionHashForRecord(target, recordsByHash));
  });
  const disputed = relevant.filter((entry) => entry.state === 'disputed');
  const decisionHashes = relevant.flatMap((entry) => entry.decisions.map((record) => record.recordHash));
  if (disputed.length) {
    return dimension(
      'disagreement',
      [...disputed.map((entry) => entry.recordHash), ...decisionHashes],
      'Independent reviewers recorded conflicting current decisions for evidence tied to this protein.',
      { disputedTargetHashes: disputed.map((entry) => entry.recordHash).sort() }
    );
  }
  if (decisionHashes.length) {
    return dimension(
      'no_disagreement_observed',
      decisionHashes,
      'Reviewer decisions exist, but no target has conflicting current independent decisions.',
      { disputedTargetHashes: [] }
    );
  }
  return dimension('insufficient_evidence', [], 'No independent reviewer decision is available.', {
    disputedTargetHashes: []
  });
};

const experimentalFinding = (record) => {
  if (record.kind === 'research_outcome') {
    return {
      classification: record.outcome?.attempt?.status === 'completed'
        ? record.outcome?.classification
        : 'not_observed',
      attemptStatus: record.outcome?.attempt?.status,
      conditionKey: canonicalize(record.outcome?.protocol?.conditions || {})
    };
  }
  if (record.kind === 'research_prior_evidence'
    && record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
    && ['assay', 'negative_result', 'failed_attempt'].includes(record.evidence?.kind)) {
    return {
      classification: record.evidence.finding?.classification,
      attemptStatus: record.evidence.finding?.attempt?.status,
      conditionKey: canonicalize(record.evidence?.conditions || {})
    };
  }
  return null;
};

const projectExperimentalDisagreement = (records) => {
  const evidence = records.map((record) => ({ record, finding: experimentalFinding(record) }))
    .filter((entry) => entry.finding);
  const groups = new Map();
  for (const entry of evidence) {
    const group = groups.get(entry.finding.conditionKey) || [];
    group.push(entry);
    groups.set(entry.finding.conditionKey, group);
  }
  const comparable = [...groups.values()].filter((group) => (
    group.filter((entry) => entry.finding.attemptStatus === 'completed').length >= 2
  ));
  const disagreements = comparable.filter((group) => (
    new Set(group
      .filter((entry) => entry.finding.attemptStatus === 'completed')
      .map((entry) => entry.finding.classification)).size > 1
  ));
  const failedAttemptHashes = evidence
    .filter((entry) => entry.finding.attemptStatus === 'failed')
    .map((entry) => entry.record.recordHash)
    .sort();
  const evidenceHashes = evidence.map((entry) => entry.record.recordHash);
  if (disagreements.length) {
    return dimension(
      'disagreement',
      evidenceHashes,
      'Completed accepted experimental findings disagree under the same declared conditions.',
      { disagreeingConditionCount: disagreements.length, failedAttemptHashes }
    );
  }
  if (comparable.length) {
    return dimension(
      'no_disagreement_observed',
      evidenceHashes,
      'Comparable completed experimental findings do not currently disagree.',
      { disagreeingConditionCount: 0, failedAttemptHashes }
    );
  }
  return dimension(
    'insufficient_evidence',
    evidenceHashes,
    failedAttemptHashes.length
      ? 'Failed attempts remain visible, but fewer than two completed findings are comparable.'
      : 'Fewer than two completed accepted findings share declared conditions.',
    { disagreeingConditionCount: 0, failedAttemptHashes }
  );
};

export function projectProteinUncertaintyCampaignQueue(records = [], { limit = 1000 } = {}) {
  const requestedLimit = Number(limit || 1000);
  if (!Number.isFinite(requestedLimit)) throw new TypeError('campaign queue limit must be a finite number');
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(requestedLimit)));
  const byHash = new Map();
  for (const record of asArray(records)) if (record?.recordHash) byHash.set(record.recordHash, record);
  const snapshot = [...byHash.values()].sort(recordOrder).slice(-boundedLimit);
  const recordsByHash = new Map(snapshot.map((record) => [record.recordHash, record]));
  const rooms = new Map();
  for (const record of snapshot) rooms.set(record.roomId, [...(rooms.get(record.roomId) || []), record]);
  const active = [...rooms.values()].flatMap((roomRecords) => activeResearchRecords(roomRecords));
  const activeByHash = new Map(active.map((record) => [record.recordHash, record]));
  const accepted = [...new Map([...rooms.values()].flatMap((roomRecords) => (
    projectAcceptedResearchMemory(roomRecords).records.map((record) => [record.recordHash, record])
  ))).values()];
  const reviewStates = [...rooms.values()].flatMap((roomRecords) => projectResearchReviewStates(roomRecords));
  const publicQuestions = active.filter((record) => (
    record.kind === 'research_submission'
    && record.sequence?.alphabet === 'amino_acid'
    && record.consent?.publicSequence === true
    && record.consent?.publicEvidenceNetwork === true
  ));
  const questionsBySequence = new Map();
  for (const question of publicQuestions) {
    questionsBySequence.set(question.sequence.hash, [
      ...(questionsBySequence.get(question.sequence.hash) || []),
      question
    ]);
  }
  const entries = [...questionsBySequence.entries()].map(([sequenceHash, questions]) => {
    const questionHashes = new Set(questions.map((question) => question.recordHash));
    const acceptedEvidence = accepted.filter((record) => questionHashes.has(
      questionHashForRecord(record, activeByHash)
    ));
    const dimensions = {
      exactContractEmbedding: projectEmbeddingDisagreement(acceptedEvidence),
      publicAnnotation: projectAnnotationDisagreement(acceptedEvidence),
      independentReviewer: projectReviewerDisagreement(reviewStates, questionHashes, recordsByHash),
      experimentalEvidence: projectExperimentalDisagreement(acceptedEvidence)
    };
    const disagreementCount = Object.values(dimensions)
      .filter((entry) => entry.status === 'disagreement').length;
    const anchor = questions.slice().sort(recordOrder)[0];
    return {
      sequence: {
        hash: sequenceHash,
        alphabet: anchor.sequence.alphabet,
        length: anchor.sequence.length
      },
      label: anchor.requesterIntent?.label || anchor.requesterIntent?.text || sequenceHash,
      questionHashes: questions.map((question) => question.recordHash).sort(),
      roomIds: sortedUnique(questions.map((question) => question.roomId)),
      dimensions,
      priority: {
        disagreementCount,
        status: PROTEIN_UNCERTAINTY_CAMPAIGN_POLICY.status,
        eligible: disagreementCount > 0
      },
      evidenceRecordHashes: sortedUnique(Object.values(dimensions)
        .flatMap((entry) => entry.evidenceRecordHashes))
    };
  }).sort((left, right) => (
    right.priority.disagreementCount - left.priority.disagreementCount
    || left.sequence.hash.localeCompare(right.sequence.hash)
  )).map((entry, index) => ({ ...entry, rank: index + 1 }));

  return {
    schema: PROTEIN_UNCERTAINTY_CAMPAIGN_QUEUE_VERSION,
    policy: {
      ...PROTEIN_UNCERTAINTY_CAMPAIGN_POLICY,
      dimensions: [...PROTEIN_UNCERTAINTY_CAMPAIGN_POLICY.dimensions],
      tieBreak: [...PROTEIN_UNCERTAINTY_CAMPAIGN_POLICY.tieBreak]
    },
    boundary: byHash.size >= boundedLimit ? 'bounded_input_snapshot' : 'input_snapshot',
    complete: byHash.size < boundedLimit,
    inputRecordHashes: snapshot.map((record) => record.recordHash).sort(),
    entries
  };
}

export default { projectProteinUncertaintyCampaignQueue };
