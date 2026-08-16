/**
 * @fileoverview Evidence-network rendering and human review controls for Poolday.
 */

import { createPoolIdentity } from '../../pool/identity.js';
import { createDiscoveryContractCheckpoint } from '../../pool/discovery-contract.js';
import {
  ADJUDICATION_EXPERIMENT_VERSION,
  PUBLIC_PROTEIN_EVIDENCE_VERSION,
  activeResearchRecords,
  buildEvidenceGraph,
  buildQuestionLifecycles,
  clusterCompatibleResults,
  createCrossRoomReuseContext,
  createSignedAdjudicationEvaluation,
  createSignedAdjudicationExperiment,
  createSignedCandidateAction,
  createSignedCohortEvaluation,
  createSignedEvaluationCohort,
  createSignedExperimentalOutcome,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedPublicProteinEvidence,
  createSignedResearchHypothesis,
  createSignedResearchPrediction,
  createSignedResearchResolutionPolicy,
  createSignedRealizedActionValue,
  createSignedResearchRevocation,
  createSignedResearchWorkClaim,
  createSignedResearchWorkOrder,
  findSimilarSequences,
  invalidatedResearchHashes,
  projectResearchReviewStates,
  projectResearchRewards,
  proposeDiscoveryTasks,
  rankProposedDiscoveryActions,
  rankProposedCandidateActions,
  searchEvidence
} from '../../pool/evidence-network.js';
import {
  getCrossRoomSequenceEvidence,
  hydrateCrossRoomSequenceEvidence,
  hydrateProteinUncertaintyCampaignQueue,
  hydrateResearchRecords,
  loadResearchRecords,
  publishResearchRecord
} from './research-store.js';
import {
  compactHash,
  recordLabel,
  renderDiscoveryPanel,
  renderNextWorkPanel,
  renderParticipationQualityPanel,
  renderResultEvidencePanel,
  renderReviewPanel
} from './research-panels.js';
import { renderLifecycleForms } from './research-lifecycle-panel.js';
import { renderSequenceDisclosure, renderTechnicalEvidencePanel } from './research-technical-panel.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const reviewTargetFromUrl = () => {
  const target = new URLSearchParams(globalThis.location?.search || '').get('target') || '';
  return /^sha256:[a-f0-9]{64}$/.test(target) ? target : '';
};
const lifecycleRecordSummary = (record = {}) => {
  if (record.kind === 'research_hypothesis') return `<p>${escapeHtml(record.hypothesis.statement)}</p><small>Conditions: ${escapeHtml(JSON.stringify(record.hypothesis.conditions))} · discriminators: ${escapeHtml(record.hypothesis.discriminatingObservations.join(' · '))}</small>`;
  if (record.kind === 'research_prior_evidence') {
    const finding = record.evidence?.finding;
    const findingLabel = finding
      ? ` · ${finding.classification.replace(/_/g, ' ')} · attempt ${finding.attempt.status.replace(/_/g, ' ')}${finding.attempt.failureCategory !== 'none' ? ` (${finding.attempt.failureCategory.replace(/_/g, ' ')})` : ''}`
      : '';
    return `<p>${escapeHtml(record.evidence.kind.replace(/_/g, ' '))}${escapeHtml(findingLabel)} · ${escapeHtml(record.evidence.summary)}</p><small>${escapeHtml(record.evidence.reference.accession || record.evidence.reference.uri)} @ ${escapeHtml(record.evidence.reference.version || compactHash(record.evidence.reference.contentHash))} · retrieved ${escapeHtml(record.evidence.provenance.retrievedAt)}${record.evidence.schema ? ` · ${escapeHtml(record.evidence.schema)}` : ''}</small>`;
  }
  if (record.kind === 'research_prediction') return `<p>${escapeHtml(record.prediction.normalizedLabel)} · confidence ${Math.round(record.prediction.confidence * 100)}%</p><small>${escapeHtml(record.prediction.method.methodId)} @ ${escapeHtml(record.prediction.method.version)} · frozen ${escapeHtml(record.prediction.frozenAt)} · ${escapeHtml(record.prediction.outcomeAccess)}</small>`;
  if (record.kind === 'research_resolution_policy') return `<p>${escapeHtml(record.policy.conclusionLabel)} · resolution criteria frozen</p><small>Provisional acceptance: ${record.policy.provisionalAcceptance.minimumAcceptedCompletedOutcomes} accepted outcome(s), ${record.policy.provisionalAcceptance.minimumIndependentReplications} replica(s) · closure criteria only; no closure authority</small>`;
  if (record.kind === 'research_work_order') return `<p>${escapeHtml(record.work.kind)} · ${record.work.replicaTarget} planned replica${record.work.replicaTarget === 1 ? '' : 's'}</p><small>Protocol ${escapeHtml(record.work.protocol.protocolId)} @ ${escapeHtml(record.work.protocol.version)} · ${escapeHtml(compactHash(record.work.protocol.protocolHash))}${record.work.schema ? ` · analysis ${escapeHtml(record.work.plannedAnalysis.methodId)} @ ${escapeHtml(record.work.plannedAnalysis.version)} · custody ${escapeHtml(record.work.custody.planId)} @ ${escapeHtml(record.work.custody.version)} · replication dimensions ${escapeHtml(record.work.replication.requiredIndependentDimensions.join(', '))} · public non-clinical scope · no laboratory or interpretation authority · public failures required` : ' · legacy work order'} · proposed and unallocated until independently reviewed</small>`;
  if (record.kind === 'research_work_claim') {
    const laboratoryLabel = record.workClaim?.consent?.publicLaboratoryIdentity === true
      ? record.workClaim?.laboratory?.name
      : `Participant ${compactHash(record.author?.identityRootId || record.author?.userId || record.recordHash)}`;
    const capabilityLabels = (record.workClaim?.capabilityClaims || [])
      .map((claim) => `${claim.id} @ ${claim.version}`);
    const details = record.workClaim?.schema
      ? [
        record.workClaim.laboratory?.institution,
        ...capabilityLabels,
        `${record.workClaim.protocolCustody?.role || 'unknown'} custody`,
        record.workClaim.safety?.classification,
        `${record.workClaim.availability?.status || 'unknown availability'} through ${record.workClaim.availability?.validUntil || 'undeclared date'}`
      ]
      : [...(record.workClaim?.capabilities || []), 'legacy qualification claim'];
    return `<p>${escapeHtml(laboratoryLabel)} claimed ${escapeHtml(compactHash(record.workOrderHash))}</p><small>${escapeHtml(details.filter(Boolean).join(' · '))} · signed declarations, not proof of authorization, safety, or capability</small>`;
  }
  if (record.kind === 'research_outcome') return `<p>${escapeHtml(record.outcome.classification)} · ${escapeHtml(record.outcome.attempt.status)}${record.outcome.attempt.failureCategory !== 'none' ? ` · ${escapeHtml(record.outcome.attempt.failureCategory)}` : ''}</p><small>${record.replicationOfHash ? `Replication claim of ${escapeHtml(compactHash(record.replicationOfHash))} · admitted only after declared-dimension checks · ` : ''}${escapeHtml(record.outcome.blind.state)} · analysis ${escapeHtml(compactHash(record.outcome.analysis.analysisHash))}</small>`;
  if (record.kind === 'research_cohort') return `<p>${record.cohort.predictionHashes.length} frozen predictions · ${record.cohort.workOrderHashes.length} work orders</p><small>${escapeHtml(record.cohort.frozenAt)} · ${record.cohort.blindingRequired ? 'blinding required' : 'blinding not required'}</small>`;
  if (record.kind === 'research_evaluation') return `<p>${record.evaluation.metricResults.map((metric) => `${escapeHtml(metric.metricId)} ${metric.improved ? 'improved' : 'did not improve'} (${escapeHtml(metric.baselineValue)} to ${escapeHtml(metric.currentValue)})`).join(' · ')}</p><small>${record.evaluation.outcomeHashes.length} independently accepted outcomes · next cohort ${record.evaluation.nextCohortQuestionHashes.length ? 'bound' : 'not bound'}</small>`;
  if (record.kind === 'research_realized_action_value') return `<p>${escapeHtml(record.realizedValue.assessment.status.replace(/_/g, ' '))} · ${escapeHtml(record.realizedValue.assessment.decisionEffect.replace(/_/g, ' '))}</p><small>${record.realizedValue.metricResults.length} measured metric(s) · ${record.realizedValue.contributions.length} causal contribution(s) · reward requires independent acceptance</small>`;
  if (record.kind === 'research_adjudication_experiment') return `<p>${escapeHtml(record.experiment.target.catalogId)} @ ${escapeHtml(record.experiment.target.catalogVersion)} · ${escapeHtml(record.experiment.target.curatorRole)}</p><small>Baseline ${escapeHtml(record.experiment.baseline.workflowId)}${record.experiment.baseline.actionSelection ? ` / ${escapeHtml(record.experiment.baseline.actionSelection.policyId)}` : ''} versus ${escapeHtml(record.experiment.candidate.policyId)} · ${record.experiment.cohort.caseCount} family-disjoint paired cases · north star ${escapeHtml(record.experiment.northStarPolicy?.aggregation?.cohortStatistic || 'legacy not frozen')} · outcome access ${escapeHtml(record.experiment.outcomeBoundary?.accessAtFreeze || 'legacy boundary not frozen')}</small>`;
  if (record.kind === 'research_adjudication_evaluation') return `<p>Frozen adjudication rule ${escapeHtml(record.evaluation.assessment.conclusion)}</p><small>North star ${escapeHtml(record.evaluation.northStarEvidence?.reportingStatus || 'legacy not reported')} · ${record.evaluation.metricResults.map((metric) => `${escapeHtml(metric.metricId)} ${escapeHtml(metric.baselineValue)} to ${escapeHtml(metric.candidateValue)}`).join(' · ')}</small>`;
  if (record.kind === 'research_candidate_action') return `<p>${escapeHtml(record.action.kind)} · ${escapeHtml(record.action.title)}</p><small>${record.action.uncertainty.map((entry) => `${entry.source}: ${entry.representation}`).join(' · ')} · exact ${escapeHtml(record.action.execution.contractKind)} ${escapeHtml(record.action.execution.contractId)} @ ${escapeHtml(record.action.execution.version)} · proposal only</small>`;
  if (record.kind === 'research_discovery_checkpoint') return `<p>${escapeHtml(record.checkpoint.state.status)} Discovery Contract state · ${record.checkpoint.inputRecordHashes.length} complete inputs · ${record.checkpoint.activeInputRecordHashes.length} active inputs</p><small>Projection ${escapeHtml(record.checkpoint.projection.id)} · state ${escapeHtml(compactHash(record.checkpoint.stateHash))}</small>`;
  if (record.kind === 'research_revocation') return `<p>Future reuse revoked: ${escapeHtml(record.revocation.reason)}</p><small>Target ${escapeHtml(compactHash(record.targetHash))} remains in immutable history.</small>`;
  return '';
};

const renderRecord = (record, {
  invalidated = new Set(),
  reviewStates = new Map(),
  submissionsByHash = new Map()
} = {}) => {
  const recordReviewState = reviewStates.get(record.recordHash)?.state || 'unresolved';
  const publicationSource = record.kind === 'research_result'
    ? submissionsByHash.get(record.submissionHash)
    : record;
  const publication = publicationSource?.consent || {};
  const isInvalidated = invalidated.has(record.recordHash);
  const authorIdentity = compactHash(record.author?.identityRootId || record.author?.userId || record.author?.roleId || 'unknown author');
  return `
    <article class="pool-research-record" data-research-kind="${escapeHtml(record.kind)}"${isInvalidated ? ' data-research-invalidated="true"' : ''}>
      <div><span>${escapeHtml(record.kind.replace(/_/g, ' '))}</span><b>${escapeHtml(recordLabel(record))}</b></div>
      <small>${escapeHtml(record.author?.role || record.author?.roleId || 'unknown role')} · ${escapeHtml(authorIdentity)} · ${escapeHtml(compactHash(record.recordHash))} · ${escapeHtml(isInvalidated ? 'revoked or downstream-invalidated' : recordReviewState)}</small>
      ${renderSequenceDisclosure(record)}
      ${record.kind === 'research_result' ? `<p>Derived from ${escapeHtml(compactHash(record.submissionHash))} · provider ${escapeHtml(compactHash(record.compute?.providerId || 'unknown'))} · receipt ${escapeHtml(compactHash(record.compute?.receiptHash))}</p>` : ''}
      ${record.kind === 'human_claim' ? `<p><strong>${escapeHtml(record.claim?.relation || '')}</strong> ${escapeHtml(compactHash(record.targetHash))} · confidence ${escapeHtml(Math.round(Number(record.claim?.confidence || 0) * 100))}%${record.claim?.decision ? ` · ${escapeHtml(record.claim.decision)}` : ''}</p>${record.claim?.evidenceLinks?.length ? `<div>${record.claim.evidenceLinks.map((link) => `<a href="${escapeHtml(link.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(link.label || link.url)}</a>`).join(' · ')}</div>` : ''}` : ''}
      ${lifecycleRecordSummary(record)}
      ${renderTechnicalEvidencePanel({ record, publication, reviewState: recordReviewState, invalidated: isInvalidated })}
    </article>
  `;
};


export function renderResearchWorkspace(roomId, records = loadResearchRecords(roomId), {
  query = '',
  similarityTarget = '',
  reviewTarget = reviewTargetFromUrl()
} = {}) {
  const graph = buildEvidenceGraph(records);
  const active = activeResearchRecords(records);
  const invalidated = invalidatedResearchHashes(records);
  const reviewStateEntries = projectResearchReviewStates(records);
  const reviewStates = new Map(reviewStateEntries.map((entry) => [entry.recordHash, entry]));
  const submissions = active.filter((record) => record.kind === 'research_submission');
  const results = active.filter((record) => record.kind === 'research_result');
  const claims = active.filter((record) => record.kind === 'human_claim');
  const priorEvidence = active.filter((record) => record.kind === 'research_prior_evidence');
  const hypotheses = active.filter((record) => record.kind === 'research_hypothesis');
  const predictions = active.filter((record) => record.kind === 'research_prediction');
  const resolutionPolicies = active.filter((record) => record.kind === 'research_resolution_policy');
  const workOrders = active.filter((record) => record.kind === 'research_work_order');
  const acceptedResolutionPolicies = resolutionPolicies.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted');
  const acceptedWorkOrders = workOrders.filter((record) => (
    reviewStates.get(record.recordHash)?.state === 'accepted'
    && acceptedResolutionPolicies.some((policy) => (
      policy.questionHash === record.questionHash
      && Date.parse(policy.createdAt || '') <= Date.parse(record.createdAt || '')
    ))
  ));
  const workClaims = active.filter((record) => record.kind === 'research_work_claim');
  const outcomes = active.filter((record) => record.kind === 'research_outcome');
  const cohorts = active.filter((record) => record.kind === 'research_cohort');
  const evaluations = active.filter((record) => record.kind === 'research_evaluation');
  const realizedActionValues = active.filter((record) => record.kind === 'research_realized_action_value');
  const candidateActions = active.filter((record) => record.kind === 'research_candidate_action');
  const approvedCandidateActions = candidateActions.filter((candidate) => claims.some((claim) => (
    claim.claim?.kind === 'candidate_action_approval'
    && claim.claim?.decision === 'approved'
    && claim.claim?.actionContractHash === candidate.action?.contractHash
    && claim.targetHash === candidate.recordHash
    && claim.author?.identityRootId !== candidate.author?.identityRootId
  )));
  const adjudicationExperiments = active.filter((record) => record.kind === 'research_adjudication_experiment');
  const acceptedAdjudicationExperiments = adjudicationExperiments.filter((record) => (
    record.experiment?.schema === ADJUDICATION_EXPERIMENT_VERSION
    && reviewStates.get(record.recordHash)?.state === 'accepted'
  ));
  const adjudicationEvaluations = active.filter((record) => record.kind === 'research_adjudication_evaluation');
  const lifecycles = buildQuestionLifecycles(records);
  const submissionsByHash = new Map(submissions.map((record) => [record.recordHash, record]));
  const visible = searchEvidence(records, query);
  const tasks = proposeDiscoveryTasks(records);
  const actionRanking = rankProposedDiscoveryActions(records);
  const rankedTasks = actionRanking.rankedCandidates;
  const candidateRanking = rankProposedCandidateActions(records);
  const clusters = clusterCompatibleResults(records);
  const target = similarityTarget || results.at(-1)?.recordHash || '';
  const similar = target ? findSimilarSequences(records, target) : [];
  const rewards = projectResearchRewards(records);
  const reviewTargets = active.filter((record) => record.kind !== 'human_claim'
    || !['task_approval', 'candidate_action_approval'].includes(record.claim?.kind));
  return `
    <section class="pool-research-workspace" data-pool-research-workspace data-room-id="${escapeHtml(roomId)}">
      <header class="pool-research-header">
        <div>
          <p class="pool-dashboard-kicker">Public protein evidence network</p>
          <h2 class="type-h2">Question lifecycle: predict, test, review, learn</h2>
          <p>Competing hypotheses, condition-specific evidence, blinded work, failures, replications, and cohort effects remain separately signed and challengeable.</p>
        </div>
        <span class="pool-research-sync" data-pool-research-sync>Verifying local evidence</span>
      </header>
      <dl class="pool-research-stats">
        <div><dt>Submissions</dt><dd>${submissions.length}</dd></div>
        <div><dt>Hypotheses</dt><dd>${hypotheses.length}</dd></div>
        <div><dt>Predictions</dt><dd>${predictions.length}</dd></div>
        <div><dt>Resolution policies</dt><dd>${resolutionPolicies.length}</dd></div>
        <div><dt>Work orders</dt><dd>${workOrders.length}</dd></div>
        <div><dt>Outcomes</dt><dd>${outcomes.length}</dd></div>
        <div><dt>Frozen cohorts</dt><dd>${cohorts.length}</dd></div>
        <div><dt>Cohort evaluations</dt><dd>${evaluations.length}</dd></div>
        <div><dt>Realized action values</dt><dd>${realizedActionValues.length}</dd></div>
        <div><dt>Adjudication experiments</dt><dd>${adjudicationExperiments.length}</dd></div>
        <div><dt>Adjudication evaluations</dt><dd>${adjudicationEvaluations.length}</dd></div>
        <div><dt>Candidate actions</dt><dd>${candidateActions.length}</dd></div>
        <div><dt>Results</dt><dd>${results.length}</dd></div>
        <div><dt>Human claims</dt><dd>${claims.length}</dd></div>
        <div><dt>Evidence nodes</dt><dd>${graph.nodes.length}</dd></div>
        <div><dt>Connections</dt><dd>${graph.edges.length}</dd></div>
        <div><dt>Question lifecycles</dt><dd>${lifecycles.length}</dd></div>
      </dl>
      <div class="pool-research-grid">
        <section class="pool-research-panel pool-research-collection">
          <div class="pool-section-heading"><div><p class="pool-dashboard-kicker">Connect</p><h3 class="type-h3">Evidence collection</h3></div></div>
          <label class="pool-field"><span>Search sequences, intent, claims, models, or contributors</span><input data-research-search value="${escapeHtml(query)}" placeholder="signal peptide, sequence, model, reviewer"></label>
          <div class="pool-research-records" data-research-records>
            ${visible.length ? visible.map((record) => renderRecord(record, { invalidated, reviewStates, submissionsByHash })).join('') : '<p class="type-caption">No matching signed evidence yet.</p>'}
          </div>
        </section>
        ${renderResultEvidencePanel({ lifecycles, submissionsByHash })}
        ${renderReviewPanel({ reviewTargets, reviewTarget, submissionsByHash, reviewStates })}
        ${renderLifecycleForms({
          questions: submissions,
          priorEvidence,
          hypotheses,
          predictions,
          resolutionPolicies,
          workOrders,
          acceptedWorkOrders,
          workClaims,
          outcomes,
          cohorts,
          calibrationCohorts: cohorts.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted'),
          calibrationEvaluations: [...evaluations, ...adjudicationEvaluations]
            .filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted'),
          candidateActions: approvedCandidateActions,
          evaluations: evaluations.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted'),
          adjudicationExperiments: acceptedAdjudicationExperiments,
          active
        })}
        ${renderDiscoveryPanel({ results, target, similar, clusters })}
        ${renderNextWorkPanel({ rankedTasks, actionRanking, candidateRanking })}
        ${renderParticipationQualityPanel({ rewards })}
      </div>
    </section>
  `;
}

const replaceWorkspace = (workspace, options = {}) => {
  const roomId = workspace.dataset.roomId;
  const parent = workspace.parentElement;
  if (!parent) return;
  const selectedReviewTarget = workspace.querySelector('[data-research-review-form] select[name="targetHash"]')?.value || '';
  parent.innerHTML = renderResearchWorkspace(roomId, loadResearchRecords(roomId), {
    reviewTarget: reviewTargetFromUrl() || selectedReviewTarget,
    ...options
  });
  bindResearchWorkspace(parent.querySelector('[data-pool-research-workspace]'));
};

const reviewActionClaims = Object.freeze({
  accept: {
    claimKind: 'review_decision',
    relation: 'reviews',
    decision: 'accepted',
    pending: 'Signing acceptance...'
  },
  reject: {
    claimKind: 'review_decision',
    relation: 'reviews',
    decision: 'rejected',
    pending: 'Signing rejection...'
  },
  correct: {
    claimKind: 'correction',
    relation: 'corrects',
    decision: null,
    pending: 'Signing correction...'
  },
  replicate: {
    claimKind: 'review_decision',
    relation: 'reviews',
    decision: 'replication_requested',
    pending: 'Signing replication request...'
  }
});

export const createContextualReviewRecord = ({
  action,
  identity,
  roomId,
  targetHash,
  text,
  confidence,
  evidenceUrl = '',
  targetRecord = null,
  contextDetermination = ''
} = {}) => {
  const claim = reviewActionClaims[action];
  if (!claim) throw new TypeError('review action must be accept, reject, correct, or replicate');
  const reuseContext = targetRecord?.evidence?.reuseContext || null;
  const determination = String(contextDetermination || '').trim();
  if (reuseContext && action === 'accept' && determination !== 'relevant') {
    throw new TypeError('Accepting cross-room evidence requires an explicit relevant context determination');
  }
  const contextAssessment = reuseContext && claim.claimKind === 'review_decision' && determination
    ? {
        determination,
        originRecordHash: reuseContext.originRecordHash,
        originQuestionHash: reuseContext.origin.questionHash,
        currentQuestionHash: reuseContext.current.questionHash,
        comparisonHash: reuseContext.comparisonHash,
        rationale: text
      }
    : null;
  return createSignedHumanClaim({
    identity,
    roomId,
    targetHash,
    claimKind: claim.claimKind,
    relation: claim.relation,
    text,
    confidence,
    evidenceLinks: evidenceUrl ? [evidenceUrl] : [],
    decision: claim.decision,
    contextAssessment
  });
};

const retainReviewTargetInUrl = (targetHash) => {
  if (!targetHash || !globalThis.location || !globalThis.history?.replaceState) return;
  const url = new URL(globalThis.location.href);
  url.searchParams.set('target', targetHash);
  globalThis.history.replaceState(globalThis.history.state, '', `${url.pathname}${url.search}${url.hash}`);
};

const commaList = (value) => String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);

const candidateScientificCostFromForm = (values) => Object.fromEntries([
  ...['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime'].map((component) => [component, {
    amount: values.get(`${component}Amount`),
    unit: values.get(`${component}Unit`),
    burden: values.get(`${component}Burden`)
  }]),
  ['assumptions', commaList(values.get('costAssumptions'))]
]);

const candidateUncertaintyFromForm = (values) => {
  const representation = values.get('uncertaintyRepresentation');
  const shared = {
    representation,
    rationale: values.get('uncertaintyRationale')
  };
  const represented = representation === 'probability'
    ? {
        ...shared,
        probability: values.get('uncertaintyProbability'),
        calibration: {
          methodId: values.get('calibrationMethodId'),
          version: values.get('calibrationMethodVersion'),
          cohortHash: values.get('calibrationCohortHash'),
          metricId: values.get('calibrationMetricId')
        }
      }
    : representation === 'set_valued'
      ? { ...shared, possibleValues: commaList(values.get('possibleValues')) }
      : {
          ...shared,
          ordinal: {
            level: values.get('ordinalLevel'),
            scaleId: values.get('ordinalScaleId'),
            scaleVersion: values.get('ordinalScaleVersion')
          }
        };
  return values.getAll('uncertaintySources').map((source) => ({ source, ...represented }));
};

const protocolFromForm = (values) => ({
  protocolId: values.get('protocolId'),
  version: values.get('protocolVersion'),
  assayType: values.get('assayType'),
  executableUri: values.get('executableUri'),
  referenceIdentities: [{ accession: values.get('referenceAccession'), version: values.get('referenceVersion') }],
  conditions: { notes: values.get('conditions') },
  controls: commaList(values.get('controls')),
  readouts: commaList(values.get('readouts')),
  normalization: { method: values.get('normalizationMethod'), version: values.get('normalizationVersion') },
  uncertaintyPlan: values.get('uncertaintyPlan'),
  acceptanceCriteria: values.get('acceptanceCriteria')
});

export const createLifecycleRecordFromForm = async (action, values, roomId, records) => {
  const researcher = createPoolIdentity(['evaluation', 'adjudication-evaluation'].includes(action) ? 'verifier' : 'researcher');
  const byHash = new Map(records.map((record) => [record.recordHash, record]));
  if (action === 'prior-evidence') {
    const question = byHash.get(values.get('questionHash'));
    if (question?.kind !== 'research_submission') throw new Error('Selected research question is unavailable');
    const evidenceKind = values.get('evidenceKind');
    const requiresAnnotationIdentity = ['annotation', 'domain'].includes(evidenceKind);
    const finding = evidenceKind === 'assay'
      ? { classification: values.get('findingClassification'), attempt: { status: 'completed', failureCategory: 'none' } }
      : evidenceKind === 'negative_result'
        ? { classification: 'negative', attempt: { status: 'completed', failureCategory: 'none' } }
        : evidenceKind === 'failed_attempt'
          ? { classification: 'not_observed', attempt: { status: 'failed', failureCategory: values.get('failureCategory') } }
          : {};
    return createSignedPublicProteinEvidence({
      identity: researcher,
      roomId,
      questionHash: question.recordHash,
      evidenceKind,
      summary: values.get('summary'),
      reference: {
        uri: values.get('uri'),
        accession: values.get('accession'),
        version: values.get('version'),
        contentHash: values.get('sourceContentHash')
      },
      annotation: requiresAnnotationIdentity ? {
        scope: evidenceKind === 'domain' ? 'domain' : values.get('annotationScope'),
        ontology: {
          namespace: values.get('ontologyNamespace'),
          termId: values.get('ontologyTermId'),
          version: values.get('ontologyVersion'),
          label: values.get('ontologyLabel')
        },
        sequence: { hash: question.sequence?.hash, length: question.sequence?.length },
        coordinates: {
          sourceSystem: values.get('coordinateSystem'),
          sourceStart: values.get('coordinateStart'),
          sourceEnd: values.get('coordinateEnd')
        }
      } : null,
      conditions: { notes: values.get('conditions') },
      transformations: [{
        id: values.get('transformationId'),
        version: values.get('transformationVersion'),
        parametersHash: values.get('transformationParametersHash'),
        description: values.get('transformationDescription')
      }],
      uncertainty: { method: 'contributor assessment', description: values.get('uncertainty') },
      finding,
      provenance: {
        retrievalMethod: values.get('retrievalMethod'),
        retrievedAt: new Date().toISOString(),
        sourceIdentity: values.get('accession') || values.get('uri'),
        license: values.get('sourceLicense')
      }
    });
  }
  if (action === 'hypothesis') {
    return createSignedResearchHypothesis({
      identity: researcher,
      roomId,
      questionHash: values.get('questionHash'),
      statement: values.get('statement'),
      conditions: { notes: values.get('conditions') },
      discriminatingObservations: [values.get('discriminator')],
      priorEvidenceHashes: values.get('priorEvidenceHash') ? [values.get('priorEvidenceHash')] : [],
      alternativeToHashes: values.get('alternativeToHash') ? [values.get('alternativeToHash')] : []
    });
  }
  if (action === 'prediction') {
    const hypothesis = byHash.get(values.get('hypothesisHash'));
    if (!hypothesis) throw new Error('Selected hypothesis is unavailable');
    return createSignedResearchPrediction({
      identity: researcher,
      roomId,
      questionHash: hypothesis.questionHash,
      hypothesisHash: hypothesis.recordHash,
      method: { methodId: values.get('methodId'), version: values.get('methodVersion'), artifactHash: values.get('artifactHash') },
      expectedObservation: values.get('expectedObservation'),
      normalizedLabel: values.get('normalizedLabel'),
      conditions: { notes: values.get('conditions') },
      confidence: values.get('confidence'),
      outcomeAccess: 'blinded'
    });
  }
  if (action === 'resolution-policy') {
    const hypothesis = byHash.get(values.get('resolutionTargetHypothesisHash'));
    if (hypothesis?.kind !== 'research_hypothesis') throw new Error('Selected resolution target hypothesis is unavailable');
    const rule = (prefix) => ({
      outcomeClassifications: [values.get(`${prefix}Classification`)],
      minimumAcceptedCompletedOutcomes: values.get(`${prefix}MinimumOutcomes`),
      minimumIndependentReplications: values.get(`${prefix}MinimumReplications`),
      maximumAmbiguousOutcomes: values.get(`${prefix}MaximumAmbiguous`),
      requiredDistinctReviewerIdentities: values.get(`${prefix}MinimumReviewers`),
      uncertainty: {
        methodId: values.get(`${prefix}UncertaintyMethodId`),
        version: values.get(`${prefix}UncertaintyVersion`),
        metricId: values.get(`${prefix}UncertaintyMetricId`),
        maximumValue: values.get(`${prefix}MaximumUncertainty`),
        unit: values.get(`${prefix}UncertaintyUnit`)
      }
    });
    const frozenAt = new Date().toISOString();
    return createSignedResearchResolutionPolicy({
      identity: researcher,
      roomId,
      questionHash: hypothesis.questionHash,
      targetHypothesisHash: hypothesis.recordHash,
      conclusionLabel: values.get('resolutionConclusionLabel'),
      decisionScope: values.get('resolutionDecisionScope'),
      provisionalAcceptance: rule('acceptance'),
      continuedUncertainty: { triggers: commaList(values.get('uncertaintyTriggers')) },
      rejection: rule('rejection'),
      reopening: { triggers: commaList(values.get('reopeningTriggers')) },
      closure: {
        minimumAcceptedCompletedOutcomes: values.get('closureMinimumOutcomes'),
        minimumIndependentReplications: values.get('closureMinimumReplications'),
        maximumAmbiguousOutcomes: values.get('closureMaximumAmbiguous'),
        requiredDistinctReviewerIdentities: values.get('closureMinimumReviewers'),
        requireAllControlsPassed: values.get('closureControlsPassed') === 'on',
        requireNoDisputedReviews: values.get('closureNoDisputedReviews') === 'on',
        requireNoActiveContradictions: values.get('closureNoContradictions') === 'on'
      },
      frozenAt
    });
  }
  if (action === 'candidate-action') {
    const question = byHash.get(values.get('questionHash'));
    const affectedHypothesisHashes = values.getAll('affectedHypothesisHashes');
    const hypotheses = affectedHypothesisHashes.map((hash) => byHash.get(hash)).filter(Boolean);
    if (question?.kind !== 'research_submission') throw new Error('Selected research question is unavailable');
    if (!affectedHypothesisHashes.length
      || hypotheses.length !== affectedHypothesisHashes.length
      || hypotheses.some((record) => record.kind !== 'research_hypothesis' || record.questionHash !== question.recordHash)) {
      throw new Error('Select affected hypotheses from the chosen question');
    }
    return createSignedCandidateAction({
      identity: researcher,
      roomId,
      questionHash: question.recordHash,
      action: {
        kind: values.get('candidateKind'),
        title: values.get('candidateTitle'),
        rationale: values.get('candidateRationale'),
        affectedHypothesisHashes,
        predictedObservations: [{
          observation: values.get('predictedObservation'),
          affectedHypothesisHashes
        }],
        falsifiers: affectedHypothesisHashes.map((hypothesisHash) => ({
          hypothesisHash,
          observation: values.get('falsifyingObservation')
        })),
        execution: {
          contractKind: values.get('contractKind'),
          contractId: values.get('contractId'),
          version: values.get('contractVersion'),
          artifactHash: values.get('contractArtifactHash'),
          parametersHash: values.get('contractParametersHash')
        },
        uncertainty: candidateUncertaintyFromForm(values),
        feasibility: {
          status: values.get('feasibilityStatus'),
          requiredCapabilities: commaList(values.get('requiredCapabilities')),
          availability: values.get('availability'),
          materials: commaList(values.get('materials')),
          failureRisks: commaList(values.get('failureRisks'))
        },
        independence: {
          dimensions: commaList(values.get('independenceDimensions')),
          exclusions: commaList(values.get('independenceExclusions')),
          minimumIndependentExecutions: values.get('minimumIndependentExecutions')
        },
        safety: {
          classification: values.get('safetyClassification'),
          requirements: commaList(values.get('safetyRequirements')),
          reviewRequired: values.get('candidateSafetyReview') === 'on'
        },
        consent: {
          publicSequenceRequired: values.get('candidatePublicConsent') === 'on',
          publicEvidencePublicationRequired: values.get('candidatePublicConsent') === 'on',
          additionalRequirements: []
        },
        scientificCost: candidateScientificCostFromForm(values),
        expectedValue: {
          status: values.get('valueStatus'),
          method: { id: values.get('valueMethodId'), version: values.get('valueMethodVersion') },
          uncertaintyReduction: values.get('uncertaintyReduction'),
          decisionRelevance: values.get('decisionRelevance'),
          duplicateWorkAvoidance: values.get('duplicateWorkAvoidance'),
          calibrationEvidenceHashes: values.getAll('valueCalibrationEvidenceHashes').filter(Boolean)
        }
      }
    });
  }
  if (action === 'work-order') {
    const hypothesisHashes = values.getAll('hypothesisHashes');
    const hypotheses = hypothesisHashes.map((hash) => byHash.get(hash)).filter(Boolean);
    const questionHashes = new Set(hypotheses.map((record) => record.questionHash));
    if (hypotheses.length !== hypothesisHashes.length || questionHashes.size !== 1) {
      throw new Error('Select competing hypotheses from one question');
    }
    return createSignedResearchWorkOrder({
      identity: researcher,
      roomId,
      questionHash: [...questionHashes][0],
      hypothesisHashes,
      title: values.get('title'),
      protocol: protocolFromForm(values),
      replicaTarget: values.get('replicaTarget'),
      blindness: { required: true, allocationHash: values.get('allocationHash') },
      feasibility: {
        resources: values.get('workResources'),
        biosafety: values.get('workBiosafety'),
        limitations: values.get('workLimitations')
      },
      analysis: {
        methodId: values.get('workAnalysisMethodId'),
        version: values.get('workAnalysisVersion'),
        artifactHash: values.get('workAnalysisArtifactHash'),
        parametersHash: values.get('workAnalysisParametersHash')
      },
      failureCategories: commaList(values.get('allowedFailureCategories')),
      custody: {
        planId: values.get('custodyPlanId'),
        version: values.get('custodyPlanVersion'),
        artifactHash: values.get('custodyArtifactHash'),
        requiredRoles: commaList(values.get('custodyRequiredRoles')),
        materialsPolicy: values.get('materialsPolicy'),
        samplesPolicy: values.get('samplesPolicy'),
        instrumentsPolicy: values.get('instrumentsPolicy')
      },
      publication: {
        scope: 'public_complete_record',
        license: values.get('workPublicationLicense'),
        publishLaboratoryIdentity: values.get('publishLaboratoryIdentity') === 'on',
        publishQualification: values.get('publishQualification') === 'on',
        publishProtocol: values.get('publishProtocol') === 'on',
        publishRawObservations: values.get('publishRawObservations') === 'on',
        publishFailures: values.get('publishFailures') === 'on'
      },
      replication: {
        requiredIndependentDimensions: commaList(values.get('replicationIndependentDimensions'))
      },
      scopeBoundary: {
        biologicalInterpretation: 'evidence_only_no_interpretation_authority',
        medicalUse: 'prohibited',
        protocolSafetyClassification: 'public_non_pathogenic_non_clinical',
        sampleScope: 'explicitly_public_synthetic_or_public_reference_only',
        privateSamples: 'prohibited',
        laboratoryAuthority: 'none',
        safetyReview: 'independent_human_required_before_execution'
      }
    });
  }
  if (action === 'work-claim') {
    const workOrder = byHash.get(values.get('workOrderHash'));
    if (workOrder?.kind !== 'research_work_order') throw new Error('Selected work order is unavailable');
    return createSignedResearchWorkClaim({
      identity: researcher,
      roomId,
      workOrderHash: values.get('workOrderHash'),
      laboratory: {
        id: values.get('laboratoryId'),
        name: values.get('laboratoryName'),
        institution: values.get('institution'),
        institutionIdentityHash: values.get('institutionIdentityHash'),
        ror: values.get('ror')
      },
      capabilityClaims: [{
        id: values.get('capabilityId'),
        version: values.get('capabilityVersion'),
        evidenceHash: values.get('capabilityEvidenceHash'),
        description: values.get('capabilityDescription')
      }],
      protocolCustody: {
        protocolHash: workOrder.work.protocol.protocolHash,
        role: values.get('protocolCustodyRole'),
        evidenceHash: values.get('protocolCustodyEvidenceHash')
      },
      safety: {
        classification: values.get('laboratorySafetyClassification'),
        oversightAuthority: values.get('oversightAuthority'),
        approvalHash: values.get('safetyApprovalHash'),
        limitations: commaList(values.get('safetyLimitations'))
      },
      availability: {
        status: values.get('laboratoryAvailabilityStatus'),
        capacity: values.get('laboratoryCapacity'),
        validFrom: values.get('laboratoryAvailableFrom'),
        validUntil: values.get('laboratoryAvailableUntil')
      },
      consent: {
        publicLaboratoryIdentity: values.get('publicConsent') === 'on',
        publishQualification: values.get('publicConsent') === 'on',
        publishOutcome: values.get('publicConsent') === 'on'
      },
      conflictDisclosure: values.get('laboratoryConflictDisclosure')
    });
  }
  if (action === 'outcome') {
    const workClaim = byHash.get(values.get('workClaimHash'));
    const workOrder = byHash.get(workClaim?.workOrderHash);
    if (!workClaim || !workOrder) throw new Error('Selected work claim or work order is unavailable');
    const replicationOfHash = values.get('replicationOfHash') || null;
    return createSignedExperimentalOutcome({
      identity: researcher,
      roomId,
      questionHash: workOrder.questionHash,
      workOrderHash: workOrder.recordHash,
      workClaimHash: workClaim.recordHash,
      hypothesisHashes: workOrder.hypothesisHashes,
      classification: values.get('classification'),
      summary: values.get('summary'),
      attempt: {
        status: values.get('attemptStatus'),
        failureCategory: values.get('failureCategory'),
        failureDetail: values.get('failureDetail'),
        completedAt: new Date().toISOString()
      },
      observations: [{
        readout: values.get('readout'),
        value: values.get('value'),
        normalizedValue: values.get('normalizedValue'),
        unit: values.get('unit'),
        uncertainty: { method: 'reported uncertainty', value: values.get('uncertaintyValue'), unit: values.get('unit') }
      }],
      protocol: workOrder.work.protocol,
      analysis: workOrder.work.plannedAnalysis
        ? { ...workOrder.work.plannedAnalysis, lineageHashes: replicationOfHash ? [replicationOfHash] : [] }
        : {
          methodId: values.get('analysisId'),
          version: values.get('analysisVersion'),
          artifactHash: values.get('analysisArtifactHash'),
          parametersHash: values.get('analysisParametersHash'),
          lineageHashes: replicationOfHash ? [replicationOfHash] : []
        },
      executionContext: {
        institutionIdentityHash: workClaim.workClaim.laboratory.institutionIdentityHash,
        instrumentIdentityHash: values.get('instrumentIdentityHash'),
        sampleBatchHash: values.get('sampleBatchHash'),
        preparationBatchHash: values.get('preparationBatchHash'),
        analysisExecutionHash: values.get('analysisExecutionHash')
      },
      uncertainty: { method: 'reported uncertainty', value: values.get('uncertaintyValue'), unit: values.get('unit') },
      blind: { state: 'sealed', codeHash: values.get('codeHash'), allocationHash: workOrder.work.blindness.allocationHash },
      replicationOfHash
    });
  }
  if (action === 'cohort') {
    const questionHash = values.get('questionHash');
    const predictionHashes = records.filter((record) => record.kind === 'research_prediction' && record.questionHash === questionHash).map((record) => record.recordHash);
    const workOrderHashes = records.filter((record) => record.kind === 'research_work_order' && record.questionHash === questionHash).map((record) => record.recordHash);
    if (!predictionHashes.length || !workOrderHashes.length) throw new Error('The selected question needs frozen predictions and a work order');
    return createSignedEvaluationCohort({
      identity: researcher,
      roomId,
      label: values.get('label'),
      questionHashes: [questionHash],
      predictionHashes,
      workOrderHashes,
      metrics: [{ id: values.get('metricId'), label: values.get('metricLabel'), direction: values.get('direction'), unit: values.get('unit') }]
    });
  }
  if (action === 'adjudication-experiment') {
    const metricPrefixes = [
      'quality',
      'effort',
      'informationGain',
      'contradictionCost',
      'duplicateWork',
      'uncertaintyCalibration',
      'heldOutFamily',
      'northStar'
    ];
    return createSignedAdjudicationExperiment({
      identity: researcher,
      roomId,
      target: {
        catalogId: values.get('catalogId'),
        catalogVersion: values.get('catalogVersion'),
        curatorRole: values.get('curatorRole'),
        decision: values.get('adjudicationDecision'),
        disputedEvidencePattern: values.get('disputedEvidencePattern'),
        actionableOutput: values.get('actionableOutput'),
        adopterOrPayer: values.get('adopterOrPayer')
      },
      baseline: {
        workflowId: values.get('baselineWorkflowId'),
        version: values.get('baselineVersion'),
        revisionHash: values.get('baselineRevisionHash'),
        description: values.get('baselineDescription'),
        toolsAndHandoffs: commaList(values.get('baselineTools')),
        actionSelection: {
          policyId: values.get('baselinePolicyId'),
          version: values.get('baselinePolicyVersion'),
          artifactHash: values.get('baselinePolicyArtifactHash'),
          inputContractHash: values.get('baselineInputContractHash'),
          budgetContractHash: values.get('baselineBudgetContractHash'),
          rankingMethod: values.get('baselineRankingMethod'),
          rankingStatus: values.get('baselineRankingStatus'),
          eligibleActionKinds: commaList(values.get('baselineEligibleActionKinds')),
          tieBreak: commaList(values.get('baselineTieBreak')),
          stopRule: values.get('baselineStopRule')
        }
      },
      candidate: {
        policyId: values.get('candidatePolicyId'),
        version: values.get('candidateVersion'),
        revisionHash: values.get('candidateRevisionHash')
      },
      cohort: {
        manifest: {
          accession: values.get('cohortAccession'),
          version: values.get('cohortVersion'),
          contentHash: values.get('cohortContentHash')
        },
        caseCount: values.get('cohortCaseCount'),
        familySplitHash: values.get('familySplitHash'),
        allocationHash: values.get('allocationHash'),
        familyDisjoint: values.get('familyDisjoint') === 'on'
      },
      outcomeBoundary: {
        mode: values.get('outcomeBoundaryMode'),
        accessAtFreeze: values.get('outcomeBoundaryMode') === 'historical_hidden' ? 'blinded' : 'not_available',
        evidenceCutoffAt: values.get('outcomeEvidenceCutoffAt'),
        outcomeManifestCommitmentHash: values.get('outcomeManifestCommitmentHash'),
        revealRule: values.get('outcomeRevealRule'),
        contaminationAuditMethod: values.get('contaminationAuditMethod'),
        contaminationAuditArtifactHash: values.get('contaminationAuditArtifactHash')
      },
      comparison: {
        pairedTasks: values.get('pairedTasks') === 'on',
        sameInputOrder: values.get('sameInputOrder') === 'on',
        sameEvidenceCutoff: values.get('sameEvidenceCutoff') === 'on',
        resourceBudgetHash: values.get('comparisonResourceBudgetHash'),
        failurePolicyHash: values.get('comparisonFailurePolicyHash'),
        timeoutPolicyHash: values.get('comparisonTimeoutPolicyHash'),
        seedManifestHash: values.get('comparisonSeedManifestHash')
      },
      evaluator: {
        authority: values.get('evaluatorAuthority'),
        identityRootId: values.get('evaluatorIdentityRootId'),
        methodId: values.get('evaluatorMethodId'),
        version: values.get('evaluatorVersion'),
        artifactHash: values.get('evaluatorArtifactHash'),
        blinded: values.get('evaluatorBlinded') === 'on'
      },
      metrics: metricPrefixes.map((prefix) => ({
        id: values.get(`${prefix}MetricId`),
        label: values.get(`${prefix}MetricLabel`),
        unit: values.get(`${prefix}MetricUnit`),
        direction: values.get(`${prefix}Direction`),
        measurementSource: values.get(`${prefix}MeasurementSource`),
        aggregationRule: values.get(`${prefix}AggregationRule`),
        validityConditions: commaList(values.get(`${prefix}ValidityConditions`)),
        noiseModel: values.get(`${prefix}NoiseModel`),
        minimumSampleSize: values.get(`${prefix}MinimumSample`),
        confidenceLevel: values.get(`${prefix}ConfidenceLevel`)
      })),
      measurementPlan: {
        informationGainPerActionMetricId: values.get('informationGainMetricId'),
        contradictionResolutionCostMetricId: values.get('contradictionCostMetricId'),
        duplicateWorkAvoidedMetricId: values.get('duplicateWorkMetricId'),
        uncertaintyCalibrationErrorMetricId: values.get('uncertaintyCalibrationMetricId'),
        heldOutFamilyPerformanceMetricId: values.get('heldOutFamilyMetricId')
      },
      northStarPolicy: {
        costToReplicatedConclusionMetricId: values.get('northStarMetricId'),
        costRepresentation: {
          componentIds: ['compute', 'money', 'labor', 'instrument', 'sample', 'elapsedTime'],
          rawAmountsRemainInOriginalUnits: values.get('rawCostUnitsPreserved') === 'on',
          normalizedUnit: values.get('northStarMetricUnit'),
          conversionPolicy: {
            policyId: values.get('costConversionPolicyId'),
            version: values.get('costConversionPolicyVersion'),
            artifactHash: values.get('costConversionArtifactHash')
          },
          includeFailedAttempts: values.get('failedAttemptsIncluded') === 'on',
          includeUnresolvedCases: values.get('unresolvedCasesIncluded') === 'on',
          stopRule: values.get('northStarCostStopRule')
        },
        conclusionCriteria: {
          policyId: values.get('conclusionPolicyId'),
          version: values.get('conclusionPolicyVersion'),
          artifactHash: values.get('conclusionPolicyArtifactHash'),
          decisionStates: ['retain', 'revise', 'reject', 'unresolved'],
          frozenBeforeActions: values.get('conclusionFrozenBeforeActions') === 'on',
          independentAcceptanceRequired: values.get('conclusionIndependentAcceptance') === 'on',
          independentReplicationRequired: values.get('conclusionIndependentReplication') === 'on',
          minimumIndependentReplications: values.get('minimumIndependentReplications')
        },
        independenceCriteria: {
          policyId: values.get('independencePolicyId'),
          version: values.get('independencePolicyVersion'),
          artifactHash: values.get('independencePolicyArtifactHash'),
          requiredDimensions: commaList(values.get('northStarIndependenceDimensions')),
          evaluatorExcludedFromCaseEvidence: values.get('evaluatorExcludedFromCaseEvidence') === 'on'
        },
        aggregation: {
          intervalMethod: values.get('northStarIntervalMethod'),
          minimumPairedCases: values.get('northStarMinimumPairedCases'),
          confidenceLevel: values.get('northStarAggregationConfidence'),
          minimumImprovementThreshold: values.get('northStarMinimumImprovement')
        },
        operationalMetrics: ['peers', 'jobs', 'receipts', 'records', 'claims', 'total_compute']
      },
      successPolicy: {
        qualityMetricId: values.get('qualityMetricId'),
        effortMetricId: values.get('effortMetricId'),
        qualityImprovementThreshold: values.get('qualityImprovementThreshold'),
        qualityNonInferiorityMargin: values.get('qualityNonInferiorityMargin'),
        effortImprovementThreshold: values.get('effortImprovementThreshold'),
        effortComparabilityMargin: values.get('effortComparabilityMargin')
      },
      resolution: {
        acceptanceRule: values.get('experimentAcceptanceRule'),
        rejectionRule: values.get('experimentRejectionRule'),
        reopeningRule: values.get('experimentReopeningRule')
      }
    });
  }
  if (action === 'adjudication-evaluation') {
    const experiment = byHash.get(values.get('adjudicationExperimentHash'));
    if (experiment?.kind !== 'research_adjudication_experiment') throw new Error('Selected adjudication experiment is unavailable');
    const policy = experiment.experiment.successPolicy;
    const measurementPlan = experiment.experiment.measurementPlan;
    const metricResults = [
      [policy.qualityMetricId, 'quality'],
      [policy.effortMetricId, 'effort'],
      [measurementPlan.informationGainPerActionMetricId, 'informationGain'],
      [measurementPlan.contradictionResolutionCostMetricId, 'contradictionCost'],
      [measurementPlan.duplicateWorkAvoidedMetricId, 'duplicateWork'],
      [measurementPlan.uncertaintyCalibrationErrorMetricId, 'uncertaintyCalibration'],
      [measurementPlan.heldOutFamilyPerformanceMetricId, 'heldOutFamily'],
      [experiment.experiment.northStarPolicy.costToReplicatedConclusionMetricId, 'northStar']
    ].map(([metricId, prefix]) => ({
      metricId,
      baselineValue: values.get(`${prefix}BaselineValue`),
      candidateValue: values.get(`${prefix}CandidateValue`),
      effectInterval: {
        lower: values.get(`${prefix}EffectLower`),
        upper: values.get(`${prefix}EffectUpper`)
      },
      pairedSampleCount: values.get('pairedSampleCount')
    }));
    return createSignedAdjudicationEvaluation({
      identity: researcher,
      roomId,
      experiment,
      resultManifest: {
        accession: values.get('resultManifestAccession'),
        version: values.get('resultManifestVersion'),
        contentHash: values.get('resultManifestHash')
      },
      metricResults,
      northStarEvidence: {
        caseEvidenceManifestHash: values.get('northStarCaseEvidenceManifestHash'),
        rawCostObservationManifestHash: values.get('northStarRawCostManifestHash'),
        conclusionAuditManifestHash: values.get('northStarConclusionAuditHash'),
        independenceAuditManifestHash: values.get('northStarIndependenceAuditHash'),
        conversionAuditArtifactHash: values.get('northStarConversionAuditHash'),
        baseline: {
          observedCaseCount: values.get('northStarBaselineObservedCases'),
          independentlyReplicatedConclusionCount: values.get('northStarBaselineReplicatedCases')
        },
        candidate: {
          observedCaseCount: values.get('northStarCandidateObservedCases'),
          independentlyReplicatedConclusionCount: values.get('northStarCandidateReplicatedCases')
        },
        allFrozenCasesIncluded: values.get('northStarAllCasesIncluded') === 'on',
        realWorldObserved: values.get('northStarRealWorldObserved') === 'on',
        criteriaAppliedBeforeOutcomeAccess: values.get('northStarCriteriaPredatedOutcomes') === 'on',
        operationalMetricsExcludedFromSuccess: values.get('northStarOperationalMetricsExcluded') === 'on'
      },
      regressionCount: values.get('adjudicationRegressionCount'),
      missingCaseCount: values.get('adjudicationMissingCaseCount'),
      disagreementSummary: values.get('adjudicationDisagreementSummary'),
      failureAnalysis: values.get('adjudicationFailureAnalysis')
    });
  }
  if (action === 'evaluation') {
    const cohort = byHash.get(values.get('cohortHash'));
    if (!cohort) throw new Error('Selected cohort is unavailable');
    const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
    const outcomeHashes = records.filter((record) => record.kind === 'research_outcome'
      && cohort.cohort.workOrderHashes.includes(record.workOrderHash)
      && Date.parse(record.createdAt) >= Date.parse(cohort.cohort.frozenAt)
      && reviewStates.get(record.recordHash)?.state === 'accepted')
      .map((record) => record.recordHash);
    if (!outcomeHashes.length) throw new Error('No independently accepted post-freeze outcomes are eligible');
    const metric = cohort.cohort.metrics[0];
    return createSignedCohortEvaluation({
      identity: researcher,
      roomId,
      cohortHash: cohort.recordHash,
      outcomeHashes,
      metricResults: [{
        metricId: metric.id,
        direction: metric.direction,
        baselineValue: values.get('baselineValue'),
        currentValue: values.get('currentValue')
      }],
      disagreementSummary: values.get('disagreementSummary'),
      failureAnalysis: values.get('failureAnalysis'),
      nextCohortQuestionHashes: values.get('bindNextCohort') === 'on' ? cohort.cohort.questionHashes : []
    });
  }
  if (action === 'realized-action-value') {
    const candidate = byHash.get(values.get('candidateActionHash'));
    const evaluation = byHash.get(values.get('evaluationHash'));
    if (!candidate || !evaluation) throw new Error('Selected candidate action or evaluation is unavailable');
    const cohort = byHash.get(evaluation.cohortHash);
    if (!cohort?.cohort?.questionHashes?.includes(candidate.questionHash)) {
      throw new Error('Selected evaluation does not measure the candidate action question');
    }
    const candidateActionApprovalHashes = records.filter((record) => (
      record.kind === 'human_claim'
      && record.claim?.kind === 'candidate_action_approval'
      && record.claim?.decision === 'approved'
      && record.claim?.actionContractHash === candidate.action.contractHash
      && record.targetHash === candidate.recordHash
      && record.author?.identityRootId !== candidate.author?.identityRootId
    )).map((record) => record.recordHash);
    if (!candidateActionApprovalHashes.length) throw new Error('The candidate action requires independent exact-contract approval');
    const reviewStates = new Map(projectResearchReviewStates(records).map((entry) => [entry.recordHash, entry]));
    const acceptedReviewHashes = (targetHash) => (reviewStates.get(targetHash)?.decisions || [])
      .filter((decision) => decision.claim?.decision === 'accepted')
      .map((decision) => decision.recordHash);
    const evaluationReviewDecisionHashes = acceptedReviewHashes(evaluation.recordHash);
    if (!evaluationReviewDecisionHashes.length) throw new Error('The measured evaluation requires independent acceptance');
    const reviewedOutcomes = evaluation.evaluation.outcomeHashes.map((outcomeHash) => {
      const reviewDecisionHashes = acceptedReviewHashes(outcomeHash);
      if (!reviewDecisionHashes.length) throw new Error(`Outcome ${compactHash(outcomeHash)} requires independent acceptance`);
      return { outcomeHash, reviewDecisionHashes };
    });
    const contributionByHash = new Map();
    const addContribution = (recordHash, role, causalRationale) => {
      if (recordHash) contributionByHash.set(recordHash, { recordHash, role, causalRationale });
    };
    addContribution(candidate.recordHash, 'action_proposal', 'Proposed the exact candidate action whose downstream value was measured.');
    for (const approvalHash of candidateActionApprovalHashes) {
      addContribution(approvalHash, 'independent_review', 'Independently approved the exact candidate action contract.');
    }
    addContribution(evaluation.recordHash, 'evaluation', 'Measured the candidate against the frozen cohort metric vector.');
    for (const reviewHash of evaluationReviewDecisionHashes) {
      addContribution(reviewHash, 'independent_review', 'Independently accepted the measured evaluation.');
    }
    for (const reviewed of reviewedOutcomes) {
      addContribution(reviewed.outcomeHash, 'outcome_execution', 'Produced a reviewed outcome used by the frozen evaluation.');
      for (const reviewHash of reviewed.reviewDecisionHashes) {
        addContribution(reviewHash, 'independent_review', 'Independently accepted a measured downstream outcome.');
      }
    }
    return createSignedRealizedActionValue({
      identity: researcher,
      roomId,
      questionHash: candidate.questionHash,
      candidateActionHash: candidate.recordHash,
      actionContractHash: candidate.action.contractHash,
      candidateActionApprovalHashes,
      evaluationHash: evaluation.recordHash,
      evaluationReviewDecisionHashes,
      reviewedOutcomes,
      contributions: [...contributionByHash.values()],
      metricResults: evaluation.evaluation.metricResults,
      decisionEffect: values.get('decisionEffect'),
      summary: values.get('realizedValueSummary')
    });
  }
  if (action === 'revocation') {
    return createSignedResearchRevocation({
      identity: researcher,
      roomId,
      targetHash: values.get('targetHash'),
      reason: values.get('reason')
    });
  }
  throw new Error(`Unsupported research lifecycle action: ${action}`);
};

export function bindResearchWorkspace(
  workspace = document.querySelector('[data-pool-research-workspace]'),
  { publishRecord = publishResearchRecord } = {}
) {
  if (!workspace || workspace.dataset.researchBound === 'true') return;
  workspace.dataset.researchBound = 'true';
  const roomId = workspace.dataset.roomId;
  workspace.querySelector('[data-research-search]')?.addEventListener('input', (event) => {
    const allRecords = loadResearchRecords(roomId);
    const records = searchEvidence(allRecords, event.target.value);
    const invalidated = invalidatedResearchHashes(allRecords);
    const reviewStates = new Map(projectResearchReviewStates(allRecords).map((entry) => [entry.recordHash, entry]));
    const submissionsByHash = new Map(allRecords.filter((record) => record.kind === 'research_submission').map((record) => [record.recordHash, record]));
    const target = workspace.querySelector('[data-research-records]');
    if (target) target.innerHTML = records.length
      ? records.map((record) => renderRecord(record, { invalidated, reviewStates, submissionsByHash })).join('')
      : '<p class="type-caption">No matching signed evidence yet.</p>';
  });
  workspace.querySelector('[data-research-similarity-target]')?.addEventListener('change', (event) => {
    replaceWorkspace(workspace, { similarityTarget: event.target.value });
  });
  const reviewTargetSelect = workspace.querySelector('[data-research-review-form] select[name="targetHash"]');
  reviewTargetSelect?.addEventListener('change', (event) => {
    workspace.querySelectorAll('[data-research-review-context-shell]').forEach((context) => {
      context.hidden = context.dataset.researchReviewContextShell !== event.target.value;
    });
    const contextFields = workspace.querySelector('[data-research-context-assessment-fields]');
    const contextSelect = contextFields?.querySelector('[name="contextDetermination"]');
    const selectedRecord = activeResearchRecords(loadResearchRecords(roomId))
      .find((record) => record.recordHash === event.target.value);
    const required = Boolean(selectedRecord?.evidence?.reuseContext);
    if (contextFields) contextFields.hidden = !required;
    if (contextSelect) {
      contextSelect.disabled = !required;
      contextSelect.required = required;
      contextSelect.value = '';
    }
    retainReviewTargetInUrl(event.target.value);
  });
  workspace.querySelector('[data-research-review-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('[data-research-review-status]');
    const values = new FormData(form);
    const action = reviewActionClaims[event.submitter?.value];
    if (!action) {
      if (status) status.textContent = 'Choose accept, reject, correct, or replicate.';
      return;
    }
    form.querySelectorAll('[data-research-review-action]').forEach((button) => { button.disabled = true; });
    if (status) status.textContent = action.pending;
    try {
      const record = await createContextualReviewRecord({
        action: event.submitter.value,
        identity: createPoolIdentity('reviewer'),
        roomId,
        targetHash: values.get('targetHash'),
        text: values.get('text'),
        confidence: values.get('confidence'),
        evidenceUrl: values.get('evidenceUrl'),
        targetRecord: activeResearchRecords(loadResearchRecords(roomId))
          .find((candidate) => candidate.recordHash === values.get('targetHash')) || null,
        contextDetermination: values.get('contextDetermination')
      });
      const publication = await publishRecord(record, { roomId });
      replaceWorkspace(workspace, { reviewTarget: values.get('targetHash') });
      const nextStatus = document.querySelector('[data-research-review-status]');
      if (nextStatus) nextStatus.textContent = publication.remote ? 'Signed review record published.' : 'Signed review record saved locally; coordinator sync is pending.';
    } catch (error) {
      if (status) status.textContent = error.message;
      form.querySelectorAll('[data-research-review-action]').forEach((button) => { button.disabled = false; });
    }
  });
  workspace.querySelectorAll('[data-research-approve-task]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const task = proposeDiscoveryTasks(loadResearchRecords(roomId))
          .find((candidate) => candidate.taskId === button.dataset.researchApproveTask
            && candidate.targetHash === button.dataset.researchTaskTarget);
        if (!task) throw new Error('The projected discovery task is no longer active');
        const record = await createSignedHumanClaim({
          identity: createPoolIdentity('reviewer'),
          roomId,
          targetHash: button.dataset.researchTaskTarget,
          claimKind: 'task_approval',
          relation: 'approves',
          text: `Approved bounded discovery task: ${button.dataset.researchApproveTask}`,
          confidence: 1,
          decision: 'approved',
          taskId: button.dataset.researchApproveTask,
          taskContract: task.taskContract
        });
        await publishResearchRecord(record, { roomId });
        replaceWorkspace(workspace);
      } catch (error) {
        button.disabled = false;
        button.title = error.message;
      }
    });
  });
  workspace.querySelectorAll('[data-research-approve-candidate]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const records = loadResearchRecords(roomId);
        const candidate = activeResearchRecords(records)
          .find((record) => record.kind === 'research_candidate_action'
            && record.recordHash === button.dataset.researchApproveCandidate
            && record.action?.contractHash === button.dataset.researchCandidateContract);
        const ranked = rankProposedCandidateActions(records).admittedCandidates
          .find((entry) => entry.recordHash === candidate?.recordHash);
        if (!candidate || !ranked) throw new Error('The signed candidate action is no longer admitted');
        const record = await createSignedHumanClaim({
          identity: createPoolIdentity('reviewer'),
          roomId,
          targetHash: candidate.recordHash,
          claimKind: 'candidate_action_approval',
          relation: 'approves',
          text: `Approved exact candidate action contract: ${candidate.action.contractHash}`,
          confidence: 1,
          decision: 'approved',
          actionContractHash: candidate.action.contractHash
        });
        await publishRecord(record, { roomId });
        replaceWorkspace(workspace);
      } catch (error) {
        button.disabled = false;
        button.title = error.message;
      }
    });
  });
  workspace.querySelectorAll('[data-research-lifecycle-form]').forEach((form) => {
    const kindSelect = form.querySelector('[data-prior-evidence-kind]');
    const annotationFields = form.querySelector('[data-protein-annotation-fields]');
    if (kindSelect && annotationFields) {
      const syncAnnotationFields = () => {
        const enabled = ['annotation', 'domain'].includes(kindSelect.value);
        annotationFields.hidden = !enabled;
        for (const control of annotationFields.querySelectorAll('input, select')) {
          control.disabled = !enabled;
          control.required = enabled && control.name !== 'ontologyLabel';
        }
        const scope = annotationFields.querySelector('[name="annotationScope"]');
        if (scope && kindSelect.value === 'domain') {
          scope.value = 'domain';
          scope.disabled = true;
          scope.required = false;
        }
      };
      kindSelect.addEventListener('change', syncAnnotationFields);
      syncAnnotationFields();
    }
    const findingFields = form.querySelector('[data-public-evidence-finding]');
    const failureFields = form.querySelector('[data-public-evidence-failure]');
    if (kindSelect && findingFields && failureFields) {
      const syncPublicEvidenceFinding = () => {
        const assay = kindSelect.value === 'assay';
        const negative = kindSelect.value === 'negative_result';
        const failed = kindSelect.value === 'failed_attempt';
        findingFields.hidden = !assay && !negative;
        const classification = findingFields.querySelector('[name="findingClassification"]');
        if (classification) {
          classification.disabled = !assay;
          classification.required = assay;
          if (negative) classification.value = 'negative';
        }
        failureFields.hidden = !failed;
        for (const control of failureFields.querySelectorAll('input, select')) {
          control.disabled = !failed;
          control.required = failed;
        }
      };
      kindSelect.addEventListener('change', syncPublicEvidenceFinding);
      syncPublicEvidenceFinding();
    }
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = form.querySelector('[data-research-lifecycle-status]');
      const submit = form.querySelector('[type="submit"]');
      if (submit) submit.disabled = true;
      if (status) status.textContent = 'Signing lifecycle evidence...';
      try {
        const record = await createLifecycleRecordFromForm(
          form.dataset.researchAction,
          new FormData(form),
          roomId,
          activeResearchRecords(loadResearchRecords(roomId))
        );
        const publication = await publishResearchRecord(record, { roomId });
        replaceWorkspace(workspace);
        const sync = document.querySelector('[data-pool-research-sync]');
        if (sync) sync.textContent = publication.remote ? 'Lifecycle evidence synchronized' : 'Lifecycle evidence saved locally; coordinator sync pending';
      } catch (error) {
        if (status) status.textContent = error.message;
        if (submit) submit.disabled = false;
      }
    });
  });
}

export async function createCurrentRoomPriorEvidence({
  identity,
  roomId,
  question,
  originQuestion,
  candidate,
  sourceRecord,
  createdAt = new Date().toISOString()
} = {}) {
  if (question?.kind !== 'research_submission' || question.roomId !== roomId) {
    throw new Error('The active current-room question is unavailable');
  }
  if (candidate?.originRoomId === roomId || candidate?.recordHash !== sourceRecord?.recordHash) {
    throw new Error('The prior-room candidate identity is inconsistent');
  }
  if (originQuestion?.kind !== 'research_submission'
    || originQuestion.recordHash !== sourceRecord?.questionHash
    || originQuestion.roomId !== candidate.originRoomId) {
    throw new Error('The signed origin-room question is unavailable or inconsistent');
  }
  if (candidate?.qualification?.status !== 'source_metadata_complete') {
    throw new Error('The prior-room source requires qualification before attachment');
  }
  if (sourceRecord?.kind !== 'research_prior_evidence') {
    throw new Error('Only a versioned prior-evidence record can be attached automatically');
  }
  const license = String(sourceRecord.evidence?.provenance?.license || '').trim();
  if (!license) throw new Error('The prior-room source has no declared reuse license');
  const annotation = sourceRecord.evidence?.annotation || null;
  if (['annotation', 'domain'].includes(sourceRecord.evidence?.kind)) {
    if (!annotation) throw new Error('The prior-room annotation has no normalized identity');
    if (annotation.sequence?.hash !== question.sequence?.hash
      || annotation.sequence?.length !== question.sequence?.length) {
      throw new Error('The prior-room annotation is not bound to the active exact sequence');
    }
  }
  const reuseContext = await createCrossRoomReuseContext({
    originRecord: sourceRecord,
    originQuestion,
    currentQuestion: question
  });
  const createAttachedEvidence = sourceRecord.evidence?.schema === PUBLIC_PROTEIN_EVIDENCE_VERSION
    ? createSignedPublicProteinEvidence
    : createSignedPriorEvidence;
  return createAttachedEvidence({
    identity,
    roomId,
    questionHash: question.recordHash,
    evidenceKind: sourceRecord.evidence?.kind,
    summary: `Prior-room evidence from ${candidate.originRoomId}: ${sourceRecord.evidence?.summary || candidate.recordHash}`,
    reference: {
      accession: `reploid:${candidate.originRoomId}:${sourceRecord.evidence?.reference?.accession || 'evidence'}`,
      contentHash: candidate.recordHash
    },
    annotation,
    reuseContext,
    conditions: sourceRecord.evidence?.conditions || {},
    transformations: [
      ...(sourceRecord.evidence?.transformations || []),
      {
        id: 'reploid.cross-room-evidence-reference',
        version: '1',
        description: 'References the exact signed origin-room record without inheriting its decision status.'
      }
    ],
    uncertainty: sourceRecord.evidence?.uncertainty || {},
    finding: sourceRecord.evidence?.finding || {},
    provenance: {
      retrievalMethod: 'Reploid exact-sequence prior-room lookup',
      retrievedAt: createdAt,
      sourceIdentity: `${candidate.originRoomId}:${candidate.recordHash}`,
      license
    },
    createdAt
  });
}

export function bindResearchRoomActions(root = document, {
  publishRecord = publishResearchRecord
} = {}) {
  if (!root || root.dataset?.researchRoomActionsBound === 'true') return;
  if (root.dataset) root.dataset.researchRoomActionsBound = 'true';
  root.addEventListener('click', async (event) => {
    const checkpointButton = event.target.closest?.('[data-pool-room-freeze-contract]');
    if (checkpointButton && root.contains(checkpointButton)) {
      event.preventDefault();
      const roomId = checkpointButton.dataset.poolRoomId;
      const records = loadResearchRecords(roomId);
      const question = activeResearchRecords(records)
        .filter((record) => record.kind === 'research_submission')
        .at(-1) || null;
      const parent = records
        .filter((record) => (
          record.kind === 'research_discovery_checkpoint'
          && record.checkpoint?.questionHash === question?.recordHash
        ))
        .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt))
          || left.recordHash.localeCompare(right.recordHash))
        .at(-1) || null;
      const label = checkpointButton.textContent;
      checkpointButton.disabled = true;
      checkpointButton.textContent = 'Signing replay checkpoint...';
      try {
        if (!question) throw new Error('The active Research Room question is unavailable');
        const record = await createDiscoveryContractCheckpoint({
          identity: createPoolIdentity('reviewer'),
          roomId,
          questionHash: question.recordHash,
          records,
          parentCheckpointHashes: parent ? [parent.recordHash] : []
        });
        const publication = await publishRecord(record, { roomId });
        checkpointButton.textContent = publication.remote ? 'Checkpoint synchronized' : 'Checkpoint saved locally';
      } catch (error) {
        checkpointButton.disabled = false;
        checkpointButton.textContent = label;
        checkpointButton.title = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const priorButton = event.target.closest?.('[data-pool-room-attach-prior]');
    if (priorButton && root.contains(priorButton)) {
      event.preventDefault();
      const roomId = priorButton.dataset.poolRoomId;
      const recordHash = priorButton.dataset.poolRoomAttachPrior;
      const originRoomId = priorButton.dataset.poolRoomPriorOrigin;
      const state = getCrossRoomSequenceEvidence(roomId);
      const candidate = state.projection?.candidates?.find((entry) => (
        entry.recordHash === recordHash && entry.originRoomId === originRoomId
      ));
      const sourceRecord = state.projection?.records?.find((entry) => entry.recordHash === recordHash);
      const originQuestion = state.projection?.records?.find((entry) => (
        entry.recordHash === sourceRecord?.questionHash
        && entry.kind === 'research_submission'
        && entry.roomId === originRoomId
      ));
      const question = activeResearchRecords(loadResearchRecords(roomId))
        .filter((record) => record.kind === 'research_submission')
        .at(-1) || null;
      const label = priorButton.textContent;
      priorButton.disabled = true;
      priorButton.textContent = 'Signing provisional evidence...';
      try {
        if (!candidate || !sourceRecord) throw new Error('The prior-room candidate is no longer available');
        if (state.sequenceHash !== question?.sequence?.hash) throw new Error('The prior-room sequence identity is stale');
        const record = await createCurrentRoomPriorEvidence({
          identity: createPoolIdentity('researcher'),
          roomId,
          question,
          originQuestion,
          candidate,
          sourceRecord
        });
        const publication = await publishRecord(record, { roomId });
        priorButton.textContent = publication.remote ? 'Attached for review' : 'Attached locally; sync pending';
      } catch (error) {
        priorButton.disabled = false;
        priorButton.textContent = label;
        priorButton.title = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const candidateButton = event.target.closest?.('[data-pool-room-approve-candidate]');
    if (candidateButton && root.contains(candidateButton)) {
      event.preventDefault();
      const roomId = candidateButton.dataset.poolRoomId;
      const recordHash = candidateButton.dataset.poolRoomApproveCandidate;
      const contractHash = candidateButton.dataset.poolRoomCandidateContract;
      const records = loadResearchRecords(roomId);
      const candidate = activeResearchRecords(records).find((record) => (
        record.kind === 'research_candidate_action'
        && record.recordHash === recordHash
        && record.action?.contractHash === contractHash
      ));
      const admitted = rankProposedCandidateActions(records).admittedCandidates
        .some((entry) => entry.recordHash === recordHash && entry.actionId === contractHash);
      const label = candidateButton.textContent;
      candidateButton.disabled = true;
      candidateButton.textContent = 'Signing exact approval...';
      try {
        if (!candidate || !admitted) throw new Error('The signed candidate action is no longer admitted');
        const approval = await createSignedHumanClaim({
          identity: createPoolIdentity('reviewer'),
          roomId,
          targetHash: candidate.recordHash,
          claimKind: 'candidate_action_approval',
          relation: 'approves',
          text: `Approved exact candidate action contract: ${contractHash}`,
          confidence: 1,
          decision: 'approved',
          actionContractHash: contractHash
        });
        const publication = await publishRecord(approval, { roomId });
        candidateButton.textContent = publication.remote ? 'Exact contract approved' : 'Approval saved locally';
      } catch (error) {
        candidateButton.disabled = false;
        candidateButton.textContent = label;
        candidateButton.title = error instanceof Error ? error.message : String(error);
      }
      return;
    }
    const button = event.target.closest?.('[data-pool-room-approve-task]');
    if (!button || !root.contains(button)) return;
    event.preventDefault();
    const taskId = button.dataset.poolRoomApproveTask;
    const roomId = button.dataset.poolRoomId;
    const targetHash = button.dataset.poolRoomTaskTarget;
    if (!taskId || !roomId || !targetHash) return;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = 'Signing approval...';
    try {
      const task = proposeDiscoveryTasks(loadResearchRecords(roomId))
        .find((candidate) => candidate.taskId === taskId && candidate.targetHash === targetHash);
      if (!task) throw new Error('The projected discovery task is no longer active');
      const record = await createSignedHumanClaim({
        identity: createPoolIdentity('reviewer'),
        roomId,
        targetHash,
        claimKind: 'task_approval',
        relation: 'approves',
        text: `Approved bounded discovery task: ${taskId}`,
        confidence: 1,
        decision: 'approved',
        taskId,
        taskContract: task.taskContract
      });
      const publication = await publishResearchRecord(record, { roomId });
      button.textContent = publication.remote ? 'Approved next action' : 'Approval saved locally';
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      button.title = error instanceof Error ? error.message : String(error);
    }
  });
}

export async function hydrateAndBindResearchWorkspace(
  workspace = document.querySelector('[data-pool-research-workspace]'),
  roomId = workspace?.dataset.roomId,
  {
    hydrate = hydrateResearchRecords,
    hydrateCrossRoom = hydrateCrossRoomSequenceEvidence,
    hydrateCampaign = hydrateProteinUncertaintyCampaignQueue
  } = {}
) {
  if (!roomId) return null;
  const sync = workspace?.querySelector('[data-pool-research-sync]');
  let localRenderCompleted = false;
  const renderLocalEvidence = () => {
    if (!workspace || !document.body.contains(workspace)) return;
    replaceWorkspace(workspace);
    localRenderCompleted = true;
  };
  const hydrated = workspace
    ? await hydrate(roomId, { onLocalHydrated: renderLocalEvidence })
    : await hydrate(roomId);
  if (!localRenderCompleted) renderLocalEvidence();
  const latestSubmission = activeResearchRecords(hydrated.records || [])
    .filter((record) => record.kind === 'research_submission')
    .at(-1) || null;
  const crossRoomEvidence = latestSubmission
    ? await hydrateCrossRoom(roomId, latestSubmission.sequence?.hash)
    : null;
  const campaignQueue = await hydrateCampaign(roomId);
  const currentWorkspace = document.querySelector('[data-pool-research-workspace]');
  if (workspace && currentWorkspace?.dataset.roomId === roomId) {
    replaceWorkspace(currentWorkspace);
  }
  const current = document.querySelector('[data-pool-research-sync]');
  if (current) {
    const rejectedCount = hydrated.rejectedRecords?.length || 0;
    current.textContent = hydrated.remote
      ? (rejectedCount
        ? `Coordinator evidence synchronized; ${rejectedCount} unadmitted or invalid record${rejectedCount === 1 ? '' : 's'} rejected by policy`
        : 'Coordinator evidence synchronized')
      : (rejectedCount
        ? `Local evidence verified; ${rejectedCount} unadmitted or invalid record${rejectedCount === 1 ? '' : 's'} rejected by policy; coordinator sync unavailable`
        : 'Local evidence verified; coordinator sync unavailable');
  }
  const result = { ...hydrated, crossRoomEvidence, campaignQueue };
  if (sync && !document.body.contains(sync)) return result;
  return result;
}

export default { renderResearchWorkspace, bindResearchWorkspace, bindResearchRoomActions, hydrateAndBindResearchWorkspace };
