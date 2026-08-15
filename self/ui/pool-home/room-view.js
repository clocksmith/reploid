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

const annotationIdentityLabel = (annotation = null) => {
  if (!annotation) return null;
  const ontology = annotation.ontology || {};
  const coordinates = annotation.coordinates || {};
  const term = [ontology.namespace, ontology.termId].filter(Boolean).join(':');
  if (!term || !ontology.version || !Number.isInteger(coordinates.start) || !Number.isInteger(coordinates.end)) return null;
  return `${annotation.scope || 'annotation'} · ${term} @ ${ontology.version} · canonical residues ${coordinates.start}-${coordinates.end} (one-based closed)`;
};

const roomHref = (path, roomId, panel = '', targetHash = '') => {
  const url = new URL(path, 'https://reploid.invalid');
  if (roomId) url.searchParams.set('room', roomId);
  if (panel) url.searchParams.set('panel', panel);
  if (targetHash) url.searchParams.set('target', targetHash);
  const panelAnchors = {
    review: 'pool-room-review',
    discovery: 'pool-room-discovery',
    'candidate-actions': 'pool-room-candidate-actions'
  };
  if (panelAnchors[panel]) url.hash = panelAnchors[panel];
  return `${url.pathname}${url.search}${url.hash}`;
};

const statusLabel = (status) => ({
  ready: 'Ready for a question',
  investigating: 'Investigation in progress',
  awaiting_review: 'Awaiting review',
  awaiting_replication: 'Awaiting independent execution',
  corrected: 'Result corrected',
  remembered: 'Accepted evidence remembered'
}[status] || 'Room activity');

const renderRecovery = (room) => {
  const recovery = room.recovery || {};
  const states = Array.isArray(recovery.states) ? recovery.states : [];
  const labels = Array.isArray(recovery.labels) ? recovery.labels : states;
  const hasProblem = Boolean(
    recovery.remoteError
    || recovery.rejectedRecords?.length
    || recovery.invalidatedCount > 0
  );
  if (!hasProblem) return '';
  const details = [
    recovery.remoteError ? `Coordinator sync unavailable: ${recovery.remoteError}` : null,
    recovery.rejectedRecords?.length
      ? `${recovery.rejectedRecords.length} record${recovery.rejectedRecords.length === 1 ? '' : 's'} was rejected after verification or policy checks.`
      : null,
    recovery.invalidatedCount > 0
      ? `${recovery.invalidatedCount} record${recovery.invalidatedCount === 1 ? '' : 's'} remain in history but are excluded from active projections.`
      : null,
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
        <p class="pool-dashboard-kicker">Question</p>
        <h2 class="type-h2">No question yet</h2>
        <a class="btn btn-primary" data-pool-route-link="${escapeHtml(roomHref('/ask', room.roomId))}" href="${escapeHtml(roomHref('/ask', room.roomId))}">Ask a question</a>
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
      </dl>
      ${room.question.clarity?.gaps?.length ? `<details class="pool-room-disclosure"><summary>${escapeHtml(room.question.clarity.gaps.length)} missing detail${room.question.clarity.gaps.length === 1 ? '' : 's'}</summary><ul>${room.question.clarity.gaps.map((gap) => `<li><strong>${escapeHtml(gap.field.replace(/_/g, ' '))}:</strong> ${escapeHtml(gap.reason)}</li>`).join('')}</ul></details>` : ''}
    </div>
  `;
};

const renderResult = (room) => {
  const result = room.latestResult;
  if (!result) {
    return `
      <section class="pool-room-result-card is-empty" data-room-result-card>
        <div><p class="pool-dashboard-kicker">Result</p><h2 class="type-h2">No result yet</h2></div>
        <a class="btn btn-primary" data-pool-route-link="${escapeHtml(roomHref('/ask', room.roomId))}" href="${escapeHtml(roomHref('/ask', room.roomId))}">Run</a>
      </section>
    `;
  }
  const agreementLabel = researchRoomAgreementLabels[result.agreement?.state] || 'Not assessed';
  return `
    <section class="pool-room-result-card" data-room-result-card>
      <div class="pool-room-result-heading">
        <div><p class="pool-dashboard-kicker">Result</p><h2 class="type-h2">Model evidence</h2></div>
        <span class="pool-room-status" data-status="${escapeHtml(result.status)}">${escapeHtml(result.status.replace(/_/g, ' '))}</span>
      </div>
      <div class="pool-room-result-grid">
        <div><span class="rgr-status-label">Agreement</span><strong>${escapeHtml(agreementLabel)}</strong></div>
        <div><span class="rgr-status-label">Review</span><strong>${escapeHtml(result.reviewState.replace(/_/g, ' '))}</strong></div>
        <div><span class="rgr-status-label">Receipt</span><strong title="${escapeHtml(result.receiptHash || '')}">${escapeHtml(compactHash(result.receiptHash))}</strong></div>
      </div>
      <div class="pool-room-action-controls">
        <a class="btn btn-primary" data-pool-route-link="${escapeHtml(roomHref('/records', room.roomId, 'review', result.sourceHash))}" href="${escapeHtml(roomHref('/records', room.roomId, 'review', result.sourceHash))}">Review</a>
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
  const signedCandidate = action?.actionType === 'signed_candidate_action';
  const nextQuestion = room.nextQuestion || {};
  const needsQuestion = !room.question;
  const destination = needsQuestion
    ? roomHref('/ask', room.roomId)
    : roomHref('/records', room.roomId, signedCandidate ? 'candidate-actions' : action ? 'discovery' : 'review');
  const approvalRecordHashes = signedCandidate ? action.approvalRecordHashes : nextQuestion.approvalRecordHashes;
  const approvalBoundary = (signedCandidate ? action.status : nextQuestion.humanApprovalStatus) === 'approved'
    ? `${approvalRecordHashes?.length || 0} signed approval${approvalRecordHashes?.length === 1 ? '' : 's'}`
    : 'Independent approval required';
  const candidateEvidence = signedCandidate ? `<details class="pool-room-disclosure"><summary>Raw candidate-action evidence</summary>
    <dl class="pool-room-facts">
      <div><dt>Ranking status</dt><dd>${escapeHtml(action.rankingStatus?.replace(/_/g, ' ') || 'unknown')}</dd></div>
      <div><dt>Uncertainty reduction</dt><dd>${escapeHtml(action.rawValueComponents?.uncertaintyReduction)}/5</dd></div>
      <div><dt>Decision relevance</dt><dd>${escapeHtml(action.rawValueComponents?.decisionRelevance)}/5</dd></div>
      <div><dt>Duplicate-work avoidance</dt><dd>${escapeHtml(action.rawValueComponents?.duplicateWorkAvoidance)}/5</dd></div>
      <div><dt>Declared burden</dt><dd>${escapeHtml(action.rawValueComponents?.costBurden)}</dd></div>
      ${Object.entries(action.scientificCost || {}).filter(([, value]) => value && !Array.isArray(value)).map(([component, value]) => `<div><dt>${escapeHtml(component.replace(/([A-Z])/g, ' $1').toLowerCase())}</dt><dd>${escapeHtml(value.amount)} ${escapeHtml(value.unit)} · burden ${escapeHtml(value.burden)}/5</dd></div>`).join('')}
      <div><dt>Uncertainty</dt><dd>${action.uncertainty.map((entry) => `${escapeHtml(entry.source.replace(/_/g, ' '))}: ${escapeHtml(entry.representation.replace(/_/g, ' '))}`).join(' · ')}</dd></div>
      <div><dt>Exact ${escapeHtml(action.execution?.contractKind || 'contract')}</dt><dd>${escapeHtml(action.execution?.contractId)} @ ${escapeHtml(action.execution?.version)} · ${escapeHtml(compactHash(action.contractHash))}</dd></div>
      <div><dt>Authority</dt><dd>Ranking projection only; no allocation or execution authority.</dd></div>
    </dl>
  </details>` : '';
  return `
    <section class="pool-room-action-card" aria-labelledby="pool-room-next-action-title">
      <div><p class="pool-dashboard-kicker">Next</p><h2 class="type-h2" id="pool-room-next-action-title">${escapeHtml(needsQuestion ? 'Ask a question' : action ? action.title || action.kind.replace(/_/g, ' ') : 'Review the evidence')}</h2><p>${escapeHtml(needsQuestion ? 'Start with a public protein sequence.' : signedCandidate ? action.reason : nextQuestion.prompt || action?.reason || 'Review a result.')}</p>${needsQuestion ? '' : `<small>${escapeHtml(approvalBoundary)}</small>`}${action ? `<details class="pool-room-disclosure"><summary>Why this action?</summary><p>${escapeHtml(action.reason)}</p><p>Based on ${escapeHtml(action.basis === 'accepted_memory' ? `${action.basisHashes.length} accepted record${action.basisHashes.length === 1 ? '' : 's'}` : signedCandidate ? `${action.basisHashes.length} affected hypothesis contract${action.basisHashes.length === 1 ? '' : 's'}` : 'the current question')}.</p></details>` : ''}${candidateEvidence}</div>
      <div class="pool-room-action-controls">
        ${action && action.status !== 'approved' && signedCandidate ? `<button class="btn btn-primary" type="button" data-pool-room-approve-candidate="${escapeHtml(action.targetHash)}" data-pool-room-candidate-contract="${escapeHtml(action.contractHash)}" data-pool-room-id="${escapeHtml(room.roomId)}">Approve exact contract</button>` : ''}
        ${action && action.status !== 'approved' && !signedCandidate ? `<button class="btn btn-primary" type="button" data-pool-room-approve-task="${escapeHtml(action.id)}" data-pool-room-task-target="${escapeHtml(action.targetHash)}" data-pool-room-id="${escapeHtml(room.roomId)}">Approve next action</button>` : ''}
        <a class="btn btn-ghost" data-pool-route-link="${escapeHtml(destination)}" href="${escapeHtml(destination)}">Open</a>
      </div>
    </section>
  `;
};

const renderMemory = (room) => `
  <section class="pool-room-section pool-room-memory" aria-labelledby="pool-room-memory-title">
    <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Decision memory</p><h2 class="type-h2" id="pool-room-memory-title">Remembered evidence</h2></div><span class="pool-room-count">${room.memory.length}</span></div>
    <p class="pool-room-boundary">Admitted only for this decision under ${escapeHtml(room.decisionMemory?.policyId || 'an unknown policy')}. Remembered does not mean biologically true.</p>
    ${room.memory.length
      ? `<div class="pool-room-list">${room.memory.map((entry) => `<article class="pool-room-list-item"><div><strong>${escapeHtml(entry.title)}</strong><p>Accepted under the current room policy by ${escapeHtml(entry.reviewDecisionHashes.length)} independent signed decision${entry.reviewDecisionHashes.length === 1 ? '' : 's'}.</p></div><small>${escapeHtml(entry.kind.replace(/_/g, ' '))} · ${escapeHtml(compactHash(entry.sourceHash))}</small></article>`).join('')}</div>`
      : '<p class="pool-room-muted">No evidence has been accepted into room memory yet. Provisional results and proposals remain visible above without being remembered.</p>'}
  </section>
`;

const archiveStateLabel = (state) => String(state || 'provisional').replace(/_/g, ' ');

const renderArchive = (room) => {
  const archive = room.archive || { entries: [], rejected: [] };
  const entries = [...(archive.entries || []), ...(archive.rejected || [])];
  return `
    <section class="pool-room-section pool-room-archive" aria-labelledby="pool-room-archive-title">
      <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Immutable history</p><h2 class="type-h2" id="pool-room-archive-title">Complete evidence archive</h2></div><span class="pool-room-count">${entries.length}</span></div>
      <p class="pool-room-boundary">Every loaded room record remains represented here, including material excluded from decision memory. Boundary: ${escapeHtml(archive.boundary || 'verified_local_snapshot')}.</p>
      ${entries.length
        ? `<div class="pool-room-list">${entries.map((entry) => `<article class="pool-room-list-item" data-archive-state="${escapeHtml(entry.state)}"><div><strong>${escapeHtml(entry.title || entry.claimedKind || 'Rejected record')}</strong><p>${escapeHtml(entry.summary || entry.reason || 'No trusted summary is available.')}</p>${entry.decisionMemoryExclusionReason ? `<p class="type-caption">Decision-memory exclusion: ${escapeHtml(entry.decisionMemoryExclusionReason.replace(/_/g, ' '))}.</p>` : ''}</div><small>${escapeHtml(archiveStateLabel(entry.state))} · ${escapeHtml(compactHash(entry.recordHash || entry.id))}</small></article>`).join('')}</div>`
        : '<p class="pool-room-muted">No immutable research records have been loaded for this room.</p>'}
    </section>
  `;
};

const renderDiscoveryContract = (room) => {
  const contract = room.discoveryContract || { status: 'question_missing', latest: null };
  const labels = {
    question_missing: 'Question required',
    checkpoint_missing: 'Checkpoint missing',
    checkpoint_required: 'New inputs require a checkpoint',
    reopen_required: 'Reopening must be checkpointed',
    current: 'Current checkpoint',
    reopened: 'Reopened state checkpointed'
  };
  const latest = contract.latest;
  return `
    <section class="pool-room-section pool-room-contract" aria-labelledby="pool-room-contract-title" data-contract-status="${escapeHtml(contract.status)}">
      <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Replay boundary</p><h2 class="type-h2" id="pool-room-contract-title">Discovery Contract checkpoint</h2></div><span class="pool-room-event-status">${escapeHtml(labels[contract.status] || contract.status)}</span></div>
      <p class="pool-room-boundary">A checkpoint signs the exact question, named policy, projection artifact, complete archive inputs, active inputs, and deterministic state. It freezes evidence state; it does not establish biological truth or scientific closure.</p>
      ${latest ? `<dl class="pool-room-facts"><div><dt>Checkpoint</dt><dd>${escapeHtml(compactHash(latest.recordHash))}</dd></div><div><dt>State</dt><dd>${escapeHtml(latest.stateStatus)}</dd></div><div><dt>Complete inputs</dt><dd>${escapeHtml(latest.inputRecordCount)}</dd></div><div><dt>Active inputs</dt><dd>${escapeHtml(latest.activeInputRecordCount)}</dd></div><div><dt>Decision memory</dt><dd>${escapeHtml(latest.decisionMemoryCount)}</dd></div><div><dt>Projection</dt><dd>${escapeHtml(latest.projectionId || 'unknown')}</dd></div></dl>` : '<p class="pool-room-muted">No signed replay checkpoint exists for the active question.</p>'}
      ${contract.unfrozenRecordHashes?.length ? `<p class="type-caption">${escapeHtml(contract.unfrozenRecordHashes.length)} signed input${contract.unfrozenRecordHashes.length === 1 ? '' : 's'} remain outside the latest checkpoint.</p>` : ''}
      ${contract.triggerKinds?.length ? `<p class="type-caption">Reopening evidence: ${escapeHtml(contract.triggerKinds.join(' · ').replace(/_/g, ' '))}.</p>` : ''}
      <button class="btn btn-ghost" type="button" data-pool-room-freeze-contract data-pool-room-id="${escapeHtml(room.roomId)}"${contract.canCheckpoint ? '' : ' disabled'}>${contract.status === 'reopen_required' ? 'Sign reopened checkpoint' : contract.status === 'checkpoint_missing' ? 'Sign first checkpoint' : 'Checkpoint is current'}</button>
    </section>
  `;
};

const renderPriorRoomEvidence = (room) => {
  const prior = room.priorRoomEvidence || { phase: 'idle', candidates: [], roomCount: 0 };
  const boundary = prior.registryBoundary?.boundary || 'not queried';
  const boundaryLabel = prior.registryBoundary
    ? `${boundary}; ${prior.registryBoundary.complete ? 'complete within the declared registry boundary' : 'the registry snapshot may be incomplete'}`
    : boundary;
  return `
    <section class="pool-room-section pool-room-prior-evidence" aria-labelledby="pool-room-prior-evidence-title">
      <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Exact-sequence reuse</p><h2 class="type-h2" id="pool-room-prior-evidence-title">Prior-room evidence</h2></div><span class="pool-room-count">${prior.candidates.length}</span></div>
      <p class="pool-room-boundary">Origin-room acceptance is provenance, not admission here. A candidate must be qualified, attached to this question, and independently reviewed before it can enter this room's decision memory. Boundary: ${escapeHtml(boundaryLabel)}.</p>
      ${prior.phase === 'synchronizing' ? '<p class="pool-room-muted">Searching the public evidence registry by exact sequence identity.</p>' : ''}
      ${prior.error ? `<p class="pool-room-muted">Prior-room retrieval unavailable: ${escapeHtml(prior.error)}</p>` : ''}
      ${prior.candidates.length
        ? `<div class="pool-room-list">${prior.candidates.map((candidate) => {
          const source = candidate.sourceVersions.find((entry) => entry.recordHash === candidate.recordHash)
            || candidate.sourceVersions[0]
            || null;
          const qualification = candidate.qualification?.status || 'needs_source_qualification';
          const reasons = candidate.qualification?.reasons || [];
          const annotationLabel = annotationIdentityLabel(candidate.annotation);
          const contextComparison = candidate.contextComparison || { status: 'context_unavailable', differences: [], missing: [] };
          const contextDetail = [
            contextComparison.status.replace(/_/g, ' '),
            contextComparison.differences?.length ? `differs: ${contextComparison.differences.join(', ')}` : '',
            contextComparison.missing?.length ? `missing: ${contextComparison.missing.join(', ')}` : ''
          ].filter(Boolean).join(' · ');
          const duplicateRecordCount = candidate.duplicateRecordHashes?.length || 1;
          const duplicateDetail = duplicateRecordCount > 1
            ? `<p class="type-caption">Same declared versioned source in ${escapeHtml(duplicateRecordCount)} signed origin record${duplicateRecordCount === 1 ? '' : 's'} across ${escapeHtml(candidate.duplicateOriginRoomIds?.length || 1)} room${candidate.duplicateOriginRoomIds?.length === 1 ? '' : 's'}. The archive preserves every record; this candidate contributes at most once to decision memory.</p>`
            : '';
          const action = candidate.attachedRecordHash
            ? `<span class="pool-room-event-status">Attached for current-room review · ${escapeHtml(compactHash(candidate.attachedRecordHash))}</span>`
            : candidate.attachable
              ? `<button class="btn btn-ghost" type="button" data-pool-room-attach-prior="${escapeHtml(candidate.recordHash)}" data-pool-room-prior-origin="${escapeHtml(candidate.originRoomId)}" data-pool-room-id="${escapeHtml(room.roomId)}">Attach as provisional evidence</button>`
              : '<span class="pool-room-event-status">Manual qualification required</span>';
          return `<article class="pool-room-list-item" data-prior-room-qualification="${escapeHtml(qualification)}"><div><strong>${escapeHtml(candidate.title)}</strong><p>${escapeHtml(candidate.summary)}</p><p class="type-caption">Origin room ${escapeHtml(candidate.originRoomId)} · accepted there · ${escapeHtml(qualification.replace(/_/g, ' '))}${reasons.length ? ` · ${escapeHtml(reasons.join(' · ').replace(/_/g, ' '))}` : ''}</p>${source ? `<p class="type-caption">Source ${escapeHtml(source.accession || source.uri || compactHash(source.recordHash))} @ ${escapeHtml(source.version || compactHash(source.contentHash))} · declared license ${escapeHtml(source.license || 'undeclared')}</p>` : ''}${annotationLabel ? `<p class="type-caption">${escapeHtml(annotationLabel)}</p>` : ''}${duplicateDetail}<p class="type-caption">Declared decision context: ${escapeHtml(contextDetail)}. Even an exact declared match still requires explicit current-room relevance review.</p>${action}</div><small>${escapeHtml(candidate.kind.replace(/_/g, ' '))} · ${escapeHtml(compactHash(candidate.recordHash))}</small></article>`;
        }).join('')}</div>`
        : prior.phase === 'synchronized'
          ? `<p class="pool-room-muted">No independently accepted evidence from ${escapeHtml(prior.roomCount)} other matching room${prior.roomCount === 1 ? '' : 's'} is eligible even as a candidate.</p>`
          : '<p class="pool-room-muted">Prior-room evidence has not been loaded for this sequence.</p>'}
    </section>
  `;
};

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

const renderAdjudicationProof = (room) => {
  const proof = room.adjudicationProof || { status: 'not_frozen', gaps: [] };
  const experiment = proof.experiment;
  const evaluation = proof.evaluation;
  return `
    <section class="pool-room-section pool-room-adjudication-proof" aria-labelledby="pool-room-adjudication-proof-title">
      <div class="pool-room-section-heading"><div><p class="pool-dashboard-kicker">Falsifiable product proof</p><h2 class="type-h2" id="pool-room-adjudication-proof-title">Annotation adjudication experiment</h2></div></div>
      <p class="pool-room-boundary">Status: ${escapeHtml(proof.status.replace(/_/g, ' '))}. A frozen contract or evaluation is evidence about one declared workflow, not proof of biological truth or broader product value.</p>
      ${experiment ? `
        <dl class="pool-room-facts">
          <div><dt>Catalog</dt><dd>${escapeHtml(experiment.target.catalogId)} @ ${escapeHtml(experiment.target.catalogVersion)}</dd></div>
          <div><dt>Curator role</dt><dd>${escapeHtml(experiment.target.curatorRole)}</dd></div>
          <div><dt>Decision</dt><dd>${escapeHtml(experiment.target.decision)}</dd></div>
          <div><dt>Baseline</dt><dd>${escapeHtml(experiment.baseline.workflowId)} @ ${escapeHtml(experiment.baseline.version)}</dd></div>
          <div><dt>Candidate</dt><dd>${escapeHtml(experiment.candidate.policyId)} @ ${escapeHtml(experiment.candidate.version)}</dd></div>
          <div><dt>Paired cohort</dt><dd>${escapeHtml(experiment.cohort.caseCount)} family-disjoint cases</dd></div>
        </dl>
        <p class="type-caption">Success requires quality improvement at comparable effort or effort improvement without quality loss, using the frozen lower-bound thresholds.</p>
        ${evaluation ? `<div class="pool-room-list">${evaluation.metricResults.map((metric) => `<article class="pool-room-list-item"><div><strong>${escapeHtml(metric.metricId)}</strong><p>${escapeHtml(metric.baselineValue)} baseline to ${escapeHtml(metric.candidateValue)} candidate · oriented effect ${escapeHtml(metric.orientedEffect)} · interval ${escapeHtml(metric.effectInterval.lower)} to ${escapeHtml(metric.effectInterval.upper)}</p></div><small>${escapeHtml(metric.pairedSampleCount)} paired cases</small></article>`).join('')}</div>` : '<p class="pool-room-muted">No prospective paired evaluation is attached to the accepted frozen experiment.</p>'}
      ` : '<p class="pool-room-muted">No catalog, curator role, baseline workflow, paired cohort, success rule, and independent evaluator have been frozen together. Reploid has not demonstrated its first product win.</p>'}
      ${proof.gaps?.length ? `<p class="type-caption">Open proof gaps: ${escapeHtml(proof.gaps.join(' · ').replace(/_/g, ' '))}</p>` : ''}
    </section>
  `;
};

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
  quarantinedRecords = [],
  crossRoomEvidence = {},
  receipts = [],
  peerEvents = [],
  syncState = {}
} = {}) {
  const room = projectResearchRoom({
    roomId,
    routeId,
    researchRecords,
    quarantinedRecords,
    crossRoomEvidence,
    receipts,
    peerEvents,
    syncState
  });
  return `
    <section class="pool-research-room" data-pool-research-room data-room-id="${escapeHtml(room.roomId)}" data-room-route="${escapeHtml(room.routeId)}" data-room-panel="${escapeHtml(panel)}">
      <header class="pool-room-header">
        <div><p class="pool-dashboard-kicker">Reploid</p><h1 class="type-h1">Research room</h1></div>
        <div class="pool-room-header-meta"><span class="pool-room-status" data-status="${escapeHtml(room.status)}">${escapeHtml(statusLabel(room.status))}</span></div>
      </header>
      ${renderRecovery(room)}
      <div class="pool-room-main-grid">
        <section class="pool-room-question-card">${renderQuestion(room)}</section>
        ${renderResult(room)}
      </div>
      ${renderNextAction(room)}
      <details class="pool-room-disclosure pool-room-technical-disclosure"><summary>History and details</summary>
        <div class="pool-room-participants" aria-label="Room participants">${renderParticipants(room.participants)}</div>
        <div class="pool-room-columns">
          <div>${renderDiscoveryContract(room)}${renderAdjudicationProof(room)}${renderUnresolved(room)}${renderMemory(room)}${renderPriorRoomEvidence(room)}</div>
          <div>${renderArchive(room)}${renderTimeline(room)}</div>
        </div>
        ${renderProposals(room)}
        ${renderRoles(room)}
        <dl class="pool-room-facts"><div><dt>Room identity</dt><dd>${escapeHtml(room.roomId)}</dd></div><div><dt>Decision-memory policy</dt><dd>${escapeHtml(room.decisionMemory?.policyId || 'unknown')}</dd></div><div><dt>Archived records</dt><dd>${escapeHtml(room.counts.archive)}</dd></div><div><dt>Active records</dt><dd>${escapeHtml(room.counts.active)}</dd></div><div><dt>Remembered records</dt><dd>${escapeHtml(room.counts.memory)}</dd></div><div><dt>Prior-room candidates</dt><dd>${escapeHtml(room.counts.priorRoomCandidates)}</dd></div><div><dt>Excluded from memory</dt><dd>${escapeHtml(room.memoryExclusions?.length || 0)}</dd></div><div><dt>Timeline entries</dt><dd>${escapeHtml(room.counts.timeline)}</dd></div><div><dt>Recovery state</dt><dd>${escapeHtml(room.recovery?.labels?.join(' · ') || 'Local-only recovery')}</dd></div><div><dt>Rejected records</dt><dd>${escapeHtml(room.recovery?.rejectedRecords?.length || 0)}</dd></div><div><dt>Invalidated records</dt><dd>${escapeHtml(room.recovery?.invalidatedCount || 0)}</dd></div></dl>
      </details>
    </section>
  `;
}

export { roomHref };

export default { renderResearchRoom, roomHref };
