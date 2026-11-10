/**
 * @fileoverview The focused Ask, Compute, Records and Research Room-1 routes, each in the
 * shared route shell.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { getPeerRoomId } from '../../host/product-context.js';
import { LAUNCH_MODEL } from '../../../../shared/pool/model-contract.js';
import { readParticipationPreferences } from '../../../../shared/pool/participation-profile.js';
import { POOLDAY_VERSION_TAG, ROUTE_COPY } from './constants.js';
import { renderOperationSharing } from './operation-sharing.js';
import { renderRequesterConsentRows, renderRequesterIntentFields } from './requester-controls.js';
import { loadResearchRecords } from './research-store.js';
import { renderResearchWorkspace } from './research-view.js';
import { renderParticipationControl, renderModelOptions, renderPackSummary, renderPolicyOptions, renderSharingBoundary, renderSharingLimits } from './route-controls.js';
import { renderResultBox } from './run-result-view.js';
import { renderRecentContributionHistory } from './contribution-status-view.js';
import { renderProviderHealth } from './provider-status-view.js';
import { getPoolRecordFacet, readRecordViewState, renderPeerLedgerState, renderReceiptLedger, renderRecordLedger, renderRoomActivity } from './record-ledger-view.js';
import { getPoolReviewTarget, getPoolRoomPanel, renderActiveResearchRoom } from './research-room-route.js';

const renderRouteShell = (copy, content, { routeId = 'records' } = {}) => `
  <section class="panel pool-panel pool-route-shell pool-task-card pool-surface" data-pool-route-shell="${escapeHtml(routeId)}">
    <div class="pool-page-heading">
      <h1 class="pool-title">${escapeHtml(copy.title)}</h1>
      <p class="pool-caption pool-hero-body">${escapeHtml(copy.body)}</p>
    </div>
    ${content}
  </section>
`;

export const renderRouteDetail = (routeId) => {
  if (['home', 'network', 'improve', 'examples'].includes(routeId)) return '';
  const normalizedRouteId = routeId === 'history' || routeId === 'network' ? 'records' : routeId;
  const copy = ROUTE_COPY[normalizedRouteId] || ROUTE_COPY.home;
  if (normalizedRouteId === 'ask') {
    return renderRouteShell(copy, `
        ${renderParticipationControl({ surface: 'ask' })}
        <div class="pool-form pool-route-grid pool-run-layout" data-pool-run data-pool-run-surface="run" data-run-state="idle" data-run-phase="">
          <div class="pool-run-compose">
            <label class="pool-field">
              <span data-pool-run-prompt-label class="pool-small pool-muted">Protein sequence</span>
              <textarea id="pool-run-prompt" rows="6">MAPLALLLLGLVAGA</textarea>
            </label>
            <div class="pool-run-model-row">
              <label class="pool-field pool-run-model-field">
                <span class="pool-small pool-muted">Model</span>
                <select id="pool-run-model">${renderModelOptions()}</select>
              </label>
              <span class="pool-workload-badge pool-label pool-chip" data-pool-run-workload>protein embedding</span>
            </div>
            ${renderPackSummary(LAUNCH_MODEL)}
            <label class="pool-field">
              <span class="pool-small pool-muted">Input disclosure</span>
              ${renderRequesterConsentRows({ prefix: 'pool-run', rowElement: 'span', includeResearch: false })}
              <small>The peer job sends the sequence only to selected contributors.</small>
            </label>
            <details class="pool-advanced pool-disclosure">
              <summary>Settings</summary>
              <div class="pool-advanced-grid">
                <label class="pool-field">
                  <span class="pool-small pool-muted">Verification</span>
                  <select id="pool-run-policy">${renderPolicyOptions()}</select>
                </label>
              </div>
            </details>
            <p class="pool-run-status pool-small pool-muted" data-pool-run-status aria-live="polite">Ready</p>
            <div class="pool-control-row pool-primary-actions" aria-label="Run controls">
              <button class="btn btn-primary pool-primary-action pool-button" id="pool-run-submit" type="button">Run</button>
            </div>
          </div>
          <section class="pool-run-output" data-pool-run-output hidden>
            <h2 class="pool-heading">Protein embedding</h2>
            ${renderResultBox('pool-run-result', {
              stream: true,
              streamLabel: 'Result',
              evidence: true,
              evidenceLabel: 'Proof',
              proteinEmbedding: true,
              rawLabel: 'Raw result',
              rawFull: true
            })}
          </section>
        </div>
    `, { routeId: normalizedRouteId });
  }
  if (normalizedRouteId === 'compute') {
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-provider-layout" data-pool-provider>
          <div class="pool-provider-main">
            <div class="pool-section-heading pool-provider-heading">
              <p class="pool-provider-status pool-label pool-dot" data-pool-provider-status>Idle</p>
            </div>
            <div id="pool-provider-node-stats" class="pool-node-status-line" aria-live="polite" hidden></div>
            <label class="pool-field">
              <span class="pool-small pool-muted">Model</span>
              <select id="pool-provider-model">${renderModelOptions()}</select>
            </label>
            ${renderPackSummary(LAUNCH_MODEL)}
            ${renderSharingBoundary(readParticipationPreferences(), LAUNCH_MODEL)}
            ${renderSharingLimits(readParticipationPreferences())}
            <div class="pool-provider-notice pool-small" data-pool-provider-notice aria-live="assertive" hidden></div>
            <div class="pool-control-row pool-primary-actions" aria-label="Contribution controls">
              <button class="btn btn-primary pool-primary-action pool-button" id="pool-provider-worker-toggle" type="button" aria-pressed="false">Start sharing</button>
            </div>
            ${renderOperationSharing()}
          </div>
          <section class="pool-inspector-shell" data-pool-contribution-history hidden>
            <h2 class="pool-heading">Recent receipts</h2>
            <div id="pool-provider-node-history" class="pool-ledger-shell pool-surface" aria-live="polite">${renderRecentContributionHistory()}</div>
          </section>
          <details class="pool-advanced pool-disclosure pool-provider-details" id="pool-provider-details">
            <summary>Advanced details</summary>
            <div class="pool-provider-detail-grid">
              ${renderParticipationControl({ surface: 'compute' })}
              <section aria-label="Contributor readiness">
                <h2 class="pool-heading">Readiness</h2>
                <div id="pool-provider-health" class="pool-ledger-shell pool-surface" aria-live="polite">${renderProviderHealth()}</div>
              </section>
              <details class="pool-advanced pool-disclosure">
                <summary>Debug event</summary>
              ${renderResultBox('pool-provider-result', { placeholder: 'No activity yet.', rawLabel: 'Full event' })}
              </details>
            </div>
          </details>
        </div>
    `, { routeId: normalizedRouteId });
  }
  if (normalizedRouteId === 'records') {
    const recordFacet = getPoolRecordFacet();
    return renderRouteShell(copy, `
        <div class="pool-form pool-route-grid pool-record-layout" data-pool-receipts data-pool-reputation>
          <div id="pool-record-ledger" aria-live="polite" data-record-facet="${escapeHtml(recordFacet)}">${renderRecordLedger(recordFacet)}</div>
          <details class="pool-advanced pool-disclosure pool-record-tools" data-pool-record-disclosure="technical-tools"${readRecordViewState().open['technical-tools'] ? ' open' : ''}>
            <summary>Advanced details</summary>
            <div class="pool-record-tool-grid">
              <section data-pool-room-activity>
                <h2 class="pool-heading">Peer activity and retries</h2>
                <div id="pool-room-activity" class="pool-ledger-shell pool-surface" aria-live="polite">${renderRoomActivity()}</div>
              </section>
              <section>
                <h2 class="pool-heading">Peer identities</h2>
                <div id="pool-peer-ledger" class="pool-ledger-shell pool-surface" aria-live="polite">${renderPeerLedgerState()}</div>
              </section>
              <section>
                <h2 class="pool-heading">Saved answer receipts</h2>
                <div id="pool-receipt-ledger" class="pool-ledger-shell pool-surface" aria-live="polite">${renderReceiptLedger()}</div>
              </section>
              <details class="pool-advanced pool-disclosure pool-record-lookup" data-pool-record-disclosure="receipt-lookup"${readRecordViewState().open['receipt-lookup'] ? ' open' : ''}>
                <summary>Find by receipt hash</summary>
                <label class="pool-field">
                  <span class="pool-small pool-muted">Hash</span>
                  <input id="pool-receipt-hash" placeholder="sha256:..." />
                </label>
                <div class="pool-control-row pool-primary-actions">
                  <button class="btn btn-primary btn-op" data-op="⚲" id="pool-receipt-lookup" type="button">Lookup</button>
                </div>
                ${renderResultBox('pool-receipt-result', { placeholder: 'No lookup yet.' })}
              </details>
              <section class="pool-record-recovery">
                <h2 class="pool-heading">Recovery</h2>
                <p>Submitted, interrupted, and failed jobs stay in the timeline. Open a job to inspect its valid retry, resume, cancel, or receipt actions.</p>
              </section>
            </div>
            <p class="pool-caption pool-protocol-version" aria-label="protocol identifier">Protocol ${POOLDAY_VERSION_TAG}</p>
          </details>
        </div>
    `, { routeId: normalizedRouteId });
  }
  if (normalizedRouteId === 'room-1') {
    const roomPanel = getPoolRoomPanel();
    const secondaryWorkspaceOpen = roomPanel === 'review' || roomPanel === 'discovery';
    const contextualPanel = roomPanel === 'review'
      ? {
          title: 'Review evidence',
          body: 'Make a signed decision or attach a correction to the evidence shown above.',
          target: 'pool-room-review'
        }
      : roomPanel === 'discovery'
        ? {
            title: 'Discover the next action',
            body: 'Inspect compatible evidence and approve a bounded follow-up without promoting a proposal into memory.',
            target: 'pool-room-discovery'
          }
        : null;
    return renderRouteShell(copy, `
      <div class="pool-form pool-route-grid pool-room-1-layout" data-pool-receipts data-pool-reputation>
        <section id="pool-room-1-request" class="pool-room-1-request" data-pool-run data-pool-run-surface="run" data-run-state="idle" data-run-phase="">
          <h2 class="pool-heading">Start a research question</h2>
          <label class="pool-field">
            <span class="pool-small pool-muted">Public protein sequence</span>
            <textarea id="pool-run-prompt" rows="6">MAPLALLLLGLVAGA</textarea>
          </label>
          <label class="pool-field">
            <span class="pool-small pool-muted">Model</span>
            <select id="pool-run-model">${renderModelOptions()}</select>
          </label>
          ${renderPackSummary(LAUNCH_MODEL)}
          <label class="pool-field">
            <span class="pool-small pool-muted">Publication</span>
            ${renderRequesterConsentRows({ prefix: 'pool-run', rowElement: 'span' })}
            <small>Research publication is explicit and separate from ordinary model runs.</small>
          </label>
          ${renderRequesterIntentFields({ prefix: 'pool-run', textTag: 'textarea' })}
          <label class="pool-field">
            <span class="pool-small pool-muted">Verification</span>
            <select id="pool-run-policy">${renderPolicyOptions()}</select>
          </label>
          <p class="pool-run-status pool-small pool-muted" data-pool-run-status aria-live="polite">Ready</p>
          <div class="pool-control-row pool-primary-actions">
            <button class="btn btn-primary pool-primary-action pool-button" id="pool-run-submit" type="button">Run and publish</button>
          </div>
          <section class="pool-run-output" data-pool-run-output hidden>
            ${renderResultBox('pool-run-result', {
              stream: true,
              streamLabel: 'Result',
              evidence: true,
              evidenceLabel: 'Proof',
              proteinEmbedding: true,
              rawLabel: 'Raw result',
              rawFull: true
            })}
          </section>
        </section>
        ${renderActiveResearchRoom(normalizedRouteId)}
        ${contextualPanel ? `<section class="pool-room-contextual-panel pool-surface" data-pool-room-contextual-panel="${escapeHtml(roomPanel)}"><h2 class="pool-heading">${escapeHtml(contextualPanel.title)}</h2><p>${escapeHtml(contextualPanel.body)}</p><a class="btn btn-ghost" href="#${escapeHtml(contextualPanel.target)}">Open panel controls</a></section>` : ''}
        <section class="pool-room-secondary-workspace" data-pool-room-panel="research"${secondaryWorkspaceOpen ? ' data-pool-room-panel-open="true"' : ''}>
          <h2 class="pool-heading">Research workspace</h2>
          <div id="pool-research-workspace-host">${renderResearchWorkspace(getPeerRoomId(), loadResearchRecords(getPeerRoomId()), { reviewTarget: getPoolReviewTarget() })}</div>
        </section>
      </div>
    `, { routeId: normalizedRouteId });
  }
  return '';
};
