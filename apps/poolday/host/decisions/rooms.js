/**
 * Research Room-1 without markup: the research request (sequence, model, publication consent, the bounded question,
 * verification) with its per-room draft, the research room projected from signed local and coordinator records, the
 * evidence-network workspace and the room actions (replay checkpoint, prior-room evidence, exact candidate and task
 * approvals, the canonical sample dispute). The vanilla page's projections and wording (ui/pool-home/room-view.js,
 * research-workspace-render.js, research-room-actions.js, requester-controls.js, route-controls.js), as one snapshot
 * and commands. Every action signs and publishes a record through research-store.js; none decides scientific truth.
 * The workspace's forms, review and queues are projected by research-workspace.js.
 */
import { createPoolIdentity } from '../../../../shared/pool/identity.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract, getPoolModelWorkload, listPoolModels } from '../../../../shared/pool/model-contract.js';
import { getPeerRoomId } from '../product-context.js';
import { listPolicies } from '../../pool/policy-router.js';
import { createDiscoveryContractCheckpoint } from '../../pool/discovery-contract.js';
import {
  activeResearchRecords, createSignedHumanClaim, proposeDiscoveryTasks, rankProposedCandidateActions
} from '../../pool/evidence-network.js';
import { ROUTE_COPY } from '../../ui/pool-home/constants.js';
import { getPoolLedgerStore } from '../../ui/pool-home/ledger-store.js';
import { createPoolRecordPersistence } from '../../ui/pool-home/record-persistence.js';
import { projectResearchRoom, researchRoomAgreementLabels } from '../../ui/pool-home/room-projection.js';
import { createCurrentRoomPriorEvidence } from '../../ui/pool-home/research-room-actions.js';
import { createLifecycleRecordFromForm } from '../../ui/pool-home/research-lifecycle-records.js';
import { createContextualReviewRecord } from '../../ui/pool-home/research-review-records.js';
import {
  DEFAULT_REVIEW, lifecycleProblem, lifecycleValues, projectLifecycleForms, projectResearchSources, projectResearchWorkspace, reviewProblem, reviewTargets,
  selectedReviewTarget
} from './research-workspace.js';
import {
  getCrossRoomSequenceEvidence, getProteinUncertaintyCampaignQueue, getResearchSyncState, hydrateCrossRoomSequenceEvidence,
  hydrateProteinUncertaintyCampaignQueue, hydrateResearchRecords, loadQuarantinedResearchRecords, loadResearchRecords, publishResearchRecord
} from '../../ui/pool-home/research-store.js';

export const DEFAULT_SEQUENCE = 'MAPLALLLLGLVAGA';
export const INTENT_KINDS = Object.freeze([['question', 'Question'], ['hypothesis', 'Hypothesis'], ['label', 'Label'], ['task_context', 'Task context']]);
const POLICY_LABELS = { fastest_receipt: 'One peer', canary_audited: 'One peer with audit', redundant_agreement: 'Two matching peers', ring_quorum_receipt: 'Peer quorum' };
const DRAFT_FIELDS = ['sequence', 'intentKind', 'intentLabel', 'intentText', 'intentConditions', 'intentObservation', 'intentDecision',
  'intentScope', 'intentExclusions', 'intentUnknowns', 'sequencePublic', 'researchPublic'];
const STATUS_LABELS = { ready: 'Ready for a question', investigating: 'Investigation in progress', awaiting_review: 'Awaiting review',
  awaiting_replication: 'Awaiting independent execution', corrected: 'Result corrected', remembered: 'Accepted evidence remembered' };
// The canonical dispute (UniProt P0DTC2, 1,273 residues) is longer than the public input limit. Sending a prefix would
// silently change a scientific input, so the control states why it cannot load here instead.
export const CANONICAL_DISPUTE_BLOCKED = "The full sequence is longer than the 1,024-residue public limit, so this dispute can't be loaded here.";

export const compactHash = (value) => {
  const text = String(value || 'unknown');
  return text.length > 24 ? `${text.slice(0, 16)}...${text.slice(-8)}` : text;
};
const words = value => String(value || '').replace(/_/g, ' ');

/** A room address as the vanilla room links it: path, room, panel and review target. */
export function roomHref(path, roomId, panel = '', targetHash = '') {
  const url = new URL(path, 'https://reploid.invalid');
  if (roomId) url.searchParams.set('room', roomId);
  if (panel) url.searchParams.set('panel', panel);
  if (targetHash) url.searchParams.set('target', targetHash);
  const anchors = { review: 'pool-room-review', discovery: 'pool-room-discovery', 'candidate-actions': 'pool-room-candidate-actions' };
  if (anchors[panel]) url.hash = anchors[panel];
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The model a run uses, as the request form's details list it. */
export function packFacts(model = LAUNCH_MODEL) {
  const identity = model.artifactIdentity || {};
  const dimensions = Number(model.embeddingDimensions || model.dimensions || 0);
  const maxInput = Number(model.sequence?.maxLength || model.contextLength || 0);
  return [
    ['Model identity', compactHash(identity.weightPackId || model.modelHash || model.modelId)],
    ['Capability', dimensions ? `Sequence embedding · ${dimensions} dimensions` : getPoolModelWorkload(model).replace(/[._-]/g, ' ')],
    ['Input', maxInput ? `Public protein sequence · up to ${maxInput} residues` : 'Public protein sequence'],
    ['Work', model.executionMode === 'full_model_browser_sequence' ? 'Full model · one sequence' : `${model.runtime || 'Doppler'} · ${model.backend || 'qualified provider'}`],
    ['Providers', 'Searching']
  ];
}

const annotationIdentityLabel = (annotation = null) => {
  if (!annotation) return null;
  const ontology = annotation.ontology || {}, coordinates = annotation.coordinates || {};
  const term = [ontology.namespace, ontology.termId].filter(Boolean).join(':');
  if (!term || !ontology.version || !Number.isInteger(coordinates.start) || !Number.isInteger(coordinates.end)) return null;
  return `${annotation.scope || 'annotation'} · ${term} @ ${ontology.version} · canonical residues ${coordinates.start}-${coordinates.end} (one-based closed)`;
};
const CONTRACT_LABELS = { question_missing: 'Question required', checkpoint_missing: 'Checkpoint missing', checkpoint_required: 'New inputs require a checkpoint',
  reopen_required: 'Reopening must be checkpointed', current: 'Current checkpoint', reopened: 'Reopened state checkpointed' };
const RESOLUTION_LABELS = { policy_missing: 'Criteria missing', awaiting_independent_review: 'Awaiting independent review', criteria_frozen: 'Criteria frozen' };
const CAMPAIGN_LABELS = { exactContractEmbedding: 'Exact-contract embeddings', publicAnnotation: 'Public annotations', independentReviewer: 'Independent reviewers', experimentalEvidence: 'Experimental evidence' };
const TIMELINE_ANCHORS = ['research_submission', 'research_result', 'agreement', 'receipt'];

/** The room's replay checkpoint, resolution criteria, adjudication proof, campaign, prior-room evidence, proposals and canvas. */
export function projectRoomSections(room) {
  const contract = room.discoveryContract || { status: 'question_missing', latest: null };
  const latest = contract.latest;
  const resolution = room.resolutionCriteria || { status: 'policy_missing', policy: null };
  const policy = resolution.policy;
  const proof = room.adjudicationProof || { status: 'not_frozen', gaps: [] };
  const experiment = proof.experiment, evaluation = proof.evaluation;
  const campaign = room.proteinCampaign || {};
  const current = campaign.current || null;
  const prior = room.priorRoomEvidence || { phase: 'idle', candidates: [], roomCount: 0 };
  const boundary = prior.registryBoundary?.boundary || 'not queried';
  const timeline = room.timeline || [];
  const anchors = new Set(timeline.filter(entry => TIMELINE_ANCHORS.includes(entry.kind)).map(entry => entry.id));
  timeline.slice(-13).forEach(entry => anchors.add(entry.id));
  const timelineEntry = entry => ({ title: entry.title, status: entry.status, summary: entry.summary, meta: `${entry.sourceAuthority} · ${compactHash(entry.sourceHash || entry.id)}` });
  return {
    contract: {
      status: contract.status, label: CONTRACT_LABELS[contract.status] || contract.status,
      facts: latest ? [['Checkpoint', compactHash(latest.recordHash)], ['State', String(latest.stateStatus)], ['Complete inputs', String(latest.inputRecordCount)],
        ['Active inputs', String(latest.activeInputRecordCount)], ['Decision memory', String(latest.decisionMemoryCount)], ['Projection', latest.projectionId || 'unknown']] : [],
      unfrozen: contract.unfrozenRecordHashes?.length ? `${contract.unfrozenRecordHashes.length} signed input${contract.unfrozenRecordHashes.length === 1 ? '' : 's'} remain outside the latest checkpoint.` : '',
      triggers: contract.triggerKinds?.length ? `Reopening evidence: ${words(contract.triggerKinds.join(' · '))}.` : '',
      canCheckpoint: contract.canCheckpoint === true,
      button: ({ reopen_required: 'Sign reopened checkpoint', checkpoint_missing: 'Sign first checkpoint' })[contract.status] || 'Checkpoint is current'
    },
    resolution: {
      status: resolution.status, label: RESOLUTION_LABELS[resolution.status] || resolution.status,
      boundary: resolution.boundary || 'Criteria define future eligibility only and grant no scientific closure authority.',
      facts: policy ? [['Conclusion label', policy.conclusionLabel], ['Decision scope', policy.decisionScope],
        ['Provisional acceptance', `${policy.provisionalAcceptance.minimumAcceptedCompletedOutcomes} accepted outcomes · ${policy.provisionalAcceptance.minimumIndependentReplications} independent replications`],
        ['Rejection', `${policy.rejection.minimumAcceptedCompletedOutcomes} accepted ${policy.rejection.outcomeClassifications.join(' / ')} outcome(s)`],
        ['Continued uncertainty', `Continue investigation when ${words(policy.continuedUncertainty.triggers.join(' · '))}`], ['Reopening', words(policy.reopening.triggers.join(' · '))],
        ['Closure eligibility', `${policy.closure.minimumAcceptedCompletedOutcomes} outcomes · ${policy.closure.minimumIndependentReplications} replications · ${policy.closure.requiredDistinctReviewerIdentities} reviewers`],
        ['Closure authority', 'None in the current product']] : []
    },
    proof: {
      status: words(proof.status),
      facts: experiment ? [['Catalog', `${experiment.target.catalogId} @ ${experiment.target.catalogVersion}`], ['Curator role', experiment.target.curatorRole], ['Decision', experiment.target.decision],
        ['Baseline', `${experiment.baseline.workflowId} @ ${experiment.baseline.version}`],
        ['Baseline action policy', experiment.baseline.actionSelection ? `${experiment.baseline.actionSelection.policyId} @ ${experiment.baseline.actionSelection.version} · ${words(experiment.baseline.actionSelection.rankingStatus)}` : 'not frozen'],
        ['Candidate', `${experiment.candidate.policyId} @ ${experiment.candidate.version}`], ['Paired cohort', `${experiment.cohort.caseCount} family-disjoint cases`],
        ['Outcome access at freeze', experiment.outcomeBoundary ? `${words(experiment.outcomeBoundary.mode)} · ${words(experiment.outcomeBoundary.accessAtFreeze)} · cutoff ${experiment.outcomeBoundary.evidenceCutoffAt}` : 'not frozen'],
        ['Comparison controls', experiment.comparison?.pairedTasks && experiment.comparison?.sameInputOrder && experiment.comparison?.sameEvidenceCutoff ? 'paired tasks · same input order · same evidence cutoff' : 'not frozen'],
        ['Campaign measures', experiment.measurementPlan ? 'information gain · contradiction cost · duplicate work · calibration error · held-out family performance' : 'not frozen'],
        ['North-star policy', experiment.northStarPolicy ? `${experiment.northStarPolicy.aggregation.cohortStatistic} ${experiment.northStarPolicy.costRepresentation.normalizedUnit} cost · ${experiment.northStarPolicy.conclusionCriteria.minimumIndependentReplications} independent replication minimum` : 'not frozen'],
        ['North-star evidence', evaluation?.northStarEvidence?.reportingStatus || 'not reported']] : [],
      frozen: Boolean(experiment),
      metrics: (evaluation?.metricResults || []).map(metric => ({ title: metric.metricId, meta: `${metric.pairedSampleCount} paired cases`,
        detail: `${metric.baselineValue} baseline to ${metric.candidateValue} candidate · oriented effect ${metric.orientedEffect} · interval ${metric.effectInterval.lower} to ${metric.effectInterval.upper}` })),
      evaluated: Boolean(evaluation),
      gaps: proof.gaps?.length ? `Open proof gaps: ${words(proof.gaps.join(' · '))}` : ''
    },
    campaign: {
      count: Number(campaign.eligibleCount || 0),
      state: (() => {
        if (campaign.phase === 'unavailable') return `Campaign evidence is unavailable: ${campaign.error || 'coordinator projection unavailable'}`;
        if (campaign.phase !== 'synchronized') return 'The public-protein disagreement queue has not synchronized.';
        if (!current) return 'This room has no public sequence in the current campaign snapshot.';
        return current.priority.eligible
          ? `This exact sequence is rank ${current.rank} with disagreement in ${current.priority.disagreementCount} of 4 declared dimensions.`
          : 'This exact sequence is not prioritized because no declared disagreement is currently admitted.';
      })(),
      dimensions: campaign.phase === 'synchronized' && current ? Object.entries(current.dimensions || {}).map(([key, value]) => ({ title: CAMPAIGN_LABELS[key] || key, detail: value.detail || '',
        meta: `${words(String(value.status || 'unknown'))} · ${value.evidenceRecordHashes?.length || 0} records` })) : [],
      eligible: (campaign.entries || []).filter(entry => entry.priority?.eligible).map(entry => ({ title: entry.label, href: roomHref('/room-1', entry.roomIds?.[0] || ''),
        detail: `${entry.priority.disagreementCount} of 4 declared disagreement dimensions · exact sequence ${compactHash(entry.sequence.hash)}` })),
      boundary: `Registry boundary: ${campaign.boundary || 'not synchronized'} · ${campaign.complete ? 'reported complete for this bounded query' : 'incomplete or unavailable'} · showing at most five eligible sequences.`
    },
    prior: {
      boundary: prior.registryBoundary ? `${boundary}; ${prior.registryBoundary.complete ? 'complete within the declared registry boundary' : 'the registry snapshot may be incomplete'}` : boundary,
      searching: prior.phase === 'synchronizing', error: prior.error ? `Prior-room retrieval unavailable: ${prior.error}` : '',
      empty: prior.phase === 'synchronized' ? `No independently accepted evidence from ${prior.roomCount} other matching room${prior.roomCount === 1 ? '' : 's'} is eligible even as a candidate.` : 'Prior-room evidence has not been loaded for this sequence.',
      candidates: prior.candidates.map(candidate => {
        const source = candidate.sourceVersions.find(entry => entry.recordHash === candidate.recordHash) || candidate.sourceVersions[0] || null;
        const qualification = candidate.qualification?.status || 'needs_source_qualification';
        const reasons = candidate.qualification?.reasons || [];
        const finding = candidate.sourceRecord?.evidence?.finding || source?.finding || null;
        const comparison = candidate.contextComparison || { status: 'context_unavailable', differences: [], missing: [] };
        const duplicates = candidate.duplicateRecordHashes?.length || 1;
        return {
          hash: candidate.recordHash, originRoomId: candidate.originRoomId, qualification, title: candidate.title, summary: candidate.summary,
          details: [
            `Origin room ${candidate.originRoomId} · accepted there · ${words(qualification)}${reasons.length ? ` · ${words(reasons.join(' · '))}` : ''}`,
            source ? `Source ${source.accession || source.uri || compactHash(source.recordHash)} @ ${source.version || compactHash(source.contentHash)} · declared license ${source.license || 'undeclared'}` : '',
            finding ? `Imported finding: ${words(finding.classification)} · attempt ${words(finding.attempt?.status) || 'unknown'}${finding.attempt?.failureCategory && finding.attempt.failureCategory !== 'none' ? ` · ${words(finding.attempt.failureCategory)}` : ''}. Negative, ambiguous, and failed evidence remains non-supporting evidence, not a successful replica.` : '',
            annotationIdentityLabel(candidate.annotation) || '',
            duplicates > 1 ? `Same declared versioned source in ${duplicates} signed origin record${duplicates === 1 ? '' : 's'} across ${candidate.duplicateOriginRoomIds?.length || 1} room${candidate.duplicateOriginRoomIds?.length === 1 ? '' : 's'}. The archive preserves every record; this candidate contributes at most once to decision memory.` : '',
            `Declared decision context: ${[words(comparison.status), comparison.differences?.length ? `differs: ${comparison.differences.join(', ')}` : '', comparison.missing?.length ? `missing: ${comparison.missing.join(', ')}` : ''].filter(Boolean).join(' · ')}. Even an exact declared match still requires explicit current-room relevance review.`
          ].filter(Boolean),
          attached: candidate.attachedRecordHash ? `Attached for current-room review · ${compactHash(candidate.attachedRecordHash)}` : '',
          attachable: !candidate.attachedRecordHash && candidate.attachable === true,
          meta: `${words(candidate.kind)} · ${compactHash(candidate.recordHash)}`
        };
      })
    },
    proposals: (room.proposals || []).map(proposal => ({ kind: proposal.kind, title: proposal.title, status: proposal.status, summary: proposal.summary,
      facts: [['Evidence supporting', proposal.supportingEvidence.length ? proposal.supportingEvidence.map(compactHash).join(' · ') : 'None linked'], ['Evidence missing', proposal.missingEvidence],
        ['What would distinguish it', proposal.distinguishes.length ? proposal.distinguishes.join(' · ') : 'No discriminator recorded']],
      href: roomHref('/room-1', room.roomId, 'discovery') })),
    canvas: !room.question && !room.latestResult && !room.memory?.length ? null : {
      accepted: (room.memory || []).map(item => ({ title: item.title, detail: `${words(item.kind)} · ${compactHash(item.sourceHash)}` })),
      disputed: (room.unresolved || []).map(item => ({ title: item.title, detail: item.detail })),
      missing: (room.nextActions || []).map(action => ({ title: action.title || words(action.kind), detail: action.reason || 'Independent execution or review required.' }))
    },
    timelineShown: timeline.filter(entry => anchors.has(entry.id)).map(timelineEntry),
    timelineHidden: timeline.filter(entry => !anchors.has(entry.id)).map(timelineEntry)
  };
}

/** The room as the vanilla room view states it, from the pure projection. */
export function projectRoomView(room) {
  const result = room.latestResult;
  const action = room.nextActions?.[0];
  const signedCandidate = action?.actionType === 'signed_candidate_action';
  const nextQuestion = room.nextQuestion || {};
  const approvals = signedCandidate ? action.approvalRecordHashes : nextQuestion.approvalRecordHashes;
  const recovery = room.recovery || {};
  const recoveryDetails = [
    recovery.remoteError ? `Coordinator sync unavailable: ${recovery.remoteError}` : null,
    recovery.rejectedRecords?.length ? `${recovery.rejectedRecords.length} record${recovery.rejectedRecords.length === 1 ? '' : 's'} was rejected after verification or policy checks.` : null,
    recovery.invalidatedCount > 0 ? `${recovery.invalidatedCount} record${recovery.invalidatedCount === 1 ? '' : 's'} remain in history but are excluded from active projections.` : null
  ].filter(Boolean);
  const intent = room.question?.intent || {};
  const participants = [room.participants?.requester, ...(room.participants?.contributors || []), ...(room.participants?.reviewers || []),
    ...(room.participants?.peers || [])].filter(Boolean);
  const seen = new Set();
  const archive = [...(room.archive?.entries || []), ...(room.archive?.rejected || [])];
  return {
    roomId: room.roomId,
    status: room.status,
    statusLabel: STATUS_LABELS[room.status] || 'Room activity',
    recovery: recoveryDetails.length ? { states: (recovery.labels || recovery.states || []).map(state => words(state)), details: recoveryDetails } : null,
    question: room.question ? {
      title: intent.label || intent.text || 'Public sequence investigation',
      text: intent.text && intent.text !== intent.label ? intent.text : '',
      facts: [['Sequence', `${compactHash(room.question.sequenceHash)} · ${room.question.sequenceLength} residues`], ['Model', room.question.modelContract?.id || 'Not selected']],
      gaps: (room.question.clarity?.gaps || []).map(gap => `${words(gap.field)}: ${gap.reason}`),
      gapsTitle: `${room.question.clarity?.gaps?.length || 0} missing detail${room.question.clarity?.gaps?.length === 1 ? '' : 's'}`
    } : null,
    result: result ? {
      status: words(result.status),
      agreement: researchRoomAgreementLabels[result.agreement?.state] || 'Not assessed',
      review: words(result.reviewState),
      receipt: compactHash(result.receiptHash),
      reviewHref: roomHref('/room-1', room.roomId, 'review', result.sourceHash),
      technical: [
        ['Source', compactHash(result.sourceHash)], ['Model identity', `${result.model.id || 'unknown'} · ${compactHash(result.model.hash)}`],
        ['Manifest', compactHash(result.model.manifestHash)], ['Runtime identity', compactHash(result.runtimeIdentity)],
        ['Sequence publication', result.publication.sequence ? 'permitted' : 'withheld'], ['Embedding publication', result.publication.embedding ? 'permitted' : 'withheld'],
        ['Residue evidence', result.publication.residue ? 'permitted' : 'withheld']
      ],
      uncertainty: result.uncertainty || []
    } : null,
    next: (() => {
      let nextTitle = 'Review the evidence';
      if (!room.question) nextTitle = 'Ask a question';
      else if (action) nextTitle = action.title || words(action.kind);

      let nextBody = nextQuestion.prompt || action?.reason || 'Review a result.';
      if (!room.question) nextBody = 'Start with a public protein sequence.';
      else if (signedCandidate) nextBody = action.reason;

      const approvalStatus = signedCandidate ? action.status : nextQuestion.humanApprovalStatus;
      let nextBoundary = '';
      if (room.question) {
        nextBoundary = approvalStatus === 'approved'
          ? `${approvals?.length || 0} signed approval${approvals?.length === 1 ? '' : 's'}`
          : 'Independent approval required';
      }

      let nextBasis = '';
      if (action) {
        let basisSubject = 'the current question';
        if (action.basis === 'accepted_memory') basisSubject = `${action.basisHashes.length} accepted record${action.basisHashes.length === 1 ? '' : 's'}`;
        else if (signedCandidate) basisSubject = `${action.basisHashes.length} affected hypothesis contract${action.basisHashes.length === 1 ? '' : 's'}`;
        nextBasis = `Based on ${basisSubject}.`;
      }

      let approve = null;
      if (action && action.status !== 'approved') {
        approve = signedCandidate
          ? { kind: 'candidate', label: 'Approve exact contract', targetHash: action.targetHash, contractHash: action.contractHash }
          : { kind: 'task', label: 'Approve next action', taskId: action.id, targetHash: action.targetHash };
      }

      let nextHref = roomHref('/room-1', room.roomId);
      if (room.question) {
        let panelTarget = 'review';
        if (signedCandidate) panelTarget = 'candidate-actions';
        else if (action) panelTarget = 'discovery';
        nextHref = roomHref('/room-1', room.roomId, panelTarget);
      }

      return {
        title: nextTitle,
        body: nextBody,
        boundary: nextBoundary,
        reason: action?.reason || '',
        basis: nextBasis,
        raw: !signedCandidate ? [] : [['Ranking status', words(action.rankingStatus) || 'unknown'], ['Uncertainty reduction', `${action.rawValueComponents?.uncertaintyReduction}/5`],
          ['Decision relevance', `${action.rawValueComponents?.decisionRelevance}/5`], ['Duplicate-work avoidance', `${action.rawValueComponents?.duplicateWorkAvoidance}/5`],
          ['Declared burden', String(action.rawValueComponents?.costBurden)],
          ...Object.entries(action.scientificCost || {}).filter(([, value]) => value && !Array.isArray(value))
            .map(([component, value]) => [component.replace(/([A-Z])/g, ' $1').toLowerCase(), `${value.amount} ${value.unit} · burden ${value.burden}/5`]),
          ['Uncertainty', action.uncertainty.map(entry => `${words(entry.source)}: ${words(entry.representation)}`).join(' · ')],
          [`Exact ${action.execution?.contractKind || 'contract'}`, `${action.execution?.contractId} @ ${action.execution?.version} · ${compactHash(action.contractHash)}`],
          ['Authority', 'Ranking projection only; no allocation or execution authority.']],
        approve,
        href: nextHref
      };
    })(),
    unresolved: (room.unresolved || []).map(entry => ({ kind: entry.kind, title: entry.title, detail: entry.detail, action: entry.action || 'Inspect',
      href: entry.kind === 'evidence' ? roomHref('/room-1', room.roomId) : roomHref('/room-1', room.roomId, entry.kind === 'next_action' ? 'discovery' : 'review') })),
    memory: (room.memory || []).map(entry => ({ title: entry.title,
      detail: `Accepted under the current room policy by ${entry.reviewDecisionHashes.length} independent signed decision${entry.reviewDecisionHashes.length === 1 ? '' : 's'}.`,
      meta: `${words(entry.kind)} · ${compactHash(entry.sourceHash)}` })),
    memoryPolicy: room.decisionMemory?.policyId || 'an unknown policy',
    archive: archive.map(entry => ({ state: String(entry.state || 'provisional'), title: entry.title || entry.claimedKind || 'Rejected record', detail: entry.summary || entry.reason || 'No trusted summary is available.',
      exclusion: entry.decisionMemoryExclusionReason ? `Decision-memory exclusion: ${words(entry.decisionMemoryExclusionReason)}.` : '',
      meta: `${words(entry.state || 'provisional')} · ${compactHash(entry.recordHash || entry.id)}` })),
    archiveBoundary: room.archive?.boundary || 'verified_local_snapshot',
    timeline: (room.timeline || []).map(entry => ({ title: entry.title, status: entry.status, summary: entry.summary, meta: `${entry.sourceAuthority} · ${compactHash(entry.sourceHash || entry.id)}` })),
    participants: participants.filter(entry => { const key = `${entry.role}:${entry.id}`; if (seen.has(key)) return false; seen.add(key); return true; })
      .map(entry => ({ role: entry.role, label: entry.label || compactHash(entry.id), status: entry.status })),
    facts: [['Room identity', room.roomId], ['Decision-memory policy', room.decisionMemory?.policyId || 'unknown'], ['Archived records', String(room.counts.archive)],
      ['Active records', String(room.counts.active)], ['Remembered records', String(room.counts.memory)], ['Prior-room candidates', String(room.counts.priorRoomCandidates)],
      ['Excluded from memory', String(room.memoryExclusions?.length || 0)], ['Timeline entries', String(room.counts.timeline)],
      ['Recovery state', room.recovery?.labels?.join(' · ') || 'Local-only recovery'], ['Rejected records', String(room.recovery?.rejectedRecords?.length || 0)],
      ['Invalidated records', String(room.recovery?.invalidatedCount || 0)]],
    ...projectRoomSections(room),
    requestHref: `${roomHref('/room-1', room.roomId)}#pool-room-1-request`,
    roles: [
      { title: 'Request', body: 'State the sequence and question.', link: 'Open requester', href: `${roomHref('/room-1', room.roomId)}#pool-room-1-request` },
      { title: 'Share compute', body: 'Let this browser contribute execution.', link: 'Open contributor', href: roomHref('/compute', room.roomId) },
      { title: 'Review evidence', body: 'Make an attributable signed decision.', link: 'Review evidence', href: roomHref('/room-1', room.roomId, 'review') },
      { title: 'Discover', body: 'Inspect compatible evidence and proposed work.', link: 'Explore discovery', href: roomHref('/room-1', room.roomId, 'discovery') }
    ]
  };
}

const syncLabel = (hydrated) => {
  if (!hydrated) return 'Verifying local evidence';
  const rejected = hydrated.rejectedRecords?.length || 0, plural = rejected === 1 ? '' : 's';
  if (hydrated.remote) {
    return rejected ? `Coordinator evidence synchronized; ${rejected} unadmitted or invalid record${plural} rejected by policy` : 'Coordinator evidence synchronized';
  }
  return rejected ? `Local evidence verified; ${rejected} unadmitted or invalid record${plural} rejected by policy; coordinator sync unavailable` : 'Local evidence verified; coordinator sync unavailable';
};

export function createRoomModel({
  storage = (() => { try { return globalThis.localStorage || null; } catch { return null; } })(),
  getRoomId = () => getPeerRoomId(),
  href = () => globalThis.location?.href || 'https://reploid.invalid/room-1',
  eventTarget = globalThis,
  publishRecord = publishResearchRecord,
  hydrate = true,
  /** Keeps the chosen review target in the address, as the vanilla review form did, so a reload reopens it. */
  retainTarget = (target) => {
    const history = globalThis.history;
    if (!target || !globalThis.location || !history?.replaceState) return;
    const url = new URL(globalThis.location.href);
    url.searchParams.set('target', target);
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }
} = {}) {
  const ledgerStore = getPoolLedgerStore();
  const persistence = createPoolRecordPersistence({ ledgerStore, getRoomId, getStorage: () => storage });
  const listeners = new Set();
  let disposed = false, snapshot = null, hydrated = null, query = '', pending = {}, errors = {};
  // The workspace's own state: typed lifecycle values per form, the review form, the similarity target and status notes.
  let values = {}, review = { ...DEFAULT_REVIEW }, similarity = '', reviewStatus = '', syncNote = '';
  // Typing in a form changes only that form; records change on publication, hydration and research updates.
  let version = 0, cachedRoom = null, cachedWorkspace = null;
  const notify = (recordsChanged = true) => {
    if (disposed) return;
    if (recordsChanged) version += 1;
    snapshot = null;
    for (const listener of listeners) listener();
  };
  const roomId = getRoomId();
  // The request's fields start from this room's unsent draft; an empty saved field stays empty.
  const stored = persistence.loadDraft(roomId) || {};
  let draft = { sequence: DEFAULT_SEQUENCE, intentKind: 'question', intentLabel: '', intentText: '', intentConditions: '', intentObservation: '',
    intentDecision: '', intentScope: '', intentExclusions: '', intentUnknowns: '', sequencePublic: false, researchPublic: false,
    model: LAUNCH_MODEL.modelId, policy: listPolicies()[0]?.policyId || '' };
  for (const field of DRAFT_FIELDS) if (stored[field] !== undefined) draft[field] = stored[field];

  const params = () => new URL(href()).searchParams;
  const panel = () => { const value = params().get('panel'); return ['review', 'discovery'].includes(value) ? value : 'overview'; };
  const addressedTarget = () => params().get('target') || '';
  const project = () => {
    const records = loadResearchRecords(roomId);
    persistence.ensureLoaded(roomId);
    if (cachedRoom?.version !== version) cachedRoom = { version, view: projectRoomView(projectResearchRoom({ roomId, routeId: 'room-1', researchRecords: records, quarantinedRecords: loadQuarantinedResearchRecords(roomId),
      crossRoomEvidence: getCrossRoomSequenceEvidence(roomId), campaignQueue: getProteinUncertaintyCampaignQueue(roomId),
      receipts: ledgerStore.receipts, peerEvents: ledgerStore.peerEvents, syncState: getResearchSyncState(roomId) })) };
    const workspaceKey = JSON.stringify([version, query, similarity, review, reviewStatus, pending, errors, href()]);
    if (cachedWorkspace?.key !== workspaceKey) {
      cachedWorkspace = { key: workspaceKey, sources: projectResearchSources(records),
        view: projectResearchWorkspace(records, { query, similarityTarget: similarity, review, addressedTarget: addressedTarget(), reviewStatus, pending, errors }) };
    }
    const model = getEnabledPoolModelContract(draft.model) || LAUNCH_MODEL;
    const currentPanel = panel();
    return Object.freeze({
      roomId, title: ROUTE_COPY['room-1'].title, body: ROUTE_COPY['room-1'].body,
      draft: { ...draft },
      models: listPoolModels({ enabledOnly: true }).map(entry => ({ value: entry.modelId, title: entry.label || entry.modelId })),
      policies: listPolicies().map(policy => ({ value: policy.policyId, title: POLICY_LABELS[policy.policyId] || words(policy.policyId) })),
      intentKinds: INTENT_KINDS.map(([value, title]) => ({ value, title })),
      pack: packFacts(model),
      status: 'Ready',
      panel: currentPanel,
      contextual: ({
        review: { title: 'Review evidence', body: 'Make a signed decision or attach a correction to the evidence shown above.', target: 'pool-room-review' },
        discovery: { title: 'Discover the next action', body: 'Inspect compatible evidence and approve a bounded follow-up without promoting a proposal into memory.', target: 'pool-room-discovery' }
      })[currentPanel] || null,
      room: cachedRoom.view,
      sampleBlocked: CANONICAL_DISPUTE_BLOCKED,
      workspace: { ...cachedWorkspace.view, forms: projectLifecycleForms(cachedWorkspace.sources, values, { pending, errors }), query, sync: syncNote || syncLabel(hydrated) },
      pending: { ...pending }, errors: { ...errors }
    });
  };

  const run = async (key, work) => {
    pending = { ...pending, [key]: true }; errors = { ...errors, [key]: '' }; notify();
    try { return await work(); }
    catch (error) { errors = { ...errors, [key]: error instanceof Error ? error.message : String(error) }; return null; }
    finally { pending = { ...pending, [key]: false }; notify(); }
  };

  // A record published by another copy of the research store (another bundle or tab) is persisted but not in this copy's
  // verified set; it is admitted the same way the page load admits it, by verifying the persisted records again.
  const onUpdate = (event) => {
    if (event.detail?.roomId !== roomId) return;
    const hash = event.detail?.recordHash;
    if (!hash || loadResearchRecords(roomId).some(record => record.recordHash === hash)) { notify(); return; }
    void hydrateResearchRecords(roomId, { onLocalHydrated: () => notify() }).then(result => { hydrated = result; }, () => {}).finally(() => notify());
  };
  eventTarget?.addEventListener?.('reploid:pool-research-update', onUpdate);
  if (hydrate) {
    void (async () => {
      try {
        hydrated = await hydrateResearchRecords(roomId);
        const latest = activeResearchRecords(hydrated.records || []).filter(record => record.kind === 'research_submission').at(-1) || null;
        if (latest) await hydrateCrossRoomSequenceEvidence(roomId, latest.sequence?.hash);
        await hydrateProteinUncertaintyCampaignQueue(roomId);
      } catch (error) { hydrated = { remote: false, rejectedRecords: [], error }; }
      notify();
    })();
  }

  return {
    getSnapshot: () => (snapshot ??= project()),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    /** One request field; it is saved to this room's draft as it changes, as the vanilla form saved it. */
    setDraft(field, value) {
      draft = { ...draft, [field]: value };
      persistence.persistDraft(Object.fromEntries(DRAFT_FIELDS.map(key => [key, draft[key]])), roomId);
      notify();
    },
    setQuery(value) { query = value; notify(); },
    /** One lifecycle form field; the form keeps it until it signs. */
    setLifecycleValue(action, name, value) { values = { ...values, [action]: { ...(values[action] || {}), [name]: value } }; notify(false); },
    /** Signs one lifecycle form's record with the vanilla builders, after the checks its required marks made. */
    submitLifecycle: (action) => run(`lifecycle:${action}`, async () => {
      const records = loadResearchRecords(roomId);
      const form = projectLifecycleForms(projectResearchSources(records), values).flatMap(section => section.parts).find(part => part.k === 'form' && part.action === action);
      if (!form) throw new Error(`Unsupported research lifecycle action: ${action}`);
      if (!form.ready) throw new Error('The records this form needs are not in the room yet.');
      const problem = lifecycleProblem(form);
      if (problem) throw new Error(problem);
      const record = await createLifecycleRecordFromForm(action, lifecycleValues(form), roomId, activeResearchRecords(records));
      const publication = await publishRecord(record, { roomId });
      values = { ...values, [action]: {} };
      syncNote = publication.remote ? 'Lifecycle evidence synchronized' : 'Lifecycle evidence saved locally; coordinator sync pending';
      return true;
    }),
    /** One review field. Choosing another target clears the context determination and keeps the target in the address. */
    setReview(field, value) {
      review = field === 'target' ? { ...review, target: value, contextDetermination: '' } : { ...review, [field]: value };
      if (field === 'target') retainTarget(value);
      notify(false);
    },
    /** Signs an accept, reject, correct or replicate decision on the selected evidence. */
    submitReview: (action) => run(`review:${action}`, async () => {
      const targets = reviewTargets(activeResearchRecords(loadResearchRecords(roomId)));
      const target = selectedReviewTarget(targets, review.target, addressedTarget());
      const targetRecord = targets.find(record => record.recordHash === target) || null;
      const problem = reviewProblem({ ...review, target }, Boolean(targetRecord?.evidence?.reuseContext));
      if (problem) { reviewStatus = problem; return null; }
      try {
        const record = await createContextualReviewRecord({ action, identity: createPoolIdentity('reviewer'), roomId, targetHash: target, text: review.text,
          confidence: review.confidence, evidenceUrl: review.evidenceUrl, targetRecord, contextDetermination: review.contextDetermination });
        const publication = await publishRecord(record, { roomId });
        review = { ...DEFAULT_REVIEW, target };
        reviewStatus = publication.remote ? 'Signed review record published.' : 'Signed review record saved locally; coordinator sync is pending.';
        return true;
      } catch (error) { reviewStatus = error instanceof Error ? error.message : String(error); return null; }
    }),
    setSimilarityTarget(target) { similarity = target; notify(false); },
    approveTask: (taskId, targetHash) => run(`task:${taskId}`, async () => {
      const task = proposeDiscoveryTasks(loadResearchRecords(roomId)).find(candidate => candidate.taskId === taskId && candidate.targetHash === targetHash);
      if (!task) throw new Error('The projected discovery task is no longer active');
      const record = await createSignedHumanClaim({ identity: createPoolIdentity('reviewer'), roomId, targetHash, claimKind: 'task_approval', relation: 'approves',
        text: `Approved bounded discovery task: ${taskId}`, confidence: 1, decision: 'approved', taskId, taskContract: task.taskContract });
      return (await publishRecord(record, { roomId })).remote ? 'Approved next action' : 'Approval saved locally';
    }),
    approveCandidate: (recordHash, contractHash) => run(`candidate:${recordHash}`, async () => {
      const records = loadResearchRecords(roomId);
      const candidate = activeResearchRecords(records).find(record => record.kind === 'research_candidate_action' && record.recordHash === recordHash
        && record.action?.contractHash === contractHash);
      const admitted = rankProposedCandidateActions(records).admittedCandidates.some(entry => entry.recordHash === recordHash && entry.actionId === contractHash);
      if (!candidate || !admitted) throw new Error('The signed candidate action is no longer admitted');
      const approval = await createSignedHumanClaim({ identity: createPoolIdentity('reviewer'), roomId, targetHash: candidate.recordHash,
        claimKind: 'candidate_action_approval', relation: 'approves', text: `Approved exact candidate action contract: ${contractHash}`,
        confidence: 1, decision: 'approved', actionContractHash: contractHash });
      return (await publishRecord(approval, { roomId })).remote ? 'Exact contract approved' : 'Approval saved locally';
    }),
    freezeContract: () => run('checkpoint', async () => {
      const records = loadResearchRecords(roomId);
      const question = activeResearchRecords(records).filter(record => record.kind === 'research_submission').at(-1) || null;
      if (!question) throw new Error('The active Research Room question is unavailable');
      const parent = records.filter(record => record.kind === 'research_discovery_checkpoint' && record.checkpoint?.questionHash === question.recordHash)
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)) || left.recordHash.localeCompare(right.recordHash)).at(-1) || null;
      const record = await createDiscoveryContractCheckpoint({ identity: createPoolIdentity('reviewer'), roomId, questionHash: question.recordHash, records,
        parentCheckpointHashes: parent ? [parent.recordHash] : [] });
      return (await publishRecord(record, { roomId })).remote ? 'Checkpoint synchronized' : 'Checkpoint saved locally';
    }),
    attachPrior: (recordHash, originRoomId) => run(`prior:${recordHash}`, async () => {
      const state = getCrossRoomSequenceEvidence(roomId);
      const candidate = state.projection?.candidates?.find(entry => entry.recordHash === recordHash && entry.originRoomId === originRoomId);
      const sourceRecord = state.projection?.records?.find(entry => entry.recordHash === recordHash);
      const originQuestion = state.projection?.records?.find(entry => entry.recordHash === sourceRecord?.questionHash && entry.kind === 'research_submission' && entry.roomId === originRoomId);
      const question = activeResearchRecords(loadResearchRecords(roomId)).filter(record => record.kind === 'research_submission').at(-1) || null;
      if (!candidate || !sourceRecord) throw new Error('The prior-room candidate is no longer available');
      if (state.sequenceHash !== question?.sequence?.hash) throw new Error('The prior-room sequence identity is stale');
      const record = await createCurrentRoomPriorEvidence({ identity: createPoolIdentity('researcher'), roomId, question, originQuestion, candidate, sourceRecord });
      return (await publishRecord(record, { roomId })).remote ? 'Attached for review' : 'Attached locally; sync pending';
    }),
    dispose() { disposed = true; listeners.clear(); eventTarget?.removeEventListener?.('reploid:pool-research-update', onUpdate); }
  };
}
