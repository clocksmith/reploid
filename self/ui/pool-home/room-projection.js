/**
 * @fileoverview Pure Research Room projection over existing Poolday records.
 *
 * This module never persists, signs, or mutates evidence. It exposes stable
 * identifiers and hashes so the room can present one causal view without
 * becoming a second authority.
 */

import {
  activeResearchRecords,
  buildQuestionLifecycles,
  invalidatedResearchHashes,
  projectResearchReviewStates,
  proposeDiscoveryTasks,
  rankProposedDiscoveryActions
} from '../../pool/evidence-network.js';

const RESEARCH_KINDS = Object.freeze({
  submission: 'research_submission',
  result: 'research_result',
  claim: 'human_claim',
  hypothesis: 'research_hypothesis',
  prediction: 'research_prediction',
  priorEvidence: 'research_prior_evidence',
  workOrder: 'research_work_order',
  workClaim: 'research_work_claim',
  outcome: 'research_outcome',
  cohort: 'research_cohort',
  evaluation: 'research_evaluation',
  revocation: 'research_revocation'
});

const asText = (value, fallback = '') => {
  const text = String(value ?? '').trim();
  return text || fallback;
};

const asArray = (value) => Array.isArray(value) ? value : [];

const dateValue = (value) => {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

const sortByTime = (left, right) => (
  dateValue(left?.createdAt || left?.occurredAt) - dateValue(right?.createdAt || right?.occurredAt)
    || asText(left?.recordHash || left?.id).localeCompare(asText(right?.recordHash || right?.id))
);

const sorted = (values) => [...values].sort(sortByTime);

const unique = (values) => [...new Set(values.filter(Boolean).map((value) => String(value)))];

const shortHash = (value) => {
  const text = asText(value, 'unknown');
  return text.length > 24 ? `${text.slice(0, 16)}...${text.slice(-8)}` : text;
};

const publicationConsent = (record = {}) => ({
  sequence: record.consent?.publicSequence === true,
  embedding: record.consent?.publishEmbedding === true,
  residue: record.consent?.publishResidueEvidence === true,
  identity: record.consent?.publishIdentity === true
    || record.consent?.publicIdentity === true
    || record.workClaim?.consent?.publicLaboratoryIdentity === true
});

const publicIdentity = (record = {}, fallback = 'participant') => {
  const consent = publicationConsent(record);
  if (consent.identity) {
    return asText(
      record.author?.publicLabel
        || record.author?.displayName
        || record.workClaim?.laboratory?.name
        || record.author?.userId,
      fallback
    );
  }
  return shortHash(record.author?.identityRootId || record.author?.userId || fallback);
};

const participant = ({ id, role, status = 'observed', label = null } = {}) => ({
  id: asText(id, 'unknown'),
  role: asText(role, 'peer'),
  status: asText(status, 'observed'),
  label: label ? asText(label) : null
});

const recordTitle = (record = {}) => {
  if (record.kind === RESEARCH_KINDS.submission) {
    return asText(record.requesterIntent?.label || record.requesterIntent?.text, 'Question submitted');
  }
  if (record.kind === RESEARCH_KINDS.result) return `${asText(record.modelContract?.id, 'Model')} result`;
  if (record.kind === RESEARCH_KINDS.claim) return asText(record.claim?.text, 'Human review recorded');
  if (record.kind === RESEARCH_KINDS.hypothesis) return 'Hypothesis proposed';
  if (record.kind === RESEARCH_KINDS.prediction) return 'Prediction proposed';
  if (record.kind === RESEARCH_KINDS.priorEvidence) return 'Prior evidence linked';
  if (record.kind === RESEARCH_KINDS.workOrder) return 'Discovery work proposed';
  if (record.kind === RESEARCH_KINDS.workClaim) return 'Contributor claimed work';
  if (record.kind === RESEARCH_KINDS.outcome) return 'Outcome recorded';
  if (record.kind === RESEARCH_KINDS.cohort) return 'Cohort frozen';
  if (record.kind === RESEARCH_KINDS.evaluation) return 'Evidence evaluated';
  if (record.kind === RESEARCH_KINDS.revocation) return 'Evidence revoked';
  return 'Research evidence';
};

const recordSummary = (record = {}) => {
  if (record.kind === RESEARCH_KINDS.submission) {
    return `${record.sequence?.alphabet === 'dna' ? 'DNA' : 'Protein'} sequence · ${Number(record.sequence?.length || 0)} residues`;
  }
  if (record.kind === RESEARCH_KINDS.result) {
    return `${Number(record.embedding?.dimensions || record.modelContract?.dimensions || 0) || 'Unknown'} dimensions · receipt ${shortHash(record.compute?.receiptHash)}`;
  }
  if (record.kind === RESEARCH_KINDS.claim) return asText(record.claim?.decision || record.claim?.relation, 'Review or annotation');
  if (record.kind === RESEARCH_KINDS.hypothesis) return asText(record.hypothesis?.statement, 'Competing explanation');
  if (record.kind === RESEARCH_KINDS.prediction) return asText(record.prediction?.expectedObservation, 'Expected observation');
  if (record.kind === RESEARCH_KINDS.workOrder) return asText(record.work?.title, 'Bounded next work');
  if (record.kind === RESEARCH_KINDS.outcome) return asText(record.outcome?.summary, 'Experimental outcome');
  return recordTitle(record);
};

const statusForRecord = (record, reviewStates, invalidated) => {
  if (invalidated.has(record.recordHash)) return 'invalidated';
  return reviewStates.get(record.recordHash)?.state || 'unreviewed';
};

const evidenceAgreement = (result, records) => {
  if (!result) return { state: 'evidence_unavailable', label: 'Evidence unavailable', sourceHash: null };
  const agreement = result.compute?.agreement || null;
  const explicitStatus = asText(agreement?.status).toLowerCase();
  if (explicitStatus === 'accepted' || explicitStatus === 'agreed') {
    return { state: 'agreement_assessed', label: 'Agreement assessed', sourceHash: result.recordHash };
  }
  if (
    explicitStatus === 'rejected'
    || explicitStatus === 'disagreement'
    || explicitStatus === 'redundant_disagreement'
    || result.compute?.status === 'redundant_disagreement'
  ) {
    return { state: 'disagreement_assessed', label: 'Disagreement assessed', sourceHash: result.recordHash };
  }
  const acceptedAndRejected = projectResearchReviewStates(records)
    .some((entry) => entry.recordHash === result.recordHash && entry.disagreement === true);
  if (acceptedAndRejected) {
    return { state: 'disagreement_assessed', label: 'Disagreement assessed', sourceHash: result.recordHash };
  }
  return { state: 'not_assessed', label: 'Not assessed', sourceHash: result.recordHash };
};

const latest = (records, kind) => sorted(records.filter((record) => record.kind === kind)).at(-1) || null;

const resultForQuestion = (records, submission) => {
  if (!submission) return null;
  return sorted(records.filter((record) => (
    record.kind === RESEARCH_KINDS.result && record.submissionHash === submission.recordHash
  ))).at(-1) || null;
};

const sourceAuthorityForPeerEvent = (event = {}) => {
  const type = asText(event.type).toLowerCase();
  return type.includes('relay') || type.includes('signal') ? 'room_relay' : 'peer_ledger';
};

const peerEventId = (event = {}) => asText(
  event.messageHash
    || event.id
    || `${event.type || 'unknown'}:${event.createdAt || ''}:${event.body?.receiptHash || event.body?.providerId || ''}`,
  'peer-event:unknown'
);

const peerEventTitle = (event = {}) => {
  const type = asText(event.type, 'room activity').replace(/[-_]/g, ' ');
  return type ? `${type[0].toUpperCase()}${type.slice(1)}` : 'Room activity';
};

const makeTimelineEntry = ({ id, kind, occurredAt, title, status, sourceAuthority, sourceHash, summary, action }) => ({
  id: asText(id),
  kind: asText(kind, 'activity'),
  occurredAt: asText(occurredAt, null),
  title: asText(title, 'Room activity'),
  status: asText(status, 'observed'),
  sourceAuthority: asText(sourceAuthority, 'room_relay'),
  sourceHash: sourceHash ? asText(sourceHash) : null,
  summary: asText(summary, 'Room activity'),
  action: action ? asText(action) : null
});

const projectParticipants = (records, peerEvents, latestResult, submission) => {
  const requester = submission?.author
    ? participant({
        id: submission.author.identityRootId || submission.author.userId,
        role: 'requester',
        status: 'question owner',
        label: publicIdentity(submission, 'requester')
      })
    : null;
  const contributors = [];
  const reviewers = [];
  const peers = [];
  const add = (list, value) => {
    if (!value?.id || list.some((entry) => entry.id === value.id)) return;
    list.push(value);
  };
  for (const record of records) {
    if (record.kind === RESEARCH_KINDS.result && record.compute?.providerId) {
      add(contributors, participant({ id: record.compute.providerId, role: 'contributor', status: 'receipt observed' }));
    }
    if (record.kind === RESEARCH_KINDS.claim) {
      add(reviewers, participant({
        id: record.author?.identityRootId || record.author?.userId,
        role: 'reviewer',
        status: record.claim?.decision || 'reviewed',
        label: publicIdentity(record, 'reviewer')
      }));
    }
  }
  for (const event of peerEvents) {
    const body = event.body || {};
    const providerId = body.providerId || body.fromPeerId || event.fromPeerId;
    if (providerId) add(peers, participant({ id: providerId, role: 'peer', status: asText(event.type, 'activity') }));
    if (body.providerId) add(contributors, participant({ id: body.providerId, role: 'contributor', status: 'room activity' }));
  }
  if (latestResult?.compute?.providerId) {
    add(contributors, participant({ id: latestResult.compute.providerId, role: 'contributor', status: 'latest result' }));
  }
  return {
    requester,
    contributors,
    reviewers,
    peers
  };
};

const projectMemory = (active, reviewStates) => active
  .filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted')
  .map((record) => ({
    id: record.recordHash,
    kind: record.kind,
    occurredAt: record.createdAt || null,
    title: recordTitle(record),
    status: 'accepted',
    sourceHash: record.recordHash
  }));

const projectProposals = (active, reviewStates) => active
  .filter((record) => (
    [RESEARCH_KINDS.hypothesis, RESEARCH_KINDS.prediction, RESEARCH_KINDS.workOrder].includes(record.kind)
    || (record.kind === RESEARCH_KINDS.claim && record.claim?.relation === 'proposes')
  ))
  .map((record) => {
    const rawReviewState = reviewStates.get(record.recordHash)?.state || null;
    const reviewState = ['accepted', 'rejected', 'invalidated'].includes(rawReviewState)
      ? rawReviewState
      : 'provisional';
    if (record.kind === RESEARCH_KINDS.hypothesis) {
      return {
        id: record.recordHash,
        kind: record.kind,
        title: 'Possible explanation',
        summary: asText(record.hypothesis?.statement, 'Competing explanation'),
        supportingEvidence: record.hypothesis?.priorEvidenceHashes || [],
        missingEvidence: record.hypothesis?.discriminatingObservations?.length
          ? 'No distinguishing observation has been reviewed yet.'
          : 'A distinguishing observation is missing.',
        distinguishes: record.hypothesis?.discriminatingObservations || [],
        status: reviewState,
        sourceHash: record.recordHash
      };
    }
    if (record.kind === RESEARCH_KINDS.prediction) {
      return {
        id: record.recordHash,
        kind: record.kind,
        title: 'Expected observation',
        summary: asText(record.prediction?.expectedObservation, 'Prediction proposed'),
        supportingEvidence: record.prediction?.receiptHashes || [],
        missingEvidence: 'The predicted outcome remains unavailable until reviewed outcome evidence is recorded.',
        distinguishes: [asText(record.prediction?.normalizedLabel, 'Prediction label')],
        status: reviewState,
        sourceHash: record.recordHash
      };
    }
    if (record.kind === RESEARCH_KINDS.workOrder) {
      return {
        id: record.recordHash,
        kind: record.kind,
        title: 'Proposed next work',
        summary: asText(record.work?.title, 'Bounded discovery work'),
        supportingEvidence: record.hypothesisHashes || [],
        missingEvidence: rawReviewState === 'accepted'
          ? 'Awaiting attributable execution or replication evidence.'
          : 'Independent approval is required before execution.',
        distinguishes: [asText(record.work?.protocol?.protocolId, 'Bounded protocol')],
        status: reviewState,
        sourceHash: record.recordHash
      };
    }
    return {
      id: record.recordHash,
      kind: record.kind,
      title: 'Proposed interpretation',
      summary: asText(record.claim?.text, 'Human proposal'),
      supportingEvidence: record.claim?.evidenceLinks?.map((link) => link.label || link.url) || [],
      missingEvidence: 'This proposal remains provisional until the linked evidence is reviewed.',
      distinguishes: [],
      status: reviewState,
      sourceHash: record.recordHash
    };
  });

const projectUnresolved = ({ active, reviewStates, latestResult, agreement, tasks }) => {
  const unresolved = [];
  if (!latestResult) {
    unresolved.push({
      id: 'evidence-unavailable',
      kind: 'evidence',
      title: 'Evidence unavailable',
      detail: 'No receipt-backed result is linked to this question yet.',
      sourceHash: null,
      action: 'Run'
    });
  } else if (agreement.state === 'not_assessed') {
    unresolved.push({
      id: 'agreement-not-assessed',
      kind: 'agreement',
      title: 'Agreement not assessed',
      detail: 'The room has no signed shared semantic observation or adjudicated outcome for agreement.',
      sourceHash: latestResult.recordHash,
      action: 'Review evidence'
    });
  } else if (agreement.state === 'disagreement_assessed') {
    unresolved.push({
      id: 'agreement-disagreement',
      kind: 'agreement',
      title: 'Disagreement assessed',
      detail: 'Independent evidence does not currently support one agreement state.',
      sourceHash: agreement.sourceHash,
      action: 'Review evidence'
    });
  }
  if (latestResult && reviewStates.get(latestResult.recordHash)?.state !== 'accepted') {
    unresolved.push({
      id: 'result-review',
      kind: 'review',
      title: 'Result awaits review',
      detail: 'The result remains visible but is not remembered until an independent review accepts it.',
      sourceHash: latestResult.recordHash,
      action: 'Review evidence'
    });
  }
  for (const task of tasks.slice(0, 3)) {
    const taskKind = asText(task.actionKind || task.kind, 'next action');
    unresolved.push({
      id: task.actionId || task.taskId,
      kind: 'next_action',
      title: taskKind.replace(/_/g, ' '),
      detail: task.reason,
      sourceHash: task.targetHash,
      action: task.status === 'approved' ? 'Approved' : 'Approve next action'
    });
  }
  if (active.some((record) => record.kind === RESEARCH_KINDS.hypothesis)
    && !active.some((record) => record.kind === RESEARCH_KINDS.prediction)) {
    unresolved.push({
      id: 'missing-prediction',
      kind: 'evidence_gap',
      title: 'Prediction missing',
      detail: 'A proposed hypothesis has no signed prediction linked to this room.',
      sourceHash: active.find((record) => record.kind === RESEARCH_KINDS.hypothesis)?.recordHash || null,
      action: 'Discover'
    });
  }
  return unresolved;
};

const buildTimeline = ({ records, peerEvents, receipts, reviewStates, invalidated }) => {
  const entries = records.map((record) => makeTimelineEntry({
    id: record.recordHash,
    kind: record.kind,
    occurredAt: record.createdAt,
    title: recordTitle(record),
    status: statusForRecord(record, reviewStates, invalidated),
    sourceAuthority: record.kind === RESEARCH_KINDS.result ? 'execution' : 'research_evidence',
    sourceHash: record.recordHash,
    summary: recordSummary(record),
    action: record.kind === RESEARCH_KINDS.claim ? 'Review evidence' : null
  }));
  for (const receipt of receipts) {
    const sourceHash = receipt.receiptHash || receipt.record?.receiptHash || null;
    entries.push(makeTimelineEntry({
      id: `receipt:${sourceHash || receipt.jobId || receipt.occurredAt}`,
      kind: 'receipt',
      occurredAt: receipt.occurredAt || receipt.record?.createdAt,
      title: 'Signed receipt received',
      status: asText(receipt.fidelity, 'observed'),
      sourceAuthority: 'execution',
      sourceHash,
      summary: `Contributor ${shortHash(receipt.provider || 'unknown')} · ${asText(receipt.speed, 'speed unavailable')}`,
      action: 'Inspect evidence'
    }));
  }
  for (const event of peerEvents) {
    const id = peerEventId(event);
    entries.push(makeTimelineEntry({
      id: `peer:${id}`,
      kind: 'room_activity',
      occurredAt: event.createdAt || event.occurredAt,
      title: peerEventTitle(event),
      status: 'observed',
      sourceAuthority: sourceAuthorityForPeerEvent(event),
      sourceHash: event.messageHash || null,
      summary: `Peer ${shortHash(event.fromPeerId || event.body?.providerId || 'unknown')} activity`,
      action: 'Inspect activity'
    }));
  }
  return entries.sort(sortByTime);
};

const projectResult = (result, submission, reviewStates, agreement, modelEvidence) => {
  if (!result) return null;
  const consent = publicationConsent(submission);
  return {
    sourceHash: result.recordHash,
    status: reviewStates.get(result.recordHash)?.state || 'unreviewed',
    embeddingDimensions: result.embedding?.dimensions || result.modelContract?.dimensions || null,
    model: {
      id: result.modelContract?.id || null,
      hash: result.modelContract?.hash || null,
      manifestHash: result.modelContract?.manifestHash || null,
      tokenizerHash: result.modelContract?.tokenizerHash || null,
      runtime: result.modelContract?.runtime || null,
      backend: result.modelContract?.backend || null,
      artifactIdentity: result.modelContract?.artifactIdentity || null
    },
    runtimeIdentity: result.compute?.runtimeProfileHash || result.modelContract?.runtime || null,
    receiptHash: result.compute?.receiptHash || null,
    agreement,
    uncertainty: modelEvidence?.uncertainty?.map((entry) => asText(entry.detail)).filter(Boolean) || [],
    evidenceNextAction: modelEvidence?.nextAction
      ? {
          kind: modelEvidence.nextAction.kind,
          reason: modelEvidence.nextAction.reason,
          targetHash: modelEvidence.nextAction.targetHash
        }
      : null,
    reviewState: reviewStates.get(result.recordHash)?.state || 'unreviewed',
    publication: {
      sequence: consent.sequence,
      embedding: consent.embedding,
      residue: consent.residue
    },
    hasRawEmbedding: consent.embedding && Array.isArray(result.embedding?.values),
    residueEvidencePublished: consent.residue && Boolean(result.sequenceEvidence)
  };
};

const RECOVERY_LABELS = Object.freeze({
  local_only: 'Local-only recovery',
  synchronizing: 'Synchronizing',
  synchronized: 'Synchronized',
  stale: 'Stale coordinator view',
  rejected: 'Rejected records',
  invalidated: 'Invalidated evidence',
  awaiting_review: 'Awaiting review'
});

const projectRecovery = ({ syncState = {}, invalidatedCount = 0, awaitingReview = false, activeCount = 0 } = {}) => {
  const phase = ['local_only', 'synchronizing', 'synchronized', 'stale'].includes(syncState.phase)
    ? syncState.phase
    : 'local_only';
  const states = [];
  if (phase === 'stale' && activeCount > 0) states.push('local_only');
  states.push(phase);
  if (Array.isArray(syncState.rejectedRecords) && syncState.rejectedRecords.length) states.push('rejected');
  if (invalidatedCount > 0) states.push('invalidated');
  if (awaitingReview) states.push('awaiting_review');
  const uniqueStates = [...new Set(states)];
  return {
    phase,
    remote: asText(syncState.remote, 'unknown'),
    states: uniqueStates,
    labels: uniqueStates.map((state) => RECOVERY_LABELS[state]),
    rejectedRecords: Array.isArray(syncState.rejectedRecords)
      ? syncState.rejectedRecords.map((entry) => ({ ...entry }))
      : [],
    invalidatedCount,
    remoteError: syncState.remoteError ? asText(syncState.remoteError) : null,
    checkedAt: syncState.checkedAt || null
  };
};

const sourceRoomId = (source = {}) => source.roomId
  || source.record?.roomId
  || source.body?.roomId
  || source.detail?.roomId
  || null;

const scopeRoomSources = (sources, roomId) => sources.filter((source) => {
  const sourceId = sourceRoomId(source);
  return !sourceId || !roomId || sourceId === roomId;
});

export function projectResearchRoom({
  roomId,
  routeId = 'home',
  researchRecords = [],
  receipts = [],
  peerEvents = [],
  syncState = {}
} = {}) {
  const scopedRecords = researchRecords.filter((record) => !roomId || record.roomId === roomId);
  const scopedReceipts = scopeRoomSources(receipts, roomId);
  const scopedPeerEvents = scopeRoomSources(peerEvents, roomId);
  const active = activeResearchRecords(scopedRecords);
  const invalidated = invalidatedResearchHashes(scopedRecords);
  const reviewStates = new Map(projectResearchReviewStates(scopedRecords).map((entry) => [entry.recordHash, entry]));
  const submission = latest(active, RESEARCH_KINDS.submission);
  const result = resultForQuestion(active, submission);
  const agreement = evidenceAgreement(result, scopedRecords);
  const tasks = proposeDiscoveryTasks(scopedRecords);
  const ranked = rankProposedDiscoveryActions(scopedRecords).rankedCandidates || [];
  const rankedById = new Map(ranked.map((task) => [task.actionId, task]));
  const nextActions = tasks
    .map((task) => rankedById.get(task.actionId) || task)
    .sort((left, right) => Number(right.heuristicPriority || 0) - Number(left.heuristicPriority || 0));
  const participants = projectParticipants(active, scopedPeerEvents, result, submission);
  const question = submission
    ? {
        submissionHash: submission.recordHash,
        sequenceHash: submission.sequence?.hash || null,
        sequenceLength: submission.sequence?.length || null,
        intent: submission.requesterIntent || null,
        consent: {
          sequence: submission.consent?.publicSequence === true,
          embedding: submission.consent?.publishEmbedding === true,
          residue: submission.consent?.publishResidueEvidence === true
        },
        modelContract: submission.modelContract || null,
        policyId: submission.policyId || null
      }
    : null;
  const memory = projectMemory(active, reviewStates);
  const proposals = projectProposals(active, reviewStates);
  const unresolved = projectUnresolved({
    active,
    reviewStates,
    latestResult: result,
    agreement,
    tasks: nextActions
  });
  const timeline = buildTimeline({
    records: scopedRecords,
    peerEvents: scopedPeerEvents,
    receipts: scopedReceipts,
    reviewStates,
    invalidated
  });
  const status = !submission
    ? 'ready'
    : !result
      ? 'investigating'
      : reviewStates.get(result.recordHash)?.state === 'accepted'
        ? 'remembered'
        : 'awaiting_review';
  const recovery = projectRecovery({
    syncState,
    invalidatedCount: invalidated.size,
    awaitingReview: status === 'awaiting_review',
    activeCount: active.length
  });
  const modelEvidence = submission
    ? buildQuestionLifecycles(scopedRecords).find((entry) => entry.question?.recordHash === submission.recordHash)?.modelEvidence || null
    : null;
  return {
    roomId: asText(roomId, 'reploid-default'),
    routeId: asText(routeId, 'home'),
    status,
    recovery,
    question,
    participants,
    latestResult: projectResult(result, submission, reviewStates, agreement, modelEvidence),
    unresolved,
    nextActions: nextActions.slice(0, 5).map((task) => ({
      id: task.actionId || task.taskId,
      kind: task.actionKind || task.kind || 'next_action',
      targetHash: task.targetHash,
      reason: task.reason,
      status: task.status || 'proposed',
      priority: task.heuristicPriority || null
    })),
    memory,
    proposals,
    timeline,
    modelEvidence: modelEvidence ? {
      agreement: modelEvidence.agreement?.status || 'not_assessed',
      disagreement: modelEvidence.disagreement?.status || 'not_assessed',
      sourceCount: modelEvidence.modelSources?.length || 0,
      sharedResiduePositions: modelEvidence.sharedResiduePositions?.length || 0
    } : null,
    counts: {
      records: scopedRecords.length,
      active: active.length,
      invalidated: invalidated.size,
      rejected: recovery.rejectedRecords.length,
      memory: memory.length,
      unresolved: unresolved.length,
      timeline: timeline.length
    }
  };
}

export const researchRoomAgreementLabels = Object.freeze({
  agreement_assessed: 'Agreement assessed',
  disagreement_assessed: 'Disagreement assessed',
  not_assessed: 'Not assessed',
  evidence_unavailable: 'Evidence unavailable'
});

export default { projectResearchRoom, researchRoomAgreementLabels };
