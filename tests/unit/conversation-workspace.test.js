import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';

const mockStorage = () => {
  let store = {};
  return {
    getItem: key => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    clear: () => { store = {}; }
  };
};

describe('Conversation Workspace UI', () => {
  let root;
  let session;
  let disposeWorkspace;

  beforeEach(() => {
    root = document.createElement('div');
    document.body.appendChild(root);
  });

  afterEach(async () => {
    disposeWorkspace?.();
    await session?.close();
    root.remove();
  });

  it('renders the 4 connected areas and contains no legacy task-runner chrome', () => {
    const markup = renderConversationWorkspace();
    root.innerHTML = markup;

    // 1. Thread sidebar
    const sidebar = root.querySelector('[data-thread-sidebar]');
    expect(sidebar).not.toBeNull();
    expect(root.querySelector('[data-new-thread]')).not.toBeNull();
    expect(root.querySelector('[data-thread-list]')).not.toBeNull();

    // 2. Conversation area
    const convoArea = root.querySelector('[data-conversation-area]');
    expect(convoArea).not.toBeNull();
    expect(root.querySelector('[data-message-stream]')).not.toBeNull();
    expect(root.querySelector('[data-composer-area]')).not.toBeNull();
    expect(root.querySelector('[data-composer-input]')).not.toBeNull();

    // 3. Network header
    const header = root.querySelector('[data-network-header]');
    expect(header).not.toBeNull();
    expect(root.querySelector('[data-mesh-status]')).not.toBeNull();
    expect(root.querySelector('[data-active-model-select]')).not.toBeNull();
    expect(root.querySelector('[data-toggle-inspector]')).not.toBeNull();
    expect(root.querySelector('[data-toggle-contribution]')).not.toBeNull();

    // 4. Contextual inspector
    const inspector = root.querySelector('[data-contextual-inspector]');
    expect(inspector).not.toBeNull();
    expect(inspector.hidden).toBe(true);

    // Verify ABSENCE of task-runner chrome from ordinary chat
    expect(markup).not.toContain('Start work');
    expect(markup).not.toContain('Accept result');
    expect(markup).not.toContain('Needs changes');
    expect(markup).not.toContain('Revise with feedback');
    expect(markup).not.toContain('A useful result must');
  });

  it('binds to ChatSession, renders model selection, and handles new thread creation', async () => {
    const storage = mockStorage();
    session = createChatSession({ storage });
    root.innerHTML = renderConversationWorkspace();
    disposeWorkspace = bindConversationWorkspace(root, session);

    // Verify models in selector
    const modelSelect = root.querySelector('[data-active-model-select]');
    expect(modelSelect.options.length).toBeGreaterThan(0);
    expect(modelSelect.innerHTML).toContain('Qwen 3.5 0.8B');
    expect(modelSelect.innerHTML).toContain('Code Reasoning LoRA');

    // Initially no threads
    expect(root.querySelector('.chat-no-threads')).not.toBeNull();

    // Click + New
    const newThreadBtn = root.querySelector('[data-new-thread]');
    newThreadBtn.click();

    const state = session.getState();
    expect(state.threads).toHaveLength(1);
    const threadId = state.threads[0].id;

    // Sidebar should now display the thread
    const threadItem = root.querySelector(`[data-thread-item-id="${threadId}"]`);
    expect(threadItem).not.toBeNull();
    expect(threadItem.classList.contains('is-selected')).toBe(true);
  });

  it('sends message via composer, renders user & assistant bubbles with execution badge', async () => {
    const storage = mockStorage();
    session = createChatSession({ storage });
    root.innerHTML = renderConversationWorkspace();
    disposeWorkspace = bindConversationWorkspace(root, session);

    // Create a thread
    const threadId = session.createThread({
      model: CANONICAL_CHAT_MODELS[0],
      purpose: 'General Chat'
    });

    // Enter message in composer
    const input = root.querySelector('[data-composer-input]');
    input.value = 'What is distributed intelligence?';

    const form = root.querySelector('[data-composer-form]');
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    // Message stream should show user bubble and assistant bubble
    const userMsg = root.querySelector('.chat-message-row.is-user');
    expect(userMsg).not.toBeNull();
    expect(userMsg.textContent).toContain('What is distributed intelligence?');

    // Wait for mock session generation to complete
    await new Promise(r => setTimeout(r, 60));

    const assistantMsg = root.querySelector('.chat-message-row.is-assistant');
    expect(assistantMsg).not.toBeNull();
    expect(assistantMsg.textContent).toContain('What is distributed intelligence?');

    // Assistant message must have an execution badge
    const badge = assistantMsg.querySelector('[data-inspect-execution]');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('Local Doppler');
  });

  it('opens contextual inspector on badge click or inspector toggle, controls contribution', async () => {
    const storage = mockStorage();
    session = createChatSession({ storage });
    root.innerHTML = renderConversationWorkspace();
    disposeWorkspace = bindConversationWorkspace(root, session);

    const inspector = root.querySelector('[data-contextual-inspector]');
    expect(inspector.hidden).toBe(true);

    // Toggle inspector open
    const toggleBtn = root.querySelector('[data-toggle-inspector]');
    toggleBtn.click();
    expect(inspector.hidden).toBe(false);

    // Check inspector contents
    expect(root.querySelector('[data-insp-model-name]').textContent).toBe('Qwen 3.5 0.8B');
    expect(root.querySelector('[data-insp-placement]').textContent).toContain('WebGPU');

    // Test contribution quick toggle
    const contribBtn = root.querySelector('[data-toggle-contribution]');
    expect(contribBtn.textContent).toContain('Contributing');
    contribBtn.click();

    expect(session.getState().contribution.paused).toBe(true);
    expect(contribBtn.textContent).toContain('Paused');

    // Close inspector
    const closeBtn = root.querySelector('[data-close-inspector]');
    closeBtn.click();
    expect(inspector.hidden).toBe(true);
  });

  it('handles cancellation and multi-thread concurrency cleanly', async () => {
    const storage = mockStorage();
    session = createChatSession({ storage });
    root.innerHTML = renderConversationWorkspace();
    disposeWorkspace = bindConversationWorkspace(root, session);

    // Thread 1
    const t1 = session.createThread({ model: CANONICAL_CHAT_MODELS[0], purpose: 'Thread 1' });
    // Thread 2
    const t2 = session.createThread({ model: CANONICAL_CHAT_MODELS[0], purpose: 'Thread 2' });

    // Select thread 1
    session.select(t1);

    // Start generation on thread 1
    const sendPromise = session.send(t1, 'Compute intensive query');

    // Stop button should be visible for running thread
    const stopBtn = root.querySelector('[data-composer-stop]');
    expect(stopBtn.hidden).toBe(false);

    // Click Stop button
    stopBtn.click();
    await sendPromise;

    // Thread 1 should show stopped status
    const state = session.getState();
    const thread1 = state.threads.find(t => t.id === t1);
    expect(thread1.attempts[0].status).toBe('cancelled');

    // Switch to thread 2 in sidebar
    const t2Item = root.querySelector(`[data-thread-item-id="${t2}"]`);
    t2Item.click();

    expect(session.getState().selectedId).toBe(t2);
    // Thread 2 should not be affected by cancellation of thread 1
    const thread2 = session.getState().threads.find(t => t.id === t2);
    expect(thread2.attempts).toHaveLength(0);
  });
});
