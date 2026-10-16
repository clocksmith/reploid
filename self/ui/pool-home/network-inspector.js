import { withComputerLabels } from './computer-labels.js';
import { interfaceIcon } from '../components/interface-icons.js';
/** One projection of conversation execution, participant availability, and device contribution. */
import { renderSharingControls, renderConnectionControl, bindNetworkControls, projectNetworkPeers } from './network-controls.js';
import { bindDialog } from '../components/dialog.js';
import { updateModelSelect } from '../components/model-select.js';
import { escapeHtml as escape } from '../components/attachments.js';
import { projectExecutionRibbon, routeMarkup, detailMarkup } from './execution-ribbon.js';
import { renderRemotePermissionSettings, updateRemotePermissionSettings } from './remote-permission.js';
import { renderWebSearchSettings, bindWebSearchSettings } from './web-search-settings.js';
import { renderAccountPanel, bindAccountPanel } from './account-panel.js';

export function renderNetworkInspector() {
  return `<aside class="chat-network-rail pool-surface" data-network-rail aria-label="Network and settings">
    <nav class="pool-stack pool-gap-sm" data-inspector-navigation aria-label="Network sections">
      <button class="pool-button chat-network-toggle" type="button" data-inspector-section="participants" data-toggle-inspector aria-haspopup="dialog" aria-expanded="false" aria-label="Computers" title="Computers">${interfaceIcon('peers')}<span class="chat-rail-label">Computers</span><small class="chat-rail-digest pool-muted" data-rail-digest="participants"></small></button>
      <button class="pool-button chat-rail-icon" type="button" data-inspector-section="settings" aria-label="Settings" title="Settings">${interfaceIcon('settings')}<span class="chat-rail-label">Settings</span></button>
    </nav>
    <dialog class="network-inspector pool-surface pool-small" data-contextual-inspector data-network-workspace aria-labelledby="network-inspector-title">
    <header class="chat-network-heading"><h2 class="pool-subheading" id="network-inspector-title" tabindex="-1">Network</h2><button class="pool-button" type="button" data-close-inspector aria-label="Back to chat" title="Back to chat">${interfaceIcon('close')}</button></header>
    <section data-inspector-pane="model" aria-label="Model" hidden><div data-model-picker-slot></div><p class="pool-small pool-muted" data-model-empty hidden>No models are available. Connect to the network or prepare a model in Computers.</p><dl class="chat-model-facts pool-small" data-model-facts hidden></dl></section>
    <section data-inspector-pane="conversation" aria-label="This conversation">
      <div class="execution-ribbon-route" data-inspector-route></div>
      <p data-inspector-status role="status"></p><p class="pool-caption pool-muted" data-context-detail></p>
      <details><summary>Execution details</summary><div class="execution-inspector-facts pool-facts" data-ribbon-facts></div><details><summary>Timeline</summary><ol data-ribbon-timeline></ol></details></details>
      <section data-thread-permissions hidden><h4>Current permissions</h4>
        <p>Revoking stops this thread’s sharing. It cannot recall data already sent.</p><ul data-thread-grants></ul></section>
    </section>
    <section class="pool-stack pool-gap-lg" data-inspector-pane="participants" aria-label="Computers" hidden>
      <section class="pool-stack pool-gap-sm" aria-label="This device"><h3 class="pool-subheading">This device</h3>
        ${renderSharingControls({ introductory: false })}
        <details class="pool-disclosure" data-specialized-jobs><summary>Specialized model jobs</summary><div data-specialized-content></div></details>
      </section>
      <section class="pool-stack pool-gap-sm" aria-label="Network computers"><h3 class="pool-subheading">Network</h3>
        ${renderConnectionControl()}<p class="network-readiness pool-small pool-muted" data-peer-readiness></p>
        <div class="execution-ribbon-route" data-computers-route></div><ul class="network-peer-list pool-list" data-insp-device-list></ul>
        <button class="pool-button btn-ghost" type="button" data-mesh-invite hidden>Copy private invitation</button>
      </section>
    </section>
    <section class="pool-stack pool-gap-lg" data-inspector-pane="settings" aria-label="Settings" hidden>${renderAccountPanel()}<div data-execution-settings hidden><h3 class="pool-small">Run on</h3><div class="chat-execution-location" data-execution-location role="group" aria-label="Execution location"><button class="pool-button btn-ghost" type="button" data-execution-choice="auto" aria-pressed="true">Automatic</button><button class="pool-button btn-ghost" type="button" data-execution-choice="local" aria-pressed="false">This device</button><button class="pool-button btn-ghost" type="button" data-execution-choice="network" aria-pressed="false">Network</button></div></div>${renderRemotePermissionSettings()}${renderWebSearchSettings()}</section>
    <p data-network-message role="status" hidden></p><p data-inspector-error role="alert" hidden></p>
  </dialog></aside>
  <dialog class="chat-model-setup pool-surface pool-small" data-model-dialog aria-labelledby="model-setup-title">
    <h2 class="pool-heading" id="model-setup-title">Contribute answers</h2>
    <label>Model<select class="pool-input" data-download-model aria-label="Model to download"></select></label>
    <p data-download-size role="status">Checking download size…</p><p class="pool-muted">This downloads the model and lets this device answer others’ public prompts. File sharing is controlled separately. You can stop contributing at any time.</p><p data-download-compute-limits></p>
    <div class="chat-network-actions"><button class="pool-button" type="button" data-download-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-download-confirm disabled>Download and contribute</button></div>
  </dialog>`;
}

export function bindNetworkInspector(root, session, { getInviteUrl, loadSpecialized, webSearch = null, search = null, earning = null } = {}) {
  const rail = root.querySelector('[data-network-rail]');
  const navigation = rail.querySelector('[data-inspector-navigation]');
  const find = selector => rail.querySelector(selector) || root.querySelector(selector);
  const panel = find('[data-contextual-inspector]');
  const toggle = find('[data-toggle-inspector]');
  const surface = root.closest('.pool-home');
  const usesRails = ['home', 'network'].includes(surface?.dataset.poolRouteId);
  const settings = usesRails ? surface.querySelector('[data-pool-settings]') : null;
  const settingsSection = settings?.querySelector('section');
  const settingsChildren = settingsSection ? [...settingsSection.childNodes] : [];
  if (settingsSection) {
    find('[data-inspector-pane="settings"]').append(...settingsChildren);
    settingsSection.hidden = true;
  }
  let onRailOpen = null;
  let opener;
  const dialog = {
    open(trigger) {
      onRailOpen?.(); opener = trigger || toggle;
      opener.setAttribute('aria-expanded', 'true');
      surface?.setAttribute('data-network-panel-open', ''); rail.dataset.expanded = '';
      if (!panel.open) panel.show();
      for (const button of navigation.querySelectorAll('[data-inspector-section]')) {
        const selected = !panel.querySelector(`[data-inspector-pane="${button.dataset.inspectorSection}"]`).hidden;
        button.setAttribute('aria-current', String(selected));
        button.setAttribute('aria-expanded', String(selected));
      }
      find('#network-inspector-title').focus({ preventScroll: true });
    },
    close({ restoreFocus = true } = {}) { const wasOpen = panel.open; opener?.setAttribute?.('aria-expanded', 'false'); panel.close(); surface?.removeAttribute('data-network-panel-open'); delete rail.dataset.expanded; for (const button of navigation.querySelectorAll('[data-inspector-section]')) { button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-current', 'false'); button.setAttribute('aria-pressed', 'false'); } if (wasOpen && restoreFocus) opener?.focus?.({ preventScroll: true }); },
    dispose() { if (panel.open) panel.close(); surface?.removeAttribute('data-network-panel-open'); if (settingsSection) { settingsSection.append(...settingsChildren); settingsSection.hidden = false; } }
  };
  const controller = new AbortController(), options = { signal: controller.signal };
  const network = bindNetworkControls(panel, session, { getInviteUrl,
    requestContribution: (modelId, opener) => openModelSetup(opener, modelId) });
  const modelDialog = bindDialog(find('[data-model-dialog]'));
  const on = (selector, event, fn) => find(selector)?.addEventListener(event, fn, options);
  const error = cause => { const node = find('[data-inspector-error]'); node.textContent = cause?.message || ''; node.hidden = !cause; };
  const act = operation => Promise.resolve().then(operation).catch(error);
  let grantsKey = '', executionKey = '', metadataController, disposed = false, specialized;
  const select = section => {
    if (section === 'device') section = 'participants';
    for (const pane of panel.querySelectorAll('[data-inspector-pane]')) pane.hidden = pane.dataset.inspectorPane !== section;
    find('#network-inspector-title').textContent = { model: 'Model', conversation: 'This conversation', participants: 'Computers', device: 'Sharing', settings: 'Settings' }[section];
    for (const button of navigation.querySelectorAll('[data-inspector-section]')) button.setAttribute('aria-pressed', String(button.dataset.inspectorSection === section));
  };
  panel.addEventListener('click', event => {
    const toggle = event.target.closest('[data-remote-answers-toggle]');
    if (toggle && !toggle.disabled) {
      toggle.disabled = true;
      void act(() => session.setRemoteAnswersEnabled(toggle.getAttribute('aria-checked') !== 'true'))
        .finally(() => { toggle.disabled = false; });
    }
    const grant = event.target.closest('[data-revoke-grant]');
    if (grant) void act(() => session.revokeGrant(session.getState().selectedId, grant.dataset.revokeGrant));
    const remote = event.target.closest('[data-revoke-remote-permission]');
    if (remote) void act(() => session.revokeRemotePermission(remote.dataset.revokeRemotePermission));
  }, options);
  const onEscape = event => { if (event.key === 'Escape' && panel.open) { event.preventDefault(); event.stopPropagation(); dialog.close(); } };
  rail.addEventListener('keydown', onEscape, options);
  panel.addEventListener('keydown', onEscape, options);
  navigation.addEventListener('click', event => {
    const button = event.target.closest('[data-inspector-section]');
    if (!button) return;
    const section = button.dataset.inspectorSection;
    select(section); dialog.open(button);
  }, options);
  navigation.addEventListener('keydown', onEscape, options);
  on('[data-close-inspector]', 'click', () => dialog.close());
  const unsubscribe = session.subscribe(snapshot => {
    const state = withComputerLabels(snapshot, session);
    const view = projectExecutionRibbon(state), key = JSON.stringify([view.execution, view.status, view.model, view.attempt?.id, view.attempt?.createdAt, view.attempt?.error, view.totalMs, view.executors.map(node => node.label)]);
    if (key !== executionKey) {
      executionKey = key; find('[data-inspector-route]').innerHTML = routeMarkup(view);
      find('[data-computers-route]').innerHTML = routeMarkup(view);
      find('[data-ribbon-facts]').innerHTML = detailMarkup(view);
      const events = [];
      if (Number.isFinite(view.attempt?.createdAt)) events.push(`Started ${new Date(view.attempt.createdAt).toLocaleTimeString()}`);
      if (Number.isFinite(view.attempt?.finishedAt)) events.push(`${view.statusLabel} ${new Date(view.attempt.finishedAt).toLocaleTimeString()}`);
      find('[data-ribbon-timeline]').innerHTML = events.map(event => `<li>${escape(event)}</li>`).join('') || '<li>No recorded attempt events.</li>';
    }
    find('[data-inspector-status]').textContent = view.statusLabel;
    const peers = projectNetworkPeers(state);
    const connection = find('[data-connection-label]').textContent;
    const summaries = {
      conversation: view.statusLabel,
      participants: connection === 'Connected' ? `${peers.length} connected` : connection,
      device: [find('[data-contrib-label]').textContent, state.network?.files?.sharing ? 'Files on' : ''].filter(Boolean).join(' · ')
    };
    for (const [section, summary] of Object.entries(summaries)) {
      const button = navigation.querySelector(`[data-inspector-section="${section}"]`);
      if (!button) continue;
      const digest = button.querySelector('[data-rail-digest]');
      if (digest.textContent !== summary) digest.textContent = summary;
      const label = button.querySelector('.chat-rail-label').textContent;
      button.setAttribute('aria-label', `${label}: ${summary}`); button.title = `${label}: ${summary}`;
      button.classList.add('pool-activity-edge');
      button.dataset.activity = (section === 'conversation' && view.status === 'executing')
        || (section === 'device' && state.network?.contribution?.phase === 'executing' && state.network?.sharing) ? 'executing' : 'idle';
    }
    updateRemotePermissionSettings(panel, state);
    const grants = (state.activeThread?.grants || []).filter(grant => grant.revokedAt === null);
    find('[data-thread-permissions]').hidden = !grants.length;
    const next = JSON.stringify([state.selectedId, grants]);
    if (next !== grantsKey) {
      grantsKey = next;
      find('[data-thread-grants]').innerHTML = grants.map((grant, index) => `<li><strong>Recipient ${index + 1}</strong> · ${escape(state.activeThread.model.name)}
        <details><summary>Permission details</summary><pre>${escape(JSON.stringify(grant, null, 2))}</pre></details>
        <button class="pool-button" type="button" data-revoke-grant="${escape(grant.id)}">Revoke</button></li>`).join('');
    }
  });
  const checkDownload = async () => {
    metadataController?.abort(); const request = metadataController = new AbortController();
    find('[data-download-confirm]').disabled = true; find('[data-download-size]').textContent = 'Checking download size…';
    try {
      if (!find('[data-download-model]').value) throw new Error('No model is available to download.');
      const info = await session.getModelDownload(find('[data-download-model]').value, { signal: request.signal });
      if (request.signal.aborted || disposed) return;
      find('[data-download-size]').textContent = Math.ceil(info.sizeBytes / 1e6) + ' MB download'; find('[data-download-confirm]').disabled = false;
    } catch (cause) { if (!request.signal.aborted && !disposed) find('[data-download-size]').textContent = cause.message; }
  };
  const openModelSetup = (opener, modelId) => {
    const models = session.getState().models.filter(model => !model.partition && !model.adapters?.length);
    updateModelSelect(find('[data-download-model]'), models, { value: modelId });
    find('[data-download-compute-limits]').textContent = find('[data-contribution-limits]').textContent;
    modelDialog.open(find('[data-download-model]'), opener); void checkDownload();
  };
  on('[data-download-model]', 'change', () => void checkDownload());
  on('[data-download-cancel]', 'click', () => modelDialog.close());
  on('[data-model-dialog]', 'close', () => metadataController?.abort());
  on('[data-download-confirm]', 'click', () => {
    const modelId = find('[data-download-model]').value; modelDialog.close();
    find('[data-contribution-model]').value = modelId;
    void act(async () => {
      if (session.getState().network?.paused) await session.connect();
      await session.setSharing(true, modelId, true);
    });
  });
  on('[data-specialized-jobs]', 'toggle', () => {
    if (find('[data-specialized-jobs]').open && !specialized && loadSpecialized) {
      specialized = Promise.resolve().then(() => loadSpecialized(find('[data-specialized-content]'))).then(dispose => {
        if (disposed) dispose?.(); else specialized = dispose || true;
      }).catch(cause => { if (!disposed) { specialized = null; error(cause); } });
    }
  });
  const disposeWebSearch = bindWebSearchSettings(rail, webSearch, { search });
  // Credits appear only when the page's server publishes an earning service (host/credits/browser.js).
  const disposeAccount = bindAccountPanel(rail, earning);
  return {
    mountRail(panelSlot, triggerSlot, onOpen) {
      if (!panelSlot || !triggerSlot) return () => {};
      const railParent = rail.parentElement, railNext = rail.nextSibling;
      const triggerParent = navigation.parentElement, triggerNext = navigation.nextSibling;
      panelSlot.append(rail); triggerSlot.append(navigation); rail.dataset.mounted = '';
      // The main workspace supplies the surface; keep its contents on one material.
      const panels = [rail, rail.querySelector('[data-contextual-inspector]')];
      panels.forEach(panel => panel?.classList.remove('pool-surface'));
      onRailOpen = onOpen;
      return () => {
        dialog.close({ restoreFocus: false }); onRailOpen = null; delete rail.dataset.mounted;
        panels.forEach(panel => panel?.classList.add('pool-surface'));
        triggerParent.insertBefore(navigation, triggerNext?.parentNode === triggerParent ? triggerNext : null);
        railParent.insertBefore(rail, railNext?.parentNode === railParent ? railNext : null);
      };
    },
    toggle(section = 'settings', opener) {
      if (panel.open && !panel.querySelector(`[data-inspector-pane="${section}"]`).hidden) dialog.close();
      else { select(section); dialog.open(opener); }
    },
    open(section = 'participants', opener) { select(section); dialog.open(opener || navigation.querySelector(`[data-inspector-section="${section}"]`)); },
    close: options => dialog.close(options),
    dispose() { disposed = true; disposeWebSearch(); disposeAccount(); metadataController?.abort(); controller.abort(); unsubscribe(); network(); modelDialog.dispose(); dialog.dispose(); if (typeof specialized === 'function') specialized(); }
  };
}
