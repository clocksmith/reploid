import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

describe('Conversation workspace', () => {
  let root, session, dispose, service;
  const find = selector => root.querySelector(selector);
  beforeEach(() => {
    root = document.createElement('div'); document.body.append(root);
    service = createChatTestService();
    session = createChatSession({ storage: null, service, models: [CANONICAL_CHAT_MODELS[1]] });
    root.innerHTML = renderConversationWorkspace();
    dispose = bindConversationWorkspace(root, session);
  });
  afterEach(async () => { dispose(); await session.close(); root.remove(); });

  it('waits for available intelligence without offering unavailable catalog entries', () => {
    expect(find('[data-composer-send]').disabled).toBe(true);
    expect(find('[data-active-model-select]').textContent).toBe('No models available');
    expect(find('[data-model-status]').textContent).toContain('Waiting for contributors');
    expect(find('[data-contribution-model]').value).toBe(CANONICAL_CHAT_MODELS[1].id);
    expect(find('[data-contextual-inspector]').hidden).toBe(true);
    expect(find('[data-composer-input]').placeholder).toBeTruthy();
    expect(root.textContent).not.toMatch(/Mesh Active|Distributed Intelligence|Contributing|Scope:|Recent Improvements|LoRA/);
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
    expect(find('[data-active-model-select]').disabled).toBe(true);
    submit('Followup');
    await vi.waitFor(() => expect(session.getState().activeThread.messages).toHaveLength(4));
    await vi.waitFor(() => expect(session.getState().activeThread.attempts[1].status).toBe('completed'));
    expect(service.calls[0].source).toBe(CANONICAL_CHAT_MODELS[1].id);
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

  it('uses new placeholders and does not create empty stored threads', () => {
    const previous = find('[data-composer-input]').placeholder;
    find('[data-new-thread]').click();
    expect(find('[data-composer-input]').placeholder).not.toBe(previous);
    expect(session.getState().threads).toHaveLength(0);
  });

  it('surfaces execution failures instead of invented answers', async () => {
    service.open = async () => { throw new Error('GPU unavailable'); };
    const thread = session.createThread({ sharingScope: 'local' });
    await session.send(thread, 'Hello');
    expect(find('[data-chat-error]').hidden).toBe(false);
    expect(find('[data-chat-error]').textContent).toBe('GPU unavailable');
    expect(find('[data-message-stream]').textContent).not.toContain('Executing via');
  });

  it('shows actual network state and removes its event handlers on teardown', () => {
    find('[data-toggle-inspector]').click();
    expect(find('[data-contextual-inspector]').hidden).toBe(false);
    expect(find('[data-contrib-label]').textContent).toBe('Not sharing');
    find('[data-close-inspector]').click();
    dispose();
    find('[data-toggle-inspector]').click();
    expect(find('[data-contextual-inspector]').hidden).toBe(true);
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
    dispose = bindConversationWorkspace(root, session);
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
    dispose = bindConversationWorkspace(root, session);
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

  it('automatically selects newly available capacity and preserves a thread model when its peer leaves', async () => {
    const model = CANONICAL_CHAT_MODELS[0];
    let peers = [];
    dispose(); await session.close();
    session = createChatSession({ storage: null, service, swarm: { getState: () => ({ discoveryScope: 'public', consumer: { peers } }) } });
    dispose = bindConversationWorkspace(root, session);
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
    expect(find('[data-active-model-select]').disabled).toBe(true);
    expect(find('[data-composer-send]').disabled).toBe(true);
    find('[data-composer-input]').value = 'Keep my draft';
    find('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(find('[data-composer-input]').value).toBe('Keep my draft');
    expect(session.getState().activeThread.attempts).toEqual([]);
  });
});
