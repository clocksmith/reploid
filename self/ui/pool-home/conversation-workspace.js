import { withComputerLabels } from './computer-labels.js';
import { interfaceIcon } from '../components/interface-icons.js';
import { createConversationList } from './conversation-list.js';
import { updateModelSelect } from '../components/model-select.js';
/** Conversation presentation; the host owns execution and disclosure. */
import { projectNetworkPeers } from './network-controls.js';
import { renderNetworkInspector, bindNetworkInspector } from './network-inspector.js';
import { escapeHtml as escape, renderAttachments, readTextAttachments } from '../components/attachments.js';
import { bindDisclosure } from '../components/disclosure.js';
import { bindDialog } from '../components/dialog.js';
import { createMessageList } from './message-list.js';

const selectable = model => ['ready', 'busy', 'loading', 'preparing'].includes(model.availability);

export function renderConversationWorkspace({ inspector = true } = {}) {
  return `<section class="reploid-chat-workspace" data-chat-workspace aria-label="Conversation workspace">
    <aside id="chat-threads" class="chat-thread-sidebar pool-surface" data-thread-sidebar aria-label="Threads">
      <header class="chat-sidebar-header"><span data-thread-rail-brand></span><h2 id="chat-threads-title" class="chat-rail-label">Threads</h2></header>
      <button class="pool-button chat-new-thread" type="button" data-new-thread aria-label="New thread" title="New thread">${interfaceIcon('newThread')}<span class="chat-rail-label">New thread</span></button>
      <div class="chat-rail-controls" data-network-header>

        <button class="pool-button chat-rail-icon" type="button" data-open-model aria-label="Choose model" title="Choose model">${interfaceIcon('device')}</button><div class="chat-thread-info">
          <span class="chat-model-control pool-activity-edge" data-model-control><select class="pool-input pool-glass" id="chat-model" data-active-model-select aria-label="Model"></select><button class="pool-button" type="button" data-current-model aria-haspopup="dialog" hidden></button></span>
          </div>

        <details class="chat-conversation-actions" data-conversation-actions><summary class="pool-button" aria-label="Conversation actions" title="Conversation actions">${interfaceIcon('more')}<span class="chat-rail-label">Conversation</span></summary><div class="pool-surface">
          <button class="pool-button" type="button" data-show-archived aria-pressed="false">Archived threads</button>
          <button class="btn pool-button btn-ghost" type="button" data-conversation-download hidden>Download conversation</button>
          <fieldset data-context-controls><legend>Context prompt</legend>
            <label><input type="checkbox" data-context-enabled> Include app context</label>
            <label>Word cap <select class="pool-input" data-context-cap aria-label="Context prompt word cap"><option value="16">16</option><option value="32">32</option><option value="64">64</option></select></label>
            <p class="chat-setup-hint" data-context-count></p><p class="chat-setup-hint" data-context-preview></p>
          </fieldset>
        </div></details>
      </div>
      <div class="chat-thread-list" data-thread-list></div>
    </aside>
    <section class="chat-conversation-area pool-surface" data-conversation-area aria-label="Current conversation">
      <div class="chat-transcript chat-message-stream" data-chat-transcript data-message-stream role="log" aria-label="Messages" aria-live="polite"></div>
      <p class="chat-error" role="alert" data-chat-error hidden></p>
      <footer class="chat-composer-area" data-composer-area><form data-composer-form>
        <label class="chat-visually-hidden" for="chat-message">Message</label>
        <div class="chat-composer-field pool-input pool-glass pool-glass-focus pool-activity-edge" data-composer-field>
          <div class="chat-attachments" data-attachments-preview hidden></div>
          <textarea id="chat-message" data-composer-input rows="1" required placeholder="Ask a question…"></textarea>
          <label class="btn pool-button btn-ghost chat-file-label pool-focus-within" title="Attach files">${interfaceIcon('attach')}<span class="chat-visually-hidden">Attach files</span><input type="file" multiple data-composer-files accept=".txt,.md,.json,.js,.ts,.html,.css" /></label>
          <div class="chat-composer-submit">
            <button class="btn pool-button btn-primary" type="submit" data-composer-send aria-label="Send" title="Send">${interfaceIcon('send')}</button>
            <button class="btn pool-button btn-ghost" type="button" data-composer-stop aria-label="Stop" title="Stop" hidden>${interfaceIcon('stop')}</button>
          </div>
        </div>
        <div class="chat-composer-notices"><p class="chat-setup-hint" id="chat-model-status" data-model-status role="status" hidden></p><button class="pool-button btn-ghost" type="button" data-retry-connection hidden>Retry connection</button></div>
        <p class="chat-attachment-help" data-attachment-help hidden>Text files: up to 8, 64 KB each, 128 KB total.</p>
      </form></footer>
      <dialog class="chat-model-setup pool-surface" data-rename-dialog aria-labelledby="chat-rename-title">
        <form data-rename-form><h2 id="chat-rename-title">Rename thread</h2><label>Name<input class="pool-input" data-thread-name required maxlength="256"></label>
          <div class="chat-network-actions"><button class="pool-button" type="button" data-rename-cancel>Cancel</button><button class="pool-button" type="submit">Save</button></div>
        </form>
      </dialog>
      <dialog class="chat-model-setup pool-surface" data-model-picker aria-labelledby="chat-model-picker-title">
        <h2 id="chat-model-picker-title">Conversation model</h2><p data-current-model-description></p>
        <p>A new model starts a new thread.</p>
        <label>Model<select class="pool-input" data-next-model></select></label>
        <p data-next-model-status role="status" hidden></p>
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
  let archived = false, renameId = null, chosenModel = viewState.chosenModel || null, pickerModel = null;
  let files = [], fileRevision = 0, composerRevision = 0, reading = false;
  let contextPrompt = viewState.contextPrompt || null;
  viewState.positions ??= new Map(); viewState.seen ??= new Map();
  const threads = createConversationList(find('[data-thread-list]'), viewState.seen, { getSources: session.getDocumentSources });
  const messages = createMessageList(find('[data-message-stream]'), { getSources: session.getDocumentSources, positions: viewState.positions, scrollContainer: find('[data-chat-transcript]') });
  const actions = find('[data-conversation-actions]');
  const actionsPanel = bindDisclosure({ root: actions, trigger: actions.querySelector('summary'), panel: actions.querySelector('div'), native: true });
  const surface = container.closest('.pool-home');
  const railToggle = surface?.querySelector('[data-toggle-thread-rail]');
  const brandParent = railToggle?.parentElement;
  if (railToggle) find('[data-thread-rail-brand]').append(railToggle);
  const setThreads = open => {
    viewState.threadsOpen = open; container.toggleAttribute('data-threads-open', open);
    surface?.toggleAttribute('data-left-rail-open', open);
    railToggle?.setAttribute('aria-expanded', String(open));
  };
  setThreads(viewState.threadsOpen ?? false);
  find('[data-open-model]').addEventListener('click', () => { setThreads(true); (modelSelect.hidden ? find('[data-current-model]') : modelSelect).focus(); }, options);
  railToggle?.addEventListener('click', () => setThreads(!container.hasAttribute('data-threads-open')), options);
  surface?.addEventListener('keydown', event => {
    if (event.key === 'Escape' && container.hasAttribute('data-threads-open')) {
      event.preventDefault(); setThreads(false); railToggle?.focus();
    }
  }, options);
  onResize();
  function onResize() {
    resizeInput();
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
    drafts.set(selectedId, structuredClone(value)); return session.saveDraft?.(selectedId, value);
  };
  let selectedId = session.getState().selectedId, submitting = false;
  const error = cause => {
    const node = find('[data-chat-error]');
    node.textContent = String(cause?.message || cause || ''); node.hidden = !node.textContent;
  };
  const act = operation => Promise.resolve().then(operation).catch(error);
  const after = (pending, next) => pending?.then ? pending.then(next) : next();
  const observe = pending => pending?.catch?.(error);
  const on = (selector, event, callback) => find(selector)?.addEventListener(event, callback, options);
  function resizeInput() {
    input.style.height = 'auto';
    input.style.height = Math.min(Math.max(48, input.scrollHeight), Math.max(72, (globalThis.visualViewport?.height || globalThis.innerHeight || 800) * 0.22)) + 'px';
  }
  // Rail changes alter the input width without a window resize.
  let inputWidth = input.getBoundingClientRect().width;
  const inputResize = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    const width = input.getBoundingClientRect().width;
    if (!controller.signal.aborted && width !== inputWidth) { inputWidth = width; resizeInput(); }
  }) : null;
  inputResize?.observe(input);
  const showFiles = () => { resizeInput(); renderAttachments(find('[data-attachments-preview]'), files); find('[data-attachment-help]').hidden = !files.length; };
  const updatePicker = state => {
    const keyFor = model => model?.selectionId || model?.id;
    const models = state.models.filter(selectable);
    const selected = state.models.find(model => keyFor(model) === keyFor(pickerModel));
    if (pickerModel && !models.some(model => keyFor(model) === keyFor(pickerModel))) {
      models.push(selected || { ...pickerModel, availability: 'unavailable' });
    }
    updateModelSelect(find('[data-next-model]'), models, { value: keyFor(pickerModel), showAvailability: true });
    const available = selected && selectable(selected);
    find('[data-change-model]').disabled = !available;
    const status = find('[data-next-model-status]');
    status.textContent = !pickerModel ? 'No model is available right now.'
      : !available ? 'This model is unavailable. Choose another model or wait for capacity.' : '';
    status.hidden = !status.textContent;
  };
  const render = snapshot => {
    const state = withComputerLabels(snapshot, session);
    if (controller.signal.aborted) return;
    if (selectedId !== state.selectedId) {
      drafts.set(selectedId, { text: input.value, files }); selectedId = state.selectedId; fileRevision++;
      const draft = drafts.get(selectedId) || session.getDraft?.(selectedId); input.value = draft?.text || ''; files = draft?.files || []; showFiles();
    }
    const thread = state.activeThread, catalogModels = state.models || [];
    const keyFor = model => model?.selectionId || model?.id;
    const models = catalogModels.filter(selectable);
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
    for (const node of surface?.querySelectorAll('[data-mesh-peers]') || []) node.textContent = `${peerCount} ${peerCount === 1 ? 'computer' : 'computers'}`;
    const usable = thread?.permissions?.sharingScope === 'local'
      || models.some(model => keyFor(model) === current && ['ready', 'busy'].includes(model.availability));
    const modelStatus = find('[data-model-status]');
    const networkState = state.network?.consumer?.connectionState;
    const localPreparing = state.localModel?.phase === 'loading';
    const requestedModel = thread?.model || chosenModel || models.find(model => keyFor(model) === current);
    const remotePreparing = (state.network?.partitionPeers || []).some(peer => peer.available
      && peer.description?.phase === 'loading' && catalogModels.some(model => model.id === peer.description.offer?.id
        && model.identity === peer.description.offer?.identity)
      && (!requestedModel || requestedModel.id === peer.description.offer?.id
        && requestedModel.identity === peer.description.offer?.identity));
    const selectedPreparing = catalogModels.some(model => keyFor(model) === current
      && ['loading', 'preparing'].includes(model.availability));
    const preparing = localPreparing || remotePreparing || selectedPreparing;
    const attempt = thread?.attempts.at(-1);
    // The collapsed rails hide the header status. Explain a disabled composer
    // here, including before the first attempt, without adding another panel.
    modelStatus.textContent = thread?.closed ? 'Restore this thread to continue.'
      : state.localModel?.error && !usable ? 'Download failed: ' + state.localModel.error
      : !usable && current && !preparing && catalogModels.some(model => ['ready', 'busy'].includes(model.availability))
        ? 'Choose an available model.'
      : !usable ? preparing ? 'Model preparing…' : state.network?.paused ? 'Reconnect to continue.'
        : state.network?.connecting || ['connecting', 'retrying'].includes(networkState) ? 'Finding capacity…' : 'Model unavailable.' : '';
    modelStatus.hidden = !modelStatus.textContent;
    find('[data-model-control]').hidden = !models.length;
    find('[data-model-control]').dataset.activity = models.some(model => keyFor(model) === current && model.availability === 'ready') ? 'ready' : 'idle';
    threads.update(state.threads, state.selectedId, { archived });
    const busy = state.runningIds.includes(thread?.id) || !!state.comparisonPhase;
    const contextControls = find('[data-context-controls]');
    contextControls.hidden = !session.previewContextPrompt;
    if (session.previewContextPrompt) {
      const context = thread?.systemContext || session.previewContextPrompt(thread ? {} : contextPrompt || {}, thread?.model || requestedModel);
      find('[data-context-enabled]').checked = context.metadata.enabled;
      find('[data-context-cap]').value = String(context.metadata.maxWords);
      find('[data-context-enabled]').disabled = busy || !!thread?.closed;
      find('[data-context-cap]').disabled = busy || !!thread?.closed || !context.metadata.enabled;
      find('[data-context-count]').textContent = `${context.metadata.wordCount}/${context.metadata.maxWords} context words. Replies are not limited by this setting.`;
      find('[data-context-preview]').textContent = context.content || 'Off. No app context is added.';
    }
    find('[data-composer-send]').hidden = busy;
    find('[data-retry-connection]').hidden = busy || usable || preparing || state.network?.connecting || ['connecting', 'retrying'].includes(networkState); find('[data-composer-send]').disabled = reading || !usable || !!thread?.closed || !!state.storageError;
    find('[data-composer-stop]').hidden = !busy;
    find('[data-conversation-download]').hidden = !thread?.messages.length;
    find('[data-composer-field]').dataset.activity = busy && attempt?.status === 'executing' ? 'executing' : 'idle';
    messages.update(thread, { usable: usable && !thread?.closed, busy, state });
    if (find('[data-model-picker]').open) updatePicker(state);
    error(state.storageError || '');

  };
  const unsubscribe = session.subscribe(render);
  const changeContext = () => {
    const selection = { enabled: find('[data-context-enabled]').checked, maxWords: Number(find('[data-context-cap]').value) };
    try {
      const threadId = session.getState().selectedId;
      if (threadId) observe(session.setContextPrompt(threadId, selection));
      else { contextPrompt = selection; viewState.contextPrompt = selection; render(session.getState()); }
    } catch (failure) { error(failure.message); }
  };
  find('[data-context-enabled]').addEventListener('change', changeContext, options);
  find('[data-context-cap]').addEventListener('change', changeContext, options);
  showFiles();
  const renameDialog = bindDialog(find('[data-rename-dialog]'));
  const picker = bindDialog(find('[data-model-picker]'));
  on('[data-current-model]', 'click', event => {
    const state = session.getState();
    find('[data-current-model-description]').textContent = state.activeThread?.model.name || '';
    pickerModel = state.activeThread?.model || state.models.find(selectable) || null;
    updatePicker(state);
    picker.open(find('[data-next-model]'), event.currentTarget);
  });
  on('[data-model-picker-close]', 'click', () => picker.close());
  on('[data-next-model]', 'change', () => {
    pickerModel = session.getState().models.find(model => (model.selectionId || model.id) === find('[data-next-model]').value) || pickerModel;
    updatePicker(session.getState());
  });
  on('[data-composer-input]', 'input', () => { composerRevision++; resizeInput(); try { observe(saveDraft()); } catch (cause) { error(cause); } });
  const newThread = () => after(saveDraft(), () => after(session.select(null), () => { chosenModel = null; viewState.chosenModel = null; archived = false; find('[data-show-archived]').setAttribute('aria-pressed', 'false'); find('[data-show-archived]').textContent = 'Archived threads'; actionsPanel.setOpen(false); if (globalThis.innerWidth <= 760) setThreads(false); input.focus(); }));
  on('[data-new-thread]', 'click', () => { try { observe(newThread()); } catch (cause) { error(cause); } });
  on('[data-active-model-select]', 'change', () => { chosenModel = session.getState().models.find(model => (model.selectionId || model.id) === modelSelect.value); viewState.chosenModel = chosenModel; render(session.getState()); });
  on('[data-change-model]', 'click', () => {
    const next = find('[data-next-model]').value;
    const model = session.getState().models.find(model => (model.selectionId || model.id) === next && selectable(model));
    if (!model) { updatePicker(session.getState()); return; }
    picker.close();
    try { observe(after(newThread(), () => { chosenModel = model; viewState.chosenModel = chosenModel;
      modelSelect.value = next; render(session.getState()); modelSelect.focus(); })); } catch (cause) { error(cause); }
  });
  on('[data-retry-connection]', 'click', () => act(() => session.connect()));
  on('[data-show-archived]', 'click', event => {
    archived = !archived; event.currentTarget.setAttribute('aria-pressed', String(archived));
    event.currentTarget.textContent = archived ? 'Back to threads' : 'Archived threads';
    actionsPanel.setOpen(false); render(session.getState());
    setThreads(true);
    (find('[data-thread-item-id]') || find('[data-new-thread]')).focus();
  });
  on('[data-rename-cancel]', 'click', () => renameDialog.close());
  on('[data-rename-form]', 'submit', event => { event.preventDefault(); void act(async () => { await session.renameThread(renameId, find('[data-thread-name]').value); renameDialog.close(); }); });
  on('[data-thread-list]', 'click', event => {
    const rename = event.target.closest('[data-rename-thread]');
    if (rename) {
      renameId = rename.dataset.threadId; const thread = session.getState().threads.find(item => item.id === renameId);
      find('[data-thread-name]').value = thread.title || thread.purpose || thread.messages.find(message => message.role === 'user')?.content || 'New thread';
      rename.closest('details').open = false; renameDialog.open(find('[data-thread-name]'), rename.closest('details').querySelector('summary')); return;
    }
    const archive = event.target.closest('[data-archive-thread]');
    if (archive) {
      void act(async () => { await saveDraft();
        if (archived) { archived = false; find('[data-show-archived]').setAttribute('aria-pressed', 'false'); find('[data-show-archived]').textContent = 'Archived threads'; await session.restoreThread(archive.dataset.threadId); }
        else await session.archiveThread(archive.dataset.threadId);
        (find('[data-thread-item-id][aria-current="true"]') || find('[data-new-thread]')).focus();
      }); return;
    }
    const button = event.target.closest('[data-thread-item-id]'); if (button) { try { observe(after(saveDraft(), () => { session.select(button.dataset.threadItemId); if (globalThis.innerWidth <= 760) setThreads(false); })); } catch (cause) { error(cause); } } });
  on('[data-composer-form]', 'submit', event => {
    event.preventDefault();
    const content = input.value.trim(), state = session.getState();
    if (!content || reading || submitting || state.runningIds.includes(state.selectedId)) return;
    if (find('[data-composer-send]').disabled) return;
    submitting = true;
    const revision = composerRevision, origin = state.selectedId, attachments = files.map(file => ({ ...file }));
    act(async () => {
      try {
        const model = state.models.find(item => (item.selectionId || item.id) === modelSelect.value);
        const threadId = state.selectedId || await session.createThread({ model, sharingScope: model?.localReady ? 'local' : 'mesh', contextPrompt: contextPrompt || undefined });
        if (selectedId === threadId) {
          const current = composerRevision === revision ? { text: content, files: attachments } : drafts.get(origin);
          if (current) { input.value = current.text; files = current.files; showFiles(); }
        }
        const completion = session.send(threadId, content, attachments, { allowPeerExecution: true });
        // A second call cannot begin while asynchronous admission is pending.
        completion.catch(() => {});
        if (completion.admitted) await completion.admitted;
        if (composerRevision === revision && selectedId === threadId) {
          await session.saveDraft?.(null, null); await session.saveDraft?.(threadId, null);
          if (composerRevision === revision && selectedId === threadId) {
            input.value = ''; resizeInput(); files = []; drafts.delete(null); drafts.delete(threadId); showFiles();
          }
        }
        submitting = false; await completion;
      } finally { submitting = false; }
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
    if (button && !button.disabled) act(() => session.retry(session.getState().selectedId, button.dataset.retryAttempt, { allowPeerExecution: true }));
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
        files.push(...loaded); composerRevision++; await saveDraft(); showFiles();
      } finally { reading = false; if (!controller.signal.aborted) render(session.getState()); }
    });
  });
  on('[data-attachments-preview]', 'click', event => { const button = event.target.closest('[data-remove-file]'); if (button) { files.splice(Number(button.dataset.removeFile), 1); composerRevision++; void act(async () => { await saveDraft(); showFiles(); }); } });
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
  return () => {
    try { observe(saveDraft()); } catch (cause) { error(cause); }
    inputResize?.disconnect();
    messages.dispose(); threads.dispose(); actionsPanel.dispose(); picker.dispose(); renameDialog.dispose();
    const surface = container.closest('.pool-home');
    surface?.style.removeProperty('--pool-param-workspace-height');
    surface?.removeAttribute('data-chat-compact');
    surface?.removeAttribute('data-left-rail-open');
    if (railToggle && brandParent) brandParent.prepend(railToggle);
    controller.abort(); fileRevision++; unsubscribe(); if (!sharedInspector) inspector.dispose();
    find('[data-composer-field]').dataset.activity = 'idle';
    find('[data-model-control]').dataset.activity = 'idle';
  };
}
