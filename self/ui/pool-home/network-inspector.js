import { withComputerLabels } from './computer-labels.js';
import { interfaceIcon } from '../components/interface-icons.js';
/** One projection of conversation execution, participant availability, and device contribution. */
import { renderSharingControls, renderConnectionControl, bindNetworkControls } from './network-controls.js';
import { bindDialog } from '../components/dialog.js';
import { updateModelSelect } from '../components/model-select.js';
import { escapeHtml as escape } from '../components/attachments.js';
import { projectExecutionRibbon, routeMarkup, detailMarkup } from './execution-ribbon.js';
import { renderRemotePermissionSettings, updateRemotePermissionSettings } from './remote-permission.js';
import { renderWebSearchSettings, bindWebSearchSettings } from './web-search-settings.js';
import { renderAccountPanel, bindAccountPanel } from './account-panel.js';

export function renderNetworkInspector() {
  return `<aside class="chat-network-rail pool-surface" data-network-rail aria-label="Network and settings">
    <button class="pool-button chat-network-toggle" type="button" data-toggle-inspector aria-haspopup="dialog" aria-expanded="false" aria-label="Inspect network" title="Network">${interfaceIcon('peers')}<span class="chat-rail-label" data-mesh-peers>0 computers</span></button>
    <dialog class="network-inspector pool-surface pool-small" data-contextual-inspector data-network-workspace aria-labelledby="network-inspector-title">
    <header class="chat-network-heading"><h2 class="pool-subheading" id="network-inspector-title">Network</h2><button class="pool-button" type="button" data-close-inspector aria-label="Close network and settings">${interfaceIcon('close')}</button></header>
    <nav class="network-inspector-tabs pool-segmented" aria-label="Network sections">
      <button class="pool-segment" type="button" data-inspector-section="conversation" aria-label="This conversation" title="This conversation">${interfaceIcon('activity')}</button>
      <button class="pool-segment" type="button" data-inspector-section="participants" aria-label="Computers" title="Computers">${interfaceIcon('peers')}<span data-mesh-peers class="chat-visually-hidden"></span></button>
      <button class="pool-segment" type="button" data-inspector-section="device" aria-label="This device" title="This device">${interfaceIcon('device')}</button>
      <button class="pool-segment" type="button" data-inspector-section="settings" aria-label="Settings" title="Settings">${interfaceIcon('settings')}</button>
    </nav>
    <section data-inspector-pane="conversation" aria-label="This conversation">
      <div class="execution-ribbon-route" data-inspector-route></div>
      <p data-inspector-status role="status"></p>
      <details><summary>Execution details</summary><div class="execution-inspector-facts pool-facts" data-ribbon-facts></div><details><summary>Timeline</summary><ol data-ribbon-timeline></ol></details></details>
      <section data-thread-permissions hidden><h4>Current permissions</h4>
        <p>Revoking stops this thread’s sharing. It cannot recall data already sent.</p><ul data-thread-grants></ul></section>
    </section>
    <section data-inspector-pane="participants" aria-label="Available computers" hidden>
      ${renderConnectionControl()}<p class="network-readiness pool-small pool-muted" data-peer-readiness></p><ul class="network-peer-list pool-list" data-insp-device-list></ul>
      <button class="pool-button" type="button" data-mesh-invite hidden>Copy private invitation</button>
    </section>
    <section data-inspector-pane="device" aria-label="This device" hidden>
      ${renderSharingControls()}
      <button class="pool-button" type="button" data-model-setup>Run on this device</button>
      <details data-specialized-jobs><summary>Specialized model jobs</summary><div data-specialized-content></div></details>
    </section>
    <section class="pool-stack pool-gap-lg" data-inspector-pane="settings" aria-label="Settings" hidden>${renderAccountPanel()}${renderRemotePermissionSettings()}${renderWebSearchSettings()}</section>
    <p data-network-message role="status" hidden></p><p data-inspector-error role="alert" hidden></p>
  </dialog></aside>
  <dialog class="chat-model-setup pool-surface pool-small" data-model-dialog aria-labelledby="model-setup-title">
    <h2 class="pool-heading" id="model-setup-title">Run on this device</h2>
    <label>Model<select class="pool-input" data-download-model aria-label="Model to download"></select></label>
    <p data-download-size role="status">Checking download size…</p><p>Stored on this device. Sharing stays optional.</p>
    <div class="chat-network-actions"><button class="pool-button" type="button" data-download-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-download-confirm disabled>Download model</button></div>
  </dialog>`;
}

export function bindNetworkInspector(root, session, { getInviteUrl, loadSpecialized, webSearch = null, earning = null } = {}) {
  const rail = root.querySelector('[data-network-rail]');
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
    open(focus, trigger) {
      onRailOpen?.(); opener = trigger || toggle;
      opener.setAttribute('aria-expanded', 'true');
      surface?.setAttribute('data-network-panel-open', ''); rail.dataset.expanded = '';
      toggle.setAttribute('aria-expanded', 'true');
      if (!panel.open) panel.show();
      (focus || opener).focus({ preventScroll: true });
    },
    close({ restoreFocus = true } = {}) { const wasOpen = panel.open; opener?.setAttribute?.('aria-expanded', 'false'); panel.close(); surface?.removeAttribute('data-network-panel-open'); delete rail.dataset.expanded; toggle.setAttribute('aria-expanded', 'false'); if (wasOpen && restoreFocus) opener?.focus?.({ preventScroll: true }); },
    dispose() { if (panel.open) panel.close(); surface?.removeAttribute('data-network-panel-open'); if (settingsSection) { settingsSection.append(...settingsChildren); settingsSection.hidden = false; } }
  };
  const controller = new AbortController(), options = { signal: controller.signal };
  const network = bindNetworkControls(panel, session, { getInviteUrl });
  const modelDialog = bindDialog(find('[data-model-dialog]'));
  const on = (selector, event, fn) => find(selector)?.addEventListener(event, fn, options);
  const error = cause => { const node = find('[data-inspector-error]'); node.textContent = cause?.message || ''; node.hidden = !cause; };
  const act = operation => Promise.resolve().then(operation).catch(error);
  let grantsKey = '', executionKey = '', metadataController, disposed = false, specialized;
  const select = section => {
    for (const pane of panel.querySelectorAll('[data-inspector-pane]')) pane.hidden = pane.dataset.inspectorPane !== section;
    for (const button of panel.querySelectorAll('[data-inspector-section]')) button.setAttribute('aria-pressed', String(button.dataset.inspectorSection === section));
  };
  panel.addEventListener('click', event => {
    const tab = event.target.closest('[data-inspector-section]'); if (tab) select(tab.dataset.inspectorSection);
    const grant = event.target.closest('[data-revoke-grant]');
    if (grant) void act(() => session.revokeGrant(session.getState().selectedId, grant.dataset.revokeGrant));
    const remote = event.target.closest('[data-revoke-remote-permission]');
    if (remote) void act(() => session.revokeRemotePermission(remote.dataset.revokeRemotePermission));
  }, options);
  const onEscape = event => { if (event.key === 'Escape' && panel.open) { event.preventDefault(); event.stopPropagation(); dialog.close(); } };
  rail.addEventListener('keydown', onEscape, options);
  toggle.addEventListener('keydown', onEscape, options);
  toggle.addEventListener('click', event => { if (panel.open) dialog.close(); else { select('participants'); dialog.open(null, event.currentTarget); } }, options);
  on('[data-close-inspector]', 'click', () => dialog.close());
  const unsubscribe = session.subscribe(snapshot => {
    const state = withComputerLabels(snapshot, session);
    const view = projectExecutionRibbon(state), key = JSON.stringify([view.execution, view.status, view.model, view.attempt?.id, view.attempt?.createdAt, view.attempt?.error, view.totalMs, view.executors.map(node => node.label)]);
    if (key !== executionKey) {
      executionKey = key; find('[data-inspector-route]').innerHTML = routeMarkup(view);
      find('[data-ribbon-facts]').innerHTML = detailMarkup(view);
      const events = [];
      if (Number.isFinite(view.attempt?.createdAt)) events.push(`Started ${new Date(view.attempt.createdAt).toLocaleTimeString()}`);
      if (Number.isFinite(view.attempt?.finishedAt)) events.push(`${view.statusLabel} ${new Date(view.attempt.finishedAt).toLocaleTimeString()}`);
      find('[data-ribbon-timeline]').innerHTML = events.map(event => `<li>${escape(event)}</li>`).join('') || '<li>No recorded attempt events.</li>';
    }
    find('[data-inspector-status]').textContent = view.statusLabel;
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
    const loading = state.localModel?.phase === 'loading';
    find('[data-model-setup]').disabled = loading;
    find('[data-model-setup]').textContent = loading ? 'Preparing local model…' : 'Run on this device';
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
  on('[data-model-setup]', 'click', () => {
    const models = session.getState().models.filter(model => !model.partition && !model.adapters?.length);
    updateModelSelect(find('[data-download-model]'), models);
    modelDialog.open(find('[data-download-model]'), find('[data-model-setup]')); void checkDownload();
  });
  on('[data-download-model]', 'change', () => void checkDownload());
  on('[data-download-cancel]', 'click', () => modelDialog.close());
  on('[data-model-dialog]', 'close', () => metadataController?.abort());
  on('[data-download-confirm]', 'click', () => {
    const modelId = find('[data-download-model]').value; modelDialog.close(); void act(() => session.prepareLocalModel(modelId));
  });
  on('[data-specialized-jobs]', 'toggle', () => {
    if (find('[data-specialized-jobs]').open && !specialized && loadSpecialized) {
      specialized = Promise.resolve().then(() => loadSpecialized(find('[data-specialized-content]'))).then(dispose => {
        if (disposed) dispose?.(); else specialized = dispose || true;
      }).catch(cause => { if (!disposed) { specialized = null; error(cause); } });
    }
  });
  const disposeWebSearch = bindWebSearchSettings(rail, webSearch);
  // Credits appear only when the page's server publishes an earning service (host/credits/browser.js).
  const disposeAccount = bindAccountPanel(rail, earning);
  return {
    mountRail(panelSlot, triggerSlot, onOpen) {
      if (!panelSlot || !triggerSlot) return () => {};
      const railParent = rail.parentElement, railNext = rail.nextSibling;
      const triggerParent = toggle.parentElement, triggerNext = toggle.nextSibling;
      panelSlot.append(rail); triggerSlot.append(toggle); rail.dataset.mounted = '';
      // Mounted in the conversation rail, the inspector shares the rail's surface instead of its own.
      const panels = [rail, rail.querySelector('[data-contextual-inspector]')];
      panels.forEach(panel => panel?.classList.remove('pool-surface'));
      onRailOpen = onOpen;
      return () => {
        dialog.close({ restoreFocus: false }); onRailOpen = null; delete rail.dataset.mounted;
        panels.forEach(panel => panel?.classList.add('pool-surface'));
        triggerParent.insertBefore(toggle, triggerNext?.parentNode === triggerParent ? triggerNext : null);
        railParent.insertBefore(rail, railNext?.parentNode === railParent ? railNext : null);
      };
    },
    toggle(section = 'settings', opener) {
      if (panel.open && !panel.querySelector(`[data-inspector-pane="${section}"]`).hidden) dialog.close();
      else { select(section); dialog.open(null, opener); }
    },
    open(section = 'participants', opener) { select(section); dialog.open(panel.querySelector(`[data-inspector-section="${section}"]`), opener); },
    close: options => dialog.close(options),
    dispose() { disposed = true; disposeWebSearch(); disposeAccount(); metadataController?.abort(); controller.abort(); unsubscribe(); network(); modelDialog.dispose(); dialog.dispose(); if (typeof specialized === 'function') specialized(); }
  };
}
