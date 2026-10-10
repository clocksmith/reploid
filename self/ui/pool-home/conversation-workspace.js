import { createConversationList } from './conversation-list.js';
import { updateModelSelect } from '../components/model-select.js';
/** Conversation presentation; the host owns execution and disclosure. */
import { renderSharingControls, renderConnectionControl, bindNetworkControls } from './network-controls.js';
import { escapeHtml as escape, renderAttachments, readTextAttachments } from '../components/attachments.js';
import { bindDisclosure } from '../components/disclosure.js';
import { bindDialog } from '../components/dialog.js';
import { renderPermissionSummary, updatePermissionSummary } from '../components/permission-card.js';
import { createMessageList } from './message-list.js';

export function renderConversationWorkspace() {
  return `<section class="reploid-chat-workspace" data-chat-workspace aria-label="Conversation workspace">
    <aside id="chat-threads" class="chat-thread-sidebar pool-surface" data-thread-sidebar aria-label="Threads">
      <header class="chat-sidebar-header"><h2 id="chat-threads-title">Threads</h2><button class="pool-button chat-mobile-threads" type="button" data-close-threads>Close</button><button class="btn pool-button btn-ghost" type="button" data-new-thread>New thread</button></header>
      <div class="chat-thread-list" data-thread-list></div>
    </aside>
    <dialog class="chat-thread-drawer pool-surface" data-thread-dialog aria-labelledby="chat-threads-title"></dialog>
    <section class="chat-conversation-area pool-surface" data-conversation-area aria-label="Current conversation">
      <header class="chat-thread-header" data-network-header>
        <button class="pool-button chat-mobile-threads" type="button" data-open-threads>Threads</button>
        <div class="chat-thread-info">
          <span class="chat-model-control pool-activity-edge" data-model-control><select class="pool-input pool-glass" id="chat-model" data-active-model-select aria-label="Model"></select></span>
          </div>
        <button class="btn pool-button btn-ghost" type="button" data-toggle-inspector aria-expanded="false" aria-controls="chat-network-details">Network <span data-mesh-peers>0 peers</span></button>
      </header>
      <section class="chat-network-details" id="chat-network-details" data-contextual-inspector hidden aria-label="Network">
        <header class="chat-network-heading"><h2>Network</h2><button class="btn pool-button btn-ghost" type="button" data-close-inspector>Close</button></header>
        <ul data-insp-device-list></ul>
        <div class="chat-network-actions">${renderConnectionControl()}<button class="btn pool-button btn-ghost" type="button" data-mesh-invite>Invite</button></div>
        <p data-network-message role="status" hidden></p>
        <details data-thread-permissions hidden><summary>Thread permissions</summary>
          <p data-thread-permission-description>Approved recipients can receive this thread’s messages and attached text as public data, using its selected model. Revoking stops active work and future sharing; it cannot recall data already sent.</p>
          <ul data-thread-grants></ul></details>
        ${renderSharingControls()}
      </section>
      <div class="chat-message-stream" data-message-stream role="log" aria-label="Messages" aria-live="polite"></div>
      <section class="chat-approval" data-chat-approval hidden aria-label="Review before sending">
        <h2>Review before sending</h2><p>Other people’s computers will process what you share.</p>${renderPermissionSummary()}
        <label><input type="checkbox" data-approval-consent> <span data-approval-description>Share this exact input with this peer as public data</span></label>
        <label data-approval-remember-label hidden><input type="checkbox" data-approval-remember> Also allow future messages and attached text in this thread to this recipient, using this model, until revoked</label>
        <div class="chat-network-actions"><button class="btn pool-button btn-primary" type="button" data-approval-send disabled>Approve and send</button><button class="btn pool-button btn-ghost" type="button" data-approval-decline>Decline</button></div>
      </section>
      <p class="chat-error" role="alert" data-chat-error hidden></p>
      <footer class="chat-composer-area" data-composer-area><form data-composer-form>
        <label class="chat-visually-hidden" for="chat-message">Message</label>
        <div class="chat-composer-field pool-activity-edge" data-composer-field><textarea class="pool-input pool-glass pool-glass-focus" id="chat-message" data-composer-input rows="3" required placeholder="Ask a question…"></textarea></div>
        <div class="chat-composer-toolbar">
          <label class="btn pool-button btn-ghost chat-file-label pool-focus-within">Attach<input type="file" multiple data-composer-files accept=".txt,.md,.json,.js,.ts,.html,.css" /></label>
          <details class="chat-conversation-actions" data-conversation-actions><summary class="pool-button">Actions</summary><div class="pool-surface">
            <button class="pool-button chat-model-change" type="button" data-change-model hidden>Start a new conversation with another model</button>
            <button class="btn pool-button btn-ghost" type="button" data-conversation-download hidden>Download conversation</button>
            <button class="btn pool-button btn-ghost" type="button" data-model-setup>Run on this device</button>
          </div></details>
          <div class="chat-composer-submit">
            <p class="chat-setup-hint" id="chat-model-status" data-model-status role="status" hidden></p>
            <button class="btn pool-button btn-primary" type="submit" data-composer-send>Send</button>
            <button class="btn pool-button btn-ghost" type="button" data-retry-connection hidden>Retry connection</button>
            <button class="btn pool-button btn-ghost" type="button" data-composer-stop hidden>Stop</button>
          </div>
        </div><p class="chat-attachment-help">Text files: up to 8, 64 KB each, 128 KB total.</p><div class="chat-attachments" data-attachments-preview hidden></div>
      </form></footer>
      <dialog class="chat-model-setup pool-surface" data-model-dialog aria-labelledby="model-setup-title">
        <h2 id="model-setup-title">Run on this device</h2>
        <label>Model<select class="pool-input" data-download-model aria-label="Model to download"></select></label>
        <p data-download-size role="status">Checking download size…</p>
        <p>Stored on this device.</p>
        <div class="chat-network-actions"><button class="pool-button" type="button" data-download-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-download-confirm disabled>Download model</button></div>
      </dialog>
    </section>
  </section>`;
}

export function bindConversationWorkspace(root, session, { getInviteUrl, viewState = {} } = {}) {
  const container = root.querySelector('[data-chat-workspace]');
  if (!container || !session) return () => {};
  const find = selector => container.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const input = find('[data-composer-input]'), modelSelect = find('[data-active-model-select]');
  const disposeNetwork = bindNetworkControls(container, session, { getInviteUrl });
  let files = [], fileRevision = 0, reading = false, approvalKey = '', grantsKey = '';
  viewState.positions ??= new Map(); viewState.seen ??= new Map();
  const threads = createConversationList(find('[data-thread-list]'), viewState.seen);
  const messages = createMessageList(find('[data-message-stream]'), { getSources: session.getDocumentSources, positions: viewState.positions });
  const networkPanel = bindDisclosure({ root: find('[data-conversation-area]'), trigger: find('[data-toggle-inspector]'),
    panel: find('[data-contextual-inspector]'), closeButton: find('[data-close-inspector]') });
  const actions = find('[data-conversation-actions]');
  const actionsPanel = bindDisclosure({ root: actions, trigger: actions.querySelector('summary'), panel: actions.querySelector('div'), native: true });
  const drawer = find('[data-thread-dialog]'), sidebar = find('[data-thread-sidebar]');
  const threadDialog = bindDialog(drawer);
  const closeThreads = () => { threadDialog.close(); container.prepend(sidebar); };
  drawer.addEventListener('close', () => container.prepend(sidebar), options);
  onResize();
  function onResize() { if (globalThis.innerWidth > 760 && drawer.open) closeThreads(); }
  globalThis.addEventListener('resize', onResize, options);
  const drafts = new Map();
  const persisted = session.getDraft?.(session.getState().selectedId);
  if (persisted) { input.value = persisted.text; files = persisted.files; }
  const saveDraft = () => {
    const value = { text: input.value, files };
    drafts.set(selectedId, structuredClone(value)); session.saveDraft?.(selectedId, value);
  };
  let selectedId = session.getState().selectedId;
  const error = cause => {
    const node = find('[data-chat-error]');
    node.textContent = String(cause?.message || cause || ''); node.hidden = !node.textContent;
  };
  const act = operation => Promise.resolve().then(operation).catch(error);
  const on = (selector, event, callback) => find(selector)?.addEventListener(event, callback, options);
  const showFiles = () => renderAttachments(find('[data-attachments-preview]'), files);
  const render = state => {
    if (controller.signal.aborted) return;
    if (selectedId !== state.selectedId) {
      drafts.set(selectedId, { text: input.value, files }); selectedId = state.selectedId; fileRevision++;
      const draft = drafts.get(selectedId) || session.getDraft?.(selectedId); input.value = draft?.text || ''; files = draft?.files || []; showFiles();
    }
    const thread = state.activeThread, catalogModels = state.models || [];
    const keyFor = model => model?.selectionId || model?.id;
    const models = catalogModels.filter(model => ['ready', 'busy'].includes(model.availability));
    if (thread && !models.some(model => keyFor(model) === keyFor(thread.model))) {
      models.push(catalogModels.find(model => keyFor(model) === keyFor(thread.model)) || { ...thread.model, availability: 'unavailable' });
    }
    const current = keyFor(thread?.model) || (models.some(model => keyFor(model) === modelSelect.value) ? modelSelect.value : null)
      || keyFor(models.find(model => keyFor(model) === keyFor(state.defaultModel))) || keyFor(models[0]);
    updateModelSelect(modelSelect, models, { value: current, showAvailability: true });
    modelSelect.value = current || ''; modelSelect.disabled = !!thread || !models.length;
    modelSelect.title = thread ? 'This conversation keeps its model. Choose Actions to start another.' : 'Choose a model';
    find('[data-change-model]').hidden = !thread;
    const usable = thread?.permissions?.sharingScope === 'local'
      || models.some(model => keyFor(model) === current && ['ready', 'busy'].includes(model.availability));
    const modelStatus = find('[data-model-status]');
    const networkState = state.network?.consumer?.connectionState;
    const preparing = state.localModel?.phase === 'loading';
    modelStatus.textContent = preparing ? 'Downloading model…' + (Number.isFinite(state.localModel.progress?.progress) ? ' ' + Math.round(state.localModel.progress.progress * 100) + '%' : '')
      : state.localModel?.error && !usable ? 'Download failed: ' + state.localModel.error
      : usable ? '' : state.network?.paused ? 'Disconnected. Reconnect to find available models.'
      : catalogModels.some(model => model.availability === 'loading') ? 'A contributor is loading a model…'
        : state.network?.connecting || ['connecting', 'retrying'].includes(networkState) ? 'Finding available models…'
          : 'No model is available right now. Your draft stays here.';
    modelStatus.hidden = !modelStatus.textContent;
    find('[data-model-control]').hidden = !models.length;
    find('[data-model-control]').dataset.activity = models.some(model => keyFor(model) === current && model.availability === 'ready') ? 'ready' : 'idle';
    threads.update(state.threads, state.selectedId);
    const attempt = thread?.attempts.at(-1), busy = state.runningIds.includes(thread?.id) || !!state.comparisonPhase;
    find('[data-composer-send]').hidden = busy;
    find('[data-model-setup]').hidden = busy || !!thread?.model.partition || !!thread?.model.adapters?.length;
    find('[data-model-setup]').disabled = preparing;
    find('[data-model-setup]').textContent = preparing ? 'Downloading…' : 'Run on this device';
    find('[data-retry-connection]').hidden = busy || usable || preparing || state.network?.connecting || ['connecting', 'retrying'].includes(networkState); find('[data-composer-send]').disabled = reading || !usable || !!state.storageError;
    find('[data-composer-stop]').hidden = !busy;
    find('[data-conversation-download]').hidden = !thread?.messages.length;
    find('[data-composer-field]').dataset.activity = busy && attempt?.status === 'executing' ? 'executing' : 'idle';
    messages.update(thread, { usable, busy });
    const pending = attempt?.approval, key = pending ? JSON.stringify([thread.id, attempt.id, pending]) : '';
    if (key !== approvalKey) {
      approvalKey = key; find('[data-approval-consent]').checked = false; find('[data-approval-remember]').checked = false;
    }
    find('[data-approval-description]').textContent = pending?.disclosure === 'partition-activations'
      ? 'Share model activations derived from this input with this peer as public data'
      : 'Share this exact input with this peer as public data';
    find('[data-approval-remember-label]').hidden = !pending?.reusable;
    find('[data-chat-approval]').hidden = !pending;
    if (pending) {
      updatePermissionSummary(find('[data-chat-approval]'), {
        recipient: `Recipient: Peer ${pending.peerId.slice(0, 8)} · ${thread.model.name || pending.modelId}`,
        scope: pending.disclosure === 'partition-activations'
          ? 'Model data derived from the input below leaves this device. Approval applies to this request.'
          : 'The messages and attached text below leave this device. Approval applies to this request.',
        input: pending.input,
        technical: { recipient: pending.peerId, model: pending.modelId || thread.model.id, disclosure: pending.disclosure,
          input: pending.input, options: pending.options, limits: pending.limits, expiresAt: pending.expiresAt, approvalId: pending.id }
      });
    }
    find('[data-approval-send]').disabled = !pending || !find('[data-approval-consent]').checked;
    const grants = (thread?.grants || []).filter(grant => grant.revokedAt === null);
    find('[data-thread-permission-description]').textContent = thread?.model.partition
      ? 'Approved recipients can receive model activations derived from this thread’s messages and attached text, for this model and split. Revoking stops active work and future sharing; it cannot recall data already sent.'
      : 'Approved recipients can receive this thread’s messages and attached text as public data, using its selected model. Revoking stops active work and future sharing; it cannot recall data already sent.';
    find('[data-thread-permissions]').hidden = !grants.length;
    const nextGrants = JSON.stringify([thread?.id, grants]);
    if (nextGrants !== grantsKey) {
      grantsKey = nextGrants;
      find('[data-thread-grants]').innerHTML = grants.map(grant => `<li>${escape(grant.recipientIdentity)} · ${escape(grant.modelId)} <button class="btn pool-button btn-ghost" type="button" data-revoke-grant="${escape(grant.id)}">Revoke</button></li>`).join('');
    }
    error(state.storageError || '');

  };
  const unsubscribe = session.subscribe(render);
  showFiles();
  let metadataController = null;
  const dialog = find('[data-model-dialog]');
  const modelDialog = bindDialog(dialog);
  const checkDownload = async () => {
    metadataController?.abort();
    const request = metadataController = new AbortController();
    find('[data-download-confirm]').disabled = true;
    find('[data-download-size]').textContent = 'Checking download size…';
    try {
      const info = await session.getModelDownload(find('[data-download-model]').value, { signal: request.signal });
      if (request.signal.aborted || controller.signal.aborted) return;
      find('[data-download-size]').textContent = Math.ceil(info.sizeBytes / 1e6) + ' MB download';
      find('[data-download-confirm]').disabled = false;
    } catch (cause) {
      if (!request.signal.aborted && !controller.signal.aborted) find('[data-download-size]').textContent = cause.message;
    }
  };
  on('[data-model-setup]', 'click', () => {
    saveDraft();
    const state = session.getState(), currentModel = state.activeThread?.model;
    const models = state.models.filter(model => !model.partition && !model.adapters?.length);
    const select = find('[data-download-model]');
    updateModelSelect(select, models);
    if (currentModel) select.value = currentModel.id;
    select.disabled = !!currentModel;
    actionsPanel.setOpen(false);
    modelDialog.open(select, actions.querySelector('summary'));
    void checkDownload();
  });
  on('[data-download-model]', 'change', () => { void checkDownload(); });
  on('[data-download-cancel]', 'click', () => modelDialog.close());
  on('[data-model-dialog]', 'close', () => { metadataController?.abort(); });
  on('[data-download-confirm]', 'click', () => {
    const modelId = find('[data-download-model]').value;
    dialog.close();
    void act(() => session.prepareLocalModel(modelId));
  });
  on('[data-composer-input]', 'input', () => { try { saveDraft(); } catch (cause) { error(cause); } });
  const newThread = () => { saveDraft(); actionsPanel.setOpen(false); session.select(null); if (drawer.open) closeThreads(); input.focus(); };
  on('[data-new-thread]', 'click', newThread);
  on('[data-change-model]', 'click', () => { newThread(); modelSelect.focus(); });
  on('[data-open-threads]', 'click', () => { drawer.append(sidebar); threadDialog.open(sidebar.querySelector('[aria-current="true"]') || sidebar.querySelector('[data-new-thread]')); });
  on('[data-close-threads]', 'click', closeThreads);
  on('[data-retry-connection]', 'click', () => act(() => session.connect()));
  on('[data-thread-list]', 'click', event => { const button = event.target.closest('[data-thread-item-id]'); if (button) { saveDraft(); session.select(button.dataset.threadItemId); if (drawer.open) closeThreads(); } });
  on('[data-composer-form]', 'submit', event => {
    event.preventDefault();
    const content = input.value.trim(), state = session.getState();
    if (!content || reading || state.runningIds.includes(state.selectedId)) return;
    if (find('[data-composer-send]').disabled) return;
    act(async () => {
      const model = state.models.find(item => (item.selectionId || item.id) === modelSelect.value), attachments = files.map(file => ({ ...file }));
      const threadId = state.selectedId || session.createThread({ model, sharingScope: model?.localReady ? 'local' : 'mesh' });
      input.value = content; files = attachments; showFiles();
      const completion = session.send(threadId, content, attachments);
      session.saveDraft?.(null, null); session.saveDraft?.(threadId, null);
      input.value = ''; files = []; drafts.delete(null); drafts.delete(threadId); showFiles();
      await completion;
    });
  });
  on('[data-composer-input]', 'keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); find('[data-composer-form]').requestSubmit(); }
  });
  on('[data-composer-stop]', 'click', () => act(() => session.cancel(session.getState().selectedId)));
  on('[data-message-stream]', 'click', event => {
    const copy = event.target.closest('[data-copy-message], [data-copy-code]');
    if (copy) act(async () => {
      const row = copy.closest('[data-message-id]');
      const content = copy.hasAttribute('data-copy-code') ? copy.parentElement.querySelector('code').textContent
        : session.getState().activeThread.messages.find(message => message.id === row.dataset.messageId).content;
      await navigator.clipboard.writeText(content); copy.textContent = 'Copied';
    });
    const button = event.target.closest('[data-retry-attempt]');
    if (button && !button.disabled) act(() => session.retry(session.getState().selectedId, button.dataset.retryAttempt));
  });
  on('[data-composer-files]', 'change', event => {
    const chosen = [...event.target.files]; event.target.value = '';
    const revision = fileRevision; reading = true; render(session.getState());
    act(async () => {
      try {
        const loaded = await readTextAttachments(chosen, files, { maxFiles: 8, maxFileBytes: 65536, maxTotalBytes: 131072,
          extensions: ['txt', 'md', 'json', 'js', 'ts', 'html', 'css'] });
        if (controller.signal.aborted || revision !== fileRevision) return;
        files.push(...loaded); saveDraft(); showFiles();
      } finally { reading = false; if (!controller.signal.aborted) render(session.getState()); }
    });
  });
  on('[data-attachments-preview]', 'click', event => { const button = event.target.closest('[data-remove-file]'); if (button) { files.splice(Number(button.dataset.removeFile), 1); saveDraft(); showFiles(); } });
  on('[data-conversation-download]', 'click', () => act(() => {
    const text = session.exportConversation(selectedId);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = 'reploid-conversation.md';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
  }));
  on('[data-message-stream]', 'click', event => {
    const link = event.target.closest('[data-source-reference]');
    if (!link) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (target) { event.preventDefault(); target.closest('details').open = true; target.focus(); target.scrollIntoView({ block: 'nearest' }); }
  });
  const approve = accepted => act(() => {
    const thread = session.getState().activeThread, attempt = thread?.attempts.at(-1);
    if (attempt?.approval) session.approve(thread.id, attempt.id, attempt.approval.id, accepted,
      { remember: accepted && attempt.approval.reusable && find('[data-approval-remember]').checked });
  });
  on('[data-approval-consent]', 'change', () => render(session.getState()));
  on('[data-approval-send]', 'click', () => { if (find('[data-approval-consent]').checked) approve(true); });
  on('[data-approval-decline]', 'click', () => approve(false));
  on('[data-thread-grants]', 'click', event => {
    const button = event.target.closest('[data-revoke-grant]');
    if (button) act(() => session.revokeGrant(session.getState().selectedId, button.dataset.revokeGrant));
  });
  return () => {
    metadataController?.abort();
    try { saveDraft(); } catch (cause) { error(cause); }
    messages.dispose(); threads.dispose(); networkPanel.dispose(); actionsPanel.dispose(); modelDialog.dispose(); threadDialog.dispose();
    controller.abort(); fileRevision++; unsubscribe(); disposeNetwork();
    find('[data-composer-field]').dataset.activity = 'idle';
    find('[data-model-control]').dataset.activity = 'idle';
  };
}
