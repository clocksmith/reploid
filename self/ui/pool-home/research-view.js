/**
 * @fileoverview Evidence-network rendering and human review controls for Poolday.
 */

import { createPoolIdentity } from '../../pool/identity.js';
import { createDiscoveryContractCheckpoint } from '../../pool/discovery-contract.js';
import {
  activeResearchRecords,
  buildEvidenceGraph,
  buildQuestionLifecycles,
  clusterCompatibleResults,
  createCrossRoomReuseContext,
  createSignedAdjudicationEvaluation,
  createSignedAdjudicationExperiment,
  createSignedCohortEvaluation,
  createSignedEvaluationCohort,
  createSignedExperimentalOutcome,
  createSignedHumanClaim,
  createSignedPriorEvidence,
  createSignedResearchHypothesis,
  createSignedResearchPrediction,
  createSignedResearchRevocation,
  createSignedResearchWorkClaim,
  createSignedResearchWorkOrder,
  findSimilarSequences,
  invalidatedResearchHashes,
  projectResearchReviewStates,
  projectResearchRewards,
  proposeDiscoveryTasks,
  rankProposedDiscoveryActions,
  searchEvidence
} from '../../pool/evidence-network.js';
import {
  getCrossRoomSequenceEvidence,
  hydrateCrossRoomSequenceEvidence,
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
  if (record.kind === 'research_prior_evidence') return `<p>${escapeHtml(record.evidence.kind)} · ${escapeHtml(record.evidence.summary)}</p><small>${escapeHtml(record.evidence.reference.accession || record.evidence.reference.uri)} @ ${escapeHtml(record.evidence.reference.version || compactHash(record.evidence.reference.contentHash))} · retrieved ${escapeHtml(record.evidence.provenance.retrievedAt)}</small>`;
  if (record.kind === 'research_prediction') return `<p>${escapeHtml(record.prediction.normalizedLabel)} · confidence ${Math.round(record.prediction.confidence * 100)}%</p><small>${escapeHtml(record.prediction.method.methodId)} @ ${escapeHtml(record.prediction.method.version)} · frozen ${escapeHtml(record.prediction.frozenAt)} · ${escapeHtml(record.prediction.outcomeAccess)}</small>`;
  if (record.kind === 'research_work_order') return `<p>${escapeHtml(record.work.kind)} · ${record.work.replicaTarget} planned replica${record.work.replicaTarget === 1 ? '' : 's'}</p><small>Protocol ${escapeHtml(record.work.protocol.protocolId)} @ ${escapeHtml(record.work.protocol.version)} · ${escapeHtml(compactHash(record.work.protocol.protocolHash))} · proposed until independently reviewed</small>`;
  if (record.kind === 'research_work_claim') {
    const laboratoryLabel = record.workClaim?.consent?.publicLaboratoryIdentity === true
      ? record.workClaim?.laboratory?.name
      : `Participant ${compactHash(record.author?.identityRootId || record.author?.userId || record.recordHash)}`;
    return `<p>${escapeHtml(laboratoryLabel)} claimed ${escapeHtml(compactHash(record.workOrderHash))}</p><small>${escapeHtml(record.workClaim.capabilities.join(' · '))} · public outcome consent recorded</small>`;
  }
  if (record.kind === 'research_outcome') return `<p>${escapeHtml(record.outcome.classification)} · ${escapeHtml(record.outcome.attempt.status)}${record.outcome.attempt.failureCategory !== 'none' ? ` · ${escapeHtml(record.outcome.attempt.failureCategory)}` : ''}</p><small>${record.replicationOfHash ? `Independent replication of ${escapeHtml(compactHash(record.replicationOfHash))} · ` : ''}${escapeHtml(record.outcome.blind.state)} · analysis ${escapeHtml(compactHash(record.outcome.analysis.analysisHash))}</small>`;
  if (record.kind === 'research_cohort') return `<p>${record.cohort.predictionHashes.length} frozen predictions · ${record.cohort.workOrderHashes.length} work orders</p><small>${escapeHtml(record.cohort.frozenAt)} · ${record.cohort.blindingRequired ? 'blinding required' : 'blinding not required'}</small>`;
  if (record.kind === 'research_evaluation') return `<p>${record.evaluation.metricResults.map((metric) => `${escapeHtml(metric.metricId)} ${metric.improved ? 'improved' : 'did not improve'} (${escapeHtml(metric.baselineValue)} to ${escapeHtml(metric.currentValue)})`).join(' · ')}</p><small>${record.evaluation.outcomeHashes.length} independently accepted outcomes · next cohort ${record.evaluation.nextCohortQuestionHashes.length ? 'bound' : 'not bound'}</small>`;
  if (record.kind === 'research_adjudication_experiment') return `<p>${escapeHtml(record.experiment.target.catalogId)} @ ${escapeHtml(record.experiment.target.catalogVersion)} · ${escapeHtml(record.experiment.target.curatorRole)}</p><small>Baseline ${escapeHtml(record.experiment.baseline.workflowId)} versus ${escapeHtml(record.experiment.candidate.policyId)} · ${record.experiment.cohort.caseCount} family-disjoint paired cases</small>`;
  if (record.kind === 'research_adjudication_evaluation') return `<p>Frozen adjudication rule ${escapeHtml(record.evaluation.assessment.conclusion)}</p><small>${record.evaluation.metricResults.map((metric) => `${escapeHtml(metric.metricId)} ${escapeHtml(metric.baselineValue)} to ${escapeHtml(metric.candidateValue)}`).join(' · ')}</small>`;
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
  const workOrders = active.filter((record) => record.kind === 'research_work_order');
  const acceptedWorkOrders = workOrders.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted');
  const workClaims = active.filter((record) => record.kind === 'research_work_claim');
  const outcomes = active.filter((record) => record.kind === 'research_outcome');
  const cohorts = active.filter((record) => record.kind === 'research_cohort');
  const evaluations = active.filter((record) => record.kind === 'research_evaluation');
  const adjudicationExperiments = active.filter((record) => record.kind === 'research_adjudication_experiment');
  const acceptedAdjudicationExperiments = adjudicationExperiments.filter((record) => reviewStates.get(record.recordHash)?.state === 'accepted');
  const adjudicationEvaluations = active.filter((record) => record.kind === 'research_adjudication_evaluation');
  const lifecycles = buildQuestionLifecycles(records);
  const submissionsByHash = new Map(submissions.map((record) => [record.recordHash, record]));
  const visible = searchEvidence(records, query);
  const tasks = proposeDiscoveryTasks(records);
  const actionRanking = rankProposedDiscoveryActions(records);
  const rankedTasks = actionRanking.rankedCandidates;
  const clusters = clusterCompatibleResults(records);
  const target = similarityTarget || results.at(-1)?.recordHash || '';
  const similar = target ? findSimilarSequences(records, target) : [];
  const rewards = projectResearchRewards(records);
  const reviewTargets = active.filter((record) => record.kind !== 'human_claim' || record.claim?.kind !== 'task_approval');
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
        <div><dt>Work orders</dt><dd>${workOrders.length}</dd></div>
        <div><dt>Outcomes</dt><dd>${outcomes.length}</dd></div>
        <div><dt>Frozen cohorts</dt><dd>${cohorts.length}</dd></div>
        <div><dt>Cohort evaluations</dt><dd>${evaluations.length}</dd></div>
        <div><dt>Adjudication experiments</dt><dd>${adjudicationExperiments.length}</dd></div>
        <div><dt>Adjudication evaluations</dt><dd>${adjudicationEvaluations.length}</dd></div>
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
          workOrders,
          acceptedWorkOrders,
          workClaims,
          outcomes,
          cohorts,
          adjudicationExperiments: acceptedAdjudicationExperiments,
          active
        })}
        ${renderDiscoveryPanel({ results, target, similar, clusters })}
        ${renderNextWorkPanel({ rankedTasks, actionRanking })}
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

const createLifecycleRecordFromForm = async (action, values, roomId, records) => {
  const researcher = createPoolIdentity(['evaluation', 'adjudication-evaluation'].includes(action) ? 'verifier' : 'researcher');
  const byHash = new Map(records.map((record) => [record.recordHash, record]));
  if (action === 'prior-evidence') {
    const question = byHash.get(values.get('questionHash'));
    if (question?.kind !== 'research_submission') throw new Error('Selected research question is unavailable');
    const evidenceKind = values.get('evidenceKind');
    const requiresAnnotationIdentity = ['annotation', 'domain'].includes(evidenceKind);
    return createSignedPriorEvidence({
      identity: researcher,
      roomId,
      questionHash: question.recordHash,
      evidenceKind,
      summary: values.get('summary'),
      reference: { uri: values.get('uri'), accession: values.get('accession'), version: values.get('version') },
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
      uncertainty: { method: 'contributor assessment', description: values.get('uncertainty') },
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
      blindness: { required: true, allocationHash: values.get('allocationHash') }
    });
  }
  if (action === 'work-claim') {
    return createSignedResearchWorkClaim({
      identity: researcher,
      roomId,
      workOrderHash: values.get('workOrderHash'),
      laboratory: {
        id: values.get('laboratoryId'),
        name: values.get('laboratoryName'),
        institution: values.get('institution')
      },
      capabilities: [values.get('capability')],
      consent: {
        publicLaboratoryIdentity: values.get('publicConsent') === 'on',
        publishOutcome: values.get('publicConsent') === 'on'
      }
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
      analysis: {
        methodId: values.get('analysisId'),
        version: values.get('analysisVersion'),
        artifactHash: values.get('analysisArtifactHash'),
        lineageHashes: replicationOfHash ? [replicationOfHash] : []
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
        toolsAndHandoffs: commaList(values.get('baselineTools'))
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
      evaluator: {
        authority: values.get('evaluatorAuthority'),
        identityRootId: values.get('evaluatorIdentityRootId'),
        methodId: values.get('evaluatorMethodId'),
        version: values.get('evaluatorVersion'),
        artifactHash: values.get('evaluatorArtifactHash'),
        blinded: values.get('evaluatorBlinded') === 'on'
      },
      metrics: ['quality', 'effort'].map((prefix) => ({
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
    return createSignedAdjudicationEvaluation({
      identity: researcher,
      roomId,
      experiment,
      resultManifest: {
        accession: values.get('resultManifestAccession'),
        version: values.get('resultManifestVersion'),
        contentHash: values.get('resultManifestHash')
      },
      metricResults: [{
        metricId: policy.qualityMetricId,
        baselineValue: values.get('qualityBaselineValue'),
        candidateValue: values.get('qualityCandidateValue'),
        effectInterval: { lower: values.get('qualityEffectLower'), upper: values.get('qualityEffectUpper') },
        pairedSampleCount: values.get('pairedSampleCount')
      }, {
        metricId: policy.effortMetricId,
        baselineValue: values.get('effortBaselineValue'),
        candidateValue: values.get('effortCandidateValue'),
        effectInterval: { lower: values.get('effortEffectLower'), upper: values.get('effortEffectUpper') },
        pairedSampleCount: values.get('pairedSampleCount')
      }],
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
  return createSignedPriorEvidence({
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
    transformations: [{
      id: 'reploid.cross-room-evidence-reference',
      version: '1',
      description: 'References the exact signed origin-room record without inheriting its decision status.'
    }],
    uncertainty: sourceRecord.evidence?.uncertainty || {},
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
    hydrateCrossRoom = hydrateCrossRoomSequenceEvidence
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
  const result = { ...hydrated, crossRoomEvidence };
  if (sync && !document.body.contains(sync)) return result;
  return result;
}

export default { renderResearchWorkspace, bindResearchWorkspace, bindResearchRoomActions, hydrateAndBindResearchWorkspace };
