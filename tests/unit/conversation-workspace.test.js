import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { createChatSession } from '../../self/host/chat-session.js';
import { createChatTestService } from '../fixtures/chat-service.js';

describe('Conversation workspace', () => {
  let root, session, dispose, service;
  const find = selector => root.querySelector(selector);
  beforeEach(() => {
    root = document.createElement('div'); document.body.append(root);
    service = createChatTestService();
    session = createChatSession({ storage: null, service });
    root.innerHTML = renderConversationWorkspace();
    dispose = bindConversationWorkspace(root, session);
  });
  afterEach(async () => { dispose(); await session.close(); root.remove(); });

  it('opens a usable composer without slogans, fake status or a second setup step', () => {
    expect(find('[data-composer-send]').disabled).toBe(false);
    expect(find('[data-contextual-inspector]').hidden).toBe(true);
    expect(find('[data-composer-input]').placeholder).toBeTruthy();
    expect(root.textContent).not.toMatch(/Mesh Active|Distributed Intelligence|Contributing|Scope:|Recent Improvements|LoRA/);
  });

  it('starts directly, appends followups and pins the conversation model', async () => {
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
    expect(service.calls[0].source).toBe('qwen-3-5-2b-q4k-ehaf16');
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
    const thread = session.createThread();
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
    const first = session.createThread(), second = session.createThread();
    const a = session.send(first, 'First'), b = session.send(second, 'Second');
    session.select(first);
    find('[data-composer-stop]').click();
    const [one, two] = await Promise.all([a, b]);
    expect(one.status).toBe('cancelled'); expect(two.status).toBe('completed');
    session.select(second);
    expect(find('[data-message-stream]').textContent).toContain('Fixture: Second');
  });
});
