/**
 * @fileoverview Evidence-network rendering and human review controls for Poolday.
 */

import { createPoolIdentity } from '../../pool/identity.js';
import {
  buildEvidenceGraph,
  clusterCompatibleResults,
  createSignedHumanClaim,
  findSimilarSequences,
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
  return record.claim?.text || record.recordHash;
};

const renderRecord = (record) => `
  <article class="pool-research-record" data-research-kind="${escapeHtml(record.kind)}">
    <div><span>${escapeHtml(record.kind.replace(/_/g, ' '))}</span><b>${escapeHtml(recordLabel(record))}</b></div>
    <small>${escapeHtml(record.author?.roleId || 'unknown author')} · ${escapeHtml(compactHash(record.recordHash))}</small>
    ${record.kind === 'research_submission' ? `<code>${escapeHtml(record.sequence?.value || '')}</code>` : ''}
    ${record.kind === 'research_result' ? `<p>Derived from ${escapeHtml(compactHash(record.submissionHash))} · provider ${escapeHtml(record.compute?.providerId || 'unknown')} · receipt ${escapeHtml(compactHash(record.compute?.receiptHash))}</p><details><summary>Exact compute provenance</summary><small>Model ${escapeHtml(record.modelContract?.id || 'unknown')} · model hash ${escapeHtml(record.modelContract?.hash || 'unknown')} · manifest ${escapeHtml(record.modelContract?.manifestHash || 'unknown')} · ${escapeHtml(record.modelContract?.runtime || 'unknown runtime')} / ${escapeHtml(record.modelContract?.backend || 'unknown backend')} · route ${escapeHtml(record.compute?.routeDecisionHash || 'none')} · runtime profile ${escapeHtml(record.compute?.runtimeProfileHash || 'none')} · assignment ${escapeHtml(record.compute?.assignmentId || 'none')}</small></details>` : ''}
    ${record.kind === 'human_claim' ? `<p><strong>${escapeHtml(record.claim?.relation || '')}</strong> ${escapeHtml(compactHash(record.targetHash))} · confidence ${escapeHtml(Math.round(Number(record.claim?.confidence || 0) * 100))}%${record.claim?.decision ? ` · ${escapeHtml(record.claim.decision)}` : ''}</p>${record.claim?.evidenceLinks?.length ? `<div>${record.claim.evidenceLinks.map((link) => `<a href="${escapeHtml(link.url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(link.label || link.url)}</a>`).join(' · ')}</div>` : ''}` : ''}
  </article>
`;

export function renderResearchWorkspace(roomId, records = loadResearchRecords(roomId), { query = '', similarityTarget = '' } = {}) {
  const graph = buildEvidenceGraph(records);
  const submissions = records.filter((record) => record.kind === 'research_submission');
  const results = records.filter((record) => record.kind === 'research_result');
  const claims = records.filter((record) => record.kind === 'human_claim');
  const visible = searchEvidence(records, query);
  const tasks = proposeDiscoveryTasks(records);
  const clusters = clusterCompatibleResults(records);
  const target = similarityTarget || results.at(-1)?.recordHash || '';
  const similar = target ? findSimilarSequences(records, target) : [];
  const rewards = projectResearchRewards(records);
  const reviewTargets = records.filter((record) => record.kind !== 'human_claim' || record.claim?.kind !== 'task_approval');
  return `
    <section class="pool-research-workspace" data-pool-research-workspace data-room-id="${escapeHtml(roomId)}">
      <header class="pool-research-header">
        <div>
          <p class="pool-dashboard-kicker">Public protein evidence network</p>
          <h2 class="type-h2">Submit → Compute → Review → Connect → Discover</h2>
          <p>Model results stay receipt-backed. Human claims stay separately signed, attributable, correctable, and reviewable.</p>
        </div>
        <span class="pool-research-sync" data-pool-research-sync>Local evidence loaded</span>
      </header>
      <dl class="pool-research-stats">
        <div><dt>Submissions</dt><dd>${submissions.length}</dd></div>
        <div><dt>Results</dt><dd>${results.length}</dd></div>
        <div><dt>Human claims</dt><dd>${claims.length}</dd></div>
        <div><dt>Evidence nodes</dt><dd>${graph.nodes.length}</dd></div>
        <div><dt>Connections</dt><dd>${graph.edges.length}</dd></div>
        <div><dt>Clusters</dt><dd>${clusters.length}</dd></div>
      </dl>
      <div class="pool-research-grid">
        <section class="pool-research-panel pool-research-collection">
          <div class="pool-section-heading"><div><p class="pool-dashboard-kicker">Connect</p><h3 class="type-h3">Evidence collection</h3></div></div>
          <label class="pool-field"><span>Search sequences, intent, claims, models, or contributors</span><input data-research-search value="${escapeHtml(query)}" placeholder="signal peptide, sequence, model, reviewer"></label>
          <div class="pool-research-records" data-research-records>
            ${visible.length ? visible.map(renderRecord).join('') : '<p class="type-caption">No matching signed evidence yet.</p>'}
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

export function bindResearchWorkspace(workspace = document.querySelector('[data-pool-research-workspace]')) {
  if (!workspace || workspace.dataset.researchBound === 'true') return;
  workspace.dataset.researchBound = 'true';
  const roomId = workspace.dataset.roomId;
  workspace.querySelector('[data-research-search]')?.addEventListener('input', (event) => {
    const records = searchEvidence(loadResearchRecords(roomId), event.target.value);
    const target = workspace.querySelector('[data-research-records]');
    if (target) target.innerHTML = records.length ? records.map(renderRecord).join('') : '<p class="type-caption">No matching signed evidence yet.</p>';
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
