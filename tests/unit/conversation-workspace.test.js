import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';
import { updateModelSelect } from '../../self/ui/components/model-select.js';

describe('Conversation workspace', () => {
  let root, session, dispose, service;
  const find = selector => root.querySelector(selector);
  beforeEach(() => {
    root = document.createElement('div'); document.body.append(root);
    service = createChatTestService();
    session = createChatSession({ storage: null, service, models: [CANONICAL_CHAT_MODELS[1]] });
    root.innerHTML = renderConversationWorkspace();
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
  });
  afterEach(async () => { dispose(); await session.close(); root.remove(); });

  it('shows no network capacity for cached weights and persists location changes in an existing thread', async () => {
    const model = CANONICAL_CHAT_MODELS[1];
    session.setCachedModels([model]);
    const location = find('[data-execution-location]');
    location.value = 'network'; location.dispatchEvent(new Event('change', { bubbles: true }));
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-model-status]').textContent).toContain('No network capacity');
    const id = session.createThread({ model, sharingScope: 'local' });
    location.value = 'network'; location.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(session.getState().activeThread.permissions.executionLocation).toBe('network'));
    expect(session.getState().activeThread.id).toBe(id);
    expect(service.calls).toHaveLength(0);
    location.value = 'local'; location.dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(session.getState().activeThread.permissions.executionLocation).toBe('local'));
    expect(find('[data-model-status]').hidden).toBe(true);
  });

  it('opens every section directly from the navigation rail with the correct heading', () => {
    const navigation = find('[data-chat-rail-toolbar] [data-inspector-navigation]');
    expect(navigation).not.toBeNull();
    expect(find('[data-contextual-inspector] nav')).toBeNull();
    for (const [section, title] of [['conversation', 'This conversation'], ['participants', 'Computers'], ['device', 'Sharing'], ['settings', 'Settings']]) {
      navigation.querySelector(`[data-inspector-section="${section}"]`).click();
      expect(find('[data-contextual-inspector]').open).toBe(true);
      expect(find('#network-inspector-title').textContent).toBe(title);
      expect(find(`[data-inspector-pane="${section}"]`).hidden).toBe(false);
    }
  });

  it('keeps the composer and draft while network capacity is unavailable', () => {
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-active-model-select]').textContent).toBe('No models available');
    expect(find('[data-model-status]').hidden).toBe(false);
    expect(find('[data-model-status]').textContent).toBe('Model unavailable.');
    expect(find('[data-model-control]').hidden).toBe(true);
    expect(find('[data-toggle-contribution]').disabled).toBe(false);
    expect(find('[data-composer-send]').hidden).toBe(false);
    expect(find('[data-retry-connection]').hidden).toBe(false);
    expect(find('[data-contribution-model]').value).toBe(CANONICAL_CHAT_MODELS[1].id);
    expect(find('[data-contextual-inspector]').open).toBe(false);
    expect(find('[data-composer-input]').placeholder).toBeTruthy();
    expect(root.textContent).not.toMatch(/Mesh Active|Distributed Intelligence|Contributing|Scope:|Recent Improvements|LoRA/);
  });

  it('offers downloads only after contribution opt-in and does nothing on cancel', async () => {
    expect(find('[data-composer-model-setup]')).toBeNull();
    find('[data-toggle-contribution]').click();
    await vi.waitFor(() => expect(find('[data-download-confirm]').disabled).toBe(false));
    expect(find('[data-model-dialog]').open).toBe(true);
    expect(find('[data-download-size]').textContent).toBe('123 MB download');
    expect(service.calls).toHaveLength(0);
    find('[data-download-cancel]').click();
    expect(find('[data-model-dialog]').open).toBe(false);
    expect(service.calls).toHaveLength(0);
  });

  it('shows declared answer limits before sending, including the history allowance', () => {
    dispose();
    const model = { ...CANONICAL_CHAT_MODELS[1], availability: 'ready' };
    const project = state => ({ ...state, models: [model], answerLimits: [{ selectionId: model.id,
      cells: [{ maxConcurrency: 1, maxPromptTokens: 512, maxAnswerTokens: 255 },
        { maxConcurrency: 1, maxPromptTokens: 1024, maxAnswerTokens: 63 }] }] });
    dispose = bindConversationWorkspace(root, { ...session,
      getState: () => project(session.getState()), subscribe: fn => session.subscribe(state => fn(project(state))) });
    expect(find('[data-answer-limit]').hidden).toBe(false);
    expect(find('[data-answer-limit]').textContent).toContain('255 answer tokens for up to 512 input tokens');
    expect(find('[data-answer-limit]').textContent).toContain('63 answer tokens for up to 1024 input tokens');
    expect(find('[data-answer-limit]').textContent).toContain('Input includes conversation history');
    expect(service.calls).toHaveLength(0);
  });

  it('previews optional capped context and retains each conversation setting', async () => {
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    expect(find('[data-context-enabled]').checked).toBe(false);
    expect(find('[data-context-cap]').value).toBe('16');
    expect(find('[data-context-cap]').disabled).toBe(true);
    find('[data-context-enabled]').checked = true;
    find('[data-context-enabled]').dispatchEvent(new Event('change', { bubbles: true }));
    find('[data-context-cap]').value = '32';
    find('[data-context-cap]').dispatchEvent(new Event('change', { bubbles: true }));
    const preview = find('[data-context-preview]').textContent;
    expect(preview).toContain('Reploid');
    expect(preview.split(/\s+/u).length).toBeLessThanOrEqual(32);
    expect(find('[data-context-count]').textContent).toContain('Replies are not limited');
    let disabledWhileRunning = false;
    const unsubscribe = session.subscribe(state => {
      if (state.runningIds.length) disabledWhileRunning ||= find('[data-context-enabled]').disabled;
    });
    find('[data-composer-input]').value = 'First question';
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[0].status).toBe('completed'));
    unsubscribe();
    expect(disabledWhileRunning).toBe(true);
    const first = session.getState().activeThread;
    expect(first.systemContext.content).toBe(preview);
    expect(first.attempts[0].request.messages[0]).toEqual({ role: 'system', content: preview });
    const other = session.createThread({ sharingScope: 'local' });
    expect(find('[data-context-enabled]').checked).toBe(false);
    session.select(first.id);
    expect(find('[data-context-enabled]').checked).toBe(true);
    expect(find('[data-context-cap]').value).toBe('32');
    find('[data-context-enabled]').checked = false;
    find('[data-context-enabled]').dispatchEvent(new Event('change', { bubbles: true }));
    expect(session.getState().activeThread.systemContext.content).toBe('');
    expect(session.getState().threads.find(item => item.id === other).systemContext.content).toBe('');
  });

  it('labels an adapted model once without merging distinct selections', () => {
    const select = find('[data-active-model-select]');
    updateModelSelect(select, [
      { id: 'base', name: 'Base model' },
      { id: 'base', selectionId: 'adapted', name: 'Named adapter', adapters: [{ name: 'Named adapter' }] },
      { id: 'base', selectionId: 'other', name: 'Base model', adapters: [{ name: 'Other adapter' }] }
    ], { value: 'adapted' });
    expect([...select.options].map(option => [option.value, option.textContent])).toEqual([
      ['base', 'Base model'], ['adapted', 'Named adapter'], ['other', 'Base model + Other adapter']
    ]);
    expect(select.value).toBe('adapted');
  });

  it('shows observed remote preparation without claiming readiness or asking to reconnect', async () => {
    dispose(); await session.close();
    const peer = { available: true, description: { phase: 'loading',
      offer: { id: CANONICAL_CHAT_MODELS[1].id, identity: CANONICAL_CHAT_MODELS[1].identity } } };
    session = createChatSession({ storage: null, service, models: [CANONICAL_CHAT_MODELS[1]],
      swarm: { getState: () => ({ partitionPeers: [peer], consumer: { peers: [] } }) } });
    dispose = bindConversationWorkspace(root, session);
    find('[data-composer-input]').value = 'Keep my question';
    expect(find('[data-model-status]').hidden).toBe(false);
    expect(find('[data-model-status]').textContent).toBe('Model preparing…');
    expect(find('[data-retry-connection]').hidden).toBe(true);
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(service.calls).toHaveLength(0);
    peer.available = false; session.refreshNetwork();
    expect(find('[data-model-status]').hidden).toBe(false);
    expect(find('[data-model-status]').textContent).toBe('Model unavailable.');
    expect(find('[data-retry-connection]').hidden).toBe(false);
    expect(find('[data-composer-input]').value).toBe('Keep my question');
  });

  it('uses the selected whole-request model preparation state without treating other models as capacity', async () => {
    dispose(); await session.close();
    const model = CANONICAL_CHAT_MODELS[0], other = CANONICAL_CHAT_MODELS[1];
    const peers = [model, other].map((item, index) => ({ peerId: 'peer-' + index,
      model: item.id, modelIdentity: item.identity, readiness: 'loading',
      hasInference: true, availableSlots: 0 }));
    session = createChatSession({ storage: null, service,
      swarm: { getState: () => ({ consumer: { connectionState: 'connected', peers } }) } });
    dispose = bindConversationWorkspace(root, session);
    const select = find('[data-active-model-select]');
    select.value = model.id; select.dispatchEvent(new Event('change'));
    find('[data-composer-input]').value = 'Keep my question';
    expect(find('[data-retry-connection]').hidden).toBe(true);
    expect(find('[data-composer-send]').disabled).toBe(true);

    peers[0].readiness = 'ready'; peers[0].availableSlots = 1; session.refreshNetwork();
    expect(find('[data-composer-send]').disabled).toBe(false);
    expect(find('[data-retry-connection]').hidden).toBe(true);

    peers.shift(); session.refreshNetwork();
    expect(select.value).toBe(model.id);
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-retry-connection]').hidden).toBe(false);
    expect(find('[data-composer-input]').value).toBe('Keep my question');
    expect(service.calls).toHaveLength(0);
  });

  it('starts contribution only after the download confirmation, preserving the chat draft', async () => {
    dispose();
    const setSharing = vi.fn();
    dispose = bindConversationWorkspace(root, { ...session, setSharing,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    find('[data-composer-input]').value = 'Keep this question';
    find('[data-toggle-contribution]').click();
    await vi.waitFor(() => expect(find('[data-download-confirm]').disabled).toBe(false));
    expect(setSharing).not.toHaveBeenCalled();
    expect(service.calls).toHaveLength(0);
    find('[data-download-confirm]').click();
    await vi.waitFor(() => expect(setSharing).toHaveBeenCalledWith(true, CANONICAL_CHAT_MODELS[1].id, true));
    expect(find('[data-composer-input]').value).toBe('Keep this question');
    expect(service.calls).toHaveLength(0);
  });

  it('starts directly, appends followups and pins the conversation model', async () => {
    session.createThread({ sharingScope: 'local' });
    const submit = text => {
      find('[data-composer-input]').value = text;
      find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    };
    submit('First message');
    await vi.waitFor(() => expect(session.getState().threads[0]?.attempts[0]?.status).toBe('completed'));
    expect(find('[data-message-stream]').textContent).toContain('Fixture: First message');
    expect(find('[data-active-model-select]').hidden).toBe(true);
    submit('Followup');
    await vi.waitFor(() => expect(session.getState().activeThread.messages).toHaveLength(4));
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[1].status).toBe('completed'));
    expect(service.calls[0].source).toBe(CANONICAL_CHAT_MODELS[1].id);
  });

  it('offers a new model directly without changing an existing thread or draft', async () => {
    await session.prepareLocalModel(CANONICAL_CHAT_MODELS[1].id);
    const id = session.createThread({ sharingScope: 'local' });
    find('[data-composer-input]').value = 'Keep this draft';
    find('[data-current-model]').click();
    expect(find('[data-model-picker]').open).toBe(true);
    expect(session.getState().selectedId).toBe(id);
    find('[data-change-model]').click();
    expect(session.getState().selectedId).toBeNull();
    expect(session.getState().threads[0].model.id).toBe(CANONICAL_CHAT_MODELS[1].id);
    session.select(id); expect(find('[data-composer-input]').value).toBe('Keep this draft');
  });

  it('refreshes an open model picker without replacing a choice whose capacity disappears', async () => {
    const first = CANONICAL_CHAT_MODELS[0], second = CANONICAL_CHAT_MODELS[1];
    let peers = [first, second].map((model, index) => ({ peerId: 'peer-' + index, model: model.id,
      modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }));
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, session);
    const id = session.createThread({ model: first });
    find('[data-composer-input]').value = 'Keep this draft';
    find('[data-current-model]').click();
    const next = find('[data-next-model]');
    next.value = second.id; next.dispatchEvent(new Event('change'));
    peers = peers.slice(0, 1); session.refreshNetwork();
    expect(next.value).toBe(second.id);
    expect(next.textContent).toContain('Unavailable');
    expect(find('[data-change-model]').disabled).toBe(true);
    expect(session.getState().selectedId).toBe(id);
    expect(find('[data-composer-input]').value).toBe('Keep this draft');
    peers.push({ peerId: 'peer-1', model: second.id, modelIdentity: second.identity,
      readiness: 'ready', hasInference: true, availableSlots: 1 });
    session.refreshNetwork();
    expect(next.value).toBe(second.id);
    expect(find('[data-change-model]').disabled).toBe(false);
    find('[data-change-model]').click();
    expect(session.getState().selectedId).toBeNull();
    expect(find('[data-active-model-select]').value).toBe(second.id);
    session.select(id);
    expect(session.getState().activeThread.model.id).toBe(first.id);
    expect(find('[data-composer-input]').value).toBe('Keep this draft');
  });

  it('renames, archives, and restores a thread without changing its purpose or draft', async () => {
    const id = session.createThread({ purpose: 'Original instruction' });
    find('[data-composer-input]').value = 'Preserve draft';
    find('[data-rename-thread]').click(); find('[data-thread-name]').value = 'My thread';
    find('[data-rename-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(session.getState().activeThread.title).toBe('My thread'));
    expect(session.getState().activeThread.purpose).toBe('Original instruction');
    find('[data-archive-thread]').click();
    await vi.waitFor(() => expect(session.getState().selectedId).toBeNull());
    find('[data-show-archived]').click(); expect(find('[data-thread-item-id]').textContent).toContain('My thread');
    find('[data-archive-thread]').click();
    await vi.waitFor(() => expect(session.getState().selectedId).toBe(id));
    expect(find('[data-composer-input]').value).toBe('Preserve draft');
  });

  it('keeps drafts separate while selecting threads and starting a new one', () => {
    const first = session.createThread({ purpose: 'First' });
    find('[data-composer-input]').value = 'Draft for first';
    find('[data-new-thread]').click();
    expect(find('[data-composer-input]').value).toBe('');
    find('[data-composer-input]').value = 'New draft';
    find('[data-thread-item-id]').click();
    expect(session.getState().selectedId).toBe(first);
    expect(find('[data-composer-input]').value).toBe('Draft for first');
    find('[data-new-thread]').click();
    expect(find('[data-composer-input]').value).toBe('New draft');
  });

  it('keeps the stable placeholder and does not create empty stored threads', () => {
    const previous = find('[data-composer-input]').placeholder;
    find('[data-new-thread]').click();
    expect(find('[data-composer-input]').placeholder).toBe(previous);
    expect(session.getState().threads).toHaveLength(0);
    expect(find('[data-message-stream]').childElementCount).toBe(0);
    expect(find('[data-conversation-actions] [data-show-archived]')).not.toBeNull();
    expect(find('[data-thread-sidebar] [data-conversation-actions] [data-show-archived]')).not.toBeNull();
  });

  it('opens archived threads from conversation actions in the phone rail without losing the draft', () => {
    const previous = globalThis.innerWidth;
    Object.defineProperty(globalThis, 'innerWidth', { value: 390, configurable: true });
    try {
      const id = session.createThread({ sharingScope: 'local' });
      session.archiveThread(id);
      find('[data-composer-input]').value = 'Keep my phone draft';
      find('[data-conversation-actions]').open = true;
      find('[data-show-archived]').click();
      expect(find('[data-conversation-actions]').open).toBe(false);
      expect(find('[data-chat-workspace]').hasAttribute('data-threads-open')).toBe(true);
      expect(find('[data-thread-sidebar] [data-thread-item-id]').dataset.threadItemId).toBe(id);
      expect(find('[data-composer-input]').value).toBe('Keep my phone draft');
    } finally { Object.defineProperty(globalThis, 'innerWidth', { value: previous, configurable: true }); }
  });

  it('surfaces execution failures instead of invented answers', async () => {
    service.open = async () => { throw new Error('GPU unavailable'); };
    const thread = session.createThread({ sharingScope: 'local' });
    await session.send(thread, 'Hello');
    expect(find('[data-message-stream]').textContent).toContain('This answer could not finish.');
    expect(find('[data-message-stream] .chat-message-actions details').textContent).toContain('GPU unavailable');
    expect(find('[data-message-stream]').textContent).not.toContain('Executing via');
  });

  it('shows actual network state and removes its event handlers on teardown', () => {
    find('[data-toggle-inspector]').click();
    expect(find('[data-contextual-inspector]').open).toBe(true);
    expect(find('[data-contrib-label]').textContent).toBe('Not sharing');
    find('[data-close-inspector]').click();
    dispose();
    find('[data-toggle-inspector]').click();
    expect(find('[data-contextual-inspector]').open).toBe(false);
  });

  it('keeps another thread running when the selected thread is cancelled', async () => {
    const first = session.createThread({ sharingScope: 'local' }), second = session.createThread({ sharingScope: 'local' });
    const a = session.send(first, 'First'), b = session.send(second, 'Second');
    session.select(first);
    find('[data-composer-stop]').click();
    const [one, two] = await Promise.all([a, b]);
    expect(one.status).toBe('cancelled'); expect(two.status).toBe('completed');
    session.select(second);
    expect(find('[data-message-stream]').textContent).toContain('Fixture: Second');
  });

  it('shows activity only for the executing selected thread and clears it on cancellation and teardown', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const scheduler = { getState: () => ({}), close: async () => {},
      async schedule(request, controls) {
        controls.onDelta('Working');
        await pending;
        return { content: 'Done', model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [] };
      } };
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, scheduler });
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    const thread = session.createThread({ sharingScope: 'local' });
    const completion = session.send(thread, 'Hello');
    try {
      await vi.waitFor(() => expect(find('[data-composer-field]').dataset.activity).toBe('executing'));
      session.select(null);
      expect(find('[data-composer-field]').dataset.activity).toBe('idle');
      session.select(thread);
      expect(find('[data-composer-field]').dataset.activity).toBe('executing');
      session.cancel(thread);
      expect(find('[data-composer-field]').dataset.activity).toBe('idle');
    } finally { release(); await completion; }
    expect(find('[data-composer-field]').dataset.activity).toBe('idle');
    dispose();
    expect(find('[data-model-control]').dataset.activity).toBe('idle');
  });

  it('retries a failed response as a new attempt and preserves its partial text', async () => {
    let invocation = 0;
    const scheduler = { getState: () => ({}), close: async () => {},
      async schedule(request, controls) {
        controls.onDelta(invocation++ ? 'Recovered answer' : 'Partial answer');
        if (invocation === 1) throw new Error('Contributor disconnected');
        return { content: 'Recovered answer', model: request.model.id, modelIdentity: request.model.identity, adapterIdentities: [] };
      } };
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, scheduler });
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    const thread = session.createThread({ sharingScope: 'local' });
    await session.send(thread, 'Keep this question');
    expect(find('[data-message-stream]').textContent).toContain('Partial answer');
    find('[data-retry-attempt]').click();
    await vi.waitFor(() => expect(session.getState().activeThread.attempts.at(-1).status).toBe('completed'));
    const result = session.getState().activeThread;
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[1].retryOf).toBe(result.attempts[0].id);
    expect(result.messages.map(message => message.content)).toEqual(['Keep this question', 'Partial answer', 'Recovered answer']);
  });

  it('retains a deliberate new-thread model selection when its capacity disappears', async () => {
    const first = CANONICAL_CHAT_MODELS[0], second = CANONICAL_CHAT_MODELS[1];
    let peers = [first, second].map((model, index) => ({ peerId: 'peer-' + index, model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }));
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, session);
    find('[data-active-model-select]').value = second.id;
    find('[data-active-model-select]').dispatchEvent(new Event('change'));
    peers = peers.slice(0, 1); session.refreshNetwork();
    expect(find('[data-active-model-select]').value).toBe(second.id);
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-active-model-select]').textContent).toContain('Unavailable');
  });

  it('automatically selects newly available capacity and preserves a thread model when its peer leaves', async () => {
    const model = CANONICAL_CHAT_MODELS[0];
    let peers = [];
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ discoveryScope: 'public', consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, { ...session,
      getModelDownload: async id => ({ id, sizeBytes: 123000000 }) });
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-model-control]').dataset.activity).toBe('idle');
    peers = [{ peerId: 'ready-peer', model: model.id, modelIdentity: model.identity, readiness: 'ready', hasInference: true, availableSlots: 1 }];
    session.refreshNetwork();
    expect(find('[data-active-model-select]').value).toBe(model.id);
    expect(find('[data-composer-send]').disabled).toBe(false);
    expect(find('[data-mesh-invite]').hidden).toBe(true);
    expect(find('[data-model-control]').dataset.activity).toBe('ready');
    session.createThread();
    peers = []; session.refreshNetwork();
    expect(find('[data-model-control]').dataset.activity).toBe('idle');
    expect(find('[data-active-model-select]').value).toBe(model.id);
    expect(find('[data-active-model-select]').hidden).toBe(true);
    expect(find('[data-composer-send]').disabled).toBe(true);
    find('[data-composer-input]').value = 'Keep my draft';
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(find('[data-composer-input]').value).toBe('Keep my draft');
    expect(session.getState().activeThread.attempts).toEqual([]);
    expect(find('[data-model-dialog]').open).toBe(false);
  });
});
