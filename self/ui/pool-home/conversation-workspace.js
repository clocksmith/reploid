/** Conversation presentation; the host owns execution and disclosure. */
import { pickGoalPlaceholder } from './work-goal-composer.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function renderConversationWorkspace() {
  return `<section class="reploid-chat-workspace" data-chat-workspace aria-label="Conversation workspace">
    <aside class="chat-thread-sidebar" data-thread-sidebar aria-label="Threads">
      <header class="chat-sidebar-header"><h2>Threads</h2><button class="btn btn-ghost" type="button" data-new-thread>New thread</button></header>
      <div class="chat-thread-list" data-thread-list></div>
    </aside>
    <section class="chat-conversation-area" data-conversation-area aria-label="Current conversation">
      <header class="chat-thread-header" data-network-header>
        <div class="chat-thread-info"><label class="chat-visually-hidden" for="chat-model">Model</label>
          <select id="chat-model" data-active-model-select aria-label="Model"></select>
          <span class="chat-execution-state" data-execution-state role="status"></span></div>
        <button class="btn btn-ghost" type="button" data-toggle-inspector aria-expanded="false" aria-controls="chat-network-details">Network <span data-mesh-peers>0 peers</span></button>
      </header>
      <section class="chat-network-details" id="chat-network-details" data-contextual-inspector hidden aria-label="Network">
        <header class="chat-network-heading"><h2>Network</h2><button class="btn btn-ghost" type="button" data-close-inspector>Close</button></header>
        <ul data-insp-device-list></ul>
        <div class="chat-network-actions"><button class="btn btn-ghost" type="button" data-mesh-connect>Connect peers</button><button class="btn btn-ghost" type="button" data-mesh-invite>Invite</button></div>
        <p data-network-message role="status" hidden></p>
        <details><summary>Contribution <span data-contrib-label>Not sharing</span></summary>
          <div class="chat-contribution-controls"><p data-contribution-limits></p>
            <label><input type="checkbox" data-contribution-consent> Run peers’ public prompts on this device</label>
            <button class="btn btn-ghost" type="button" data-toggle-contribution>Start sharing</button></div></details>
      </section>
      <div class="chat-message-stream" data-message-stream role="log" aria-label="Messages" aria-live="polite"></div>
      <section class="chat-approval" data-chat-approval hidden aria-label="Review before sending">
        <h2>Review before sending</h2><p data-approval-recipient></p><pre data-approval-payload></pre>
        <label><input type="checkbox" data-approval-consent> Share this exact input with this peer as public data</label>
        <div class="chat-network-actions"><button class="btn btn-primary" type="button" data-approval-send disabled>Approve and send</button><button class="btn btn-ghost" type="button" data-approval-decline>Decline</button></div>
      </section>
      <p class="chat-error" role="alert" data-chat-error hidden></p>
      <footer class="chat-composer-area" data-composer-area><form data-composer-form>
        <label class="chat-visually-hidden" for="chat-message">Message</label>
        <textarea id="chat-message" data-composer-input rows="3" required placeholder="${escape(pickGoalPlaceholder())}"></textarea>
        <div class="chat-composer-toolbar">
          <label class="btn btn-ghost chat-file-label">Attach<input type="file" multiple data-composer-files accept=".txt,.md,.json,.js,.ts,.html,.css" /></label>
          <button class="btn btn-primary" type="submit" data-composer-send>Send</button>
          <button class="btn btn-ghost" type="button" data-composer-stop hidden>Stop</button>
        </div><div class="chat-attachments" data-attachments-preview hidden></div>
      </form></footer>
    </section>
  </section>`;
}

export function bindConversationWorkspace(root, session, { getInviteUrl } = {}) {
  const container = root.querySelector('[data-chat-workspace]');
  if (!container || !session) return () => {};
  const find = selector => container.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  const input = find('[data-composer-input]'), modelSelect = find('[data-active-model-select]');
  let files = [], fileRevision = 0, reading = false, approvalKey = '', messageKey = '', listKey = '';
  const drafts = new Map();
  let selectedId = session.getState().selectedId;
  const error = cause => {
    const node = find('[data-chat-error]');
    node.textContent = String(cause?.message || cause || ''); node.hidden = !node.textContent;
  };
  const act = operation => Promise.resolve().then(operation).catch(error);
  const on = (selector, event, callback) => find(selector)?.addEventListener(event, callback, options);
  const setNetworkOpen = open => {
    find('[data-contextual-inspector]').hidden = !open;
    find('[data-toggle-inspector]').setAttribute('aria-expanded', String(open));
  };
  const showFiles = () => {
    const preview = find('[data-attachments-preview]'); preview.hidden = !files.length;
    preview.innerHTML = files.map((file, index) => `<span>${escape(file.name)} <button type="button" class="btn btn-ghost" data-remove-file="${index}" aria-label="Remove ${escape(file.name)}">Remove</button></span>`).join('');
  };
  const render = state => {
    if (controller.signal.aborted) return;
    if (selectedId !== state.selectedId) {
      drafts.set(selectedId, { text: input.value, files }); selectedId = state.selectedId; fileRevision++;
      const draft = drafts.get(selectedId); input.value = draft?.text || ''; files = draft?.files || []; showFiles();
    }
    const thread = state.activeThread, models = state.models || [];
    const current = thread?.model?.id || modelSelect.value || state.defaultModel?.id;
    const catalog = JSON.stringify(models.map(model => [model.id, model.name]));
    if (modelSelect.dataset.catalog !== catalog) {
      modelSelect.innerHTML = models.map(model => `<option value="${escape(model.id)}">${escape(model.name)}</option>`).join('');
      modelSelect.dataset.catalog = catalog;
    }
    modelSelect.value = current; modelSelect.disabled = !!thread;
    const threads = state.threads.filter(item => !item.closed);
    const nextList = JSON.stringify([state.selectedId, threads.map(item => [item.id, item.purpose, item.messages.find(m => m.role === 'user')?.content, item.attempts.at(-1)?.status])]);
    if (nextList !== listKey) {
      listKey = nextList;
      find('[data-thread-list]').innerHTML = threads.map(item => {
        const title = item.purpose || item.messages.find(m => m.role === 'user')?.content || 'New thread';
        const status = item.attempts.at(-1)?.status || '';
        return `<button type="button" class="chat-thread-item" data-thread-item-id="${escape(item.id)}" aria-current="${item.id === state.selectedId ? 'true' : 'false'}"><span>${escape(title)}</span>${status && status !== 'completed' ? `<small>${escape(status)}</small>` : ''}</button>`;
      }).join('');
    }
    const attempt = thread?.attempts.at(-1), busy = state.runningIds.includes(thread?.id), execution = attempt?.execution;
    const location = execution?.peerId ? 'Peer ' + execution.peerId.slice(0, 8) : execution?.placement === 'local-webgpu' ? 'This device' : '';
    find('[data-execution-state]').textContent = [location, attempt?.status].filter(Boolean).join(' · ');
    find('[data-composer-send]').hidden = busy; find('[data-composer-send]').disabled = reading || !modelSelect.value || !!state.storageError;
    find('[data-composer-stop]').hidden = !busy;
    const stream = find('[data-message-stream]'), nextMessages = JSON.stringify([thread?.id, thread?.messages]);
    if (nextMessages !== messageKey) {
      const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 80;
      messageKey = nextMessages;
      stream.innerHTML = (thread?.messages || []).map(m => `<article class="chat-message-row is-${m.role === 'user' ? 'user' : 'assistant'}"><span class="chat-message-author">${m.role === 'user' ? 'You' : 'Assistant'}</span><div class="chat-message-content">${escape(m.content)}</div></article>`).join('');
      if (nearBottom) stream.scrollTop = stream.scrollHeight;
    }
    const pending = attempt?.approval, key = pending ? thread.id + ':' + attempt.id + ':' + pending.id : '';
    if (key !== approvalKey) { approvalKey = key; find('[data-approval-consent]').checked = false; }
    find('[data-chat-approval]').hidden = !pending;
    if (pending) {
      find('[data-approval-recipient]').textContent = 'Peer ' + pending.peerId + ' · ' + (pending.modelId || thread.model.id);
      find('[data-approval-payload]').textContent = JSON.stringify({ input: pending.input, options: pending.options, limits: pending.limits }, null, 2);
    }
    find('[data-approval-send]').disabled = !pending || !find('[data-approval-consent]').checked;
    error(state.storageError || attempt?.error || '');
    const network = state.network || {}, peers = network.consumer?.peers || network.supplier?.peers || [];
    find('[data-mesh-peers]').textContent = peers.length + (peers.length === 1 ? ' peer' : ' peers');
    find('[data-insp-device-list]').innerHTML = '<li>This device</li>' + peers.map(peer => `<li>Peer ${escape(peer.peerId?.slice(0, 8))}${peer.model ? ' · ' + escape(peer.model) : ''}</li>`).join('');
    const discoveryState = network.consumer?.connectionState;
    const activeDiscovery = network.connecting || ['connected', 'connecting', 'retrying'].includes(discoveryState);
    const connectControl = find('[data-mesh-connect]');
    connectControl.disabled = false;
    connectControl.dataset.disconnect = String(!!activeDiscovery);
    connectControl.textContent = activeDiscovery ? 'Disconnect' : network.error ? 'Retry' : 'Connect';
    const message = find('[data-network-message]');
    message.textContent = network.error || (network.connecting ? 'Connecting…' : ''); message.hidden = !message.textContent;
    find('[data-contrib-label]').textContent = network.stopping ? 'Stopping' : network.sharing ? 'Sharing' : 'Not sharing';
    find('[data-toggle-contribution]').textContent = network.sharing ? 'Stop sharing' : 'Start sharing';
    find('[data-toggle-contribution]').disabled = !!network.stopping;
    find('[data-contribution-consent]').disabled = !!network.sharing || !!network.stopping;
    find('[data-contribution-limits]').textContent = network.limits ? network.limits.maxInboundJobs + ' request at a time · ' + network.limits.maxOutputTokens + ' output tokens per request' : '';
  };
  const unsubscribe = session.subscribe(render);
  on('[data-new-thread]', 'click', () => { session.select(null); input.placeholder = pickGoalPlaceholder(input.placeholder); input.focus(); });
  on('[data-thread-list]', 'click', event => { const button = event.target.closest('[data-thread-item-id]'); if (button) session.select(button.dataset.threadItemId); });
  on('[data-composer-form]', 'submit', event => {
    event.preventDefault();
    const content = input.value.trim(), state = session.getState();
    if (!content || reading || state.runningIds.includes(state.selectedId)) return;
    act(async () => {
      const model = state.models.find(item => item.id === modelSelect.value), attachments = files.map(file => ({ ...file }));
      const threadId = state.selectedId || session.createThread({ model, sharingScope: 'invited-mesh' });
      input.value = content; files = attachments; showFiles();
      const completion = session.send(threadId, content, attachments);
      input.value = ''; files = []; drafts.delete(null); drafts.delete(threadId); showFiles();
      await completion;
    });
  });
  on('[data-composer-input]', 'keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); find('[data-composer-form]').requestSubmit(); }
  });
  on('[data-composer-stop]', 'click', () => act(() => session.cancel(session.getState().selectedId)));
  on('[data-composer-files]', 'change', event => {
    const chosen = [...event.target.files]; event.target.value = '';
    const revision = fileRevision; reading = true; render(session.getState());
    act(async () => {
      try {
        if (chosen.length + files.length > 8 || chosen.some(file => file.size > 65536) || [...chosen, ...files].reduce((sum, file) => sum + (file.size ?? file.bytes), 0) > 131072) throw new Error('Attach up to 8 text files, 64 KB each and 128 KB total.');
        const loaded = await Promise.all(chosen.map(async file => ({ name: file.name, bytes: file.size, text: await file.text() })));
        if (controller.signal.aborted || revision !== fileRevision) return;
        files.push(...loaded); showFiles();
      } finally { reading = false; if (!controller.signal.aborted) render(session.getState()); }
    });
  });
  on('[data-attachments-preview]', 'click', event => { const button = event.target.closest('[data-remove-file]'); if (button) { files.splice(Number(button.dataset.removeFile), 1); showFiles(); } });
  on('[data-toggle-inspector]', 'click', () => setNetworkOpen(find('[data-contextual-inspector]').hidden));
  on('[data-close-inspector]', 'click', () => setNetworkOpen(false));
  on('[data-mesh-connect]', 'click', () => act(() => find('[data-mesh-connect]').dataset.disconnect === 'true'
    ? session.disconnect() : session.connect()));
  on('[data-mesh-invite]', 'click', () => act(async () => {
    if (!getInviteUrl) throw new Error('Mesh invitation is unavailable');
    await navigator.clipboard.writeText(getInviteUrl());
    const node = find('[data-network-message]'); node.textContent = 'Invite copied'; node.hidden = false;
  }));
  on('[data-toggle-contribution]', 'click', () => act(() => session.setSharing(!session.getState().network?.sharing, modelSelect.value, find('[data-contribution-consent]').checked)));
  const approve = accepted => act(() => {
    const thread = session.getState().activeThread, attempt = thread?.attempts.at(-1);
    if (attempt?.approval) session.approve(thread.id, attempt.id, attempt.approval.id, accepted);
  });
  on('[data-approval-consent]', 'change', () => render(session.getState()));
  on('[data-approval-send]', 'click', () => { if (find('[data-approval-consent]').checked) approve(true); });
  on('[data-approval-decline]', 'click', () => approve(false));
  return () => { controller.abort(); fileRevision++; unsubscribe(); };
}
