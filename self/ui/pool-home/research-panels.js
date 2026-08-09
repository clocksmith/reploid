/**
 * @fileoverview Reusable Research Room evidence, review, discovery, and quality panels.
 *
 * These functions only render already-projected records. Signing, persistence,
 * hydration, and review state remain owned by research-view.js and the evidence
 * network.
 */

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

export const compactHash = (value) => {
  const text = String(value || '');
  return text.length > 22 ? `${text.slice(0, 13)}…${text.slice(-6)}` : text || 'none';
};

export const recordLabel = (record = {}) => {
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

export const optionList = (records, { empty = 'No eligible records' } = {}) => records.length
  ? records.map((record) => `<option value="${escapeHtml(record.recordHash)}">${escapeHtml(recordLabel(record))}</option>`).join('')
  : `<option value="" disabled>${escapeHtml(empty)}</option>`;

const renderModelEvidenceView = (view, submissionsByHash) => {
  const question = submissionsByHash.get(view.submissionHash);
  const sourceRows = view.modelSources.length
    ? view.modelSources.map((source) => `
      <article>
        <b>${escapeHtml(source.model.id || 'Unknown exact model')}</b>
        <span>${escapeHtml(source.resultHashes.length)} signed result${source.resultHashes.length === 1 ? '' : 's'} · ${escapeHtml(source.receiptHashes.length)} receipt${source.receiptHashes.length === 1 ? '' : 's'} · ${escapeHtml(source.providerIds.length)} provider${source.providerIds.length === 1 ? '' : 's'}</span>
        <small>Model ${escapeHtml(compactHash(source.model.hash))} · manifest ${escapeHtml(compactHash(source.model.manifestHash))} · tokenizer ${escapeHtml(compactHash(source.model.tokenizerHash))} · ${escapeHtml(source.model.runtime || 'unknown runtime')} / ${escapeHtml(source.model.backend || 'unknown backend')}</small>
        <small>${source.maskedResidueProposalCount > 0
          ? `${source.maskedResidueProposalCount} bounded masked-residue proposal${source.maskedResidueProposalCount === 1 ? '' : 's'} at sequence positions ${escapeHtml(source.residuePositions.join(', ') || 'not residue-mapped')}`
          : source.residueEmbeddingCount > 0
            ? `${source.residueEmbeddingCount} bounded residue embedding${source.residueEmbeddingCount === 1 ? '' : 's'} at sequence positions ${escapeHtml(source.residuePositions.join(', ') || 'not residue-mapped')}`
            : 'Model-specific embedding evidence only; no bounded residue evidence was published.'}</small>
        <small>${escapeHtml(source.claimBoundaries.join(' '))}</small>
      </article>
    `).join('')
    : '<p class="type-caption">No receipt-backed model output is linked yet.</p>';
  return `
    <article class="pool-research-model-evidence">
      <div>
        <b>${escapeHtml(question ? recordLabel(question) : compactHash(view.submissionHash))}</b>
        <span>${escapeHtml(view.modelSources.length)} isolated exact-model source${view.modelSources.length === 1 ? '' : 's'}</span>
      </div>
      <div class="pool-research-similar">${sourceRows}</div>
      <p><strong>Agreement:</strong> ${escapeHtml(view.agreement.detail)}</p>
      <p><strong>Disagreement:</strong> ${escapeHtml(view.disagreement.detail)}</p>
      ${view.sharedResiduePositions.length ? `<small>Shared protein residue coordinates: ${escapeHtml(view.sharedResiduePositions.map((position) => `${position.sequenceIndex} (${position.sourceCount} sources)`).join(', '))}. Coordinates are shared identities, not a comparison of vectors or tokenizer-local logits.</small>` : ''}
      <details><summary>Uncertainty and proposed next action</summary>
        <ul>${view.uncertainty.map((entry) => `<li>${escapeHtml(entry.detail)}</li>`).join('')}</ul>
        <p><strong>${escapeHtml(view.nextAction.kind.replace(/_/g, ' '))}:</strong> ${escapeHtml(view.nextAction.reason)}</p>
      </details>
    </article>
  `;
};

export const renderResultEvidencePanel = ({ lifecycles = [], submissionsByHash = new Map() } = {}) => `
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Model evidence</p>
    <h3 class="type-h3">Exact-model evidence, not vector averaging</h3>
    <div class="pool-research-similar">
      ${lifecycles.length ? lifecycles.map((lifecycle) => renderModelEvidenceView(lifecycle.modelEvidence, submissionsByHash)).join('') : '<p class="type-caption">Submit a public protein sequence and bounded question to start an inspectable model-evidence record.</p>'}
    </div>
    <p class="type-caption">Only shared sequence and residue identities join model records. Model vectors and tokenizer-local logits remain isolated by exact contract.</p>
  </section>
`;

export const renderReviewPanel = ({ reviewTargets = [] } = {}) => `
  <section class="pool-research-panel" id="pool-room-review" data-pool-room-panel-target="review">
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
`;

export const renderDiscoveryPanel = ({ results = [], target = '', similar = [], clusters = [] } = {}) => `
  <section class="pool-research-panel" id="pool-room-discovery" data-pool-room-panel-target="discovery">
    <p class="pool-dashboard-kicker">Discover</p>
    <h3 class="type-h3">Compatible sequence similarity</h3>
    <label class="pool-field"><span>Receipt-backed embedding</span><select data-research-similarity-target>${results.map((record) => `<option value="${escapeHtml(record.recordHash)}"${record.recordHash === target ? ' selected' : ''}>${escapeHtml(recordLabel(record))}</option>`).join('')}</select></label>
    <div class="pool-research-similar">
      ${similar.length ? similar.map((entry) => `<article><b>${escapeHtml(recordLabel(entry.record))}</b><span>${(entry.similarity * 100).toFixed(2)}% similar · ${entry.supportingAnnotations.length} accepted annotations</span><small>Model ${escapeHtml(entry.record.modelContract.id)} · receipt ${escapeHtml(compactHash(entry.record.compute.receiptHash))}</small></article>`).join('') : '<p class="type-caption">No other exact-contract compatible embeddings are available.</p>'}
    </div>
    <details class="pool-advanced"><summary>${clusters.length} deterministic similarity clusters</summary><div class="pool-research-similar">${clusters.map((cluster) => `<article><b>${escapeHtml(cluster.clusterId)}</b><span>${cluster.members.length} exact-contract compatible result${cluster.members.length === 1 ? '' : 's'}</span><small>${cluster.members.map((record) => escapeHtml(compactHash(record.recordHash))).join(' · ')}</small></article>`).join('') || '<p class="type-caption">No published embeddings to cluster.</p>'}</div></details>
    <p class="type-caption">Reranking uses compatible cosine similarity plus independently accepted evidence. Raw vectors are never presented as biological meaning.</p>
  </section>
`;

export const renderNextWorkPanel = ({ rankedTasks = [], actionRanking = { policy: { policyId: 'unknown' } } } = {}) => `
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Next work</p>
    <h3 class="type-h3">Approval-gated discovery queue</h3>
    <div class="pool-research-tasks">
      ${rankedTasks.length ? rankedTasks.map((task) => `<article><div><b>${escapeHtml(task.actionKind.replace(/_/g, ' '))}</b><span>${escapeHtml(task.reason)}</span><small>Heuristic priority ${escapeHtml(task.heuristicPriority)} · ordinal uncertainty reduction ${escapeHtml(task.expectedInformationGain.estimate)} · planning cost ${escapeHtml(task.valueComponents.totalCost)}.</small></div>${task.status === 'approved' ? '<strong>Approved</strong>' : `<button class="btn btn-ghost" type="button" data-research-approve-task="${escapeHtml(task.actionId)}" data-research-task-target="${escapeHtml(task.targetHash)}">Approve</button>`}</article>`).join('') : '<p class="type-caption">No bounded follow-up is currently proposed.</p>'}
    </div>
    <p class="type-caption">Ranking policy ${escapeHtml(actionRanking.policy.policyId)} is an inspectable, non-calibrated heuristic. It does not estimate biological truth, mutation fitness, or a decision-change probability, and it cannot allocate work.</p>
  </section>
`;

export const renderParticipationQualityPanel = ({ rewards = [] } = {}) => `
  <section class="pool-research-panel">
    <p class="pool-dashboard-kicker">Participation quality</p>
    <h3 class="type-h3">Verified and durable contributions</h3>
    <div class="pool-research-rewards">
      ${rewards.length ? rewards.map((reward) => `<article><b>${escapeHtml(reward.authorId)}</b><span>${reward.points} points · ${reward.verifiedCompute} verified compute · ${reward.acceptedEvidence} accepted evidence · ${reward.acceptedReviews} accepted reviews · ${Math.round(reward.quality * 100)}% durable</span></article>`).join('') : '<p class="type-caption">Credit appears after verified compute or independently accepted evidence.</p>'}
    </div>
    <p class="type-caption">Activity alone earns no evidence credit. Later corrections and contradictions reduce durability.</p>
  </section>
`;

export default {
  compactHash,
  recordLabel,
  optionList,
  renderResultEvidencePanel,
  renderReviewPanel,
  renderDiscoveryPanel,
  renderNextWorkPanel,
  renderParticipationQualityPanel
};
