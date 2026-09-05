/** Read-only discovery and reward projections over admitted evidence. */
import {
  CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM,
  PROTEIN_ANNOTATION_SCOPES,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  RESEARCH_RECORD_KINDS,
  SHA256_PATTERN,
  compactText,
  projectResearchExecutionIndependence,
  projectResearchQuestionClarity,
  stableTaskId,
  unique
} from './evidence-record-contract.js';
import {
  REALIZED_ACTION_VALUE_REWARD_POLICY
} from './realized-action-value.js';
import {
  SEQUENCE_ALPHABETS
} from './sequence-workload.js';
import {
  activeResearchRecords,
  invalidatedResearchHashes,
  projectAcceptedResearchMemory,
  projectResearchReviewStates,
  researchRecordTargetHashes
} from './evidence-admission.js';
import {
  buildExactModelEvidenceView
} from './model-evidence-view.js';
import {
  crossRoomSourceIdentityKey,
  normalizePublicProteinEvidenceProfile,
  projectDiscoveryTaskContract
} from './evidence-normalization.js';
import {
  exactModelContractKey
} from './model-contract.js';
import {
  rankDiscoveryActions
} from './discovery-action-value.js';
import {
  rankSignedCandidateActions
} from './discovery-candidate-action.js';
export function buildPredictionDisagreementMap(records = [], questionHash = null) {
  const active = activeResearchRecords(records);
  const predictions = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction
    && (!questionHash || record.questionHash === questionHash));
  const conditions = new Map();
  for (const prediction of predictions) {
    const conditionKey = JSON.stringify(prediction.prediction.conditions || {});
    if (!conditions.has(conditionKey)) conditions.set(conditionKey, {
      conditionKey,
      conditions: prediction.prediction.conditions,
      predictions: [],
      labels: new Map()
    });
    const group = conditions.get(conditionKey);
    group.predictions.push(prediction);
    const label = prediction.prediction.normalizedLabel;
    group.labels.set(label, [...(group.labels.get(label) || []), prediction]);
  }
  return [...conditions.values()].map((group) => {
    const labels = [...group.labels.entries()].map(([label, entries]) => ({
      label,
      count: entries.length,
      meanConfidence: entries.reduce((sum, entry) => sum + entry.prediction.confidence, 0) / entries.length,
      methodIds: unique(entries.map((entry) => entry.prediction.method.methodId)),
      predictionHashes: entries.map((entry) => entry.recordHash)
    }));
    return {
      conditionKey: group.conditionKey,
      conditions: group.conditions,
      predictionCount: group.predictions.length,
      labels,
      disagreement: labels.length > 1,
      unresolved: labels.length !== 1
    };
  });
}

export function buildModelEvidenceView(records = [], submissionHash) {
  return buildExactModelEvidenceView(activeResearchRecords(records), submissionHash);
}

export function buildQuestionLifecycles(records = []) {
  const active = activeResearchRecords(records);
  const reviews = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  return active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)
    .map((question) => {
      const matchesQuestion = (record) => record.questionHash === question.recordHash;
      const hypotheses = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.hypothesis && matchesQuestion(record));
      const priorEvidence = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence && matchesQuestion(record));
      const predictions = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction && matchesQuestion(record));
      const resolutionPolicies = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy && matchesQuestion(record));
      const workOrders = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workOrder && matchesQuestion(record));
      const workOrderHashes = new Set(workOrders.map((record) => record.recordHash));
      const workClaims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workClaim && workOrderHashes.has(record.workOrderHash));
      const outcomes = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome && matchesQuestion(record));
      const cohorts = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.cohort && record.cohort.questionHashes.includes(question.recordHash));
      const cohortHashes = new Set(cohorts.map((record) => record.recordHash));
      const evaluations = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation && cohortHashes.has(record.cohortHash));
      const realizedActionValues = active.filter((record) => (
        record.kind === RESEARCH_RECORD_KINDS.realizedActionValue
        && record.questionHash === question.recordHash
      ));
      return {
        question,
        modelEvidence: buildModelEvidenceView(active, question.recordHash),
        hypotheses,
        priorEvidence,
        predictions,
        resolutionPolicies,
        disagreementMap: buildPredictionDisagreementMap(active, question.recordHash),
        workOrders,
        workClaims,
        outcomes,
        claimStates: [...hypotheses, ...priorEvidence, ...predictions, ...workOrders, ...outcomes]
          .map((record) => reviews.get(record.recordHash) || { recordHash: record.recordHash, state: 'unresolved', decisions: [] }),
        cohorts,
        evaluations,
        realizedActionValues,
        measuredEffects: evaluations.flatMap((record) => record.evaluation.metricResults.map((metric) => ({
          evaluationHash: record.recordHash,
          cohortHash: record.cohortHash,
          ...metric
        })))
      };
    });
}

export function projectResearchResolutionCriteria(records = [], questionHash) {
  const active = activeResearchRecords(records);
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const policies = active
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.resolutionPolicy && record.questionHash === questionHash)
    .sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || ''))
      || String(left.recordHash || '').localeCompare(String(right.recordHash || '')));
  const accepted = policies.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted');
  const policy = accepted.at(-1) || policies.at(-1) || null;
  return {
    schema: 'poolday.research_resolution_projection/v1',
    questionHash,
    status: !policy ? 'policy_missing' : accepted.includes(policy) ? 'criteria_frozen' : 'awaiting_independent_review',
    policyHash: policy?.recordHash || null,
    policy: policy?.policy || null,
    reviewState: policy ? reviewStates.get(policy.recordHash)?.state || 'unresolved' : 'missing',
    closureAuthority: 'none',
    closureState: 'not_evaluated',
    boundary: 'Criteria define future eligibility only; this projection cannot accept, reject, or close a scientific question.'
  };
}

const researchRecordLabel = (record = {}) => ({
  [RESEARCH_RECORD_KINDS.submission]: record.requesterIntent?.label || record.requesterIntent?.text || record.sequence?.hash,
  [RESEARCH_RECORD_KINDS.result]: record.modelContract?.id,
  [RESEARCH_RECORD_KINDS.claim]: record.claim?.text,
  [RESEARCH_RECORD_KINDS.hypothesis]: record.hypothesis?.statement,
  [RESEARCH_RECORD_KINDS.priorEvidence]: record.evidence?.summary,
  [RESEARCH_RECORD_KINDS.prediction]: record.prediction?.expectedObservation,
  [RESEARCH_RECORD_KINDS.resolutionPolicy]: `${record.policy?.conclusionLabel || 'Resolution'} criteria`,
  [RESEARCH_RECORD_KINDS.workOrder]: record.work?.title,
  [RESEARCH_RECORD_KINDS.workClaim]: record.workClaim?.laboratory?.name,
  [RESEARCH_RECORD_KINDS.outcome]: record.outcome?.summary,
  [RESEARCH_RECORD_KINDS.cohort]: record.cohort?.label,
  [RESEARCH_RECORD_KINDS.evaluation]: record.evaluation?.metricResults?.map((metric) => metric.metricId).join(', '),
  [RESEARCH_RECORD_KINDS.realizedActionValue]: `${record.realizedValue?.assessment?.status || 'Pending'} realized action value`,
  [RESEARCH_RECORD_KINDS.adjudicationExperiment]: `${record.experiment?.target?.catalogId || 'Catalog'} adjudication experiment`,
  [RESEARCH_RECORD_KINDS.adjudicationEvaluation]: `${record.evaluation?.assessment?.conclusion || 'Pending'} adjudication evaluation`,
  [RESEARCH_RECORD_KINDS.discoveryCheckpoint]: `${record.checkpoint?.state?.status || 'Open'} Discovery Contract checkpoint`,
  [RESEARCH_RECORD_KINDS.candidateAction]: record.action?.title,
  [RESEARCH_RECORD_KINDS.sequenceLink]: 'DNA-to-protein linkage',
  [RESEARCH_RECORD_KINDS.revocation]: record.revocation?.reason
}[record.kind] || record.recordHash);

export function buildEvidenceGraph(records = []) {
  const nodes = records.map((record) => ({
    id: record.recordHash,
    kind: record.kind,
    label: researchRecordLabel(record),
    record
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const addNode = (node) => {
    if (!node?.id || nodeIds.has(node.id)) return;
    nodes.push(node);
    nodeIds.add(node.id);
  };
  for (const record of records) {
    if (record.author?.roleId) {
      const authorNodeId = `identity:${record.author.roleId}`;
      addNode({
        id: authorNodeId,
        kind: 'participant_identity',
        label: record.author.roleId,
        author: record.author
      });
      edges.push({ from: record.recordHash, to: authorNodeId, relation: 'authored_by' });
    }
    const contract = record.modelContract;
    if (contract?.hash && contract?.manifestHash) {
      // A graph node represents an exact model contract, not a broad checkpoint
      // family. Two tokenizer or execution contracts can share weights and a
      // manifest while still producing incomparable representations.
      const modelNodeId = `model:${exactModelContractKey(contract)}`;
      addNode({
        id: modelNodeId,
        kind: 'model_artifact',
        label: contract.id,
        modelContract: contract
      });
      edges.push({
        from: record.recordHash,
        to: modelNodeId,
        relation: record.kind === RESEARCH_RECORD_KINDS.submission ? 'requests' : 'generated_by'
      });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.submission && record.sequence?.hash) {
      const sequenceNodeId = `sequence:${record.sequence.hash}`;
      addNode({
        id: sequenceNodeId,
        kind: record.sequence.alphabet === SEQUENCE_ALPHABETS.nucleotide ? 'dna_sequence' : 'protein_sequence',
        label: record.sequence.hash,
        sequenceHash: record.sequence.hash,
        sequence: record.sequence.value
      });
      edges.push({ from: record.recordHash, to: sequenceNodeId, relation: 'describes' });
    }
    if (record.kind === RESEARCH_RECORD_KINDS.result && nodeIds.has(record.submissionHash)) {
      edges.push({ from: record.recordHash, to: record.submissionHash, relation: 'derived_from' });
      for (const receiptHash of unique(record.compute?.receiptHashes || [record.compute?.receiptHash])) {
        const receiptNodeId = `receipt:${receiptHash}`;
        addNode({ id: receiptNodeId, kind: 'compute_receipt', label: receiptHash, receiptHash });
        edges.push({ from: record.recordHash, to: receiptNodeId, relation: 'backed_by' });
      }
      if (record.compute?.providerId) {
        const providerNodeId = `provider:${record.compute.providerId}`;
        addNode({ id: providerNodeId, kind: 'compute_provider', label: record.compute.providerId });
        edges.push({ from: record.recordHash, to: providerNodeId, relation: 'produced_by' });
      }
      if (record.compute?.routeDecisionHash) {
        const routeNodeId = `route:${record.compute.routeDecisionHash}`;
        addNode({ id: routeNodeId, kind: 'route_decision', label: record.compute.routeDecisionHash });
        edges.push({ from: record.recordHash, to: routeNodeId, relation: 'routed_by' });
      }
      if (record.compute?.runtimeProfileHash) {
        const runtimeNodeId = `runtime:${record.compute.runtimeProfileHash}`;
        addNode({ id: runtimeNodeId, kind: 'runtime_profile', label: record.compute.runtimeProfileHash });
        edges.push({ from: record.recordHash, to: runtimeNodeId, relation: 'ran_on' });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.claim && nodeIds.has(record.targetHash)) {
      edges.push({ from: record.recordHash, to: record.targetHash, relation: record.claim.relation });
    }
    const lifecycleRelation = {
      [RESEARCH_RECORD_KINDS.hypothesis]: 'frames',
      [RESEARCH_RECORD_KINDS.priorEvidence]: 'retrieved_for',
      [RESEARCH_RECORD_KINDS.prediction]: 'predicts',
      [RESEARCH_RECORD_KINDS.resolutionPolicy]: 'governs_resolution_for',
      [RESEARCH_RECORD_KINDS.workOrder]: 'orders',
      [RESEARCH_RECORD_KINDS.workClaim]: 'claims',
      [RESEARCH_RECORD_KINDS.outcome]: record.replicationOfHash ? 'replicates' : 'reports',
      [RESEARCH_RECORD_KINDS.cohort]: 'freezes',
      [RESEARCH_RECORD_KINDS.evaluation]: 'evaluates',
      [RESEARCH_RECORD_KINDS.realizedActionValue]: 'measures_realized_value_from',
      [RESEARCH_RECORD_KINDS.adjudicationEvaluation]: 'evaluates',
      [RESEARCH_RECORD_KINDS.discoveryCheckpoint]: 'freezes_contract_input',
      [RESEARCH_RECORD_KINDS.candidateAction]: 'proposes_action_for',
      [RESEARCH_RECORD_KINDS.sequenceLink]: 'links_translation',
      [RESEARCH_RECORD_KINDS.revocation]: 'revokes'
    }[record.kind];
    if (lifecycleRelation) {
      for (const targetHash of researchRecordTargetHashes(record)) {
        if (nodeIds.has(targetHash)) edges.push({ from: record.recordHash, to: targetHash, relation: lifecycleRelation });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
      for (const inputHash of record.checkpoint?.inputRecordHashes || []) {
        if (nodeIds.has(inputHash)) edges.push({ from: record.recordHash, to: inputHash, relation: 'freezes_contract_archive' });
      }
      for (const parentHash of record.checkpoint?.parentCheckpointHashes || []) {
        if (nodeIds.has(parentHash)) edges.push({ from: record.recordHash, to: parentHash, relation: 'supersedes_checkpoint' });
      }
    }
    if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.evidence?.reference) {
      const reference = record.evidence.reference;
      const sourceIdentity = reference.uri || `${reference.accession}@${reference.version}`;
      const sourceNodeId = `source:${sourceIdentity}`;
      addNode({ id: sourceNodeId, kind: 'evidence_source', label: sourceIdentity, ...reference });
      edges.push({ from: record.recordHash, to: sourceNodeId, relation: 'retrieved_from' });
    }
    for (const source of record.claim?.evidenceLinks || []) {
      const sourceNodeId = `source:${source.url}`;
      addNode({
        id: sourceNodeId,
        kind: 'evidence_source',
        label: source.label || source.url,
        url: source.url
      });
      edges.push({ from: record.recordHash, to: sourceNodeId, relation: 'cites' });
    }
  }
  return { nodes, edges };
}

const modelCompatibilityKey = (record = {}) => {
  const model = record.modelContract || {};
  // Vectors have meaning only within the complete model contract. A model id,
  // manifest, and dimension match is insufficient when tokenizer, artifacts,
  // execution graph, runtime policy, license, or claim boundary differs.
  return exactModelContractKey(model);
};

export const embeddingsAreCompatible = (left, right) => Boolean(
  left?.embedding?.values && right?.embedding?.values
  && left.embedding.dimensions === right.embedding.dimensions
  && modelCompatibilityKey(left) === modelCompatibilityKey(right)
);

export function cosineSimilarity(left = [], right = []) {
  if (!Array.isArray(left) || left.length === 0 || left.length !== right.length) return null;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : null;
}

const acceptedClaimHashes = (records) => {
  return new Set(projectResearchReviewStates(records)
    .filter((entry) => entry.state === 'accepted')
    .map((entry) => entry.recordHash));
};

const claimsForTarget = (records, targetHash) => records.filter((record) => (
  record.kind === RESEARCH_RECORD_KINDS.claim && record.targetHash === targetHash
));

export function searchEvidence(records = [], query = '') {
  const needle = compactText(query).toLowerCase();
  if (!needle) return records.slice();
  return records.filter((record) => JSON.stringify({
    sequence: record.sequence?.value,
    intent: record.requesterIntent,
    model: record.modelContract?.id,
    claim: record.claim,
    hypothesis: record.hypothesis,
    evidence: record.evidence,
    prediction: record.prediction,
    work: record.work,
    workClaim: record.workClaim,
    outcome: record.outcome,
    cohort: record.cohort,
    evaluation: record.evaluation,
    action: record.action,
    revocation: record.revocation,
    author: record.author?.roleId
  }).toLowerCase().includes(needle));
}

const compareResearchRecords = (left, right) => (
  String(left?.createdAt || '').localeCompare(String(right?.createdAt || ''))
  || String(left?.recordHash || '').localeCompare(String(right?.recordHash || ''))
);

const connectedSequenceRoomRecords = (records, roomId, questionHashes) => {
  const roomRecords = records.filter((record) => record.roomId === roomId);
  const roomByHash = new Map(roomRecords.map((record) => [record.recordHash, record]));
  const included = new Set(questionHashes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const record of roomRecords) {
      const targets = researchRecordTargetHashes(record);
      if (!included.has(record.recordHash) && targets.some((targetHash) => included.has(targetHash))) {
        included.add(record.recordHash);
        changed = true;
      }
      if (!included.has(record.recordHash)) continue;
      for (const targetHash of targets) {
        if (!roomByHash.has(targetHash) || included.has(targetHash)) continue;
        included.add(targetHash);
        changed = true;
      }
    }
  }
  return roomRecords.filter((record) => included.has(record.recordHash)).sort(compareResearchRecords);
};

const sourceVersionProjection = (record) => {
  const reference = record.evidence?.reference || {};
  const provenance = record.evidence?.provenance || {};
  return {
    recordHash: record.recordHash,
    evidenceSchema: record.evidence?.schema || null,
    access: record.evidence?.access || null,
    kind: record.evidence?.kind || null,
    uri: reference.uri || null,
    accession: reference.accession || null,
    version: reference.version || null,
    contentHash: reference.contentHash || null,
    license: provenance.license || null,
    retrievedAt: provenance.retrievedAt || null,
    retrievalMethod: provenance.retrievalMethod || null,
    annotation: record.evidence?.annotation || null,
    finding: record.evidence?.finding || null,
    conditions: record.evidence?.conditions || null,
    transformations: record.evidence?.transformations || []
  };
};

const crossRoomQualification = (record) => {
  const reasons = [];
  if (record.kind === RESEARCH_RECORD_KINDS.priorEvidence) {
    const source = sourceVersionProjection(record);
    if (!source.uri && !source.accession) reasons.push('source_identity_missing');
    if (!source.version && !source.contentHash) reasons.push('source_version_missing');
    if (!source.license) reasons.push('source_license_missing');
    if (record.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION) {
      try {
        normalizePublicProteinEvidenceProfile({
          evidenceKind: record.evidence.kind,
          conditions: record.evidence.conditions,
          transformations: record.evidence.transformations,
          provenance: record.evidence.provenance,
          finding: record.evidence.finding
        });
      } catch {
        reasons.push('public_evidence_contract_invalid');
      }
    }
    if (['annotation', 'domain'].includes(record.evidence?.kind)) {
      const annotation = record.evidence?.annotation;
      if (!annotation) reasons.push('annotation_identity_missing');
      else {
        if (!PROTEIN_ANNOTATION_SCOPES.includes(annotation.scope)) reasons.push('annotation_scope_missing');
        if (!annotation.ontology?.namespace || !annotation.ontology?.termId) reasons.push('annotation_ontology_identity_missing');
        if (!annotation.ontology?.version) reasons.push('annotation_ontology_version_missing');
        if (!SHA256_PATTERN.test(String(annotation.sequence?.hash || '')) || !Number.isInteger(annotation.sequence?.length)) {
          reasons.push('annotation_sequence_identity_missing');
        }
        if (annotation.coordinates?.canonicalSystem !== CANONICAL_PROTEIN_ANNOTATION_COORDINATE_SYSTEM
          || !Number.isInteger(annotation.coordinates?.start)
          || !Number.isInteger(annotation.coordinates?.end)) reasons.push('annotation_coordinates_missing');
        if (!SHA256_PATTERN.test(String(annotation.identityHash || ''))) reasons.push('annotation_identity_hash_missing');
      }
    }
  }
  if (record.kind === RESEARCH_RECORD_KINDS.claim && record.claim?.evidenceLinks?.length) {
    reasons.push('linked_source_license_not_declared');
  }
  if (![RESEARCH_RECORD_KINDS.priorEvidence, RESEARCH_RECORD_KINDS.result].includes(record.kind)) {
    reasons.push('contextual_source_qualification_required');
  }
  return {
    status: reasons.length ? 'needs_source_qualification' : 'source_metadata_complete',
    reasons: unique(reasons)
  };
};

/**
 * Project public evidence connected to one exact sequence across room
 * boundaries. Original-room acceptance is preserved as provenance only: no
 * candidate enters another room's decision memory without a new local review.
 */
export function projectCrossRoomSequenceEvidence(records = [], sequenceHash, {
  currentRoomId = null,
  limit = 1000
} = {}) {
  const normalizedHash = compactText(sequenceHash, 160).toLowerCase();
  if (!SHA256_PATTERN.test(normalizedHash)) throw new TypeError('sequenceHash must be a SHA-256 identity');
  const requestedLimit = Number(limit || 1000);
  if (!Number.isFinite(requestedLimit)) throw new TypeError('limit must be a finite number');
  const boundedLimit = Math.max(1, Math.min(1000, Math.floor(requestedLimit)));
  const normalizedCurrentRoomId = compactText(currentRoomId, 160) || null;
  const byHash = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (!record?.recordHash) continue;
    byHash.set(record.recordHash, record);
  }
  const snapshot = [...byHash.values()].sort(compareResearchRecords).slice(-boundedLimit);
  const submissions = snapshot.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.submission
    && record.sequence?.hash === normalizedHash
    && record.consent?.publicSequence === true
    && record.consent?.publicEvidenceNetwork === true
  ));
  const questionsByRoom = new Map();
  for (const submission of submissions) {
    const questions = questionsByRoom.get(submission.roomId) || [];
    questions.push(submission.recordHash);
    questionsByRoom.set(submission.roomId, questions);
  }
  const includedRecords = new Map();
  const rooms = [...questionsByRoom.entries()].map(([roomId, questionHashes]) => {
    const roomRecords = connectedSequenceRoomRecords(snapshot, roomId, questionHashes);
    for (const record of roomRecords) includedRecords.set(record.recordHash, record);
    const active = activeResearchRecords(roomRecords);
    const invalidated = invalidatedResearchHashes(roomRecords);
    const memory = projectAcceptedResearchMemory(roomRecords);
    const sources = roomRecords
      .filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence)
      .map(sourceVersionProjection);
    const sequenceLinks = roomRecords
      .filter((record) => record.kind === RESEARCH_RECORD_KINDS.sequenceLink)
      .map((record) => ({
        recordHash: record.recordHash,
        nucleotideSubmissionHash: record.link?.nucleotideSubmissionHash || null,
        proteinSubmissionHash: record.link?.proteinSubmissionHash || null,
        coordinates: record.link?.coordinates || null,
        translation: record.link?.translation || null
      }));
    return {
      roomId,
      currentRoom: Boolean(normalizedCurrentRoomId && roomId === normalizedCurrentRoomId),
      questionHashes: [...questionHashes].sort(),
      archiveRecordHashes: roomRecords.map((record) => record.recordHash),
      activeRecordHashes: active.map((record) => record.recordHash).sort(),
      invalidatedRecordHashes: [...invalidated].sort(),
      acceptedMemoryHashes: [...memory.acceptedHashes],
      memoryExclusions: memory.excluded,
      sourceVersions: sources,
      sequenceLinks
    };
  }).sort((left, right) => left.roomId.localeCompare(right.roomId));
  const roomByAcceptedHash = new Map(rooms.flatMap((room) => (
    room.currentRoom
      ? []
      : room.acceptedMemoryHashes.map((recordHash) => [recordHash, room])
  )));
  const rawCandidates = [...roomByAcceptedHash.entries()].map(([recordHash, room]) => {
    const record = includedRecords.get(recordHash);
    return {
      recordHash,
      originRoomId: room.roomId,
      originQuestionHashes: room.questionHashes,
      kind: record?.kind || null,
      originalRoomAccepted: true,
      qualification: crossRoomQualification(record || {}),
      admission: 'requires_current_room_review'
    };
  }).sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const candidateGroups = new Map();
  for (const candidate of rawCandidates) {
    const record = includedRecords.get(candidate.recordHash);
    const groupKey = record?.kind === RESEARCH_RECORD_KINDS.priorEvidence
      && candidate.qualification.status === 'source_metadata_complete'
      ? `source:${crossRoomSourceIdentityKey(record)}`
      : `record:${candidate.recordHash}`;
    const group = candidateGroups.get(groupKey) || [];
    group.push(candidate);
    candidateGroups.set(groupKey, group);
  }
  const candidates = [...candidateGroups.values()].map((group) => {
    const ordered = group.slice().sort((left, right) => compareResearchRecords(
      includedRecords.get(left.recordHash),
      includedRecords.get(right.recordHash)
    ));
    const representative = ordered[0];
    return {
      ...representative,
      deduplication: ordered.length > 1 ? 'same_declared_versioned_source' : 'unique_source_record',
      duplicateRecordHashes: ordered.map((candidate) => candidate.recordHash),
      duplicateOriginRoomIds: unique(ordered.map((candidate) => candidate.originRoomId)).sort(),
      duplicateOrigins: ordered.map((candidate) => ({
        recordHash: candidate.recordHash,
        roomId: candidate.originRoomId,
        questionHashes: candidate.originQuestionHashes
      }))
    };
  }).sort((left, right) => left.recordHash.localeCompare(right.recordHash));
  const anchor = submissions[0] || null;
  return {
    schema: 'poolday.cross_room_sequence_evidence/v1',
    sequence: {
      hash: normalizedHash,
      alphabet: anchor?.sequence?.alphabet || null,
      length: anchor?.sequence?.length || null,
      value: anchor?.consent?.publicSequence === true ? anchor.sequence?.value || null : null
    },
    currentRoomId: normalizedCurrentRoomId,
    boundary: byHash.size >= boundedLimit ? 'bounded_input_snapshot' : 'input_snapshot',
    complete: byHash.size < boundedLimit,
    inputRecordCount: Array.isArray(records) ? records.length : 0,
    uniqueRecordCount: byHash.size,
    scannedRecordCount: snapshot.length,
    deduplicatedRecordCount: includedRecords.size,
    candidateRecordCount: rawCandidates.length,
    candidateSourceCount: candidates.length,
    rooms,
    candidates,
    records: [...includedRecords.values()].sort(compareResearchRecords)
  };
}

export function findSimilarSequences(records = [], targetHash, { limit = 12 } = {}) {
  const active = activeResearchRecords(records);
  const target = active.find((record) => record.recordHash === targetHash && record.embedding);
  if (!target) return [];
  const accepted = acceptedClaimHashes(records);
  return active
    .filter((record) => record.recordHash !== targetHash && embeddingsAreCompatible(target, record))
    .map((record) => {
      const annotations = [
        ...claimsForTarget(records, record.recordHash),
        ...claimsForTarget(records, record.submissionHash)
      ]
        .filter((claim) => claim.claim.kind !== 'review_decision');
      const acceptedAnnotations = annotations.filter((claim) => accepted.has(claim.recordHash));
      const score = cosineSimilarity(target.embedding.values, record.embedding.values);
      const evidenceBoost = acceptedAnnotations.reduce((sum, claim) => sum + claim.claim.confidence, 0) * 0.002;
      return {
        record,
        similarity: score,
        score: Math.min(1, score + evidenceBoost),
        supportingAnnotations: acceptedAnnotations,
        provenance: record.compute
      };
    })
    .filter((entry) => entry.similarity !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function clusterCompatibleResults(records = [], { threshold = 0.8 } = {}) {
  const results = activeResearchRecords(records).filter((record) => record.kind === RESEARCH_RECORD_KINDS.result && record.embedding?.values);
  const remaining = new Set(results.map((record) => record.recordHash));
  const byHash = new Map(results.map((record) => [record.recordHash, record]));
  const clusters = [];
  while (remaining.size) {
    const seedHash = remaining.values().next().value;
    const queue = [seedHash];
    const members = [];
    remaining.delete(seedHash);
    while (queue.length) {
      const current = byHash.get(queue.shift());
      members.push(current);
      for (const candidateHash of [...remaining]) {
        const candidate = byHash.get(candidateHash);
        if (!embeddingsAreCompatible(current, candidate)) continue;
        if ((cosineSimilarity(current.embedding.values, candidate.embedding.values) || -1) < threshold) continue;
        remaining.delete(candidateHash);
        queue.push(candidateHash);
      }
    }
    clusters.push({
      clusterId: `cluster:${modelCompatibilityKey(members[0])}:${clusters.length + 1}`,
      modelCompatibilityKey: modelCompatibilityKey(members[0]),
      members
    });
  }
  return clusters.sort((left, right) => right.members.length - left.members.length);
}

export function proposeDiscoveryTasks(records = []) {
  const tasks = [];
  const active = activeResearchRecords(records);
  const results = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result);
  const claims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const approvals = claims.filter((record) => record.claim.kind === 'task_approval');
  const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
  const acceptedMemory = projectAcceptedResearchMemory(records);
  const acceptedHashes = new Set(acceptedMemory.acceptedHashes);
  const addTask = (kind, targetHash, reason, {
    basis = 'governance',
    basisHashes = [targetHash]
  } = {}) => tasks.push({ kind, targetHash, reason, basis, basisHashes: unique(basisHashes).sort() });
  const requireReview = (record, label) => {
    const review = reviewStates.get(record.recordHash) || { state: 'unresolved' };
    if (review.state === 'unresolved') {
      addTask('independent_review', record.recordHash, `${label} has no independent reviewer decision.`);
    } else if (review.state === 'needs_revision') {
      addTask('revise_evidence', record.recordHash, `${label} needs the correction or context requested by its reviewer.`);
    } else if (review.state === 'replication_requested') {
      addTask('reproduce', record.recordHash, `${label} has an explicit independent replication request.`);
    } else if (review.state === 'disputed') {
      addTask('adjudicate_contradiction', record.recordHash, `${label} has conflicting independent reviewer decisions.`);
      if (review.replicationRequested) {
        addTask('reproduce', record.recordHash, `${label} has a replication request within its disputed review set.`);
      }
    } else if (review.state === 'rejected') {
      addTask('reproduce', record.recordHash, `${label} was rejected; new corrected or independently reproduced evidence is required.`);
    }
  };
  for (const submission of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.submission)) {
    const clarity = projectResearchQuestionClarity(submission);
    if (clarity.status !== 'bounded') {
      addTask(
        'clarify_question',
        submission.recordHash,
        clarity.minimumReady
          ? `Bound the question before deriving scientific work: ${clarity.gaps.slice(0, 3).map((gap) => gap.reason).join(' ')}`
          : clarity.gaps.map((gap) => gap.reason).join(' '),
        { basis: 'question_anchor' }
      );
    }
    const linkedResults = results.filter((record) => record.submissionHash === submission.recordHash);
    if (linkedResults.length === 0 && clarity.minimumReady) {
      addTask('compute', submission.recordHash, 'No receipt-backed result exists for this signed question.', { basis: 'question_anchor' });
    }
    for (const result of linkedResults) {
      requireReview(result, 'The receipt-backed result');
      if (!projectResearchExecutionIndependence(result).independentlyExecuted) {
        addTask('reproduce', result.recordHash, 'The result lacks two distinct receipt and provider identities.');
      }
    }
    const priorEvidenceAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.priorEvidence && record.questionHash === submission.recordHash);
    const hypothesesAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.hypothesis && record.questionHash === submission.recordHash);
    const predictionsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.prediction && record.questionHash === submission.recordHash);
    const workOrdersAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workOrder && record.questionHash === submission.recordHash);
    const outcomesAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome && record.questionHash === submission.recordHash);
    const cohortsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.cohort && record.cohort.questionHashes.includes(submission.recordHash));
    for (const record of [...priorEvidenceAll, ...hypothesesAll, ...predictionsAll, ...workOrdersAll, ...outcomesAll, ...cohortsAll]) {
      if (!acceptedHashes.has(record.recordHash)) requireReview(record, 'This proposed evidence');
    }
    const acceptedResults = linkedResults.filter((record) => acceptedHashes.has(record.recordHash));
    const priorEvidence = priorEvidenceAll.filter((record) => acceptedHashes.has(record.recordHash));
    const hypotheses = hypothesesAll.filter((record) => acceptedHashes.has(record.recordHash));
    const predictions = predictionsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const workOrders = workOrdersAll.filter((record) => acceptedHashes.has(record.recordHash));
    const outcomes = outcomesAll.filter((record) => acceptedHashes.has(record.recordHash));
    const cohorts = cohortsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const workOrderHashes = new Set(workOrders.map((record) => record.recordHash));
    const workClaims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.workClaim && workOrderHashes.has(record.workOrderHash));
    const cohortHashes = new Set(cohorts.map((record) => record.recordHash));
    const evaluationsAll = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation && cohortHashes.has(record.cohortHash));
    for (const evaluation of evaluationsAll) if (!acceptedHashes.has(evaluation.recordHash)) requireReview(evaluation, 'This cohort evaluation');
    const evaluations = evaluationsAll.filter((record) => acceptedHashes.has(record.recordHash));
    const acceptedEvidenceBasis = [...acceptedResults, ...priorEvidence].map((record) => record.recordHash);
    if (acceptedResults.length > 0 && priorEvidence.length === 0) {
      addTask('retrieve_prior_evidence', submission.recordHash, 'Accepted model evidence has no independently accepted versioned prior evidence.', {
        basis: 'accepted_memory', basisHashes: acceptedEvidenceBasis
      });
    }
    if (acceptedEvidenceBasis.length > 0 && hypotheses.length < 2) {
      addTask('add_competing_hypothesis', submission.recordHash, 'Accepted memory does not yet contain two condition-specific hypotheses that expose competing explanations.', {
        basis: 'accepted_memory', basisHashes: acceptedEvidenceBasis
      });
    }
    for (const hypothesis of hypotheses) {
      const methods = new Set(predictions.filter((prediction) => prediction.hypothesisHash === hypothesis.recordHash)
        .map((prediction) => prediction.prediction.method.analysisHash));
      if (methods.size < 2) addTask('run_diverse_predictor', hypothesis.recordHash, 'This accepted hypothesis needs accepted frozen predictions from another exact method identity.', {
        basis: 'accepted_memory', basisHashes: [hypothesis.recordHash, ...predictions.filter((prediction) => prediction.hypothesisHash === hypothesis.recordHash).map((record) => record.recordHash)]
      });
    }
    if (hypotheses.length >= 2 && workOrders.length === 0) addTask('design_discriminating_assay', submission.recordHash, 'Accepted competing hypotheses have no accepted machine-verifiable work order.', {
      basis: 'accepted_memory', basisHashes: hypotheses.map((record) => record.recordHash)
    });
    for (const order of workOrders) {
      if (!workClaims.some((claim) => claim.workOrderHash === order.recordHash)) {
        addTask('claim_experimental_work', order.recordHash, 'The accepted work order has not been claimed by a laboratory.', {
          basis: 'accepted_memory', basisHashes: [order.recordHash]
        });
      }
      const orderOutcomes = outcomes.filter((outcome) => outcome.workOrderHash === order.recordHash);
      const completedOutcomes = orderOutcomes.filter((outcome) => outcome.outcome?.attempt?.status === 'completed');
      const failedOutcomes = orderOutcomes.filter((outcome) => outcome.outcome?.attempt?.status === 'failed');
      for (const failed of failedOutcomes) {
        addTask(
          'diagnose_failed_attempt',
          failed.recordHash,
          `The accepted ${failed.outcome?.attempt?.failureCategory?.replace(/_/g, ' ') || 'failed'} attempt remains evidence but does not satisfy the planned replica target.`,
          { basis: 'accepted_memory', basisHashes: [order.recordHash, failed.recordHash] }
        );
      }
      if (workClaims.some((claim) => claim.workOrderHash === order.recordHash)
        && completedOutcomes.length < order.work.replicaTarget) {
        const classifications = ['positive', 'negative', 'ambiguous']
          .map((classification) => `${classification} ${completedOutcomes.filter((outcome) => outcome.outcome?.classification === classification).length}`)
          .join(', ');
        addTask(completedOutcomes.length ? 'replicate_assay' : 'perform_assay', order.recordHash, `${completedOutcomes.length} completed of ${order.work.replicaTarget} planned replicas (${classifications}; failed ${failedOutcomes.length}). Failed attempts remain in the basis but do not count as completed replicas.`, {
          basis: 'accepted_memory', basisHashes: [order.recordHash, ...orderOutcomes.map((record) => record.recordHash)]
        });
      }
    }
    if (predictions.length > 0 && workOrders.length > 0 && cohorts.length === 0) {
      addTask('freeze_prospective_cohort', submission.recordHash, 'Accepted predictions and work orders are not yet frozen into a blinded prospective cohort.', {
        basis: 'accepted_memory', basisHashes: [...predictions, ...workOrders].map((record) => record.recordHash)
      });
    }
    for (const cohort of cohorts) {
      const eligible = outcomes.filter((outcome) => cohort.cohort.workOrderHashes.includes(outcome.workOrderHash)
        && reviewStates.get(outcome.recordHash)?.state === 'accepted');
      if (eligible.length > 0 && !evaluations.some((evaluation) => evaluation.cohortHash === cohort.recordHash)) {
        addTask('evaluate_frozen_cohort', cohort.recordHash, 'The accepted frozen cohort has accepted blinded outcomes but no accepted measured evaluation.', {
          basis: 'accepted_memory', basisHashes: [cohort.recordHash, ...eligible.map((record) => record.recordHash)]
        });
      }
    }
    for (const evaluation of evaluations) {
      if (!evaluation.evaluation.metricResults.some((metric) => metric.improved)) {
        addTask('analyze_cohort_failure', evaluation.recordHash, 'The accepted measured cohort did not improve its frozen metric.', {
          basis: 'accepted_memory', basisHashes: [evaluation.recordHash]
        });
      }
      if (evaluation.evaluation.nextCohortQuestionHashes.length === 0) {
        addTask('define_next_cohort', evaluation.recordHash, 'The accepted evaluation does not yet bind its effect to a next-cohort question set.', {
          basis: 'accepted_memory', basisHashes: [evaluation.recordHash]
        });
      }
    }
  }
  for (const claim of claims) {
    if (claim.claim.kind === 'follow_up') addTask('follow_up', claim.recordHash, claim.claim.text);
    if (claim.claim.confidence < 0.5 && claim.claim.kind !== 'task_approval') addTask('resolve_uncertainty', claim.recordHash, 'The contributor marked this claim low confidence.');
    if (claim.claim.relation === 'contradicts') addTask('adjudicate_contradiction', claim.recordHash, 'A signed claim contradicts prior evidence.');
  }
  const uniqueTasks = [...new Map(tasks.map((task) => [`${task.kind}:${task.targetHash}`, task])).values()];
  return uniqueTasks.map((task) => {
    const taskId = stableTaskId(task.kind, task.targetHash);
    const taskContract = projectDiscoveryTaskContract({ ...task, taskId });
    const matchingApprovals = approvals.filter((approval) => (
      approval.claim.taskId === taskId
      && JSON.stringify(approval.claim.taskContract) === JSON.stringify(taskContract)
    ));
    return {
      ...task,
      taskId,
      taskContract,
      status: matchingApprovals.length ? 'approved' : 'proposed',
      approvalRecordHashes: matchingApprovals.map((approval) => approval.recordHash).sort()
    };
  });
}

export function rankProposedDiscoveryActions(records = []) {
  return rankDiscoveryActions(records, proposeDiscoveryTasks(records));
}

export function rankProposedCandidateActions(records = []) {
  const source = Array.isArray(records) ? records : [];
  const active = activeResearchRecords(source);
  const activeHashes = new Set(active.map((record) => record.recordHash));
  const reviewStates = new Map(projectResearchReviewStates(source).map((entry) => [entry.recordHash, entry]));
  const approvals = active.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.claim
    && record.claim?.kind === 'candidate_action_approval'
  ));
  const candidates = source
    .filter((record) => record.kind === RESEARCH_RECORD_KINDS.candidateAction)
    .map((record) => {
      const matchingApprovals = approvals.filter((approval) => (
        approval.targetHash === record.recordHash
        && approval.claim?.actionContractHash === record.action?.contractHash
      ));
      const reviewState = reviewStates.get(record.recordHash)?.state || 'unresolved';
      const rejectionReasons = [];
      if (!activeHashes.has(record.recordHash)) rejectionReasons.push('candidate_is_revoked_or_downstream_invalidated');
      if (reviewState === 'rejected') rejectionReasons.push('candidate_was_rejected_by_independent_review');
      if (reviewState === 'disputed') rejectionReasons.push('candidate_has_disputed_independent_review');
      return {
        record,
        rejectionReasons,
        humanApprovalState: matchingApprovals.length
          ? 'approved'
          : ['rejected', 'disputed'].includes(reviewState) ? reviewState : 'approval_required',
        approvalRecordHashes: matchingApprovals.map((approval) => approval.recordHash)
      };
    });
  return rankSignedCandidateActions({ inputRecords: source, candidates });
}

export function projectResearchRewards(records = []) {
  const active = activeResearchRecords(records);
  const claims = active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.claim);
  const accepted = acceptedClaimHashes(records);
  const contradicted = new Set(claims.filter((record) => ['contradicts', 'corrects'].includes(record.claim.relation)).map((record) => record.targetHash));
  const state = new Map();
  const ensure = (author = {}) => {
    const id = author.roleId || 'unknown';
    if (!state.has(id)) state.set(id, {
      authorId: id,
      verifiedCompute: 0,
      acceptedEvidence: 0,
      durableEvidence: 0,
      acceptedReviews: 0,
      durableReviews: 0,
      experimentalOutcomes: 0,
      independentReplications: 0,
      prospectiveEvaluations: 0,
      realizedActionValues: 0,
      realizedUsefulnessCredits: 0,
      realizedValuePoints: 0,
      points: 0
    });
    return state.get(id);
  };
  for (const result of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.result)) {
    const contributor = ensure({ roleId: result.compute?.providerId });
    const independence = projectResearchExecutionIndependence(result);
    const admittedPrimary = result.compute?.receiptAdmission?.accepted === true
      || result.compute?.verifierDecision?.accepted === true;
    const receiptCount = Math.max(admittedPrimary ? 1 : 0, independence.independentReceiptCount);
    contributor.verifiedCompute += receiptCount;
    contributor.points += receiptCount * 2;
  }
  for (const outcome of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.outcome)) {
    if (!accepted.has(outcome.recordHash)) continue;
    const contributor = ensure(outcome.author);
    contributor.experimentalOutcomes += 1;
    contributor.points += 8;
    if (outcome.replicationOfHash) {
      contributor.independentReplications += 1;
      contributor.points += 5;
    }
  }
  for (const evaluation of active.filter((record) => record.kind === RESEARCH_RECORD_KINDS.evaluation)) {
    const contributor = ensure(evaluation.author);
    contributor.prospectiveEvaluations += 1;
    contributor.points += 3 + evaluation.evaluation.metricResults.filter((metric) => metric.improved).length * 2;
  }
  const rewardRecordsByHash = new Map(active.map((record) => [record.recordHash, record]));
  const creditedActionContributions = new Set();
  for (const valueRecord of active.filter((record) => (
    record.kind === RESEARCH_RECORD_KINDS.realizedActionValue
    && record.realizedValue?.assessment?.status === 'demonstrated_useful'
    && accepted.has(record.recordHash)
  ))) {
    for (const contribution of valueRecord.realizedValue.contributions || []) {
      const creditKey = `${valueRecord.realizedValue.candidateActionHash}:${contribution.recordHash}`;
      if (creditedActionContributions.has(creditKey)) continue;
      const source = rewardRecordsByHash.get(contribution.recordHash);
      if (!source?.author) continue;
      creditedActionContributions.add(creditKey);
      const contributor = ensure(source.author);
      contributor.realizedActionValues += 1;
      contributor.realizedUsefulnessCredits += 1;
      contributor.realizedValuePoints += REALIZED_ACTION_VALUE_REWARD_POLICY.pointsPerCreditedContribution;
      contributor.points += REALIZED_ACTION_VALUE_REWARD_POLICY.pointsPerCreditedContribution;
    }
  }
  for (const claim of claims.filter((record) => !['review_decision', 'task_approval'].includes(record.claim.kind))) {
    if (!accepted.has(claim.recordHash)) continue;
    const contributor = ensure(claim.author);
    contributor.acceptedEvidence += 1;
    contributor.points += 5;
    if (!contradicted.has(claim.recordHash)) {
      contributor.durableEvidence += 1;
      contributor.points += 3;
    }
  }
  const recordsByHash = new Map(records.map((record) => [record.recordHash, record]));
  for (const review of claims.filter((record) => record.claim.kind === 'review_decision' && record.claim.decision === 'accepted')) {
    const target = recordsByHash.get(review.targetHash);
    if (!target || target.author?.identityRootId === review.author?.identityRootId) continue;
    const reviewer = ensure(review.author);
    reviewer.acceptedReviews += 1;
    reviewer.points += 2;
    if (!contradicted.has(review.recordHash) && !contradicted.has(review.targetHash)) {
      reviewer.durableReviews += 1;
      reviewer.points += 1;
    }
  }
  return [...state.values()].map((entry) => ({
    ...entry,
    quality: (entry.acceptedEvidence + entry.acceptedReviews)
      ? (entry.durableEvidence + entry.durableReviews) / (entry.acceptedEvidence + entry.acceptedReviews)
      : 0
  })).sort((left, right) => right.points - left.points);
}
