/**
 * @fileoverview Evidence-network rendering and human review controls for Poolday.
 */

import { createPoolIdentity } from '../../pool/identity.js';
import {
  activeResearchRecords,
  buildEvidenceGraph,
  buildQuestionLifecycles,
  clusterCompatibleResults,
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
  searchEvidence
} from '../../pool/evidence-network.js';
import {
  hydrateResearchRecords,
  loadResearchRecords,
  publishResearchRecord
} from './research-store.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');
const compactHash = (value) => {
  const text = String(value || '');
  return text.length > 22 ? `${text.slice(0, 13)}…${text.slice(-6)}` : text || 'none';
};
const recordLabel = (record = {}) => {
  if (record.kind === 'research_submission') return record.requesterIntent?.label || record.requesterIntent?.text || record.sequence?.hash;
  if (record.kind === 'research_result') return `${record.modelContract?.id || 'model result'} · ${compactHash(record.compute?.receiptHash)}`;
  return record.claim?.text
    || record.hypothesis?.statement
    || record.evidence?.summary
    || record.prediction?.expectedObservation
    || record.work?.title
    || record.workClaim?.laboratory?.name
    || record.outcome?.summary
    || record.cohort?.label
    || record.evaluation?.metricResults?.map((metric) => metric.metricId).join(', ')
    || record.revocation?.reason
    || record.recordHash;
};

const optionList = (records, { empty = 'No eligible records' } = {}) => records.length
  ? records.map((record) => `<option value="${escapeHtml(record.recordHash)}">${escapeHtml(recordLabel(record))}</option>`).join('')
  : `<option value="" disabled>${escapeHtml(empty)}</option>`;

const lifecycleRecordSummary = (record = {}) => {
  if (record.kind === 'research_hypothesis') return `<p>${escapeHtml(record.hypothesis.statement)}</p><small>Conditions: ${escapeHtml(JSON.stringify(record.hypothesis.conditions))} · discriminators: ${escapeHtml(record.hypothesis.discriminatingObservations.join(' · '))}</small>`;
  if (record.kind === 'research_prior_evidence') return `<p>${escapeHtml(record.evidence.kind)} · ${escapeHtml(record.evidence.summary)}</p><small>${escapeHtml(record.evidence.reference.accession || record.evidence.reference.uri)} @ ${escapeHtml(record.evidence.reference.version || compactHash(record.evidence.reference.contentHash))} · retrieved ${escapeHtml(record.evidence.provenance.retrievedAt)}</small>`;
  if (record.kind === 'research_prediction') return `<p>${escapeHtml(record.prediction.normalizedLabel)} · confidence ${Math.round(record.prediction.confidence * 100)}%</p><small>${escapeHtml(record.prediction.method.methodId)} @ ${escapeHtml(record.prediction.method.version)} · frozen ${escapeHtml(record.prediction.frozenAt)} · ${escapeHtml(record.prediction.outcomeAccess)}</small>`;
  if (record.kind === 'research_work_order') return `<p>${escapeHtml(record.work.kind)} · ${record.work.replicaTarget} planned replica${record.work.replicaTarget === 1 ? '' : 's'}</p><small>Protocol ${escapeHtml(record.work.protocol.protocolId)} @ ${escapeHtml(record.work.protocol.version)} · ${escapeHtml(compactHash(record.work.protocol.protocolHash))} · proposed until independently reviewed</small>`;
  if (record.kind === 'research_work_claim') return `<p>${escapeHtml(record.workClaim.laboratory.name)} claimed ${escapeHtml(compactHash(record.workOrderHash))}</p><small>${escapeHtml(record.workClaim.capabilities.join(' · '))} · public outcome consent recorded</small>`;
  if (record.kind === 'research_outcome') return `<p>${escapeHtml(record.outcome.classification)} · ${escapeHtml(record.outcome.attempt.status)}${record.outcome.attempt.failureCategory !== 'none' ? ` · ${escapeHtml(record.outcome.attempt.failureCategory)}` : ''}</p><small>${record.replicationOfHash ? `Independent replication of ${escapeHtml(compactHash(record.replicationOfHash))} · ` : ''}${escapeHtml(record.outcome.blind.state)} · analysis ${escapeHtml(compactHash(record.outcome.analysis.analysisHash))}</small>`;
  if (record.kind === 'research_cohort') return `<p>${record.cohort.predictionHashes.length} frozen predictions · ${record.cohort.workOrderHashes.length} work orders</p><small>${escapeHtml(record.cohort.frozenAt)} · ${record.cohort.blindingRequired ? 'blinding required' : 'blinding not required'}</small>`;
  if (record.kind === 'research_evaluation') return `<p>${record.evaluation.metricResults.map((metric) => `${escapeHtml(metric.metricId)} ${metric.improved ? 'improved' : 'did not improve'} (${escapeHtml(metric.baselineValue)} to ${escapeHtml(metric.currentValue)})`).join(' · ')}</p><small>${record.evaluation.outcomeHashes.length} independently accepted outcomes · next cohort ${record.evaluation.nextCohortQuestionHashes.length ? 'bound' : 'not bound'}</small>`;
  if (record.kind === 'research_revocation') return `<p>Future reuse revoked: ${escapeHtml(record.revocation.reason)}</p><small>Target ${escapeHtml(compactHash(record.targetHash))} remains in immutable history.</small>`;
  return '';
};

const renderRecord = (record, { invalidated = new Set(), reviewStates = new Map() } = {}) => `
  <article class="pool-research-record" data-research-kind="${escapeHtml(record.kind)}"${invalidated.has(record.recordHash) ? ' data-research-invalidated="true"' : ''}>
    <div><span>${escapeHtml(record.kind.replace(/_/g, ' '))}</span><b>${escapeHtml(recordLabel(record))}</b></div>
    <small>${escapeHtml(record.author?.roleId || 'unknown author')} · ${escapeHtml(compactHash(record.recordHash))} · ${escapeHtml(invalidated.has(record.recordHash) ? 'revoked or downstream-invalidated' : reviewStates.get(record.recordHash)?.state || 'unresolved')}</small>
    ${record.kind === 'research_submission' ? `<code>${escapeHtml(record.sequence?.value || '')}</code>` : ''}
    ${record.kind === 'research_result' ? `<p>Derived from ${escapeHtml(compactHash(record.submissionHash))} · provider ${escapeHtml(record.compute?.providerId || 'unknown')} · receipt ${escapeHtml(compactHash(record.compute?.receiptHash))}</p><details><summary>Exact compute provenance</summary><small>Model ${escapeHtml(record.modelContract?.id || 'unknown')} · model hash ${escapeHtml(record.modelContract?.hash || 'unknown')} · manifest ${escapeHtml(record.modelContract?.manifestHash || 'unknown')} · ${escapeHtml(record.modelContract?.runtime || 'unknown runtime')} / ${escapeHtml(record.modelContract?.backend || 'unknown backend')} · route ${escapeHtml(record.compute?.routeDecisionHash || 'none')} · runtime profile ${escapeHtml(record.compute?.runtimeProfileHash || 'none')} · assignment ${escapeHtml(record.compute?.assignmentId || 'none')}</small></details>` : ''}
    ${record.kind === 'human_claim' ? `<p><strong>${escapeHtml(record.claim?.relation || '')}</strong> ${escapeHtml(compactHash(record.targetHash))} · confidence ${escapeHtml(Math.round(Number(record.claim?.confidence || 0) * 100))}%${record.claim?.decision ? ` · ${escapeHtml(record.claim.decision)}` : ''}</p>${record.claim?.evidenceLinks?.length ? `<div>${record.claim.evidenceLinks.map((link) => `<a href="${escapeHtml(link.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(link.label || link.url)}</a>`).join(' · ')}</div>` : ''}` : ''}
    ${lifecycleRecordSummary(record)}
  </article>
`;

const renderLifecycleForms = ({
  questions,
  priorEvidence,
  hypotheses,
  predictions,
  workOrders,
  acceptedWorkOrders,
  workClaims,
  outcomes,
  cohorts,
  active
}) => `
  <section class="pool-research-panel pool-research-lifecycle-actions">
    <p class="pool-dashboard-kicker">Frame</p>
    <h3 class="type-h3">Competing hypotheses and prior evidence</h3>
    <details><summary>Add versioned prior evidence</summary>
      <form data-research-lifecycle-form data-research-action="prior-evidence">
        <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Evidence kind</span><select name="evidenceKind"><option value="sequence">Sequence</option><option value="structure">Structure</option><option value="domain">Domain</option><option value="annotation">Annotation</option><option value="experiment">Experiment</option><option value="publication">Publication</option></select></label>
          <label class="pool-field"><span>Accession</span><input name="accession" required placeholder="UniProt or public record identity"></label>
          <label class="pool-field"><span>Version</span><input name="version" required placeholder="record version"></label>
        </div>
        <label class="pool-field"><span>Public source URI</span><input name="uri" type="url" placeholder="https://"></label>
        <label class="pool-field"><span>Evidence summary</span><textarea name="summary" rows="3" required></textarea></label>
        <label class="pool-field"><span>Condition-specific context</span><input name="conditions" placeholder="organism, partners, ligands, modification, environment, or time"></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Retrieval method</span><input name="retrievalMethod" required placeholder="version-pinned API or archive retrieval"></label>
          <label class="pool-field"><span>Uncertainty</span><input name="uncertainty" placeholder="limitations or confidence basis"></label>
        </div>
        <button class="btn btn-primary" type="submit"${questions.length ? '' : ' disabled'}>Sign prior evidence</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Add a competing condition-specific hypothesis</summary>
      <form data-research-lifecycle-form data-research-action="hypothesis">
        <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
        <label class="pool-field"><span>Hypothesis</span><textarea name="statement" rows="3" required></textarea></label>
        <label class="pool-field"><span>Declared conditions</span><input name="conditions" required placeholder="partners, ligands, background, environment, and time"></label>
        <label class="pool-field"><span>Discriminating observation</span><input name="discriminator" required placeholder="observation that distinguishes this hypothesis"></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Prior evidence</span><select name="priorEvidenceHash"><option value="">None linked yet</option>${optionList(priorEvidence)}</select></label>
          <label class="pool-field"><span>Competes with</span><select name="alternativeToHash"><option value="">First hypothesis</option>${optionList(hypotheses)}</select></label>
        </div>
        <button class="btn btn-primary" type="submit"${questions.length ? '' : ' disabled'}>Sign hypothesis</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Freeze a computational prediction</summary>
      <form data-research-lifecycle-form data-research-action="prediction">
        <label class="pool-field"><span>Hypothesis</span><select name="hypothesisHash" required>${optionList(hypotheses)}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Method id</span><input name="methodId" required></label>
          <label class="pool-field"><span>Method version</span><input name="methodVersion" required></label>
          <label class="pool-field"><span>Exact artifact hash</span><input name="artifactHash" required placeholder="sha256:..."></label>
        </div>
        <label class="pool-field"><span>Predicted observation</span><textarea name="expectedObservation" rows="2" required></textarea></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Normalized label</span><input name="normalizedLabel" required></label>
          <label class="pool-field"><span>Conditions</span><input name="conditions" required></label>
          <label class="pool-field"><span>Confidence</span><input name="confidence" type="number" min="0" max="1" step="0.01" value="0.5" required></label>
        </div>
        <button class="btn btn-primary" type="submit"${hypotheses.length ? '' : ' disabled'}>Sign and freeze prediction</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Order</p>
    <h3 class="type-h3">Machine-verifiable assay work</h3>
    <details><summary>Propose a discriminating work order</summary>
      <form data-research-lifecycle-form data-research-action="work-order">
        <label class="pool-field"><span>Competing hypotheses</span><select name="hypothesisHashes" multiple size="4" required>${optionList(hypotheses)}</select></label>
        <label class="pool-field"><span>Work order title</span><input name="title" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Protocol id</span><input name="protocolId" required></label>
          <label class="pool-field"><span>Version</span><input name="protocolVersion" required></label>
          <label class="pool-field"><span>Assay type</span><input name="assayType" required></label>
        </div>
        <label class="pool-field"><span>Executable public protocol URI</span><input name="executableUri" type="url" placeholder="https://"></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Reference accession</span><input name="referenceAccession" required></label>
          <label class="pool-field"><span>Reference version</span><input name="referenceVersion" required></label>
          <label class="pool-field"><span>Planned replicas</span><input name="replicaTarget" type="number" min="1" max="100" value="2" required></label>
        </div>
        <label class="pool-field"><span>Exact conditions</span><input name="conditions" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Controls, comma separated</span><input name="controls" required></label>
          <label class="pool-field"><span>Readouts, comma separated</span><input name="readouts" required></label>
        </div>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Normalization method</span><input name="normalizationMethod" required></label>
          <label class="pool-field"><span>Normalization version</span><input name="normalizationVersion" required></label>
        </div>
        <label class="pool-field"><span>Uncertainty plan</span><textarea name="uncertaintyPlan" rows="2" required></textarea></label>
        <label class="pool-field"><span>Acceptance criteria</span><textarea name="acceptanceCriteria" rows="2" required></textarea></label>
        <label class="pool-field"><span>Blinded allocation commitment</span><input name="allocationHash" required placeholder="sha256:..."></label>
        <button class="btn btn-primary" type="submit"${hypotheses.length >= 2 ? '' : ' disabled'}>Sign proposed work order</button>
        <p class="type-caption">An independent expert must accept the signed order before a laboratory can claim it.</p>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Claim accepted laboratory work</summary>
      <form data-research-lifecycle-form data-research-action="work-claim">
        <label class="pool-field"><span>Accepted work order</span><select name="workOrderHash" required>${optionList(acceptedWorkOrders, { empty: 'No independently accepted work orders' })}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Laboratory id</span><input name="laboratoryId" required></label>
          <label class="pool-field"><span>Laboratory name</span><input name="laboratoryName" required></label>
          <label class="pool-field"><span>Institution</span><input name="institution"></label>
        </div>
        <label class="pool-field"><span>Declared capability</span><input name="capability" required></label>
        <label class="pool-consent-row"><input name="publicConsent" type="checkbox" required>Publish laboratory attribution and all positive, negative, ambiguous, or failed outcomes.</label>
        <button class="btn btn-primary" type="submit"${acceptedWorkOrders.length ? '' : ' disabled'}>Sign laboratory claim</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Observe</p>
    <h3 class="type-h3">Blinded outcomes and independent replicas</h3>
    <form data-research-lifecycle-form data-research-action="outcome">
      <label class="pool-field"><span>Laboratory work claim</span><select name="workClaimHash" required>${optionList(workClaims)}</select></label>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Outcome</span><select name="classification"><option value="positive">Positive</option><option value="negative">Negative</option><option value="ambiguous">Ambiguous</option></select></label>
        <label class="pool-field"><span>Attempt status</span><select name="attemptStatus"><option value="completed">Completed</option><option value="failed">Failed</option></select></label>
        <label class="pool-field"><span>Failure category</span><select name="failureCategory"><option value="none">None</option><option value="expression_failure">Expression failure</option><option value="folding_failure">Folding failure</option><option value="solubility_failure">Solubility failure</option><option value="binding_failure">Binding failure</option><option value="selectivity_failure">Selectivity failure</option><option value="environment_failure">Environment failure</option><option value="protocol_failure">Protocol failure</option><option value="analysis_failure">Analysis failure</option><option value="inconclusive">Inconclusive</option></select></label>
      </div>
      <label class="pool-field"><span>Outcome summary</span><textarea name="summary" rows="3" required></textarea></label>
      <label class="pool-field"><span>Failure detail, if any</span><input name="failureDetail"></label>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Readout</span><input name="readout" required></label>
        <label class="pool-field"><span>Raw value</span><input name="value" type="number" step="any" required></label>
        <label class="pool-field"><span>Normalized value</span><input name="normalizedValue" type="number" step="any" required></label>
        <label class="pool-field"><span>Unit</span><input name="unit" required></label>
        <label class="pool-field"><span>Uncertainty</span><input name="uncertaintyValue" type="number" step="any" min="0" required></label>
      </div>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Analysis id</span><input name="analysisId" required></label>
        <label class="pool-field"><span>Analysis version</span><input name="analysisVersion" required></label>
        <label class="pool-field"><span>Analysis artifact hash</span><input name="analysisArtifactHash" required placeholder="sha256:..."></label>
      </div>
      <div class="pool-research-form-row">
        <label class="pool-field"><span>Blind code commitment</span><input name="codeHash" required placeholder="sha256:..."></label>
        <label class="pool-field"><span>Replication of</span><select name="replicationOfHash"><option value="">Original outcome</option>${optionList(outcomes)}</select></label>
      </div>
      <button class="btn btn-primary" type="submit"${workClaims.length ? '' : ' disabled'}>Sign outcome record</button>
      <p class="type-caption">Every attempt uses the same schema. Failures remain evidence and are never discarded.</p>
      <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
    </form>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Measure</p>
    <h3 class="type-h3">Frozen prospective cohorts</h3>
    <details><summary>Freeze a cohort before outcomes arrive</summary>
      <form data-research-lifecycle-form data-research-action="cohort">
        <label class="pool-field"><span>Question</span><select name="questionHash" required>${optionList(questions)}</select></label>
        <label class="pool-field"><span>Cohort label</span><input name="label" required></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Metric id</span><input name="metricId" required></label>
          <label class="pool-field"><span>Metric label</span><input name="metricLabel" required></label>
          <label class="pool-field"><span>Direction</span><select name="direction"><option value="higher_is_better">Higher is better</option><option value="lower_is_better">Lower is better</option></select></label>
          <label class="pool-field"><span>Unit</span><input name="unit"></label>
        </div>
        <button class="btn btn-primary" type="submit"${predictions.length && workOrders.length ? '' : ' disabled'}>Sign and freeze cohort</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
    <details><summary>Evaluate independently accepted outcomes</summary>
      <form data-research-lifecycle-form data-research-action="evaluation">
        <label class="pool-field"><span>Frozen cohort</span><select name="cohortHash" required>${optionList(cohorts)}</select></label>
        <div class="pool-research-form-row">
          <label class="pool-field"><span>Baseline value</span><input name="baselineValue" type="number" step="any" required></label>
          <label class="pool-field"><span>Current value</span><input name="currentValue" type="number" step="any" required></label>
        </div>
        <label class="pool-field"><span>Disagreement summary</span><textarea name="disagreementSummary" rows="2" required></textarea></label>
        <label class="pool-field"><span>Failure analysis</span><textarea name="failureAnalysis" rows="2" required></textarea></label>
        <label class="pool-consent-row"><input name="bindNextCohort" type="checkbox" checked>Bind the measured effect to the same question in the next cohort.</label>
        <button class="btn btn-primary" type="submit"${cohorts.length ? '' : ' disabled'}>Sign measured evaluation</button>
        <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
      </form>
    </details>
  </section>
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Consent</p>
    <h3 class="type-h3">Append-only revocation</h3>
    <form data-research-lifecycle-form data-research-action="revocation">
      <label class="pool-field"><span>Record</span><select name="targetHash" required>${optionList(active)}</select></label>
      <label class="pool-field"><span>Reason</span><textarea name="reason" rows="2" required></textarea></label>
      <button class="btn btn-ghost" type="submit"${active.length ? '' : ' disabled'}>Revoke future reuse</button>
      <p class="type-caption">Only the original identity root can revoke a record. History remains inspectable and dependent projections stop using it.</p>
      <p class="type-caption" data-research-lifecycle-status aria-live="polite"></p>
    </form>
  </section>
`;

export function renderResearchWorkspace(roomId, records = loadResearchRecords(roomId), { query = '', similarityTarget = '' } = {}) {
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
  const lifecycles = buildQuestionLifecycles(records);
  const visible = searchEvidence(records, query);
  const tasks = proposeDiscoveryTasks(records);
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
        <span class="pool-research-sync" data-pool-research-sync>Local evidence loaded</span>
      </header>
      <dl class="pool-research-stats">
        <div><dt>Submissions</dt><dd>${submissions.length}</dd></div>
        <div><dt>Hypotheses</dt><dd>${hypotheses.length}</dd></div>
        <div><dt>Predictions</dt><dd>${predictions.length}</dd></div>
        <div><dt>Work orders</dt><dd>${workOrders.length}</dd></div>
        <div><dt>Outcomes</dt><dd>${outcomes.length}</dd></div>
        <div><dt>Frozen cohorts</dt><dd>${cohorts.length}</dd></div>
        <div><dt>Evaluations</dt><dd>${evaluations.length}</dd></div>
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
            ${visible.length ? visible.map((record) => renderRecord(record, { invalidated, reviewStates })).join('') : '<p class="type-caption">No matching signed evidence yet.</p>'}
          </div>
        </section>
        <section class="pool-research-panel">
          <p class="pool-dashboard-kicker">Review</p>
          <h3 class="type-h3">Add a signed human claim</h3>
          <form data-research-review-form>
            <label class="pool-field"><span>Evidence to review</span><select name="targetHash" required>${reviewTargets.map((record) => `<option value="${escapeHtml(record.recordHash)}">${escapeHtml(recordLabel(record))}</option>`).join('')}</select></label>
            <div class="pool-research-form-row">
              <label class="pool-field"><span>Claim type</span><select name="claimKind"><option value="annotation">Annotation</option><option value="evidence_link">Evidence link</option><option value="correction">Correction</option><option value="experiment_context">Experiment context</option><option value="follow_up">Follow-up task</option><option value="review_decision">Review decision</option></select></label>
              <label class="pool-field"><span>Relationship</span><select name="relation"><option value="supports">Supports</option><option value="contradicts">Contradicts</option><option value="corrects">Corrects</option><option value="reviews">Reviews</option><option value="proposes">Proposes</option></select></label>
            </div>
            <label class="pool-field"><span>Claim</span><textarea name="text" rows="4" required placeholder="State the observation, evidence, correction, context, or bounded follow-up."></textarea></label>
            <div class="pool-research-form-row">
              <label class="pool-field"><span>Confidence</span><input name="confidence" type="number" min="0" max="1" step="0.05" value="0.75" required></label>
              <label class="pool-field"><span>Evidence URL</span><input name="evidenceUrl" type="url" placeholder="https://"></label>
              <label class="pool-field"><span>Decision, if reviewing</span><select name="decision"><option value="">Not a decision</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="needs_revision">Needs revision</option></select></label>
            </div>
            <button class="btn btn-primary" type="submit"${reviewTargets.length ? '' : ' disabled'}>Sign and attach claim</button>
            <p class="type-caption" data-research-review-status aria-live="polite"></p>
          </form>
        </section>
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
          active
        })}
        <section class="pool-research-panel">
          <p class="pool-dashboard-kicker">Discover</p>
          <h3 class="type-h3">Compatible sequence similarity</h3>
          <label class="pool-field"><span>Receipt-backed embedding</span><select data-research-similarity-target>${results.map((record) => `<option value="${escapeHtml(record.recordHash)}"${record.recordHash === target ? ' selected' : ''}>${escapeHtml(recordLabel(record))}</option>`).join('')}</select></label>
          <div class="pool-research-similar">
            ${similar.length ? similar.map((entry) => `<article><b>${escapeHtml(recordLabel(entry.record))}</b><span>${(entry.similarity * 100).toFixed(2)}% similar · ${entry.supportingAnnotations.length} accepted annotations</span><small>Model ${escapeHtml(entry.record.modelContract.id)} · receipt ${escapeHtml(compactHash(entry.record.compute.receiptHash))}</small></article>`).join('') : '<p class="type-caption">No other exact-contract compatible embeddings are available.</p>'}
          </div>
          <details class="pool-advanced"><summary>${clusters.length} deterministic similarity clusters</summary><div class="pool-research-similar">${clusters.map((cluster) => `<article><b>${escapeHtml(cluster.clusterId)}</b><span>${cluster.members.length} exact-contract compatible result${cluster.members.length === 1 ? '' : 's'}</span><small>${cluster.members.map((record) => escapeHtml(compactHash(record.recordHash))).join(' · ')}</small></article>`).join('') || '<p class="type-caption">No published embeddings to cluster.</p>'}</div></details>
          <p class="type-caption">Reranking uses compatible cosine similarity plus independently accepted evidence. Raw vectors are never presented as biological meaning.</p>
        </section>
        <section class="pool-research-panel">
          <p class="pool-dashboard-kicker">Next work</p>
          <h3 class="type-h3">Approval-gated discovery queue</h3>
          <div class="pool-research-tasks">
            ${tasks.length ? tasks.map((task) => `<article><div><b>${escapeHtml(task.kind.replace(/_/g, ' '))}</b><span>${escapeHtml(task.reason)}</span></div>${task.status === 'approved' ? '<strong>Approved</strong>' : `<button class="btn btn-ghost" type="button" data-research-approve-task="${escapeHtml(task.taskId)}" data-research-task-target="${escapeHtml(task.targetHash)}">Approve</button>`}</article>`).join('') : '<p class="type-caption">No bounded follow-up is currently proposed.</p>'}
          </div>
        </section>
        <section class="pool-research-panel">
          <p class="pool-dashboard-kicker">Participation quality</p>
          <h3 class="type-h3">Verified and durable contributions</h3>
          <div class="pool-research-rewards">
            ${rewards.length ? rewards.map((reward) => `<article><b>${escapeHtml(reward.authorId)}</b><span>${reward.points} points · ${reward.verifiedCompute} verified compute · ${reward.acceptedEvidence} accepted evidence · ${reward.acceptedReviews} accepted reviews · ${Math.round(reward.quality * 100)}% durable</span></article>`).join('') : '<p class="type-caption">Credit appears after verified compute or independently accepted evidence.</p>'}
          </div>
          <p class="type-caption">Activity alone earns no evidence credit. Later corrections and contradictions reduce durability.</p>
        </section>
      </div>
    </section>
  `;
}

const replaceWorkspace = (workspace, options = {}) => {
  const roomId = workspace.dataset.roomId;
  const parent = workspace.parentElement;
  if (!parent) return;
  parent.innerHTML = renderResearchWorkspace(roomId, loadResearchRecords(roomId), options);
  bindResearchWorkspace(parent.querySelector('[data-pool-research-workspace]'));
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
  const researcher = createPoolIdentity(action === 'evaluation' ? 'verifier' : 'researcher');
  const byHash = new Map(records.map((record) => [record.recordHash, record]));
  if (action === 'prior-evidence') {
    return createSignedPriorEvidence({
      identity: researcher,
      roomId,
      questionHash: values.get('questionHash'),
      evidenceKind: values.get('evidenceKind'),
      summary: values.get('summary'),
      reference: { uri: values.get('uri'), accession: values.get('accession'), version: values.get('version') },
      conditions: { notes: values.get('conditions') },
      uncertainty: { method: 'contributor assessment', description: values.get('uncertainty') },
      provenance: { retrievalMethod: values.get('retrievalMethod'), retrievedAt: new Date().toISOString() }
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

export function bindResearchWorkspace(workspace = document.querySelector('[data-pool-research-workspace]')) {
  if (!workspace || workspace.dataset.researchBound === 'true') return;
  workspace.dataset.researchBound = 'true';
  const roomId = workspace.dataset.roomId;
  workspace.querySelector('[data-research-search]')?.addEventListener('input', (event) => {
    const allRecords = loadResearchRecords(roomId);
    const records = searchEvidence(allRecords, event.target.value);
    const invalidated = invalidatedResearchHashes(allRecords);
    const reviewStates = new Map(projectResearchReviewStates(allRecords).map((entry) => [entry.recordHash, entry]));
    const target = workspace.querySelector('[data-research-records]');
    if (target) target.innerHTML = records.length
      ? records.map((record) => renderRecord(record, { invalidated, reviewStates })).join('')
      : '<p class="type-caption">No matching signed evidence yet.</p>';
  });
  workspace.querySelector('[data-research-similarity-target]')?.addEventListener('change', (event) => {
    replaceWorkspace(workspace, { similarityTarget: event.target.value });
  });
  workspace.querySelector('[data-research-review-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = form.querySelector('[data-research-review-status]');
    const values = new FormData(form);
    if (status) status.textContent = 'Signing claim…';
    try {
      const claimKind = values.get('claimKind');
      const record = await createSignedHumanClaim({
        identity: createPoolIdentity('reviewer'),
        roomId,
        targetHash: values.get('targetHash'),
        claimKind,
        relation: claimKind === 'review_decision' ? 'reviews' : values.get('relation'),
        text: values.get('text'),
        confidence: values.get('confidence'),
        evidenceLinks: values.get('evidenceUrl') ? [values.get('evidenceUrl')] : [],
        decision: claimKind === 'review_decision' ? values.get('decision') : null
      });
      const publication = await publishResearchRecord(record, { roomId });
      replaceWorkspace(workspace);
      const nextStatus = document.querySelector('[data-research-review-status]');
      if (nextStatus) nextStatus.textContent = publication.remote ? 'Signed claim published.' : 'Signed claim saved locally; coordinator sync is pending.';
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  });
  workspace.querySelectorAll('[data-research-approve-task]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        const record = await createSignedHumanClaim({
          identity: createPoolIdentity('reviewer'),
          roomId,
          targetHash: button.dataset.researchTaskTarget,
          claimKind: 'task_approval',
          relation: 'approves',
          text: `Approved bounded discovery task: ${button.dataset.researchApproveTask}`,
          confidence: 1,
          decision: 'approved',
          taskId: button.dataset.researchApproveTask
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

export async function hydrateAndBindResearchWorkspace(workspace = document.querySelector('[data-pool-research-workspace]')) {
  if (!workspace) return;
  const roomId = workspace.dataset.roomId;
  const sync = workspace.querySelector('[data-pool-research-sync]');
  const hydrated = await hydrateResearchRecords(roomId);
  if (document.body.contains(workspace)) replaceWorkspace(workspace);
  const current = document.querySelector('[data-pool-research-sync]');
  if (current) current.textContent = hydrated.remote ? 'Coordinator evidence synchronized' : 'Local evidence loaded; coordinator sync unavailable';
  if (sync && !document.body.contains(sync)) return;
}

export default { renderResearchWorkspace, bindResearchWorkspace, hydrateAndBindResearchWorkspace };
