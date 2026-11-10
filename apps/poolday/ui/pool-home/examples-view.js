/**
 * @fileoverview The Examples route: protein-sequence and document-search examples with their
 * run form and result, and the dashboard view named in the URL.
 */
import { escapeHtml } from '../../../../shared/ui/components/html.js';
import { renderDiamond } from '../components/diamond.js';
import { LAUNCH_MODEL, POOLDAY_MODEL_WORKLOADS } from '../../../../shared/pool/model-contract.js';
import { LAB_SURFACE_IDS, SURFACE_INTENTS } from '../../../../shared/config/surface-intents.js';
import { renderPowerTower } from './shell-view.js';
import { POOLDAY_NAME, ROUTE_COPY, choosePooldayAskPlaceholderForLane } from './constants.js';
import { renderDocumentSearch } from './document-search.js';
import { renderModelOptions, renderPackSummary, renderPolicyOptions } from './route-controls.js';
import { renderResultBox } from './run-result-view.js';

export const POOL_DASHBOARD_VIEWS = Object.freeze(['home', 'compute', 'records']);

export const normalizePoolDashboardView = (value) => (
  POOL_DASHBOARD_VIEWS.includes(value) ? value : 'home'
);

export const getPoolDashboardView = () => {
  try {
    return normalizePoolDashboardView(new URLSearchParams(window.location.search || '').get('view'));
  } catch {
    return 'home';
  }
};

export const renderHomeSimulation = ({ dashboardView = 'home' } = {}) => {
  const activeView = normalizePoolDashboardView(dashboardView);
  const suggestedPrompt = choosePooldayAskPlaceholderForLane('sequence');
  return `
    <section class="pool-home-stage pool-home-stage--focused" aria-label="Run a model" data-pool-run-surface="home" data-run-state="idle" data-run-phase="" data-pool-lane="sequence" data-pool-dashboard-view="${activeView}">
      <div class="pool-home-toolbar" aria-label="${escapeHtml(POOLDAY_NAME)}">
        <div class="pool-home-toolbar-leading pool-home-overlay" aria-label="${escapeHtml(POOLDAY_NAME)} overview">
          <div class="pool-home-title-lockup">
            <h1 class="pool-home-brand-word pool-wordmark">${escapeHtml(POOLDAY_NAME)}${renderPowerTower()}</h1>
            <p class="pool-caption pool-hero-body pool-home-brand-promise">${escapeHtml(ROUTE_COPY.examples.body)}</p>
            <p class="pool-caption pool-home-brand-status" data-pool-brand-status hidden></p>
          </div>
          <div class="pool-prism" data-pool-prism aria-hidden="true">
            ${renderDiamond({ id: 'examples-diamond' })}
          </div>
        </div>
      </div>
      <div class="pool-home-task">
        <h2 class="pool-heading">Explore examples</h2>
        <p class="pool-caption">These are application examples, not the limits of Reploid. <a href="/" data-pool-route-link="/">Start with a goal instead</a>.</p>
        <div class="pool-workflow-switcher pool-segmented" role="group" aria-label="Choose an example">
          <button type="button" class="pool-segment" data-pool-workflow="sequence" aria-pressed="true" aria-controls="pool-home-ask-form">Protein sequences</button>
          <button type="button" class="pool-segment" data-pool-workflow="documents" aria-pressed="false" aria-controls="pool-document-search">Document search</button>
        </div>
        ${renderDocumentSearch()}
        <form class="pool-home-ask-dock pool-home-cta-row pool-home-ask-form pool-task-card pool-surface" id="pool-home-ask-form" aria-label="Run a model">
          <header class="pool-home-task-heading">
            <h2 class="pool-heading">Run a model</h2>
          </header>
          <label class="pool-field">
            <span class="pool-small pool-muted">Model</span>
            <select id="pool-home-request-model" data-pool-request-control>
              ${renderModelOptions({ workload: POOLDAY_MODEL_WORKLOADS.sequenceEmbedding })}
            </select>
          </label>
          <label class="pool-home-sequence-field" for="pool-home-ask-prompt">
            <span class="pool-sequence-heading pool-small pool-muted"><span>Public protein sequence</span><output id="pool-sequence-count" for="pool-home-ask-prompt">0 / ${Number(LAUNCH_MODEL.sequence?.maxLength || 1024)}</output></span>
            <textarea
              id="pool-home-ask-prompt"
              class="pool-home-ask-input pool-mono pool-small"
              name="sequence"
              rows="4"
              aria-label="Public protein sequence"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              aria-describedby="pool-sequence-feedback pool-sequence-count"
              placeholder="${escapeHtml(suggestedPrompt)}"
              data-pool-suggested-prompt="${escapeHtml(suggestedPrompt)}"
              data-pool-request-control
            ></textarea>
          </label>
          <div class="pool-sequence-help">
            <p class="pool-sequence-feedback pool-small pool-muted" id="pool-sequence-feedback" aria-live="polite"></p>
            <button class="btn btn-ghost" type="button" data-pool-use-example data-pool-request-control>Use example</button>
          </div>
          <div class="pool-sequence-options pool-caption pool-muted pool-surface" data-pool-sequence-options>
            <label class="pool-consent-row pool-small" data-pool-sequence-consent-row>
              <input id="pool-home-sequence-public" type="checkbox" data-pool-request-control>
              <span>This input may be sent to selected peers</span>
            </label>
            <strong data-pool-sequence-consent-saved hidden>Saved</strong>
          </div>
          <details class="pool-advanced pool-disclosure pool-home-request-details">
            <summary>Options</summary>
            ${renderPackSummary(LAUNCH_MODEL, { disclosure: false })}
            <div class="pool-advanced-grid">
              <label class="pool-field">
                <span class="pool-small pool-muted">Verification</span>
                <select id="pool-home-request-policy" data-pool-request-control>${renderPolicyOptions()}</select>
              </label>
              <label class="pool-home-adapter-picker pool-caption pool-surface" data-pool-home-adapter-picker hidden>
                <span class="pool-label">Model adapter</span>
                <select id="pool-home-adapter" data-pool-run-adapter data-pool-request-control disabled>
                  <option value="">Loading published adapters…</option>
                </select>
                <small data-pool-adapter-status hidden></small>
              </label>
            </div>
          </details>
          <div class="pool-home-submit-row">
            <button class="btn btn-primary pool-home-run-button pool-primary-action pool-button" id="pool-home-run-submit" type="submit" data-pool-request-control aria-label="Run model">Run model</button>
            <p class="pool-home-run-status pool-caption pool-muted" data-pool-run-status aria-live="polite">Ready</p>
          </div>
        </form>
        <section class="pool-home-result-panel pool-surface" data-pool-run-output hidden aria-label="Run result">
          ${renderResultBox('pool-home-run-result', {
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
      <footer class="pool-experiments-footer pool-small pool-muted">
        <nav aria-label="Experiments">
          <span>Experiments</span>
          ${LAB_SURFACE_IDS.map((id) => {
            const { label, route } = SURFACE_INTENTS[id];
            return `<a href="${escapeHtml(route)}" data-pool-substrate-route="${escapeHtml(id)}">${escapeHtml(label)}</a>`;
          }).join('')}
        </nav>
      </footer>
    </section>
  `;
};
