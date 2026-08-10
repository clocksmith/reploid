/**
 * @fileoverview Research Room presentation over the pure room projection.
 */

import { projectResearchRoom, researchRoomAgreementLabels } from './room-projection.js';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const compactHash = (value) => {
  const text = String(value || 'unknown');
  return text.length > 24 ? `${text.slice(0, 16)}...${text.slice(-8)}` : text;
};

const roomHref = (path, roomId, panel = '', targetHash = '') => {
  const url = new URL(path, 'https://reploid.invalid');
  if (roomId) url.searchParams.set('room', roomId);
  if (panel) url.searchParams.set('panel', panel);
  if (targetHash) url.searchParams.set('target', targetHash);
  const panelAnchors = {
    review: 'pool-room-review',
    discovery: 'pool-room-discovery'
  };
  if (panelAnchors[panel]) url.hash = panelAnchors[panel];
  return `${url.pathname}${url.search}${url.hash}`;
};

const statusLabel = (status) => ({
  ready: 'Ready for a question',
  investigating: 'Investigation in progress',
  awaiting_review: 'Awaiting review',
  corrected: 'Result corrected',
  remembered: 'Accepted evidence remembered'
}[status] || 'Room activity');

const renderRecovery = (room) => {
  const recovery = room.recovery || {};
  const states = Array.isArray(recovery.states) ? recovery.states : [];
  const labels = Array.isArray(recovery.labels) ? recovery.labels : states;
  if (!states.length) return '';
  const details = [
    recovery.remoteError ? `Coordinator sync unavailable: ${recovery.remoteError}` : null,
    recovery.rejectedRecords?.length
      ? `${recovery.rejectedRecords.length} record${recovery.rejectedRecords.length === 1 ? '' : 's'} was rejected after verification or policy checks.`
      : null,
    recovery.invalidatedCount > 0
      ? `${recovery.invalidatedCount} record${recovery.invalidatedCount === 1 ? '' : 's'} remain in history but are excluded from active projections.`
      : null,
    states.includes('awaiting_review')
      ? 'The latest result remains provisional until an applicable review accepts it.'
      : null
  ].filter(Boolean);
  return `
    <section class="pool-room-recovery" data-pool-room-recovery data-recovery-phase="${escapeHtml(recovery.phase || 'local_only')}" aria-label="Room recovery state">
      <div class="pool-room-recovery-states">${states.map((state, index) => `<span class="pool-room-recovery-state" data-recovery-state="${escapeHtml(state)}">${escapeHtml(labels[index] || state.replace(/_/g, ' '))}</span>`).join('')}</div>
      ${details.length ? `<ul>${details.map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')}</ul>` : ''}
    </section>
  `;
};

const renderParticipants = (participants = {}) => {
  const entries = [
    participants.requester,
    ...participants.contributors,
    ...participants.reviewers,
    ...participants.peers
  ].filter(Boolean);
  if (!entries.length) return '<span class="pool-room-muted">No participants observed yet.</span>';
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry.role}:${entry.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((entry) => `
    <span class="pool-room-participant" data-role="${escapeHtml(entry.role)}">
      <strong>${escapeHtml(entry.role)}</strong>
      <span>${escapeHtml(entry.label || compactHash(entry.id))}</span>
      <small>${escapeHtml(entry.status)}</small>
    </span>
  `).join('');
};

const renderQuestion = (room) => {
  if (!room.question) {
    return `
      <div class="pool-room-empty-state">
        <p class="pool-dashboard-kicker">Start with intent</p>
        <h2 class="type-h2">Ask a question of a public sequence.</h2>
        <p>Submit a sequence, question, consent, and exact model contract. The room keeps the path from request to reviewed evidence visible.</p>
        <a class="btn btn-primary" data-pool-route-link="${escapeHtml(roomHref('/ask', room.roomId))}" href="${escapeHtml(roomHref('/ask', room.roomId))}">Open requester controls</a>
      </div>
    `;
  }
  const intent = room.question.intent || {};
  return `
    <div class="pool-room-question">
      <p class="pool-dashboard-kicker">Question</p>
      <h2 class="type-h2">${escapeHtml(intent.label || intent.text || 'Public sequence investigation')}</h2>
      ${intent.text && intent.text !== intent.label ? `<p>${escapeHtml(intent.text)}</p>` : ''}
      <dl class="pool-room-facts">
        <div><dt>Sequence</dt><dd>${escapeHtml(compactHash(room.question.sequenceHash))} · ${escapeHtml(room.question.sequenceLength)} residues</dd></div>
        <div><dt>Model</dt><dd>${escapeHtml(room.question.modelContract?.id || 'Not selected')}</dd></div>
        <div><dt>Policy</dt><dd>${escapeHtml(room.question.policyId || 'Not selected')}</dd></div>
        <div><dt>Question clarity</dt><dd>${escapeHtml((room.question.clarity?.status || 'unassessed').replace(/_/g, ' '))}</dd></div>
      </dl>
      ${room.question.clarity?.gaps?.length ? `<details class="pool-room-disclosure"><summary>${escapeHtml(room.question.clarity.gaps.length)} question gap${room.question.clarity.gaps.length === 1 ? '' : 's'}</summary><ul>${room.question.clarity.gaps.map((gap) => `<li><strong>${escapeHtml(gap.field.replace(/_/g, ' '))}:</strong> ${escapeHtml(gap.reason)}</li>`).join('')}</ul></details>` : ''}
    </div>
  `;
};

const renderResult = (room) => {
  const result = room.latestResult;
  if (!result) {
    return `
      <section class="pool-room-result-card is-empty" data-room-result-card>
        <div><p class="pool-dashboard-kicker">Latest result</p><h2 class="type-h2">No receipt-backed result yet</h2><p>Execution evidence will appear here after a contributor or permitted local browser completes the request.</p><p class="pool-room-boundary"><strong>Agreement:</strong> Evidence unavailable</p></div>
        <a class="btn btn-primary" data-pool-route-link="${escapeHtml(roomHref('/ask', room.roomId))}" href="${escapeHtml(roomHref('/ask', room.roomId))}">Run the question</a>
      </section>
    `;
  }
  const agreementLabel = researchRoomAgreementLabels[result.agreement?.state] || 'Not assessed';
  return `
    <section class="pool-room-result-card" data-room-result-card>
      <div class="pool-room-result-heading">
        <div><p class="pool-dashboard-kicker">Latest result</p><h2 class="type-h2">Inspectable model evidence</h2></div>
        <span class="pool-room-status" data-status="${escapeHtml(result.status)}">${escapeHtml(result.status.replace(/_/g, ' '))}</span>
      </div>
      <div class="pool-room-result-grid">
        <div><span class="rgr-status-label">Agreement</span><strong>${escapeHtml(agreementLabel)}</strong></div>
        <div><span class="rgr-status-label">Review</span><strong>${escapeHtml(result.reviewState.replace(/_/g, ' '))}</strong></div>
        <div><span class="rgr-status-label">Dimensions</span><strong>${escapeHtml(result.embeddingDimensions || 'not published')}</strong></div>
        <div><span class="rgr-status-label">Receipt</span><strong title="${escapeHtml(result.receiptHash || '')}">${escapeHtml(compactHash(result.receiptHash))}</strong></div>
        <div><span class="rgr-status-label">Uncertainty</span><strong>${escapeHtml(result.uncertainty.length ? `${result.uncertainty.length} recorded limits` : 'Not reported')}</strong></div>
      </div>
      <p class="pool-room-boundary">Agreement is never inferred from similarity, visual proximity, or retrieval ranking.</p>
      <div class="pool-room-action-controls">
        <a class="btn btn-primary" data-pool-route-link="${escapeHtml(roomHref('/records', room.roomId, 'review', result.sourceHash))}" href="${escapeHtml(roomHref('/records', room.roomId, 'review', result.sourceHash))}">Review this result</a>
      </div>
      <details class="pool-room-disclosure"><summary>Technical evidence</summary>
        <dl class="pool-room-facts">
          <div><dt>Source</dt><dd>${escapeHtml(compactHash(result.sourceHash))}</dd></div>
          <div><dt>Model identity</dt><dd>${escapeHtml(result.model.id || 'unknown')} · ${escapeHtml(compactHash(result.model.hash))}</dd></div>
          <div><dt>Manifest</dt><dd>${escapeHtml(compactHash(result.model.manifestHash))}</dd></div>
          <div><dt>Runtime identity</dt><dd>${escapeHtml(compactHash(result.runtimeIdentity))}</dd></div>
          <div><dt>Sequence publication</dt><dd>${result.publication.sequence ? 'permitted' : 'withheld'}</dd></div>
          <div><dt>Embedding publication</dt><dd>${result.publication.embedding ? 'permitted' : 'withheld'}</dd></div>
          <div><dt>Residue evidence</dt><dd>${result.publication.residue ? 'permitted' : 'withheld'}</dd></div>
        </dl>
        <div class="pool-room-uncertainty">
          <strong>Uncertainty and evidence limits</strong>
          ${result.uncertainty.length ? `<ul>${result.uncertainty.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul>` : '<p class="type-caption">No additional uncertainty record is available.</p>'}
        </div>
        <p class="type-caption">Raw vectors and residue-level values remain hidden unless their signed publication consent exists.</p>
      </details>
    </section>
  `;
};

const unresolvedHref = (entry, roomId) => {
  if (entry.kind === 'evidence') return roomHref('/ask', roomId);
  return roomHref('/records', roomId, entry.kind === 'next_action' ? 'discovery' : 'review');
};

const renderUnresolved = (room) => `
  <section class="pool-room-section" aria-labelledby="pool-room-unresolved-title">
    <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Open questions</p><h2 class="type-h2" id="pool-room-unresolved-title">Unresolved</h2></div><span class="pool-room-count">${room.unresolved.length}</span></div>
    <div class="pool-room-list">
      ${room.unresolved.length ? room.unresolved.map((entry) => `
        <article class="pool-room-list-item" data-kind="${escapeHtml(entry.kind)}">
          <div><strong>${escapeHtml(entry.title)}</strong><p>${escapeHtml(entry.detail)}</p></div>
          <a class="btn btn-ghost" data-pool-route-link="${escapeHtml(unresolvedHref(entry, room.roomId))}" href="${escapeHtml(unresolvedHref(entry, room.roomId))}">${escapeHtml(entry.action || 'Inspect')}</a>
        </article>
      `).join('') : '<p class="pool-room-muted">Nothing is unresolved in the current projection.</p>'}
    </div>
  </section>
`;

const renderNextAction = (room) => {
  const action = room.nextActions[0];
  const nextQuestion = room.nextQuestion || {};
  const destination = roomHref('/records', room.roomId, action ? 'discovery' : 'review');
  return `
    <section class="pool-room-action-card" aria-labelledby="pool-room-next-action-title">
      <div><p class="pool-dashboard-kicker">Next research question</p><h2 class="type-h2" id="pool-room-next-action-title">${escapeHtml(action ? action.kind.replace(/_/g, ' ') : 'Human review required')}</h2><p>${escapeHtml(nextQuestion.prompt || action?.reason || 'Submit a question or invite a reviewer to create the next evidence record.')}</p>${action ? `<p class="type-caption">Action rationale: ${escapeHtml(action.reason)}</p>` : ''}<p class="pool-room-boundary">Basis: ${escapeHtml(action?.basis === 'accepted_memory' ? `${action.basisHashes.length} accepted memory record${action.basisHashes.length === 1 ? '' : 's'}` : 'question or governance boundary')}. Human approval is required; this projection cannot allocate or execute work.</p></div>
      <div class="pool-room-action-controls">
        ${action && action.status !== 'approved' ? `<button class="btn btn-primary" type="button" data-pool-room-approve-task="${escapeHtml(action.id)}" data-pool-room-task-target="${escapeHtml(action.targetHash)}" data-pool-room-id="${escapeHtml(room.roomId)}">Approve next action</button>` : ''}
        <a class="btn btn-ghost" data-pool-route-link="${escapeHtml(destination)}" href="${escapeHtml(destination)}">${action?.status === 'approved' ? 'Inspect approved action' : 'Inspect details'}</a>
      </div>
    </section>
  `;
};

const renderMemory = (room) => `
  <section class="pool-room-section pool-room-memory" aria-labelledby="pool-room-memory-title">
    <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Room memory</p><h2 class="type-h2" id="pool-room-memory-title">Remembered evidence</h2></div><span class="pool-room-count">${room.memory.length}</span></div>
    ${room.memory.length
      ? `<div class="pool-room-list">${room.memory.map((entry) => `<article class="pool-room-list-item"><div><strong>${escapeHtml(entry.title)}</strong><p>Accepted under the current room policy by ${escapeHtml(entry.reviewDecisionHashes.length)} independent signed decision${entry.reviewDecisionHashes.length === 1 ? '' : 's'}.</p></div><small>${escapeHtml(entry.kind.replace(/_/g, ' '))} · ${escapeHtml(compactHash(entry.sourceHash))}</small></article>`).join('')}</div>`
      : '<p class="pool-room-muted">No evidence has been accepted into room memory yet. Provisional results and proposals remain visible above without being remembered.</p>'}
  </section>
`;

const renderProposals = (room) => `
  <section class="pool-room-section pool-room-proposals" aria-labelledby="pool-room-proposals-title">
    <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Inspiration</p><h2 class="type-h2" id="pool-room-proposals-title">Possible explanations and proposed work</h2></div><span class="pool-room-count">${room.proposals.length}</span></div>
    <p class="pool-room-boundary">Signed proposals are provisional. They become reusable room knowledge only after applicable review and acceptance.</p>
    ${room.proposals.length
      ? `<div class="pool-room-proposal-list">${room.proposals.map((proposal) => `
        <article class="pool-room-proposal-card" data-proposal-kind="${escapeHtml(proposal.kind)}">
          <div class="pool-room-proposal-heading"><strong>${escapeHtml(proposal.title)}</strong><span class="pool-room-event-status">${escapeHtml(proposal.status)}</span></div>
          <p>${escapeHtml(proposal.summary)}</p>
          <dl class="pool-room-proposal-facts">
            <div><dt>Evidence supporting</dt><dd>${escapeHtml(proposal.supportingEvidence.length ? proposal.supportingEvidence.map(compactHash).join(' · ') : 'None linked')}</dd></div>
            <div><dt>Evidence missing</dt><dd>${escapeHtml(proposal.missingEvidence)}</dd></div>
            <div><dt>What would distinguish it</dt><dd>${escapeHtml(proposal.distinguishes.length ? proposal.distinguishes.join(' · ') : 'No discriminator recorded')}</dd></div>
          </dl>
          <a class="btn btn-ghost" data-pool-route-link="${escapeHtml(roomHref('/records', room.roomId, 'discovery'))}" href="${escapeHtml(roomHref('/records', room.roomId, 'discovery'))}">Inspect proposed action</a>
        </article>
      `).join('')}</div>`
      : '<p class="pool-room-muted">No signed hypotheses, predictions, or proposed work are present in this room yet.</p>'}
  </section>
`;

const renderTimelineEntry = (entry) => `
  <li data-source-authority="${escapeHtml(entry.sourceAuthority)}">
    <div class="pool-room-timeline-marker" aria-hidden="true"></div>
    <div class="pool-room-timeline-body"><div><strong>${escapeHtml(entry.title)}</strong><span class="pool-room-event-status">${escapeHtml(entry.status)}</span></div><p>${escapeHtml(entry.summary)}</p><small>${escapeHtml(entry.sourceAuthority)} · ${escapeHtml(compactHash(entry.sourceHash || entry.id))}</small></div>
  </li>
`;

const renderTimeline = (room) => {
  const timeline = room.timeline || [];
  const recent = timeline.slice(-13);
  const anchorIds = new Set(
    timeline
      .filter((entry) => ['research_submission', 'research_result', 'agreement', 'receipt'].includes(entry.kind))
      .map((entry) => entry.id)
  );
  recent.forEach((entry) => anchorIds.add(entry.id));
  const visible = timeline.filter((entry) => anchorIds.has(entry.id));
  const intervening = timeline.filter((entry) => !anchorIds.has(entry.id));
  const body = timeline.length
    ? `${visible.map(renderTimelineEntry).join('')}
        ${intervening.length ? `<li class="pool-room-timeline-disclosure"><details><summary>Show ${intervening.length} intervening room event${intervening.length === 1 ? '' : 's'}</summary><ol>${intervening.map(renderTimelineEntry).join('')}</ol></details></li>` : ''}`
    : '<li><div class="pool-room-timeline-body"><strong>Room created</strong><p>Submit a public sequence and question to begin.</p></div></li>';
  return `
    <section class="pool-room-section" aria-labelledby="pool-room-timeline-title">
      <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Causal sequence</p><h2 class="type-h2" id="pool-room-timeline-title">Room timeline</h2></div><span class="pool-room-count">${timeline.length}</span></div>
      <ol class="pool-room-timeline">${body}</ol>
    </section>
  `;
};

const renderRoles = (room) => `
  <section class="pool-room-section" aria-labelledby="pool-room-roles-title">
    <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Participate</p><h2 class="type-h2" id="pool-room-roles-title">Room roles</h2></div></div>
    <div class="pool-room-role-grid">
      <article><strong>Request</strong><p>State the sequence and question.</p><a data-pool-route-link="${escapeHtml(roomHref('/ask', room.roomId))}" href="${escapeHtml(roomHref('/ask', room.roomId))}">Open requester</a></article>
      <article><strong>Share compute</strong><p>Let this browser contribute execution.</p><a data-pool-route-link="${escapeHtml(roomHref('/compute', room.roomId))}" href="${escapeHtml(roomHref('/compute', room.roomId))}">Open contributor</a></article>
      <article><strong>Review evidence</strong><p>Make an attributable signed decision.</p><a data-pool-route-link="${escapeHtml(roomHref('/records', room.roomId, 'review'))}" href="${escapeHtml(roomHref('/records', room.roomId, 'review'))}">Review evidence</a></article>
      <article><strong>Discover</strong><p>Inspect compatible evidence and proposed work.</p><a data-pool-route-link="${escapeHtml(roomHref('/records', room.roomId, 'discovery'))}" href="${escapeHtml(roomHref('/records', room.roomId, 'discovery'))}">Explore discovery</a></article>
    </div>
  </section>
`;

export function renderResearchRoom({
  roomId,
  routeId = 'home',
  panel = 'overview',
  researchRecords = [],
  receipts = [],
  peerEvents = [],
  syncState = {}
} = {}) {
  const room = projectResearchRoom({ roomId, routeId, researchRecords, receipts, peerEvents, syncState });
  return `
    <section class="pool-research-room" data-pool-research-room data-room-id="${escapeHtml(room.roomId)}" data-room-route="${escapeHtml(room.routeId)}" data-room-panel="${escapeHtml(panel)}">
      <header class="pool-room-header">
        <div><p class="pool-dashboard-kicker">Reploid Research Room</p><h1 class="type-h1">Question, evidence, and the next useful action</h1><p>One room for human intent, browser execution, signed evidence, review, and remembered knowledge.</p></div>
        <div class="pool-room-header-meta"><span class="pool-room-status" data-status="${escapeHtml(room.status)}">${escapeHtml(statusLabel(room.status))}</span><code>Room ${escapeHtml(room.roomId)}</code></div>
      </header>
      ${renderRecovery(room)}
      <div class="pool-room-participants" aria-label="Room participants">${renderParticipants(room.participants)}</div>
      <div class="pool-room-main-grid">
        <section class="pool-room-question-card">${renderQuestion(room)}</section>
        ${renderResult(room)}
      </div>
      <div class="pool-room-columns">
        <div>${renderUnresolved(room)}${renderNextAction(room)}</div>
        <div>${renderTimeline(room)}</div>
      </div>
      ${renderProposals(room)}
      ${renderMemory(room)}
      ${renderRoles(room)}
      <details class="pool-room-disclosure pool-room-technical-disclosure"><summary>Room provenance and recovery</summary>
        <dl class="pool-room-facts"><div><dt>Room identity</dt><dd>${escapeHtml(room.roomId)}</dd></div><div><dt>Cycle policy</dt><dd>${escapeHtml(room.cycle?.policyId || 'unknown')}</dd></div><div><dt>Active records</dt><dd>${escapeHtml(room.counts.active)}</dd></div><div><dt>Remembered records</dt><dd>${escapeHtml(room.counts.memory)}</dd></div><div><dt>Excluded from memory</dt><dd>${escapeHtml(room.memoryExclusions?.length || 0)}</dd></div><div><dt>Timeline entries</dt><dd>${escapeHtml(room.counts.timeline)}</dd></div><div><dt>Recovery state</dt><dd>${escapeHtml(room.recovery?.labels?.join(' · ') || 'Local-only recovery')}</dd></div><div><dt>Rejected records</dt><dd>${escapeHtml(room.recovery?.rejectedRecords?.length || 0)}</dd></div><div><dt>Invalidated records</dt><dd>${escapeHtml(room.recovery?.invalidatedCount || 0)}</dd></div></dl>
        <p class="type-caption">Local drafts are recovery state. Only verified, active, accepted signed records enter room memory.</p>
      </details>
    </section>
  `;
}

export { roomHref };

export default { renderResearchRoom, roomHref };
