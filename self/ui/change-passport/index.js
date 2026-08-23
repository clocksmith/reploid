/**
 * @fileoverview Operator interface for Change Passports.
 */

import { verifyChangePassportExport } from '../../core/change-passport.js';
import ChangePassportBrowserClient from './client.js';

const SERVER_KEY = 'reploid.change-passport.server.v1';
const TOKEN_KEY = 'reploid.change-passport.token.v1';

export const escapeChangePassportHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const pretty = (value) => escapeChangePassportHtml(JSON.stringify(value, null, 2));
const list = (value) => Array.isArray(value) ? value : [];
const idempotencyKey = (type) => `ui:${type}:${globalThis.crypto?.randomUUID?.() || Date.now()}`;

const stateBadge = (axis, value) => `
  <article class="passport-state-card" data-axis="${escapeChangePassportHtml(axis)}" data-state="${escapeChangePassportHtml(value)}">
    <span>${escapeChangePassportHtml(axis)}</span>
    <strong>${escapeChangePassportHtml(value)}</strong>
  </article>
`;

const renderEvidenceRows = (items, excluded = false) => {
  if (!items.length) return '<p class="passport-empty">None recorded.</p>';
  return items.map((item) => `
    <article class="passport-record ${excluded ? 'is-excluded' : ''}">
      <header><strong>${escapeChangePassportHtml(item.evidenceId)}</strong><span>${escapeChangePassportHtml(item.kind)}</span></header>
      <p>${escapeChangePassportHtml(item.summary)}</p>
      <dl>
        <div><dt>Digest</dt><dd><code>${escapeChangePassportHtml(item.digest)}</code></dd></div>
        <div><dt>Source</dt><dd>${escapeChangePassportHtml(item.source)}</dd></div>
        ${excluded ? `<div><dt>Exclusion</dt><dd>${escapeChangePassportHtml(item.reason)}</dd></div>` : ''}
      </dl>
    </article>
  `).join('');
};

const renderEventRows = (items, empty) => {
  if (!items.length) return `<p class="passport-empty">${escapeChangePassportHtml(empty)}</p>`;
  return items.map((item) => `
    <article class="passport-record">
      <header>
        <strong>${escapeChangePassportHtml(item.reviewId || item.evaluationId || item.objectionId || item.outcomeId || item.ruleId || item.rollbackId || 'record')}</strong>
        <span>${escapeChangePassportHtml(item.verdict || item.conclusion || item.severity || item.status || item.action || '')}</span>
      </header>
      <p>${escapeChangePassportHtml(item.rationale || item.statement || item.summary || item.reason || item.failureReason || '')}</p>
      <small>${escapeChangePassportHtml(item.actor?.authorityId || '')} ${escapeChangePassportHtml(item.actor?.role || '')}</small>
    </article>
  `).join('');
};

export function renderChangePassportDetail(result, events = [], principal = null) {
  const projection = result?.projection;
  if (!projection) return '<section class="passport-panel"><p>Select a Change Passport.</p></section>';
  const roles = new Set(principal?.roles || [
    'evidence_producer',
    'evaluator',
    'security_reviewer',
    'change_authority',
    'activator',
    'observer',
    'rollback_authority'
  ]);
  const can = (...allowed) => allowed.some((role) => roles.has(role));
  const reviewerRoles = list(projection.policy?.requiredReviewerRoles);
  const evidenceRole = roles.has('evidence_producer') ? 'evidence_producer' : 'evaluator';
  const reviewRole = reviewerRoles.find((role) => roles.has(role))
    || (roles.has('security_reviewer') ? 'security_reviewer' : 'change_authority');
  const lifecycleOptions = [
    ['objection.recorded', ['evaluator', 'security_reviewer', 'change_authority']],
    ['evidence.frozen', ['change_authority']],
    ['evidence.invalidated', ['evidence_producer', 'evaluator', 'observer', 'change_authority']],
    ['effect.execute', ['activator']],
    ['effect.requested', ['activator']],
    ['effect.recorded', ['activator']],
    ['outcome.recorded', ['observer']],
    ['trigger.declared', ['change_authority']],
    ['trigger.observed', ['observer']],
    ['decision.revoked', ['change_authority']],
    ['rollback.execute', ['rollback_authority']],
    ['rollback.requested', ['rollback_authority']],
    ['rollback.recorded', ['rollback_authority', 'activator']],
    ['passport.superseded', ['change_authority']]
  ].filter(([, allowed]) => can(...allowed));
  const optionHtml = lifecycleOptions.map(([type, allowed]) => {
    const role = allowed.find((entry) => roles.has(entry));
    return `<option value="${escapeChangePassportHtml(type)}" data-role="${escapeChangePassportHtml(role)}">${escapeChangePassportHtml(type)}</option>`;
  }).join('');
  const unresolvedObjections = list(projection.objections).filter((item) => !item.resolution);
  const effectHistory = list(projection.effect?.history);
  const rollbackHistory = list(projection.effect?.rollbackHistory);
  return `
    <section class="passport-detail" data-passport-detail="${escapeChangePassportHtml(projection.passportId)}">
      <header class="passport-detail-header">
        <div>
          <p class="passport-kicker">${escapeChangePassportHtml(projection.changeClass)}</p>
          <h2>${escapeChangePassportHtml(projection.proposal?.title)}</h2>
          <p>${escapeChangePassportHtml(projection.proposal?.summary)}</p>
        </div>
        <div class="passport-detail-actions">
          <button type="button" data-action="refresh">Refresh</button>
          <button type="button" data-action="export">Export and verify</button>
        </div>
      </header>

      <div class="passport-state-grid" aria-label="Passport state" data-deco-source-file="self/ui/change-passport/index.js" data-deco-source-name="ChangePassportStateGrid" data-deco-source-framework="vanilla">
        ${stateBadge('Evidence', projection.evidence?.state)}
        ${stateBadge('Decision', projection.decision?.state)}
        ${stateBadge('Effect', projection.effect?.state)}
      </div>

      <section class="passport-panel">
        <h3>Proposed change</h3>
        <dl class="passport-facts">
          <div><dt>Repository</dt><dd>${escapeChangePassportHtml(`${projection.proposal?.repository?.owner}/${projection.proposal?.repository?.name}`)}</dd></div>
          <div><dt>Candidate</dt><dd><code>${escapeChangePassportHtml(projection.proposal?.candidateRevision)}</code></dd></div>
          <div><dt>Target</dt><dd>${escapeChangePassportHtml(projection.proposal?.target?.targetId)}</dd></div>
          <div><dt>Rollback</dt><dd><code>${escapeChangePassportHtml(projection.rollback?.artifactHash)}</code></dd></div>
        </dl>
      </section>

      <section class="passport-panel">
        <h3>Policy and blockers</h3>
        <p class="passport-gate ${result.gate?.eligible ? 'is-eligible' : 'is-blocked'}">
          ${result.gate?.eligible ? 'Eligible under the frozen policy.' : escapeChangePassportHtml(list(result.gate?.reasons).join(' | ') || 'Blocked.')}
        </p>
        <details><summary>Frozen policy</summary><pre>${pretty(projection.policy)}</pre></details>
      </section>

      <div class="passport-two-column">
        <section class="passport-panel"><h3>Admitted evidence</h3>${renderEvidenceRows(list(projection.evidence?.admitted))}</section>
        <section class="passport-panel"><h3>Excluded evidence</h3>${renderEvidenceRows(list(projection.evidence?.excluded), true)}</section>
      </div>

      <div class="passport-two-column">
        <section class="passport-panel"><h3>Evaluations</h3>${renderEventRows(list(projection.evaluations), 'No evaluations recorded.')}</section>
        <section class="passport-panel"><h3>Objections and disagreement</h3>${renderEventRows(list(projection.objections), 'No objections recorded.')}</section>
      </div>

      <section class="passport-panel"><h3>Reviews and authority</h3>${renderEventRows(list(projection.reviews), 'No reviews recorded.')}</section>

      <div class="passport-two-column">
        <section class="passport-panel"><h3>Applied effects and outcomes</h3>${renderEventRows([...effectHistory, ...list(projection.outcomes)], 'No effect or outcome recorded.')}</section>
        <section class="passport-panel"><h3>Reopening and rollback</h3>${renderEventRows([
          ...list(projection.triggers?.observed),
          ...list(projection.decision?.reopenings),
          ...list(projection.effect?.rollbackRequests),
          ...rollbackHistory
        ], 'No reopening or rollback recorded.')}</section>
      </div>

      ${can('evidence_producer', 'evaluator') ? `<section class="passport-panel passport-operator-panel" data-authorized-action="evidence">
        <h3>Submit evidence</h3>
        <form data-form="evidence">
          <label>Mode<select name="mode"><option value="evidence.admitted">Admit</option><option value="evidence.excluded">Exclude</option></select></label>
          <label>Role<input name="role" value="${escapeChangePassportHtml(evidenceRole)}" required readonly></label>
          <label class="passport-wide">Evidence JSON<textarea name="payload" rows="8" required>{
  "evidenceId": "evidence:new",
  "kind": "tests",
  "digest": "sha256:",
  "source": "",
  "uri": null,
  "summary": "",
  "observedAt": "${escapeChangePassportHtml(new Date().toISOString())}",
  "custody": { "mode": "reference_only", "accessRequired": true, "retention": "source_owned" }
}</textarea></label>
          <button type="submit">Record evidence</button>
        </form>
      </section>` : ''}

      ${can('change_authority', 'security_reviewer', ...reviewerRoles) ? `<section class="passport-panel passport-operator-panel" data-authorized-action="review">
        <h3>Record review</h3>
        <form data-form="review">
          <label>Verdict<select name="verdict"><option>approve</option><option>reject</option><option>contest</option><option>unresolved</option><option value="request_evidence">request evidence</option></select></label>
          <label>Role<input name="role" value="${escapeChangePassportHtml(reviewRole)}" required readonly></label>
          <label class="passport-wide">Rationale<textarea name="rationale" rows="3" required></textarea></label>
          <label>Evidence IDs<input name="evidenceIds" placeholder="evidence:one, evidence:two"></label>
          <label>Resolved objection IDs<input name="objectionIds" value="${escapeChangePassportHtml(unresolvedObjections.map((item) => item.objectionId).join(', '))}"></label>
          <button type="submit">Record review</button>
        </form>
      </section>` : ''}

      ${can('change_authority') ? `<section class="passport-panel passport-operator-panel" data-authorized-action="decision">
        <h3>Record decision</h3>
        <form data-form="decision">
          <label>State<select name="state"><option>approved</option><option>rejected</option><option>unresolved</option></select></label>
          <label>Role<input name="role" value="change_authority" required></label>
          <label class="passport-wide">Rationale<textarea name="rationale" rows="3" required></textarea></label>
          <button type="submit">Record decision</button>
        </form>
      </section>` : ''}

      ${lifecycleOptions.length ? `<section class="passport-panel passport-operator-panel" data-authorized-action="lifecycle">
        <h3>Lifecycle action</h3>
        <form data-form="lifecycle">
          <label>Event<select name="type">${optionHtml}</select></label>
          <label>Role<input name="role" value="${escapeChangePassportHtml(lifecycleOptions[0]?.[1].find((entry) => roles.has(entry)) || '')}" required readonly></label>
          <label class="passport-wide">Payload JSON<textarea name="payload" rows="8" required>{}</textarea></label>
          <button type="submit">Submit lifecycle event</button>
        </form>
      </section>` : ''}

      <section class="passport-panel">
        <details>
          <summary>Raw signed events (${events.length})</summary>
          <pre data-passport-raw-events>${pretty(events)}</pre>
        </details>
      </section>
    </section>
  `;
}

export function renderChangePassportApp(state = {}) {
  const connected = !!state.client;
  const selectedId = state.current?.projection?.passportId || null;
  const canCreate = !state.principal || list(state.principal.roles).includes('proposer');
  return `
    <main class="passport-app" data-connected="${connected}">
      <header class="passport-app-header">
        <div>
          <p class="passport-kicker">Reploid</p>
          <h1>Change Passports</h1>
          <p>Evidence, disagreement, approval, activation, outcome, rollback, and reopening for consequential agent changes.</p>
        </div>
        <a href="/">Research Room</a>
      </header>
      <section class="passport-connect" aria-label="Change Passport connection">
        <form data-form="connect">
          <label>Service URL<input name="serverUrl" type="url" value="${escapeChangePassportHtml(state.serverUrl || '')}" required></label>
          <label>Access token<input name="accessToken" type="password" value="" autocomplete="current-password" ${connected ? '' : 'required'}></label>
          <button type="submit">${connected ? 'Reconnect' : 'Connect'}</button>
          ${connected ? '<button type="button" data-action="disconnect">Disconnect</button>' : ''}
        </form>
        <p class="passport-status" role="status">${escapeChangePassportHtml(state.message || (connected ? 'Connected.' : 'Connect to an authorized Change Passport service.'))}</p>
      </section>
      ${connected ? `
        <div class="passport-workspace">
          <aside class="passport-sidebar">
            <div class="passport-sidebar-header"><h2>Passports</h2><button type="button" data-action="refresh-list">Refresh</button></div>
            <nav aria-label="Change Passports">
              ${list(state.passports).length ? list(state.passports).map((item) => `
                <button type="button" class="passport-list-item ${selectedId === item.passportId ? 'is-selected' : ''}" data-passport-id="${escapeChangePassportHtml(item.passportId)}">
                  <strong>${escapeChangePassportHtml(item.title)}</strong>
                  <span>${escapeChangePassportHtml(item.decisionState)} / ${escapeChangePassportHtml(item.effectState)}</span>
                </button>
              `).join('') : '<p class="passport-empty">No passports visible to this organization.</p>'}
            </nav>
            ${canCreate ? `<details class="passport-create">
              <summary>Create from frozen JSON</summary>
              <form data-form="create">
                <label>Role<input name="role" value="proposer" required></label>
                <label>Passport JSON<textarea name="payload" rows="12" required>{}</textarea></label>
                <button type="submit">Create passport</button>
              </form>
            </details>` : ''}
          </aside>
          <div class="passport-content">${renderChangePassportDetail(state.current, state.events, state.principal)}</div>
        </div>
      ` : ''}
    </main>
  `;
}

const parseCsv = (value) => String(value || '').split(',').map((entry) => entry.trim()).filter(Boolean);
const formJson = (form, field = 'payload') => JSON.parse(new FormData(form).get(field) || '{}');

export function initChangePassport(mount, options = {}) {
  if (!mount) throw new Error('Change Passport mount is required');
  const state = {
    serverUrl: options.serverUrl || localStorage.getItem(SERVER_KEY) || `${window.location.origin}/change-control`,
    accessToken: options.accessToken || sessionStorage.getItem(TOKEN_KEY) || '',
    client: null,
    principal: null,
    passports: [],
    current: null,
    events: [],
    message: ''
  };

  const render = () => {
    mount.innerHTML = renderChangePassportApp(state);
    bind();
  };

  const loadList = async (preferredId = null) => {
    state.passports = await state.client.list();
    const selected = preferredId
      || new URLSearchParams(window.location.search).get('id')
      || state.current?.projection?.passportId
      || state.passports[0]?.passportId;
    if (selected) await loadPassport(selected, { updateUrl: false });
  };

  const loadPassport = async (passportId, { updateUrl = true } = {}) => {
    const [current, events] = await Promise.all([
      state.client.get(passportId),
      state.client.events(passportId)
    ]);
    state.current = current;
    state.events = events;
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('id', passportId);
      history.replaceState(history.state, '', `${url.pathname}${url.search}`);
    }
    render();
  };

  const run = async (operation, success) => {
    try {
      state.message = 'Submitting...';
      render();
      const result = await operation();
      state.message = success;
      const passportId = result?.projection?.passportId || state.current?.projection?.passportId;
      await loadList(passportId);
      render();
    } catch (error) {
      state.message = error.message;
      render();
    }
  };

  const append = (type, payload, role) => {
    const passportId = state.current?.projection?.passportId;
    if (!passportId) throw new Error('Select a Change Passport first');
    if (type === 'trigger.observed') {
      return state.client.observeTrigger(passportId, payload, role, idempotencyKey(type));
    }
    if (type === 'effect.execute') {
      return state.client.executeEffect(passportId, payload, role, idempotencyKey(type));
    }
    if (type === 'rollback.execute') {
      return state.client.executeRollback(passportId, payload, role, idempotencyKey(type));
    }
    return state.client.append(passportId, type, payload, role, idempotencyKey(type));
  };

  const bind = () => {
    mount.querySelector('[data-form="connect"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const serverUrl = String(data.get('serverUrl') || state.serverUrl).trim();
      const token = String(data.get('accessToken') || state.accessToken).trim();
      run(async () => {
        state.client = new ChangePassportBrowserClient({ baseUrl: serverUrl, accessToken: token });
        state.serverUrl = serverUrl;
        state.accessToken = token;
        localStorage.setItem(SERVER_KEY, serverUrl);
        sessionStorage.setItem(TOKEN_KEY, token);
        state.principal = await state.client.principal();
        await loadList();
        return state.current;
      }, 'Connected.');
    });
    mount.querySelector('[data-action="disconnect"]')?.addEventListener('click', () => {
      sessionStorage.removeItem(TOKEN_KEY);
      state.accessToken = '';
      state.client = null;
      state.principal = null;
      state.passports = [];
      state.current = null;
      state.events = [];
      state.message = 'Disconnected.';
      render();
    });
    mount.querySelectorAll('[data-passport-id]').forEach((button) => {
      button.addEventListener('click', () => run(
        () => loadPassport(button.dataset.passportId),
        `Loaded ${button.dataset.passportId}.`
      ));
    });
    mount.querySelector('[data-action="refresh-list"]')?.addEventListener('click', () => run(() => loadList(), 'List refreshed.'));
    mount.querySelector('[data-action="refresh"]')?.addEventListener('click', () => run(
      () => loadPassport(state.current.projection.passportId, { updateUrl: false }),
      'Passport refreshed.'
    ));
    mount.querySelector('[data-action="export"]')?.addEventListener('click', () => run(async () => {
      const exported = await state.client.export(state.current.projection.passportId);
      const verification = await verifyChangePassportExport(exported);
      if (!verification.valid) throw new Error(`Export verification failed: ${verification.reasons.join('; ')}`);
      const blob = new Blob([`${JSON.stringify(exported, null, 2)}\n`], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${state.current.projection.passportId}.change-passport.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      return state.current;
    }, 'Export verified and downloaded.'));
    mount.querySelector('[data-form="create"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const payload = JSON.parse(data.get('payload') || '{}');
      const role = String(data.get('role') || 'proposer');
      run(() => state.client.create(payload, role, idempotencyKey('create')), 'Passport created.');
    });
    mount.querySelector('[data-form="evidence"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const type = String(data.get('mode'));
      run(() => append(type, JSON.parse(data.get('payload') || '{}'), String(data.get('role'))), 'Evidence recorded.');
    });
    mount.querySelector('[data-form="review"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const payload = {
        reviewId: `review:${Date.now()}`,
        verdict: String(data.get('verdict')),
        rationale: String(data.get('rationale')),
        evidenceIds: parseCsv(data.get('evidenceIds')),
        resolvesObjectionIds: parseCsv(data.get('objectionIds'))
      };
      run(() => append('review.recorded', payload, String(data.get('role'))), 'Review recorded.');
    });
    mount.querySelector('[data-form="decision"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const projection = state.current.projection;
      const payload = {
        decisionId: `decision:${Date.now()}`,
        state: String(data.get('state')),
        policyHash: projection.policy.policyHash,
        evaluationIds: list(projection.evaluations).map((item) => item.evaluationId),
        reviewIds: list(projection.reviews).map((item) => item.reviewId),
        rationale: String(data.get('rationale'))
      };
      run(() => append('decision.recorded', payload, String(data.get('role'))), 'Decision recorded.');
    });
    mount.querySelector('[data-form="lifecycle"]')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      const type = String(data.get('type'));
      run(() => append(type, formJson(event.currentTarget), String(data.get('role'))), 'Lifecycle event recorded.');
    });
    const lifecycleType = mount.querySelector('[data-form="lifecycle"] select[name="type"]');
    lifecycleType?.addEventListener('change', () => {
      const role = lifecycleType.selectedOptions[0]?.dataset.role || '';
      const roleInput = mount.querySelector('[data-form="lifecycle"] input[name="role"]');
      if (roleInput) roleInput.value = role;
    });
  };

  render();
  if (state.accessToken) {
    try {
      state.client = new ChangePassportBrowserClient({ baseUrl: state.serverUrl, accessToken: state.accessToken });
      state.client.principal().then((principal) => {
        state.principal = principal;
        return loadList();
      }).then(() => {
        state.message = 'Connected.';
        render();
      }).catch((error) => {
        state.client = null;
        state.message = error.message;
        render();
      });
    } catch (error) {
      state.message = error.message;
      render();
    }
  }
  return {
    getState: () => ({ ...state, accessToken: state.accessToken ? '[session token]' : '' }),
    refresh: () => loadList(),
    destroy: () => { mount.replaceChildren(); }
  };
}

export default initChangePassport;
