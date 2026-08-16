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
  compareResearchDecisionContexts,
  invalidatedResearchHashes,
  projectResearchExecutionIndependence,
  projectResearchResolutionCriteria,
  projectResearchReviewStates,
  rankProposedCandidateActions,
  revokedResearchHashes
} from '../../pool/evidence-network.js';
import { projectGovernedResearchCycle } from '../../pool/research-cycle.js';
import { discoveryContractSourceRecords } from '../../pool/discovery-contract.js';

const RESEARCH_KINDS = Object.freeze({
  submission: 'research_submission',
  result: 'research_result',
  claim: 'human_claim',
  hypothesis: 'research_hypothesis',
  prediction: 'research_prediction',
  priorEvidence: 'research_prior_evidence',
  resolutionPolicy: 'research_resolution_policy',
  workOrder: 'research_work_order',
  workClaim: 'research_work_claim',
  outcome: 'research_outcome',
  cohort: 'research_cohort',
  evaluation: 'research_evaluation',
  realizedActionValue: 'research_realized_action_value',
  adjudicationExperiment: 'research_adjudication_experiment',
  adjudicationEvaluation: 'research_adjudication_evaluation',
  discoveryCheckpoint: 'research_discovery_checkpoint',
  candidateAction: 'research_candidate_action',
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
  if (record.kind === RESEARCH_KINDS.claim) {
    if (record.claim?.kind === 'correction' || record.claim?.relation === 'corrects') return 'Correction attached';
    return asText(record.claim?.text, 'Human review recorded');
  }
  if (record.kind === RESEARCH_KINDS.hypothesis) return 'Hypothesis proposed';
  if (record.kind === RESEARCH_KINDS.prediction) return 'Prediction proposed';
  if (record.kind === RESEARCH_KINDS.priorEvidence) return 'Prior evidence linked';
  if (record.kind === RESEARCH_KINDS.resolutionPolicy) return 'Resolution criteria frozen';
  if (record.kind === RESEARCH_KINDS.workOrder) return 'Discovery work proposed';
  if (record.kind === RESEARCH_KINDS.workClaim) return 'Contributor claimed work';
  if (record.kind === RESEARCH_KINDS.outcome) return 'Outcome recorded';
  if (record.kind === RESEARCH_KINDS.cohort) return 'Cohort frozen';
  if (record.kind === RESEARCH_KINDS.evaluation) return 'Evidence evaluated';
  if (record.kind === RESEARCH_KINDS.realizedActionValue) return 'Realized action value measured';
  if (record.kind === RESEARCH_KINDS.adjudicationExperiment) return 'Adjudication experiment frozen';
  if (record.kind === RESEARCH_KINDS.adjudicationEvaluation) return 'Adjudication experiment evaluated';
  if (record.kind === RESEARCH_KINDS.discoveryCheckpoint) return 'Discovery Contract checkpoint frozen';
  if (record.kind === RESEARCH_KINDS.candidateAction) return asText(record.action?.title, 'Candidate action proposed');
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
  if (record.kind === RESEARCH_KINDS.priorEvidence) return asText(record.evidence?.summary, 'Prior evidence');
  if (record.kind === RESEARCH_KINDS.hypothesis) return asText(record.hypothesis?.statement, 'Competing explanation');
  if (record.kind === RESEARCH_KINDS.prediction) return asText(record.prediction?.expectedObservation, 'Expected observation');
  if (record.kind === RESEARCH_KINDS.resolutionPolicy) return `${asText(record.policy?.conclusionLabel, 'Resolution')} · criteria only, no closure authority`;
  if (record.kind === RESEARCH_KINDS.workOrder) return asText(record.work?.title, 'Bounded next work');
  if (record.kind === RESEARCH_KINDS.outcome) return asText(record.outcome?.summary, 'Experimental outcome');
  if (record.kind === RESEARCH_KINDS.realizedActionValue) {
    return `${asText(record.realizedValue?.assessment?.status, 'pending').replace(/_/g, ' ')} · ${record.realizedValue?.contributions?.length || 0} causal contributions`;
  }
  if (record.kind === RESEARCH_KINDS.adjudicationExperiment) {
    return `${asText(record.experiment?.target?.catalogId, 'Unnamed catalog')} · ${asText(record.experiment?.target?.decision, 'Decision not declared')}`;
  }
  if (record.kind === RESEARCH_KINDS.discoveryCheckpoint) {
    return `${record.checkpoint?.inputRecordHashes?.length || 0} complete inputs · ${record.checkpoint?.activeInputRecordHashes?.length || 0} active inputs · ${asText(record.checkpoint?.state?.status, 'open')}`;
  }
  if (record.kind === RESEARCH_KINDS.candidateAction) {
    return `${asText(record.action?.kind, 'action')} · ${record.action?.uncertainty?.map((entry) => `${entry.source}:${entry.representation}`).join(' · ') || 'uncertainty not declared'}`;
  }
  if (record.kind === RESEARCH_KINDS.adjudicationEvaluation) {
    return `Frozen rule: ${asText(record.evaluation?.assessment?.conclusion, 'unavailable')}`;
  }
  return recordTitle(record);
};

const projectAdjudicationProof = (active, reviewStates) => {
  const experiments = sorted(active.filter((record) => record.kind === RESEARCH_KINDS.adjudicationExperiment));
  const experiment = experiments.at(-1) || null;
  if (!experiment) {
    return {
      schema: 'poolday.annotation_adjudication_proof_projection/v1',
      status: 'not_frozen',
      experiment: null,
      evaluation: null,
      gaps: [
        'exact_catalog_missing',
        'curator_role_missing',
        'recurring_decision_missing',
        'frozen_baseline_missing',
        'baseline_action_selection_policy_missing',
        'outcome_access_boundary_missing',
        'paired_comparison_controls_missing',
        'campaign_measurement_plan_missing',
        'north_star_policy_missing',
        'paired_cohort_missing',
        'success_metrics_missing',
        'independent_evaluator_missing'
      ]
    };
  }
  const evaluations = sorted(active.filter((record) => (
    record.kind === RESEARCH_KINDS.adjudicationEvaluation
    && record.experimentHash === experiment.recordHash
    && record.evaluation?.schema === 'poolday.annotation_adjudication_evaluation/v3'
  )));
  const evaluation = evaluations.at(-1) || null;
  const experimentReviewState = reviewStates.get(experiment.recordHash)?.state || 'unresolved';
  const evaluationReviewState = evaluation ? reviewStates.get(evaluation.recordHash)?.state || 'unresolved' : null;
  const baselinePolicyFrozen = experiment.experiment?.schema === 'poolday.annotation_adjudication_experiment/v3';
  const campaignMeasurementFrozen = experiment.experiment?.measurementPlan?.schema
    === 'poolday.adjudication_campaign_measurement_plan/v1';
  const northStarPolicyFrozen = experiment.experiment?.northStarPolicy?.schema
    === 'poolday.adjudication_north_star_policy/v1';
  let status = 'frozen_awaiting_review';
  let gaps = ['independent_experiment_review_missing'];
  if (!baselinePolicyFrozen) {
    status = 'baseline_policy_freeze_required';
    gaps = [
      'baseline_action_selection_policy_missing',
      'outcome_access_boundary_missing',
      'paired_comparison_controls_missing'
    ];
  } else if (!campaignMeasurementFrozen) {
    status = 'campaign_measurement_plan_required';
    gaps = ['campaign_measurement_plan_missing'];
  } else if (!northStarPolicyFrozen) {
    status = 'north_star_policy_required';
    gaps = ['north_star_policy_missing'];
  } else if (['rejected', 'disputed', 'needs_revision', 'replication_requested'].includes(experimentReviewState)) {
    status = `experiment_contract_${experimentReviewState}`;
    gaps = [`experiment_contract_${experimentReviewState}`];
  } else if (experimentReviewState === 'accepted' && !evaluation) {
    status = 'frozen_awaiting_evaluation';
    gaps = ['prospective_paired_evaluation_missing'];
  } else if (experimentReviewState === 'accepted' && evaluation
    && ['rejected', 'disputed', 'needs_revision', 'replication_requested'].includes(evaluationReviewState)) {
    status = `evaluation_${evaluationReviewState}`;
    gaps = [`evaluation_${evaluationReviewState}`];
  } else if (experimentReviewState === 'accepted' && evaluation && evaluationReviewState !== 'accepted') {
    status = 'evaluated_awaiting_review';
    gaps = ['independent_evaluation_review_missing'];
  } else if (experimentReviewState === 'accepted' && evaluationReviewState === 'accepted') {
    status = `experiment_${evaluation.evaluation.assessment.conclusion}`;
    gaps = evaluation.evaluation.assessment.conclusion === 'passes'
      ? []
      : [evaluation.evaluation.assessment.conclusion === 'inconclusive'
          ? 'paired_sample_or_precision_insufficient'
          : 'frozen_success_rule_not_met'];
  }
  return {
    schema: 'poolday.annotation_adjudication_proof_projection/v1',
    status,
    experiment: {
      recordHash: experiment.recordHash,
      reviewState: experimentReviewState,
      schema: experiment.experiment.schema || null,
      contractHash: experiment.experiment.contractHash,
      target: experiment.experiment.target,
      baseline: experiment.experiment.baseline,
      candidate: experiment.experiment.candidate,
      cohort: experiment.experiment.cohort,
      outcomeBoundary: experiment.experiment.outcomeBoundary || null,
      comparison: experiment.experiment.comparison || null,
      measurementPlan: experiment.experiment.measurementPlan || null,
      northStarPolicy: experiment.experiment.northStarPolicy || null,
      metrics: experiment.experiment.metrics,
      successPolicy: experiment.experiment.successPolicy,
      resolution: experiment.experiment.resolution,
      frozenAt: experiment.experiment.frozenAt
    },
    evaluation: evaluation ? {
      recordHash: evaluation.recordHash,
      reviewState: evaluationReviewState,
      conclusion: evaluation.evaluation.assessment.conclusion,
      assessment: evaluation.evaluation.assessment,
      metricResults: evaluation.evaluation.metricResults,
      northStarEvidence: evaluation.evaluation.northStarEvidence || null,
      resultManifest: evaluation.evaluation.resultManifest,
      regressionCount: evaluation.evaluation.regressionCount,
      missingCaseCount: evaluation.evaluation.missingCaseCount
    } : null,
    gaps
  };
};

const acceptedCorrectionsByTarget = (active, reviewStates) => new Map(
  active
    .filter((record) => record.kind === RESEARCH_KINDS.claim)
    .filter((record) => record.claim?.kind === 'correction' || record.claim?.relation === 'corrects')
    .filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted')
    .map((record) => [record.targetHash, record])
);

const statusForRecord = (record, reviewStates, invalidated, acceptedCorrections) => {
  if (invalidated.has(record.recordHash)) return 'invalidated';
  if (acceptedCorrections.has(record.recordHash)) return 'corrected';
  return reviewStates.get(record.recordHash)?.state || 'unreviewed';
};

const isCorrection = (record = {}) => record.kind === RESEARCH_KINDS.claim
  && (record.claim?.kind === 'correction' || record.claim?.relation === 'corrects');

const archiveStateForRecord = ({
  record,
  reviewStates,
  invalidated,
  revoked,
  acceptedCorrections
}) => {
  if (revoked.has(record.recordHash)) return 'revoked';
  if (invalidated.has(record.recordHash)) return 'invalidated';
  if (acceptedCorrections.has(record.recordHash)) return 'superseded';
  if (record.kind === RESEARCH_KINDS.revocation) return 'revocation_recorded';
  if (record.kind === RESEARCH_KINDS.discoveryCheckpoint) return 'checkpointed';
  if (record.kind === RESEARCH_KINDS.outcome && record.outcome?.attempt?.status === 'failed') return 'failed';
  const reviewState = reviewStates.get(record.recordHash)?.state || 'unresolved';
  if (isCorrection(record) && reviewState === 'accepted') return 'corrected';
  if (['accepted', 'rejected', 'needs_revision', 'replication_requested', 'disputed'].includes(reviewState)) {
    return reviewState;
  }
  return 'provisional';
};

const dedupeQuarantine = (quarantinedRecords = [], rejectedRecords = []) => {
  const entries = new Map();
  for (const candidate of [...rejectedRecords, ...quarantinedRecords]) {
    const record = candidate?.record && typeof candidate.record === 'object' ? candidate.record : null;
    const recordHash = asText(candidate?.recordHash || record?.recordHash, null);
    const reason = asText(candidate?.reason, 'Rejected by verification or admission policy');
    const key = `${recordHash || 'unknown'}:${reason}`;
    entries.set(key, {
      id: `quarantine:${key}`,
      recordHash,
      claimedKind: asText(record?.kind, null),
      claimedCreatedAt: asText(record?.createdAt, null),
      reason,
      quarantinedAt: asText(candidate?.quarantinedAt, null),
      state: 'rejected',
      provenance: 'verification_quarantine'
    });
  }
  return [...entries.values()].sort((left, right) => (
    asText(left.claimedCreatedAt).localeCompare(asText(right.claimedCreatedAt))
    || asText(left.recordHash).localeCompare(asText(right.recordHash))
  ));
};

const countArchiveStates = (entries = []) => entries.reduce((counts, entry) => ({
  ...counts,
  [entry.state]: (counts[entry.state] || 0) + 1
}), {});

export function projectCompleteEvidenceArchive({
  roomId,
  records = [],
  reviewStates = new Map(),
  invalidated = new Set(),
  acceptedCorrections = new Map(),
  rememberedHashes = new Set(),
  memoryExclusions = [],
  quarantinedRecords = [],
  syncState = {}
} = {}) {
  const revoked = revokedResearchHashes(records);
  const exclusionsByHash = new Map(memoryExclusions.map((entry) => [entry.recordHash, entry]));
  const entries = sorted(records).map((record) => {
    const exclusion = exclusionsByHash.get(record.recordHash) || null;
    const correction = acceptedCorrections.get(record.recordHash) || null;
    return {
      id: record.recordHash,
      recordHash: record.recordHash,
      kind: record.kind,
      state: archiveStateForRecord({ record, reviewStates, invalidated, revoked, acceptedCorrections }),
      title: recordTitle(record),
      summary: recordSummary(record),
      createdAt: record.createdAt || null,
      provenance: {
        authority: 'signed_research_record',
        authorRole: record.author?.role || record.author?.roleId || null,
        authorIdentityRootId: record.author?.identityRootId || null,
        signatureDomain: record.signatureDomain || null
      },
      decisionMemoryAdmitted: rememberedHashes.has(record.recordHash),
      decisionMemoryExclusionReason: exclusion?.reason || null,
      supersededByHash: correction?.recordHash || exclusion?.supersededByHash || null
    };
  });
  const rejected = dedupeQuarantine(quarantinedRecords, syncState.rejectedRecords || []);
  const phase = ['local_only', 'synchronizing', 'synchronized', 'stale'].includes(syncState.phase)
    ? syncState.phase
    : 'local_only';
  return {
    schema: 'poolday.complete_room_evidence_archive/v1',
    roomId: asText(roomId, 'reploid-default'),
    boundary: phase === 'synchronized'
      ? 'verified_local_and_coordinator_snapshot'
      : phase === 'synchronizing'
        ? 'verified_local_snapshot_coordinator_pending'
        : phase === 'stale'
          ? 'verified_local_snapshot_coordinator_stale'
          : 'verified_local_snapshot',
    immutableRecordHashes: entries.map((entry) => entry.recordHash),
    entries,
    rejected,
    stateCounts: countArchiveStates([...entries, ...rejected])
  };
}

const evidenceAgreement = (result, records) => {
  if (!result) return { state: 'evidence_unavailable', label: 'Evidence unavailable', sourceHash: null };
  const agreement = result.compute?.agreement || null;
  const explicitStatus = asText(agreement?.status).toLowerCase();
  const independence = projectResearchExecutionIndependence(result);
  if ((explicitStatus === 'accepted' || explicitStatus === 'agreed')
    && independence.independentlyExecuted) {
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

const projectProposals = (active, reviewStates, acceptedCorrections) => active
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

const projectUnresolved = ({
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

const explicitAgreementTimelineEntry = (record) => {
  if (record.kind !== RESEARCH_KINDS.result) return null;
  const status = asText(record.compute?.agreement?.status || record.compute?.status).toLowerCase();
  const isAgreement = status === 'accepted' || status === 'agreed';
  const isDisagreement = status === 'rejected'
    || status === 'disagreement'
    || status === 'redundant_disagreement';
  if (!isAgreement && !isDisagreement) return null;
  const title = isAgreement ? 'Agreement assessed' : 'Disagreement assessed';
  return makeTimelineEntry({
    id: `agreement:${record.recordHash}`,
    kind: 'agreement',
    occurredAt: record.createdAt,
    title,
    status,
    sourceAuthority: 'execution',
    sourceHash: record.recordHash,
    summary: isAgreement
      ? 'The signed execution record carries an explicit agreement assessment.'
      : 'The signed execution record carries an explicit disagreement assessment.',
    action: 'Inspect evidence'
  });
};

const buildTimeline = ({ records, peerEvents, receipts, reviewStates, invalidated, acceptedCorrections, agreement }) => {
  const entries = records.flatMap((record) => [
    makeTimelineEntry({
      id: record.recordHash,
      kind: record.kind,
      occurredAt: record.createdAt,
      title: recordTitle(record),
      status: statusForRecord(record, reviewStates, invalidated, acceptedCorrections),
      sourceAuthority: record.kind === RESEARCH_KINDS.result ? 'execution' : 'research_evidence',
      sourceHash: record.recordHash,
      summary: recordSummary(record),
      action: record.kind === RESEARCH_KINDS.claim ? 'Review evidence' : null
    }),
    explicitAgreementTimelineEntry(record)
  ].filter(Boolean));
  if (agreement?.sourceHash
    && ['agreement_assessed', 'disagreement_assessed'].includes(agreement.state)
    && !entries.some((entry) => entry.kind === 'agreement' && entry.sourceHash === agreement.sourceHash)) {
    const result = records.find((record) => record.recordHash === agreement.sourceHash);
    entries.push(makeTimelineEntry({
      id: `agreement:${agreement.sourceHash}`,
      kind: 'agreement',
      occurredAt: result?.createdAt,
      title: agreement.label,
      status: agreement.state,
      sourceAuthority: 'research_evidence',
      sourceHash: agreement.sourceHash,
      summary: agreement.state === 'agreement_assessed'
        ? 'Signed review evidence assessed agreement for this result.'
        : 'Signed review evidence assessed disagreement for this result.',
      action: 'Review evidence'
    }));
  }
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

const projectResult = (
  result,
  submission,
  reviewStates,
  agreement,
  modelEvidence,
  acceptedCorrections,
  rememberedHashes
) => {
  if (!result) return null;
  const consent = publicationConsent(submission);
  const reviewState = reviewStates.get(result.recordHash)?.state || 'unreviewed';
  return {
    sourceHash: result.recordHash,
    status: acceptedCorrections.has(result.recordHash)
      ? 'corrected'
      : reviewState === 'accepted' && !rememberedHashes.has(result.recordHash)
        ? 'accepted_pending_replication'
        : reviewState,
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
    reviewState,
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
  awaiting_review: 'Awaiting review',
  awaiting_replication: 'Awaiting independent execution'
});

const projectRecovery = ({
  syncState = {},
  invalidatedCount = 0,
  awaitingReview = false,
  awaitingReplication = false,
  activeCount = 0
} = {}) => {
  const phase = ['local_only', 'synchronizing', 'synchronized', 'stale'].includes(syncState.phase)
    ? syncState.phase
    : 'local_only';
  const states = [];
  if (phase === 'stale' && activeCount > 0) states.push('local_only');
  states.push(phase);
  if (Array.isArray(syncState.rejectedRecords) && syncState.rejectedRecords.length) states.push('rejected');
  if (invalidatedCount > 0) states.push('invalidated');
  if (awaitingReview) states.push('awaiting_review');
  if (awaitingReplication) states.push('awaiting_replication');
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

const projectPriorRoomEvidence = ({ roomId, submission, currentRecords = [], crossRoomEvidence = {} } = {}) => {
  const projection = crossRoomEvidence?.projection || null;
  const sequenceMatches = Boolean(
    submission?.sequence?.hash
    && projection?.sequence?.hash === submission.sequence.hash
  );
  const recordsByHash = new Map(asArray(projection?.records).map((record) => [record.recordHash, record]));
  const roomsById = new Map(asArray(projection?.rooms).map((room) => [room.roomId, room]));
  const candidates = sequenceMatches
    ? asArray(projection?.candidates)
      .filter((candidate) => candidate.originRoomId !== roomId)
      .map((candidate) => {
        const record = recordsByHash.get(candidate.recordHash) || null;
        const originQuestion = recordsByHash.get(record?.questionHash) || null;
        const originRoom = roomsById.get(candidate.originRoomId) || null;
        const duplicateRecordHashes = asArray(candidate.duplicateRecordHashes).length
          ? asArray(candidate.duplicateRecordHashes)
          : [candidate.recordHash];
        const attachedRecord = currentRecords.find((entry) => (
          entry.kind === RESEARCH_KINDS.priorEvidence
          && duplicateRecordHashes.includes(entry.evidence?.reference?.contentHash)
        )) || null;
        const qualification = candidate.qualification || { status: 'needs_source_qualification', reasons: ['qualification_missing'] };
        const contextComparison = compareResearchDecisionContexts(originQuestion, submission);
        return {
          id: candidate.recordHash,
          recordHash: candidate.recordHash,
          originRoomId: candidate.originRoomId,
          originQuestionHashes: asArray(candidate.originQuestionHashes),
          kind: candidate.kind || record?.kind || 'research_evidence',
          title: recordTitle(record),
          summary: recordSummary(record),
          createdAt: record?.createdAt || null,
          originalRoomAccepted: candidate.originalRoomAccepted === true,
          qualification,
          deduplication: asText(candidate.deduplication, 'unique_source_record'),
          duplicateRecordHashes,
          duplicateOriginRoomIds: asArray(candidate.duplicateOriginRoomIds),
          duplicateOrigins: asArray(candidate.duplicateOrigins),
          admission: 'requires_current_room_review',
          attachable: record?.kind === RESEARCH_KINDS.priorEvidence
            && qualification.status === 'source_metadata_complete'
            && contextComparison.status !== 'context_unavailable'
            && !attachedRecord,
          attachedRecordHash: attachedRecord?.recordHash || null,
          annotation: record?.evidence?.annotation || null,
          contextComparison,
          sourceVersions: asArray(originRoom?.sourceVersions),
          sourceRecord: record
        };
      })
    : [];
  return {
    schema: 'poolday.prior_room_evidence_projection/v1',
    phase: asText(crossRoomEvidence?.phase, 'idle'),
    sequenceHash: submission?.sequence?.hash || null,
    sequenceMatches,
    registryBoundary: crossRoomEvidence?.registryBoundary || null,
    roomCount: sequenceMatches
      ? asArray(projection?.rooms).filter((room) => room.roomId !== roomId).length
      : 0,
    candidates,
    error: crossRoomEvidence?.error ? asText(crossRoomEvidence.error) : null
  };
};

const projectCampaignQueue = ({ submission, campaignQueue = {} } = {}) => {
  const projection = campaignQueue?.projection || null;
  const entries = asArray(projection?.entries);
  const current = submission?.sequence?.hash
    ? entries.find((entry) => entry.sequence?.hash === submission.sequence.hash) || null
    : null;
  return {
    schema: 'poolday.room_campaign_queue_projection/v1',
    phase: asText(campaignQueue?.phase, 'idle'),
    policy: projection?.policy || null,
    boundary: projection?.boundary || null,
    complete: projection?.complete === true,
    current,
    eligibleCount: entries.filter((entry) => entry.priority?.eligible).length,
    entries: entries.slice(0, 5),
    error: campaignQueue?.error ? asText(campaignQueue.error) : null
  };
};

const projectDiscoveryContractCheckpoint = ({ records, submission, cycle } = {}) => {
  if (!submission) return {
    schema: 'poolday.discovery_contract_checkpoint_projection/v1',
    status: 'question_missing',
    currentInputSet: false,
    canCheckpoint: false,
    latest: null,
    unfrozenRecordHashes: [],
    triggerKinds: []
  };
  const checkpoints = sorted(records.filter((record) => (
    record.kind === RESEARCH_KINDS.discoveryCheckpoint
    && record.checkpoint?.questionHash === submission.recordHash
  )));
  const latestCheckpoint = checkpoints.at(-1) || null;
  const sourceRecords = discoveryContractSourceRecords(records, submission.recordHash);
  const sourceHashes = sourceRecords.map((record) => record.recordHash);
  if (!latestCheckpoint) return {
    schema: 'poolday.discovery_contract_checkpoint_projection/v1',
    status: 'checkpoint_missing',
    currentInputSet: false,
    canCheckpoint: true,
    latest: null,
    unfrozenRecordHashes: sourceHashes,
    triggerKinds: []
  };
  const frozenInputs = new Set(latestCheckpoint.checkpoint.inputRecordHashes || []);
  const currentInputSet = JSON.stringify(sourceHashes) === JSON.stringify(latestCheckpoint.checkpoint.inputRecordHashes || []);
  const activeSourceHashes = new Set(activeResearchRecords(sourceRecords).map((record) => record.recordHash));
  const invalidatedParentInputHashes = (latestCheckpoint.checkpoint.activeInputRecordHashes || [])
    .filter((hash) => !activeSourceHashes.has(hash));
  const remembered = new Set(cycle?.memory?.acceptedHashes || []);
  const removedDecisionMemoryHashes = (latestCheckpoint.checkpoint.state?.decisionMemory?.acceptedHashes || [])
    .filter((hash) => !remembered.has(hash));
  const unfrozenRecords = sourceRecords.filter((record) => !frozenInputs.has(record.recordHash));
  const triggerKinds = [];
  for (const record of unfrozenRecords) {
    if (record.kind === RESEARCH_KINDS.claim && record.claim?.relation === 'contradicts') triggerKinds.push('contradiction');
    if (record.kind === RESEARCH_KINDS.claim
      && (record.claim?.kind === 'correction' || record.claim?.relation === 'corrects')) triggerKinds.push('correction');
    if (record.kind === RESEARCH_KINDS.revocation) triggerKinds.push('revocation');
    if (record.kind === RESEARCH_KINDS.outcome
      && record.replicationOfHash
      && record.outcome?.attempt?.status === 'failed') triggerKinds.push('failed_replication');
  }
  if (invalidatedParentInputHashes.length) triggerKinds.push('policy_active_input_invalidated');
  if (removedDecisionMemoryHashes.length) triggerKinds.push('decision_memory_reopened');
  const prospectiveTriggers = unique(triggerKinds).sort();
  const status = currentInputSet
    ? latestCheckpoint.checkpoint.state?.status === 'reopened' ? 'reopened' : 'current'
    : prospectiveTriggers.length ? 'reopen_required' : 'checkpoint_required';
  return {
    schema: 'poolday.discovery_contract_checkpoint_projection/v1',
    status,
    currentInputSet,
    canCheckpoint: !currentInputSet,
    latest: {
      recordHash: latestCheckpoint.recordHash,
      createdAt: latestCheckpoint.createdAt,
      stateHash: latestCheckpoint.checkpoint.stateHash,
      projectionId: latestCheckpoint.checkpoint.projection?.id || null,
      projectionArtifactHash: latestCheckpoint.checkpoint.projection?.artifactHash || null,
      parentCheckpointHashes: [...(latestCheckpoint.checkpoint.parentCheckpointHashes || [])],
      inputRecordCount: latestCheckpoint.checkpoint.inputRecordHashes?.length || 0,
      activeInputRecordCount: latestCheckpoint.checkpoint.activeInputRecordHashes?.length || 0,
      decisionMemoryCount: latestCheckpoint.checkpoint.state?.decisionMemory?.acceptedHashes?.length || 0,
      stateStatus: latestCheckpoint.checkpoint.state?.status || 'open'
    },
    unfrozenRecordHashes: unfrozenRecords.map((record) => record.recordHash),
    triggerKinds: prospectiveTriggers.length
      ? prospectiveTriggers
      : [...(latestCheckpoint.checkpoint.state?.reopen?.triggerKinds || [])],
    invalidatedParentInputHashes,
    removedDecisionMemoryHashes
  };
};

export function projectResearchRoom({
  roomId,
  routeId = 'home',
  researchRecords = [],
  quarantinedRecords = [],
  crossRoomEvidence = {},
  campaignQueue = {},
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
  const acceptedCorrections = acceptedCorrectionsByTarget(active, reviewStates);
  const submission = latest(active, RESEARCH_KINDS.submission);
  const result = resultForQuestion(active, submission);
  const agreement = evidenceAgreement(result, scopedRecords);
  const cycle = projectGovernedResearchCycle(scopedRecords, { questionHash: submission?.recordHash || null });
  const resolutionCriteria = projectResearchResolutionCriteria(scopedRecords, submission?.recordHash || null);
  const rememberedHashes = new Set(cycle.memory.acceptedHashes);
  const tasks = cycle.actions;
  const ranked = cycle.ranking.rankedCandidates || [];
  const rankedById = new Map(ranked.map((task) => [task.actionId, task]));
  const projectedTasks = tasks
    .map((task) => ({ ...task, ...(rankedById.get(task.taskId) || {}) }))
    .sort((left, right) => Number(right.heuristicPriority || 0) - Number(left.heuristicPriority || 0));
  const candidateRanking = rankProposedCandidateActions(scopedRecords);
  const signedCandidateActions = candidateRanking.admittedCandidates.map((candidate) => ({
    actionType: 'signed_candidate_action',
    actionId: candidate.actionId,
    actionKind: candidate.actionKind,
    title: candidate.title,
    targetHash: candidate.recordHash,
    reason: candidate.rationale,
    status: candidate.humanApprovalState === 'approved' ? 'approved' : 'proposed',
    heuristicPriority: candidate.rankingScore,
    basis: 'signed_candidate_contract',
    basisHashes: candidate.affectedHypothesisHashes,
    approvalRecordHashes: candidate.approvalRecordHashes,
    contractHash: candidate.actionId,
    rawValueComponents: candidate.rawValueComponents,
    scientificCost: candidate.scientificCost,
    uncertainty: candidate.uncertainty,
    execution: candidate.execution,
    rankingStatus: candidate.rankingStatus,
    allocationAuthority: candidate.allocationAuthority,
    executionAuthority: candidate.executionAuthority
  }));
  const nextActions = [...signedCandidateActions, ...projectedTasks];
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
        policyId: submission.policyId || null,
        clarity: cycle.clarity
      }
    : null;
  const activeByHash = new Map(active.map((record) => [record.recordHash, record]));
  const memory = cycle.memory.records.map((entry) => {
    const record = activeByHash.get(entry.recordHash);
    return {
      id: entry.recordHash,
      kind: entry.kind,
      occurredAt: record?.createdAt || null,
      title: recordTitle(record),
      status: 'accepted',
      sourceHash: entry.recordHash,
      reviewDecisionHashes: entry.reviewDecisionHashes
    };
  });
  const archive = projectCompleteEvidenceArchive({
    roomId,
    records: scopedRecords,
    reviewStates,
    invalidated,
    acceptedCorrections,
    rememberedHashes,
    memoryExclusions: cycle.memory.excluded,
    quarantinedRecords,
    syncState
  });
  const priorRoomEvidence = projectPriorRoomEvidence({
    roomId,
    submission,
    currentRecords: scopedRecords,
    crossRoomEvidence
  });
  const proteinCampaign = projectCampaignQueue({ submission, campaignQueue });
  const adjudicationProof = projectAdjudicationProof(active, reviewStates);
  const discoveryContract = projectDiscoveryContractCheckpoint({
    records: scopedRecords,
    submission,
    cycle
  });
  const cycleExclusions = new Map(cycle.memory.excluded.map((entry) => [entry.recordHash, entry]));
  const decisionMemory = {
    schema: 'poolday.decision_memory_projection/v1',
    policyId: cycle.policyId,
    admissionPolicy: cycle.memory.policy,
    decisionContextHash: submission?.recordHash || null,
    sourceArchiveSchema: archive.schema,
    acceptedHashes: [...cycle.memory.acceptedHashes],
    entries: memory,
    excluded: [
      ...archive.entries
        .filter((entry) => !rememberedHashes.has(entry.recordHash))
        .map((entry) => ({
          recordHash: entry.recordHash,
          state: entry.state,
          reason: cycleExclusions.get(entry.recordHash)?.reason || entry.state,
          supersededByHash: entry.supersededByHash
        })),
      ...archive.rejected.map((entry) => ({
        recordHash: entry.recordHash,
        archiveEntryId: entry.id,
        state: 'rejected',
        reason: entry.reason,
        supersededByHash: null
      }))
    ]
  };
  const proposals = projectProposals(active, reviewStates, acceptedCorrections);
  const unresolved = projectUnresolved({
    active,
    reviewStates,
    latestResult: result,
    latestResultRemembered: result ? rememberedHashes.has(result.recordHash) : false,
    agreement,
    tasks: nextActions,
    acceptedCorrections
  });
  const timeline = buildTimeline({
    records: scopedRecords,
    peerEvents: scopedPeerEvents,
    receipts: scopedReceipts,
    reviewStates,
    invalidated,
    acceptedCorrections,
    agreement
  });
  const status = !submission
    ? 'ready'
    : !result
      ? 'investigating'
      : acceptedCorrections.has(result.recordHash)
        ? 'corrected'
        : reviewStates.get(result.recordHash)?.state === 'accepted'
          ? rememberedHashes.has(result.recordHash) ? 'remembered' : 'awaiting_replication'
          : 'awaiting_review';
  const recovery = projectRecovery({
    syncState,
    invalidatedCount: invalidated.size,
    awaitingReview: status === 'awaiting_review',
    awaitingReplication: status === 'awaiting_replication',
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
    latestResult: projectResult(
      result,
      submission,
      reviewStates,
      agreement,
      modelEvidence,
      acceptedCorrections,
      rememberedHashes
    ),
    unresolved,
    nextActions: nextActions.slice(0, 5).map((task) => ({
      id: task.actionId || task.taskId,
      kind: task.actionKind || task.kind || 'next_action',
      targetHash: task.targetHash,
      reason: task.reason,
      status: task.status || 'proposed',
      priority: task.heuristicPriority || null,
      basis: task.basis || 'governance',
      basisHashes: task.basisHashes || [],
      approvalRecordHashes: task.approvalRecordHashes || [],
      actionType: task.actionType || 'projected_governance_task',
      title: task.title || null,
      contractHash: task.contractHash || null,
      rawValueComponents: task.rawValueComponents || null,
      scientificCost: task.scientificCost || null,
      uncertainty: task.uncertainty || [],
      execution: task.execution || null,
      rankingStatus: task.rankingStatus || null,
      allocationAuthority: task.allocationAuthority || 'none',
      executionAuthority: task.executionAuthority || 'none'
    })),
    archive,
    priorRoomEvidence,
    proteinCampaign,
    adjudicationProof,
    resolutionCriteria,
    discoveryContract,
    decisionMemory,
    memory: decisionMemory.entries,
    memoryExclusions: decisionMemory.excluded,
    proposals,
    timeline,
    cycle,
    candidateActions: candidateRanking,
    nextQuestion: cycle.nextQuestion,
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
      archive: archive.entries.length + archive.rejected.length,
      memory: memory.length,
      priorRoomCandidates: priorRoomEvidence.candidates.length,
      campaignEntries: proteinCampaign.entries.length,
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
