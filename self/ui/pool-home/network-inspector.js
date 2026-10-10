/** One projection of conversation execution, participant availability, and device contribution. */
import { renderSharingControls, renderConnectionControl, bindNetworkControls } from './network-controls.js';
import { bindDialog } from '../components/dialog.js';
import { updateModelSelect } from '../components/model-select.js';
import { escapeHtml as escape } from '../components/attachments.js';
import { projectExecutionRibbon, routeMarkup, detailMarkup } from './execution-ribbon.js';

export function renderNetworkInspector() {
  return `<dialog class="network-inspector pool-surface" data-contextual-inspector data-network-workspace aria-labelledby="network-inspector-title">
    <header class="chat-network-heading"><h2 id="network-inspector-title">Network</h2><button class="pool-button" type="button" data-close-inspector>Close</button></header>
    <nav class="network-inspector-tabs" aria-label="Network sections">
      <button class="pool-button" type="button" data-inspector-section="conversation">This conversation</button>
      <button class="pool-button" type="button" data-inspector-section="participants">Participants</button>
      <button class="pool-button" type="button" data-inspector-section="device">This device</button>
    </nav>
    <section data-inspector-pane="conversation" aria-label="This conversation">
      <h3>This conversation</h3><div class="execution-ribbon-route" data-inspector-route></div>
      <p data-inspector-status role="status"></p>
      <details><summary>Execution details</summary><div class="execution-inspector-facts" data-ribbon-facts></div></details>
      <section data-thread-permissions hidden><h4>Current permissions</h4>
        <p>Revoking stops this thread’s sharing. It cannot recall data already sent.</p><ul data-thread-grants></ul></section>
    </section>
    <section data-inspector-pane="participants" aria-label="Available participants" hidden>
      <h3>Available participants <small data-mesh-peers></small></h3>
      ${renderConnectionControl()}<ul class="network-peer-list" data-insp-device-list></ul>
      <button class="pool-button" type="button" data-mesh-invite hidden>Copy private invitation</button>
    </section>
    <section data-inspector-pane="device" aria-label="This device" hidden>
      <h3>This device</h3>${renderSharingControls()}
      <button class="pool-button" type="button" data-model-setup>Run on this device</button>
      <details data-specialized-jobs><summary>Specialized model jobs</summary><div data-specialized-content></div></details>
    </section>
    <p data-network-message role="status" hidden></p><p data-inspector-error role="alert" hidden></p>
  </dialog>
  <dialog class="chat-model-setup pool-surface" data-model-dialog aria-labelledby="model-setup-title">
    <h2 id="model-setup-title">Run on this device</h2>
    <label>Model<select class="pool-input" data-download-model aria-label="Model to download"></select></label>
    <p data-download-size role="status">Checking download size…</p><p>Stored on this device. Sharing stays optional.</p>
    <div class="chat-network-actions"><button class="pool-button" type="button" data-download-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-download-confirm disabled>Download model</button></div>
  </dialog>`;
}

export function bindNetworkInspector(root, session, { getInviteUrl, loadSpecialized } = {}) {
  const find = selector => root.querySelector(selector);
  const panel = find('[data-contextual-inspector]'), dialog = bindDialog(panel);
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
  }, options);
  on('[data-close-inspector]', 'click', () => dialog.close());
  const unsubscribe = session.subscribe(state => {
    const view = projectExecutionRibbon(state), key = JSON.stringify([view.execution, view.status, view.model, view.attempt?.error, view.totalMs]);
    if (key !== executionKey) {
      executionKey = key; find('[data-inspector-route]').innerHTML = routeMarkup(view);
      find('[data-ribbon-facts]').innerHTML = detailMarkup(view);
    }
    find('[data-inspector-status]').textContent = view.statusLabel;
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
  return {
    open(section = 'participants', opener) { select(section); dialog.open(panel.querySelector(`[data-inspector-section="${section}"]`), opener); },
    close: () => dialog.close(),
    dispose() { disposed = true; metadataController?.abort(); controller.abort(); unsubscribe(); network(); modelDialog.dispose(); dialog.dispose(); if (typeof specialized === 'function') specialized(); }
  };
}
