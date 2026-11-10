/**
 * @fileoverview Evidence-network workspace rendering: the stats, signed record list, review,
 * lifecycle, discovery, next-work and participation panels over projected records.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import {
  ADJUDICATION_EXPERIMENT_VERSION,
  activeResearchRecords,
  buildEvidenceGraph,
  buildQuestionLifecycles,
  clusterCompatibleResults,
  findSimilarSequences,
  invalidatedResearchHashes,
  projectResearchReviewStates,
  projectResearchRewards,
  rankProposedDiscoveryActions,
  rankProposedCandidateActions,
  searchEvidence
} from '../../pool/evidence-network.js';
import { loadResearchRecords } from './research-store.js';
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

export const reviewTargetFromUrl = () => {
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

export const renderRecord = (record, {
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
    <article class="pool-research-record pool-surface" data-research-kind="${escapeHtml(record.kind)}"${isInvalidated ? ' data-research-invalidated="true"' : ''}>
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
          <p class="pool-dashboard-kicker pool-label pool-muted">Public protein evidence network</p>
          <h2 class="pool-heading">Question lifecycle: predict, test, review, learn</h2>
          <p>Competing hypotheses, condition-specific evidence, blinded work, failures, replications, and cohort effects remain separately signed and challengeable.</p>
        </div>
        <span class="pool-research-sync pool-caption pool-chip" data-pool-research-sync>Verifying local evidence</span>
      </header>
      <dl class="pool-research-stats pool-stats">
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
        <section class="pool-research-panel pool-surface pool-research-collection">
          <div class="pool-section-heading"><div><p class="pool-dashboard-kicker pool-label pool-muted">Connect</p><h3 class="type-h3">Evidence collection</h3></div></div>
          <label class="pool-field"><span class="pool-small pool-muted">Search sequences, intent, claims, models, or contributors</span><input data-research-search value="${escapeHtml(query)}" placeholder="signal peptide, sequence, model, reviewer"></label>
          <div class="pool-research-records" data-research-records>
            ${visible.length ? visible.map((record) => renderRecord(record, { invalidated, reviewStates, submissionsByHash })).join('') : '<p class="pool-caption">No matching signed evidence yet.</p>'}
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
