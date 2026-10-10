import { createConversationList } from './conversation-list.js';
import { updateModelSelect } from '../components/model-select.js';
/** Conversation presentation; the host owns execution and disclosure. */
import { projectNetworkPeers } from './network-controls.js';
import { renderNetworkInspector, bindNetworkInspector } from './network-inspector.js';
import { escapeHtml as escape, renderAttachments, readTextAttachments } from '../components/attachments.js';
import { bindDisclosure } from '../components/disclosure.js';
import { bindDialog } from '../components/dialog.js';
import { renderPermissionSummary, updatePermissionSummary } from '../components/permission-card.js';
import { createMessageList } from './message-list.js';

export function renderConversationWorkspace({ inspector = true } = {}) {
  return `<section class="reploid-chat-workspace" data-chat-workspace aria-label="Conversation workspace">
    <aside id="chat-threads" class="chat-thread-sidebar pool-surface" data-thread-sidebar aria-label="Threads">
      <header class="chat-sidebar-header"><h2 id="chat-threads-title">Threads</h2><button class="pool-button chat-mobile-threads" type="button" data-close-threads>Close</button><button class="btn pool-button btn-ghost" type="button" data-new-thread>New thread</button></header>
      <div class="chat-thread-list" data-thread-list></div><button class="pool-button" type="button" data-show-archived aria-pressed="false">Archived threads</button>
    </aside>
    <dialog class="chat-thread-drawer pool-surface" data-thread-dialog aria-labelledby="chat-threads-title"></dialog>
    <section class="chat-conversation-area pool-surface" data-conversation-area aria-label="Current conversation">
      <header class="chat-thread-header" data-network-header>
        <button class="pool-button chat-mobile-threads" type="button" data-open-threads>Threads</button>
        <div class="chat-thread-info">
          <span class="chat-model-control pool-activity-edge" data-model-control><select class="pool-input pool-glass" id="chat-model" data-active-model-select aria-label="Model"></select><button class="pool-button" type="button" data-current-model aria-haspopup="dialog" hidden></button></span>
          </div>
        <button class="btn pool-button btn-ghost" type="button" data-toggle-inspector aria-haspopup="dialog">Network <span data-mesh-peers>0 peers</span></button>
      </header>
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
            <button class="btn pool-button btn-ghost" type="button" data-conversation-download hidden>Download conversation</button>
          </div></details>
          <div class="chat-composer-submit">
            <p class="chat-setup-hint" id="chat-model-status" data-model-status role="status" hidden></p>
            <button class="btn pool-button btn-primary" type="submit" data-composer-send>Send</button>
            <button class="btn pool-button btn-ghost" type="button" data-retry-connection hidden>Retry connection</button>
            <button class="btn pool-button btn-ghost" type="button" data-composer-stop hidden>Stop</button>
          </div>
        </div><p class="chat-attachment-help" data-attachment-help hidden>Text files: up to 8, 64 KB each, 128 KB total.</p><div class="chat-attachments" data-attachments-preview hidden></div>
      </form></footer>
      <dialog class="chat-model-setup pool-surface" data-rename-dialog aria-labelledby="chat-rename-title">
        <form data-rename-form><h2 id="chat-rename-title">Rename thread</h2><label>Name<input class="pool-input" data-thread-name required maxlength="256"></label>
          <div class="chat-network-actions"><button class="pool-button" type="button" data-rename-cancel>Cancel</button><button class="pool-button" type="submit">Save</button></div>
        </form>
      </dialog>
      <dialog class="chat-model-setup pool-surface" data-model-picker aria-labelledby="chat-model-picker-title">
        <h2 id="chat-model-picker-title">Conversation model</h2><p data-current-model-description></p>
        <p>This thread keeps its model. Choose a model for a new thread.</p>
        <label>Model<select class="pool-input" data-next-model></select></label>
        <div class="chat-network-actions"><button class="pool-button" type="button" data-model-picker-close>Cancel</button><button class="pool-button" type="button" data-change-model>New thread with this model</button></div>
      </dialog>
    </section>
    ${inspector ? renderNetworkInspector() : ''}
  </section>`;
}

export function bindConversationWorkspace(root, session, { getInviteUrl, viewState = {}, inspector: sharedInspector } = {}) {
  const container = root.querySelector('[data-chat-workspace]');
  if (!container || !session) return () => {};
  const find = selector => container.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const input = find('[data-composer-input]'), modelSelect = find('[data-active-model-select]');
  const inspector = sharedInspector || bindNetworkInspector(container, session, { getInviteUrl });
  let archived = false, renameId = null, chosenModel = viewState.chosenModel || null;
  let files = [], fileRevision = 0, reading = false, approvalKey = '';
  viewState.positions ??= new Map(); viewState.seen ??= new Map();
  const threads = createConversationList(find('[data-thread-list]'), viewState.seen);
  const messages = createMessageList(find('[data-message-stream]'), { getSources: session.getDocumentSources, positions: viewState.positions });
  const actions = find('[data-conversation-actions]');
  const actionsPanel = bindDisclosure({ root: actions, trigger: actions.querySelector('summary'), panel: actions.querySelector('div'), native: true });
  const drawer = find('[data-thread-dialog]'), sidebar = find('[data-thread-sidebar]');
  const threadDialog = bindDialog(drawer);
  const closeThreads = () => { threadDialog.close(); container.prepend(sidebar); };
  drawer.addEventListener('close', () => container.prepend(sidebar), options);
  onResize();
  function onResize() {
    if (globalThis.innerWidth > 760 && drawer.open) closeThreads();
    const surface = container.closest('.pool-home');
    if (surface) {
      const height = globalThis.visualViewport?.height || globalThis.innerHeight;
      surface.style.setProperty('--pool-param-workspace-height', `${height}px`);
      // Mobile keyboards may resize only visualViewport; CSS height queries stay unchanged.
      surface.toggleAttribute('data-chat-compact', height <= 600);
    }
  }
  globalThis.addEventListener('resize', onResize, options);
  globalThis.visualViewport?.addEventListener('resize', onResize, options);
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
  const showFiles = () => { renderAttachments(find('[data-attachments-preview]'), files); find('[data-attachment-help]').hidden = !files.length; };
  const render = state => {
    if (controller.signal.aborted) return;
    if (selectedId !== state.selectedId) {
      drafts.set(selectedId, { text: input.value, files }); selectedId = state.selectedId; fileRevision++;
      const draft = drafts.get(selectedId) || session.getDraft?.(selectedId); input.value = draft?.text || ''; files = draft?.files || []; showFiles();
    }
    const thread = state.activeThread, catalogModels = state.models || [];
    const keyFor = model => model?.selectionId || model?.id;
    const models = catalogModels.filter(model => ['ready', 'busy', 'loading', 'preparing'].includes(model.availability));
    if (!thread && chosenModel && !models.some(model => keyFor(model) === keyFor(chosenModel))) {
      models.push(catalogModels.find(model => keyFor(model) === keyFor(chosenModel)) || { ...chosenModel, availability: 'unavailable' });
    }
    if (thread && !models.some(model => keyFor(model) === keyFor(thread.model))) {
      models.push(catalogModels.find(model => keyFor(model) === keyFor(thread.model)) || { ...thread.model, availability: 'unavailable' });
    }
    const current = keyFor(thread?.model) || keyFor(chosenModel) || (models.some(model => keyFor(model) === modelSelect.value) ? modelSelect.value : null)
      || keyFor(models.find(model => keyFor(model) === keyFor(state.defaultModel))) || keyFor(models[0]);
    updateModelSelect(modelSelect, models, { value: current, showAvailability: true });
    modelSelect.value = current || ''; modelSelect.disabled = !models.length; modelSelect.hidden = !!thread;
    const currentModel = find('[data-current-model]'); currentModel.hidden = !thread;
    currentModel.textContent = thread?.model.name || 'Model';
    currentModel.setAttribute('aria-label', `${thread?.model.name || 'Model'}. Choose a model for a new thread`);
    const peerCount = projectNetworkPeers(state).length;
    find('[data-mesh-peers]').textContent = `${peerCount} ${peerCount === 1 ? 'peer' : 'peers'}`;
    const usable = thread?.permissions?.sharingScope === 'local'
      || models.some(model => keyFor(model) === current && ['ready', 'busy'].includes(model.availability));
    const modelStatus = find('[data-model-status]');
    const networkState = state.network?.consumer?.connectionState;
    const preparing = state.localModel?.phase === 'loading';
    modelStatus.textContent = thread?.closed ? 'Archived thread. Restore it to continue.' : preparing ? 'Downloading model…' + (Number.isFinite(state.localModel.progress?.progress) ? ' ' + Math.round(state.localModel.progress.progress * 100) + '%' : '')
      : state.localModel?.error && !usable ? 'Download failed: ' + state.localModel.error
      : usable ? '' : state.network?.paused ? 'Disconnected. Reconnect to find available models.'
      : ['loading', 'preparing'].includes(models.find(model => keyFor(model) === current)?.availability) ? 'This model is preparing…'
      : current ? 'This model is unavailable. Your draft stays here.'
        : state.network?.connecting || ['connecting', 'retrying'].includes(networkState) ? 'Finding available models…'
          : 'No model is available right now. Your draft stays here.';
    modelStatus.hidden = !modelStatus.textContent;
    find('[data-model-control]').hidden = !models.length;
    find('[data-model-control]').dataset.activity = models.some(model => keyFor(model) === current && model.availability === 'ready') ? 'ready' : 'idle';
    threads.update(state.threads, state.selectedId, { archived });
    const attempt = thread?.attempts.at(-1), busy = state.runningIds.includes(thread?.id) || !!state.comparisonPhase;
    find('[data-composer-send]').hidden = busy;
    find('[data-retry-connection]').hidden = busy || usable || preparing || state.network?.connecting || ['connecting', 'retrying'].includes(networkState); find('[data-composer-send]').disabled = reading || !usable || !!thread?.closed || !!state.storageError;
    find('[data-composer-stop]').hidden = !busy;
    find('[data-conversation-download]').hidden = !thread?.messages.length;
    find('[data-composer-field]').dataset.activity = busy && attempt?.status === 'executing' ? 'executing' : 'idle';
    messages.update(thread, { usable: usable && !thread?.closed, busy });
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
    error(state.storageError || '');

  };
  const unsubscribe = session.subscribe(render);
  showFiles();
  const renameDialog = bindDialog(find('[data-rename-dialog]'));
  const picker = bindDialog(find('[data-model-picker]'));
  on('[data-toggle-inspector]', 'click', event => inspector.open('participants', event.currentTarget));
  on('[data-current-model]', 'click', event => {
    const state = session.getState();
    find('[data-current-model-description]').textContent = state.activeThread?.model.name || '';
    const models = state.models.filter(model => ['ready', 'busy', 'loading', 'preparing'].includes(model.availability));
    updateModelSelect(find('[data-next-model]'), models, { showAvailability: true });
    find('[data-change-model]').disabled = !models.length;
    picker.open(find('[data-next-model]'), event.currentTarget);
  });
  on('[data-model-picker-close]', 'click', () => picker.close());
  on('[data-composer-input]', 'input', () => { try { saveDraft(); } catch (cause) { error(cause); } });
  const newThread = () => { saveDraft(); chosenModel = null; viewState.chosenModel = null; archived = false; find('[data-show-archived]').setAttribute('aria-pressed', 'false'); find('[data-show-archived]').textContent = 'Archived threads'; actionsPanel.setOpen(false); session.select(null); if (drawer.open) closeThreads(); input.focus(); };
  on('[data-new-thread]', 'click', newThread);
  on('[data-active-model-select]', 'change', () => { chosenModel = session.getState().models.find(model => (model.selectionId || model.id) === modelSelect.value); viewState.chosenModel = chosenModel; render(session.getState()); });
  on('[data-change-model]', 'click', () => { const next = find('[data-next-model]').value; picker.close(); newThread(); chosenModel = session.getState().models.find(model => (model.selectionId || model.id) === next); viewState.chosenModel = chosenModel; modelSelect.value = next; render(session.getState()); modelSelect.focus(); });
  on('[data-open-threads]', 'click', () => { drawer.append(sidebar); threadDialog.open(sidebar.querySelector('[aria-current="true"]') || sidebar.querySelector('[data-new-thread]')); });
  on('[data-close-threads]', 'click', closeThreads);
  on('[data-retry-connection]', 'click', () => act(() => session.connect()));
  on('[data-show-archived]', 'click', event => { archived = !archived; event.currentTarget.setAttribute('aria-pressed', String(archived)); event.currentTarget.textContent = archived ? 'Back to threads' : 'Archived threads'; render(session.getState()); });
  on('[data-rename-cancel]', 'click', () => renameDialog.close());
  on('[data-rename-form]', 'submit', event => { event.preventDefault(); void act(() => { session.renameThread(renameId, find('[data-thread-name]').value); renameDialog.close(); }); });
  on('[data-thread-list]', 'click', event => {
    const rename = event.target.closest('[data-rename-thread]');
    if (rename) {
      renameId = rename.dataset.threadId; const thread = session.getState().threads.find(item => item.id === renameId);
      find('[data-thread-name]').value = thread.title || thread.purpose || thread.messages.find(message => message.role === 'user')?.content || 'New thread';
      rename.closest('details').open = false; renameDialog.open(find('[data-thread-name]'), rename.closest('details').querySelector('summary')); return;
    }
    const archive = event.target.closest('[data-archive-thread]');
    if (archive) {
      saveDraft(); void act(() => {
        if (archived) { archived = false; find('[data-show-archived]').setAttribute('aria-pressed', 'false'); find('[data-show-archived]').textContent = 'Archived threads'; session.restoreThread(archive.dataset.threadId); }
        else session.archiveThread(archive.dataset.threadId);
        (find('[data-thread-item-id][aria-current="true"]') || find('[data-new-thread]')).focus();
      }); return;
    }
    const button = event.target.closest('[data-thread-item-id]'); if (button) { saveDraft(); session.select(button.dataset.threadItemId); if (drawer.open) closeThreads(); } });
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
  on('[data-composer-files]', 'click', () => { find('[data-attachment-help]').hidden = false; });
  on('[data-composer-files]', 'focus', () => { find('[data-attachment-help]').hidden = false; });
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
  return () => {
    try { saveDraft(); } catch (cause) { error(cause); }
    messages.dispose(); threads.dispose(); actionsPanel.dispose(); picker.dispose(); renameDialog.dispose(); threadDialog.dispose();
    const surface = container.closest('.pool-home');
    surface?.style.removeProperty('--pool-param-workspace-height');
    surface?.removeAttribute('data-chat-compact');
    controller.abort(); fileRevision++; unsubscribe(); if (!sharedInspector) inspector.dispose();
    find('[data-composer-field]').dataset.activity = 'idle';
    find('[data-model-control]').dataset.activity = 'idle';
  };
}
