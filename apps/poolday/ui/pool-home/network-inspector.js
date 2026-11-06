import { workspaceHref } from './workspace-navigation.js';
import { withComputerLabels } from './computer-labels.js';
import { interfaceIcon } from '../components/interface-icons.js';
/** One projection of conversation execution, participant availability, and device contribution. */
import { renderComputeSharingControls, renderFileSharingControls, renderContributionLimits, renderConnectionControl, bindNetworkControls, projectNetworkPeers } from './network-controls.js';
import { bindDialog } from '../components/dialog.js';
import { updateModelSelect } from '../components/model-select.js';
import { escapeHtml as escape } from '../components/attachments.js';
import { projectExecutionRibbon, routeMarkup, detailMarkup } from './execution-ribbon.js';
import { renderRemotePermissionSettings, updateRemotePermissionSettings } from './remote-permission.js';
import { renderAutoDownloadSetting } from './auto-download.js';
import { renderWebSearchSettings, bindWebSearchSettings } from './web-search-settings.js';
import { renderAccountPanel, bindAccountPanel } from './account-panel.js';
import { renderModelStorage, bindModelStorage } from './model-storage.js';
import { renderThemeSelector } from './theme.js';

export function renderInspectorNavigation({ workspace = false } = {}) {
  const tag = workspace ? 'a' : 'button';
  const destination = view => workspace ? `href="${escape(workspaceHref(view))}" data-workspace-view="${view}"` : 'type="button"';
  return `<nav class="pool-stack pool-gap-sm" data-inspector-navigation aria-label="Network sections">
      <${tag} class="pool-button btn-ghost chat-network-toggle" ${destination('computers')} data-inspector-section="participants" data-toggle-inspector aria-label="Computers" title="Computers">${interfaceIcon('peers')}<span class="chat-rail-label">Computers</span><small class="chat-rail-digest pool-muted" data-rail-digest="participants"></small></${tag}>
      <${tag} class="pool-button btn-ghost chat-rail-icon" ${destination('settings')} data-inspector-section="settings" aria-label="Settings" title="Settings">${interfaceIcon('settings')}<span class="chat-rail-label">Settings</span></${tag}>
    </nav>`;
}

/**
 * The inspector dialog with every pane's content rendered in its final place. Route
 * content that belongs to a pane (the Settings menu's app shortcuts) arrives as
 * markup; nothing is moved after render. A mounted rail sits inside the conversation
 * workspace, whose toolbar renders the navigation. Model choice and its details are
 * the conversation workspace's own dialog.
 */
export function renderInspectorRail({ mounted = false, navigation = !mounted, apps = '', contribution = '' } = {}) {
  const material = mounted ? '' : ' pool-surface';
  return `<aside class="chat-network-rail${material}" data-network-rail${mounted ? ' data-mounted' : ''} aria-label="Network and settings">
    ${navigation ? renderInspectorNavigation() : ''}
    <${mounted ? 'section hidden' : 'dialog'} class="network-inspector${material} pool-small" data-contextual-inspector data-network-workspace aria-labelledby="network-inspector-title">
    <header class="chat-network-heading"><h2 class="pool-subheading" id="network-inspector-title" tabindex="-1">Network</h2><button class="pool-button btn-ghost" type="button" data-close-inspector aria-label="Close" title="Close">${interfaceIcon('close')}</button></header>
    <section data-inspector-pane="conversation" aria-label="This conversation">
      <div class="execution-ribbon-route" data-inspector-route></div>
      <p data-inspector-status role="status"></p><p class="pool-caption pool-muted" data-context-detail></p>
      <details><summary>Execution details</summary><div class="execution-inspector-facts pool-facts" data-ribbon-facts></div><details><summary>Timeline</summary><ol data-ribbon-timeline></ol></details></details>
      <section data-thread-permissions hidden><h4>Current permissions</h4>
        <p>Revoking stops this thread’s sharing. It cannot recall data already sent.</p><ul data-thread-grants></ul></section>
    </section>
    <section class="pool-stack pool-gap-lg" data-inspector-pane="participants" aria-label="Computers" hidden>
      <section class="pool-stack pool-gap-sm" aria-label="Network computers"><h3 class="pool-subheading">Network</h3>
        ${renderConnectionControl()}<p class="network-readiness pool-small pool-muted" data-peer-readiness></p>
        <ul class="network-peer-list pool-list" data-insp-device-list></ul>
        <button class="pool-button btn-ghost" type="button" data-mesh-invite hidden>Copy private invitation</button>
      </section>
      <details class="pool-disclosure" data-production-device><summary>This device <span class="pool-muted" data-device-state-summary></span></summary><div class="pool-stack pool-gap-md">
        <p class="pool-caption pool-muted" data-local-computer></p>
        ${renderComputeSharingControls()}
        ${contribution}
        <p class="pool-caption pool-muted" data-file-sharing-summary></p>
        ${renderContributionLimits()}
        <details class="pool-disclosure" data-specialized-jobs><summary>Specialized model jobs</summary><div data-specialized-content></div></details>
      </div></details>
    </section>
    <section class="pool-stack pool-gap-lg" data-inspector-pane="settings" aria-label="Settings" hidden>
      <section><h3 class="pool-subheading">Appearance</h3><div data-settings-appearance>${renderThemeSelector()}</div></section>
      <section data-settings-storage><h3 class="pool-subheading">Storage</h3>${renderModelStorage()}<p class="pool-muted" data-settings-storage-summary>No downloaded models</p><div class="pool-stack pool-gap-md" data-settings-storage-controls>${renderFileSharingControls()}</div></section>
      ${renderAccountPanel()}
      <details class="pool-disclosure" data-settings-advanced><summary>Advanced</summary><div class="pool-stack pool-gap-lg">
        <section class="pool-stack pool-gap-md"><h3 class="pool-small">Inference</h3>${renderRemotePermissionSettings()}${renderAutoDownloadSetting()}</section>
        ${renderWebSearchSettings()}
        <div data-settings-apps>${apps}</div>
      </div></details>
    </section>
    <p data-network-message role="status" hidden></p>
    <p data-inspector-error role="alert" hidden></p>
  </${mounted ? 'section' : 'dialog'}></aside>`;
}

export function renderModelSetupDialog() {
  return `<dialog class="chat-model-setup pool-surface pool-small" data-model-dialog aria-labelledby="model-setup-title">
    <h2 class="pool-heading" id="model-setup-title" data-download-title>Start sharing</h2>
    <label>Model<select class="pool-input" data-download-model aria-label="Model to download"></select></label>
    <p data-download-size role="status">Checking download size…</p><button class="pool-button btn-ghost" type="button" data-retry-download-check hidden>Retry</button><p class="pool-muted" data-download-explanation>Download a model to answer public requests while this page is open. Pause anytime.</p><details class="pool-disclosure"><summary>Limits</summary><p data-download-compute-limits></p></details>
    <div class="chat-network-actions"><button class="pool-button btn-ghost" type="button" data-download-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-download-confirm disabled>Download & share</button></div>
  </dialog>`;
}

/** Navigation, rail and setup dialog together, for routes that keep the inspector beside their content. */
export function renderNetworkInspector(options = {}) {
  return renderInspectorRail({ ...options, navigation: true }) + renderModelSetupDialog();
}

export function bindNetworkInspector(root, session, { getInviteUrl, loadSpecialized, webSearch = null, search = null, earning = null, modelStorage = null } = {}) {
  // The navigation may sit outside the rail (in the conversation toolbar), so both
  // resolve from the root. Nothing here moves nodes between components.
  const rail = root.querySelector('[data-network-rail]');
  const navigation = root.querySelector('[data-inspector-navigation]');
  const find = selector => rail.querySelector(selector) || root.querySelector(selector);
  const panel = find('[data-contextual-inspector]');
  const toggle = find('[data-toggle-inspector]');
  const surface = root.closest('.pool-home');
  let onRailOpen = null, onRailClose = null, activeSection = null;
  const mounted = panel.tagName !== 'DIALOG';
  const isOpen = () => mounted ? !panel.hidden : panel.open;
  const buttonState = (node, name, value) => {
    if (node?.tagName === 'A') node.removeAttribute(name); else node?.setAttribute(name, String(value));
  };
  const hide = () => { if (mounted) panel.hidden = true; else if (panel.open) panel.close(); };
  let opener;
  const dialog = {
    open(trigger) {
      // A production surface without the workspace opens the inspector as a modal
      // sheet; the workspace and the other routes show it as a panel in their layout.
      const standalone = !!surface?.querySelector('[data-production-surface]') && !surface?.querySelector('[data-chat-workspace]');
      if (!standalone) onRailOpen?.(activeSection);
      opener = trigger || toggle;
      buttonState(opener, 'aria-expanded', true);
      if (standalone) {
        if (!panel.open) panel.showModal();
      } else {
        surface?.setAttribute('data-network-panel-open', activeSection || '');
        if (mounted) panel.hidden = false; else if (!panel.open) panel.show();
      }
      rail.dataset.expanded = '';
      for (const button of navigation.querySelectorAll('[data-inspector-section]')) {
        const selected = !panel.querySelector(`[data-inspector-pane="${button.dataset.inspectorSection}"]`).hidden;
        if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
        buttonState(button, 'aria-expanded', selected);
      }
      find('#network-inspector-title').focus({ preventScroll: true });
    },
    close({ restoreFocus = true } = {}) { const wasOpen = isOpen(); buttonState(opener, 'aria-expanded', false); hide(); surface?.removeAttribute('data-network-panel-open'); if (wasOpen) onRailClose?.(); delete rail.dataset.expanded; for (const button of navigation.querySelectorAll('[data-inspector-section]')) { buttonState(button, 'aria-expanded', false); button.removeAttribute('aria-current'); buttonState(button, 'aria-pressed', false); } if (wasOpen && restoreFocus) opener?.focus?.({ preventScroll: true }); },
    dispose() { hide(); surface?.removeAttribute('data-network-panel-open'); }
  };
  const controller = new AbortController(), options = { signal: controller.signal };
  const network = bindNetworkControls(panel, session, { getInviteUrl,
    requestContribution: (modelId, opener) => openModelSetup(opener, modelId) });
  const modelDialog = bindDialog(find('[data-model-dialog]'));
  const on = (selector, event, fn) => find(selector)?.addEventListener(event, fn, options);
  const error = cause => { const node = find('[data-inspector-error]'); node.textContent = cause?.message || ''; node.hidden = !cause; };
  const act = operation => Promise.resolve().then(operation).catch(error);
  const storagePanel = bindModelStorage(panel, modelStorage);
  if (modelStorage) find('[data-settings-storage-summary]').hidden = true;
  let grantsKey = '', executionKey = '', metadataController, disposed = false, specialized;
  const select = section => {
    activeSection = section === 'device' ? 'participants' : section;
    if (section === 'settings') void storagePanel.refresh();
    if (section === 'device') section = 'participants';
    for (const pane of panel.querySelectorAll('[data-inspector-pane]')) pane.hidden = pane.dataset.inspectorPane !== section;
    find('#network-inspector-title').textContent = { conversation: 'This conversation', participants: 'Computers', device: 'Sharing', settings: 'Settings' }[section];
    for (const button of navigation.querySelectorAll('[data-inspector-section]')) buttonState(button, 'aria-pressed', button.dataset.inspectorSection === section);
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
  const onEscape = event => { if (event.key === 'Escape' && isOpen()) { event.preventDefault(); event.stopPropagation(); dialog.close(); } };
  rail.addEventListener('keydown', onEscape, options);
  panel.addEventListener('keydown', onEscape, options);
  navigation.addEventListener('click', event => {
    const button = event.target.closest('[data-inspector-section]');
    if (!button || mounted && button.hasAttribute('data-workspace-view')) return;
    event.preventDefault();
    const section = button.dataset.inspectorSection;
    select(section); dialog.open(button);
  }, options);
  navigation.addEventListener('keydown', onEscape, options);
  on('[data-close-inspector]', 'click', () => dialog.close());
  const unsubscribe = session.subscribe(snapshot => {
    const state = withComputerLabels(snapshot, session);
    const stored = (state.models || []).filter(model => model.localCached);
    find('[data-settings-storage-summary]').textContent = stored.length ? stored.map(model => model.name || model.id).join(' · ') : 'No downloaded models';
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
    const peers = projectNetworkPeers(state);
    const connection = find('[data-connection-label]').textContent;
    const summaries = {
      conversation: view.statusLabel,
      participants: connection === 'Connected' ? `${peers.filter(peer => peer.connectionPhase === 'connected').length} connected · ${peers.filter(peer => peer.phase === 'ready').length} ready` : connection,
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
  let downloadMode = 'contribute', downloadInfo = null;
  const checkDownload = async () => {
    find('[data-retry-download-check]').hidden = true;
    downloadInfo = null; metadataController?.abort(); const request = metadataController = new AbortController();
    find('[data-download-confirm]').disabled = true; find('[data-download-size]').textContent = 'Checking download size…';
    try {
      if (!find('[data-download-model]').value) throw new Error('No model is available to download.');
      const info = await session.getModelDownload(find('[data-download-model]').value, { signal: request.signal });
      if (request.signal.aborted || disposed) return;
      downloadInfo = info;
      find('[data-download-size]').textContent = Math.ceil(info.sizeBytes / 1e6) + ' MB download'; find('[data-download-confirm]').disabled = false;
    } catch (cause) { if (!request.signal.aborted && !disposed) { find('[data-download-size]').textContent = cause.message; find('[data-retry-download-check]').hidden = false; } }
  };
  const openModelSetup = (opener, modelId, mode = 'contribute') => {
    downloadMode = mode;
    find('[data-download-title]').textContent = mode === 'local' ? 'Download model' : 'Start sharing';
    find('[data-download-confirm]').textContent = mode === 'local' ? 'Download model' : 'Download & share';
    find('[data-download-explanation]').textContent = mode === 'local'
      ? 'Store this model on this device to answer when network capacity is unavailable. Retry reuses verified files where supported. Your current sharing settings in Computers also apply to this model.'
      : 'Download a model to answer public requests while this page is open. Pause anytime.';
    const models = session.getState().models.filter(model => !model.partition && (mode !== 'local' || !model.adapters?.length));
    updateModelSelect(find('[data-download-model]'), models, { value: modelId });
    const chosen = models.find(model => (model.selectionId || model.id) === modelId);
    find('[data-download-model]').closest('label').hidden = !!chosen;
    if (chosen && mode !== 'local') find('[data-download-title]').textContent = chosen.name || chosen.id;
    find('[data-download-compute-limits]').textContent = find('[data-contribution-limits]').textContent;
    if (mode !== 'local' && chosen && (chosen.localCached || chosen.localReady)) {
      downloadInfo = { cached: true }; metadataController?.abort();
      find('[data-download-size]').textContent = 'Downloaded';
      find('[data-download-confirm]').textContent = 'Start sharing';
      find('[data-download-confirm]').disabled = false;
      find('[data-retry-download-check]').hidden = true;
      find('[data-download-explanation]').textContent = 'Answer public requests while this page is open. Pause anytime.';
      modelDialog.open(find('[data-download-confirm]'), opener);
    } else {
      modelDialog.open(chosen ? find('[data-download-confirm]') : find('[data-download-model]'), opener); void checkDownload();
    }
  };
  on('[data-download-model]', 'change', () => void checkDownload());
  on('[data-retry-download-check]', 'click', () => void checkDownload());
  on('[data-download-cancel]', 'click', () => modelDialog.close());
  on('[data-model-dialog]', 'close', () => metadataController?.abort());
  on('[data-download-confirm]', 'click', () => {
    if (find('[data-download-confirm]').disabled || !downloadInfo) return;
    find('[data-download-confirm]').disabled = true;
    const modelId = find('[data-download-model]').value; modelDialog.close();
    if (downloadMode === 'local') { void act(() => session.downloadLocalModel(modelId, true)); return; }
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
    onClose(callback) { onRailClose = callback; return () => { if (onRailClose === callback) onRailClose = null; }; },
    onOpen(callback) {
      onRailOpen = callback;
      return () => { if (onRailOpen === callback) onRailOpen = null; };
    },
    downloadModel(modelId, opener) { openModelSetup(opener, modelId, 'local'); },
    contribute(modelId, opener) { openModelSetup(opener, modelId); },
    storage(opener) {
      select('settings'); dialog.open(opener);
      find('[data-toggle-file-contribution]').focus();
    },
    toggle(section = 'settings', opener) {
      if (isOpen() && !panel.querySelector(`[data-inspector-pane="${section}"]`).hidden) dialog.close();
      else { select(section); dialog.open(opener); }
    },
    open(section = 'participants', opener) { select(section); dialog.open(opener || navigation.querySelector(`[data-inspector-section="${section}"]`)); },
    close: options => dialog.close(options),
    dispose() { disposed = true; storagePanel.dispose(); disposeWebSearch(); disposeAccount(); metadataController?.abort(); controller.abort(); unsubscribe(); network(); modelDialog.dispose(); dialog.dispose(); if (typeof specialized === 'function') specialized(); }
  };
}
