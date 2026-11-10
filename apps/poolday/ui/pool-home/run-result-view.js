/**
 * @fileoverview Run result boxes: the streamed answer, summary, proof, protein embedding,
 * recovery actions and raw result, and restoring the last accepted run.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { getPeerRoomId } from '../../host/product-context.js';
import { getRouteId } from './shell-view.js';
import { POOLDAY_STREAM_CHUNK_SIZE, POOLDAY_STREAM_TICK_MS } from './constants.js';
import { getPoolLedgerStore } from './ledger-store.js';
import { roomHref } from './room-view.js';
import { setPoolHtml, compactHash, safeJsonStringify } from './view-markup.js';
import { extractOutputText, extractResultSummary, formatErrorResultText, formatResultMessage, isEmbeddingPublicationPermitted, isErrorResult, sequenceOutputFor } from './run-result-format.js';
import { renderContributionDetails, renderRunContributionLayer } from './run-contribution-evidence.js';
import { ensureReceiptLedgerLoaded, recordPeerLedgerEvents, refreshPeerLedgerState, refreshRecordTimelineState } from './record-ledger-view.js';
import { setPoolRunVisualState } from './run-visual-state.js';

const ledgerStore = getPoolLedgerStore();

const streamOutputText = (elementId, text) => {
  const outputEl = document.getElementById(elementId);
  if (!outputEl) return;
  const value = String(text || '');
  const previous = ledgerStore.streams.get(elementId);
  if (previous?.timer) window.clearTimeout(previous.timer);
  outputEl.textContent = '';
  if (!value.length) {
    const cursorEl = document.getElementById(`${elementId}-cursor`);
    if (cursorEl) cursorEl.classList.remove('is-visible', 'is-active');
    ledgerStore.streams.delete(elementId);
    return;
  }
  ledgerStore.streams.set(elementId, {
    text: value,
    timer: null,
    index: 0
  });
  const cursorEl = document.getElementById(`${elementId}-cursor`);
  const tick = () => {
    const state = ledgerStore.streams.get(elementId);
    if (!state) return;
    state.index += POOLDAY_STREAM_CHUNK_SIZE;
    outputEl.textContent = value.slice(0, state.index);
    if (state.index < value.length) {
      state.timer = window.setTimeout(tick, POOLDAY_STREAM_TICK_MS);
    } else {
      ledgerStore.streams.delete(elementId);
      if (cursorEl) cursorEl.classList.remove('is-active');
    }
  };
  if (cursorEl) cursorEl.classList.add('is-visible', 'is-active');
  tick();
};

const renderSummaryRows = (summary) => summary.map(([label, value]) => `
  <span class="pool-summary-item">
    <span class="rgr-status-label pool-label pool-muted">${escapeHtml(label)}</span>
    <span class="rgr-status-value">${escapeHtml(label === 'Status' ? value : compactHash(value))}</span>
  </span>
`).join('');

const renderRawDetails = (id, label = 'Full result', options = {}) => `
  <details class="pool-raw-details pool-disclosure${options.full ? ' pool-raw-details-full' : ''}">
    <summary>${escapeHtml(label)}</summary>
    <pre class="pool-result pool-mono pool-surface pool-result-raw" id="${id}-raw" aria-live="polite"></pre>
  </details>
`;

const renderProteinEmbeddingDetails = (id) => `
  <details class="pool-raw-details pool-disclosure pool-protein-embedding-details" id="${id}-embedding-details" hidden>
    <summary>View embedding vector</summary>
    <p class="pool-caption" id="${id}-embedding-meta"></p>
    <pre id="${id}-embedding" aria-label="Pooled protein embedding"></pre>
  </details>
`;

const renderProteinEmbeddingOutcome = (id) => `
  <section class="pool-embedding-outcome pool-surface" id="${id}-embedding-outcome" aria-live="polite" hidden>
    <p class="pool-embedding-outcome-kicker pool-label pool-muted">Protein representation</p>
    <h3 class="type-h3">Embedding ready</h3>
    <p class="pool-embedding-outcome-meta pool-caption pool-muted pool-mono" id="${id}-embedding-outcome-meta"></p>
    <p class="pool-embedding-outcome-copy pool-small">480 values for comparing sequences from this exact ESM-2 model and contract.</p>
    <p class="pool-embedding-outcome-copy pool-small">Not a biological interpretation or diagnosis.</p>
    <div class="pool-embedding-outcome-actions">
      <button class="btn btn-ghost" type="button" data-pool-copy-embedding data-pool-embedding-result-id="${id}" disabled>Copy vector</button>
      <a class="btn btn-ghost" href="${escapeHtml(roomHref('/records', getPeerRoomId()))}">Recent jobs</a>
      <p class="pool-embedding-copy-status pool-caption pool-muted" data-pool-embedding-copy-status aria-live="polite"></p>
    </div>
    <p class="pool-embedding-copy-status pool-caption pool-muted" id="${id}-research-status" aria-live="polite"></p>
  </section>
`;

export const setResearchPublicationStatus = (resultId, message) => {
  const element = document.getElementById(`${resultId}-research-status`);
  if (element) element.textContent = String(message || '');
};

export const renderResultBox = (id, options = {}) => {
  if (options?.stream) {
    return `
      <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
      ${options.proteinEmbedding ? renderProteinEmbeddingOutcome(id) : ''}
      <div class="pool-stream-box pool-answer-box">
        <label class="pool-result-label" for="${id}-stream">${escapeHtml(options.streamLabel || 'Output stream')}</label>
        <div class="pool-stream-shell pool-surface">
          <pre class="pool-stream-output pool-mono" id="${id}-stream" aria-live="polite"></pre>
          <span class="pool-stream-cursor pool-muted" id="${id}-stream-cursor" aria-hidden="true">▍</span>
        </div>
      </div>
      <div class="pool-run-recovery" id="${id}-recovery" aria-live="polite" hidden></div>
      ${options.evidence ? renderContributionDetails(id, options.evidenceLabel || 'Contributors') : ''}
      ${options.proteinEmbedding ? renderProteinEmbeddingDetails(id) : ''}
      ${renderRawDetails(id, options.rawLabel || 'Full result', { full: options.rawFull === true })}
    `;
  }
  const placeholder = options.placeholder || 'No local activity yet.';
  return `
  <div class="boot-status-strip pool-summary" id="${id}-summary" aria-live="polite"></div>
  <p class="pool-result-message pool-surface" id="${id}" aria-live="polite">${escapeHtml(placeholder)}</p>
  <div class="pool-run-recovery" id="${id}-recovery" aria-live="polite" hidden></div>
  ${renderRawDetails(id, options.rawLabel || 'Full result', { full: options.rawFull === true })}
  `;
};

const renderProteinEmbeddingOutput = (id, value = {}) => {
  const details = document.getElementById(`${id}-embedding-details`);
  const output = document.getElementById(`${id}-embedding`);
  const meta = document.getElementById(`${id}-embedding-meta`);
  const outcome = document.getElementById(`${id}-embedding-outcome`);
  const outcomeMeta = document.getElementById(`${id}-embedding-outcome-meta`);
  const copyButton = outcome?.querySelector('[data-pool-copy-embedding]');
  const copyStatus = outcome?.querySelector('[data-pool-embedding-copy-status]');
  const pooledEmbedding = sequenceOutputFor(value)?.pooledEmbedding;
  if (!details || !output || !meta) return;
  if (!Array.isArray(pooledEmbedding) || pooledEmbedding.length === 0) {
    details.hidden = true;
    output.textContent = '';
    meta.textContent = '';
    if (outcome) outcome.hidden = true;
    if (outcomeMeta) outcomeMeta.textContent = '';
    if (copyButton) copyButton.disabled = true;
    if (copyStatus) copyStatus.textContent = '';
    return;
  }
  const resultIdentity = compactHash(value.sequenceResultHash || value.vectorHash || '');
  const publicationPermitted = isEmbeddingPublicationPermitted(value);
  details.hidden = !publicationPermitted;
  meta.textContent = publicationPermitted
    ? `${pooledEmbedding.length} dimensions · ${resultIdentity}`
    : `${pooledEmbedding.length} dimensions · ${resultIdentity} · Raw vector withheld`;
  if (outcome) outcome.hidden = false;
  if (outcomeMeta) outcomeMeta.textContent = publicationPermitted
    ? `${pooledEmbedding.length} dimensions · Result ${resultIdentity}`
    : `${pooledEmbedding.length} dimensions · Result ${resultIdentity} · Raw vector withheld because embedding publication consent was not granted.`;
  if (copyButton) {
    copyButton.disabled = !publicationPermitted;
    copyButton.dataset.poolEmbeddingPublicationPermitted = String(publicationPermitted);
  }
  if (copyStatus) copyStatus.textContent = publicationPermitted
    ? ''
    : 'The raw embedding is withheld because publication consent was not granted.';
  output.textContent = publicationPermitted ? (safeJsonStringify(pooledEmbedding) || '[]') : '';
};

const renderRecoveryAction = (action = {}) => {
  const id = String(action.id || '').trim();
  const label = String(action.label || '').trim();
  if (!id || !label) return '';
  const className = action.primary === true ? 'btn btn-primary' : 'btn btn-ghost';
  if (action.href) {
    return `
      <a class="${className}" href="${escapeHtml(action.href)}" data-pool-run-recovery-action="${escapeHtml(id)}">${escapeHtml(label)}</a>
    `;
  }
  return `
    <button class="${className}" type="button" data-pool-run-recovery-action="${escapeHtml(id)}">${escapeHtml(label)}</button>
  `;
};

const renderRunRecovery = (recovery = null) => {
  if (!recovery || typeof recovery !== 'object') return '';
  const actions = Array.isArray(recovery.actions)
    ? recovery.actions.map(renderRecoveryAction).filter(Boolean).join('')
    : '';
  const details = Array.isArray(recovery.details)
    ? recovery.details.filter(Boolean).map((detail) => `<li>${escapeHtml(detail)}</li>`).join('')
    : '';
  if (!recovery.title && !recovery.message && !actions && !details) return '';
  return `
    <section class="pool-run-recovery-card pool-small pool-surface" data-pool-run-recovery-kind="${escapeHtml(recovery.kind || 'attention')}">
      ${recovery.title ? `<h2 class="type-h3">${escapeHtml(recovery.title)}</h2>` : ''}
      ${recovery.message ? `<p>${escapeHtml(recovery.message)}</p>` : ''}
      ${details ? `<ul>${details}</ul>` : ''}
      ${actions ? `<div class="pool-run-recovery-actions">${actions}</div>` : ''}
    </section>
  `;
};

export const setResult = (id, value, options = {}) => {
  if (value && typeof value === 'object') {
    recordPeerLedgerEvents(value.ledgerEvents || value.body?.ledgerEvents || []);
    refreshPeerLedgerState();
    refreshRecordTimelineState();
  }
  const summaryEl = document.getElementById(`${id}-summary`);
  const streamMode = !!options.stream;
  const outputText = streamMode ? extractOutputText(value) : null;
  const summary = value && typeof value === 'object' ? extractResultSummary(value) : [];
  const raw = value === undefined || value === null
    ? ''
    : typeof value === 'string'
      ? value
      : isErrorResult(value)
        ? formatErrorResultText(value)
      : safeJsonStringify(value, { redactSequenceOutput: true }) || String(value);
  const streamEl = streamMode ? document.getElementById(`${id}-stream`) : document.getElementById(id);
  const streamCursor = streamMode ? document.getElementById(`${id}-stream-cursor`) : null;
  const rawEl = document.getElementById(`${id}-raw`);
  const evidenceEl = document.getElementById(`${id}-evidence`);
  const recoveryEl = document.getElementById(`${id}-recovery`);
  const answerBox = streamMode ? streamEl?.closest?.('.pool-answer-box') : null;
  if (summaryEl) {
    setPoolHtml(summaryEl, summary.length > 0 ? renderSummaryRows(summary) : '');
  }
  if (recoveryEl) {
    const recoveryHtml = renderRunRecovery(value?.recovery);
    setPoolHtml(recoveryEl, recoveryHtml);
    recoveryEl.hidden = !recoveryHtml;
  }
  if (answerBox) answerBox.hidden = Boolean(value?.recovery);
  if (rawEl) rawEl.textContent = raw;
  if (value && typeof value === 'object') renderProteinEmbeddingOutput(id, value);
  if (evidenceEl && value && typeof value === 'object') {
    setPoolHtml(evidenceEl, renderRunContributionLayer(value));
  }
  if (streamMode && streamEl) {
    if (outputText && outputText.length > 0) {
      if (options.animate === false) {
        const previous = ledgerStore.streams.get(`${id}-stream`);
        if (previous?.timer) window.clearTimeout(previous.timer);
        ledgerStore.streams.delete(`${id}-stream`);
        streamEl.textContent = outputText;
        if (streamCursor) streamCursor.classList.remove('is-visible', 'is-active');
      } else {
        if (streamCursor) streamCursor.classList.add('is-visible', 'is-active');
        streamOutputText(`${id}-stream`, outputText);
      }
    } else {
      const previous = ledgerStore.streams.get(`${id}-stream`);
      if (previous?.timer) window.clearTimeout(previous.timer);
      ledgerStore.streams.delete(`${id}-stream`);
      streamEl.textContent = formatResultMessage(value);
      if (streamCursor) streamCursor.classList.remove('is-visible', 'is-active');
    }
    return;
  }
  if (streamMode) return;
  const outputEl = document.getElementById(id);
  if (outputEl) {
    outputEl.textContent = formatResultMessage(value);
  }
};

export const restoreLatestCompletedRun = (routeId = getRouteId()) => {
  const targetId = routeId === 'home'
    ? 'pool-home-run-result'
    : routeId === 'ask'
      ? 'pool-run-result'
      : null;
  if (!targetId || !document.getElementById(`${targetId}-raw`)) return null;
  ensureReceiptLedgerLoaded();
  const row = ledgerStore.receipts.find((candidate) => (
    candidate?.record?.agreement?.accepted === true
    || candidate?.record?.requesterAcceptance?.accepted === true
    || (candidate?.record?.transport === 'local_capsule' && candidate.record.status === 'completed'
      && candidate.receiptHash === candidate.record.localExecution?.receipt?.receiptDigest)
  ));
  if (!row) return null;
  const restored = {
    ...(row.record || {}),
    receiptHash: row.receiptHash,
    savedRecord: {
      restored: true,
      roomId: getPeerRoomId(),
      occurredAt: row.occurredAt || null
    }
  };
  setResult(targetId, restored, { stream: true, animate: false });
  setPoolRunVisualState({
    state: 'inspecting',
    phase: 'saved',
    message: restored.transport === 'local_capsule' ? 'Showing last saved local result' : 'Showing last saved answer'
  });
  return restored;
};
