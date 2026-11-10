/**
 * @fileoverview What the room still needs: open proposals with their review state, and unresolved
 * items such as missing evidence, disagreements or pending replication.
 */
import { RESEARCH_KINDS, asText } from './room-projection-records.js';

export const projectProposals = (active, reviewStates, acceptedCorrections) => active
  .filter((record) => (
    [RESEARCH_KINDS.hypothesis, RESEARCH_KINDS.prediction, RESEARCH_KINDS.workOrder, RESEARCH_KINDS.candidateAction].includes(record.kind)
    || (record.kind === RESEARCH_KINDS.claim && record.claim?.relation === 'proposes')
  ))
  .map((record) => {
    const rawReviewState = reviewStates.get(record.recordHash)?.state || null;
    const reviewState = acceptedCorrections.has(record.recordHash)
      ? 'corrected'
      : ['accepted', 'rejected', 'needs_revision', 'replication_requested', 'disputed', 'invalidated'].includes(rawReviewState)
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
    if (record.kind === RESEARCH_KINDS.candidateAction) {
      return {
        id: record.recordHash,
        kind: record.kind,
        title: record.action?.title || 'Governed candidate action',
        summary: record.action?.rationale || 'Bounded signed action proposal',
        supportingEvidence: record.action?.affectedHypothesisHashes || [],
        missingEvidence: 'Independent human approval is required; proposal and ranking have no allocation authority.',
        distinguishes: record.action?.predictedObservations?.map((entry) => entry.observation) || [],
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

export const projectUnresolved = ({
  active,
  reviewStates,
  latestResult,
  latestResultRemembered,
  agreement,
  tasks,
  acceptedCorrections
}) => {
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
  const latestReviewState = latestResult
    ? reviewStates.get(latestResult.recordHash)?.state || 'unresolved'
    : null;
  if (latestResult && acceptedCorrections.has(latestResult.recordHash)) {
    const correction = acceptedCorrections.get(latestResult.recordHash);
    unresolved.push({
      id: 'result-corrected',
      kind: 'correction',
      title: 'Result corrected',
      detail: `An accepted correction supersedes this result: ${asText(correction.claim?.text, 'inspect the linked correction')}`,
      sourceHash: correction.recordHash,
      action: 'Review evidence'
    });
  } else if (latestResult && latestReviewState === 'accepted' && !latestResultRemembered) {
    unresolved.push({
      id: 'result-independent-execution',
      kind: 'replication',
      title: 'Accepted result needs independent execution',
      detail: 'Human review accepted this result, but reusable room memory still requires two distinct receipt and provider identities.',
      sourceHash: latestResult.recordHash,
      action: 'Reproduce result'
    });
  } else if (latestResult && latestReviewState !== 'accepted') {
    const reviewBoundary = {
      rejected: {
        title: 'Result rejected',
        detail: 'A reviewer rejected this result for durable memory. Inspect the decision, attach a correction, or request new evidence.',
        action: 'Review evidence'
      },
      needs_revision: {
        title: 'Result needs revision',
        detail: 'A reviewer requested changes before this result can be remembered. Inspect the decision and provide the missing context or evidence.',
        action: 'Review evidence'
      },
      replication_requested: {
        title: 'Result needs replication',
        detail: 'An independent reviewer requested another exact execution before this result can enter room memory.',
        action: 'Inspect replication request'
      },
      disputed: {
        title: 'Result review is disputed',
        detail: 'Independent reviewers reached conflicting decisions. The result remains outside memory until the disagreement is resolved.',
        action: 'Review disagreement'
      },
      unresolved: {
        title: 'Result awaits review',
        detail: 'The result remains visible but is not remembered until an independent review accepts it.',
        action: 'Review evidence'
      }
    }[latestReviewState] || {
      title: 'Result awaits review',
      detail: 'The result remains visible but is not remembered until an independent review accepts it.',
      action: 'Review evidence'
    };
    unresolved.push({
      id: 'result-review',
      kind: 'review',
      title: reviewBoundary.title,
      detail: reviewBoundary.detail,
      sourceHash: latestResult.recordHash,
      action: reviewBoundary.action
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
