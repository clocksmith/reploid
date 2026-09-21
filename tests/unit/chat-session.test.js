import { describe, it, expect, vi } from 'vitest';
import { createChatSession, CANONICAL_CHAT_MODELS } from '../../self/host/chat-session.js';

const mockStorage = () => {
  let store = {};
  return {
    getItem: key => store[key] || null,
    setItem: (key, val) => { store[key] = String(val); },
    clear: () => { store = {}; }
  };
};

describe('Host ChatSession', () => {
  it('creates threads, handles multi-turn conversation and persists history', async () => {
    const storage = mockStorage();
    const session = createChatSession({ storage });

    const threadId = session.createThread({
      model: CANONICAL_CHAT_MODELS[0],
      purpose: 'Testing multi-turn chat',
      sharingScope: 'local'
    });

    expect(threadId).toBeDefined();
    let state = session.getState();
    expect(state.threads).toHaveLength(1);
    expect(state.selectedId).toBe(threadId);

    // Send first message
    const attempt1 = await session.send(threadId, 'First user message');
    expect(attempt1.status).toBe('completed');

    state = session.getState();
    const thread = state.threads[0];
    expect(thread.messages).toHaveLength(2); // user + assistant
    expect(thread.messages[0].content).toBe('First user message');
    expect(thread.messages[1].role).toBe('assistant');
    expect(thread.messages[1].content).toContain('First user message');

    // Send second message (follow up)
    const attempt2 = await session.send(threadId, 'Follow up message');
    expect(attempt2.status).toBe('completed');

    state = session.getState();
    expect(state.threads[0].messages).toHaveLength(4);

    await session.close();

    // Verify recovery across session reload
    const reloaded = createChatSession({ storage });
    const reloadedState = reloaded.getState();
    expect(reloadedState.threads).toHaveLength(1);
    expect(reloadedState.threads[0].messages).toHaveLength(4);
    expect(reloadedState.threads[0].messages[2].content).toBe('Follow up message');
    await reloaded.close();
  });

  it('runs multiple threads concurrently without cross-contamination', async () => {
    const storage = mockStorage();
    const session = createChatSession({ storage });

    const threadA = session.createThread({ model: CANONICAL_CHAT_MODELS[0] });
    const threadB = session.createThread({ model: CANONICAL_CHAT_MODELS[1] });

    const [resA, resB] = await Promise.all([
      session.send(threadA, 'Message to A'),
      session.send(threadB, 'Message to B')
    ]);

    expect(resA.status).toBe('completed');
    expect(resB.status).toBe('completed');

    const state = session.getState();
    const tA = state.threads.find(t => t.id === threadA);
    const tB = state.threads.find(t => t.id === threadB);

    expect(tA.messages.at(-1).content).toContain('Message to A');
    expect(tB.messages.at(-1).content).toContain('Message to B');
    expect(tA.messages.at(-1).content).not.toContain('Message to B');

    await session.close();
  });

  it('cancels one thread without affecting another running thread', async () => {
    const storage = mockStorage();
    let resolveB;
    const gateB = new Promise(r => { resolveB = r; });

    const service = {
      isSupported: () => true,
      open: async model => ({
        stream: async function* (messages, { signal }) {
          const prompt = messages.at(-1).content;
          if (prompt.includes('cancel-me')) {
            yield { text: 'Starting... ' };
            // Wait until aborted
            await new Promise((_, reject) => {
              signal.addEventListener('abort', () => reject(new Error('Cancelled')));
            });
          } else {
            yield { text: 'Running B' };
            await gateB;
            yield { text: ' Finished B' };
          }
        },
        close: async () => {}
      })
    };

    const session = createChatSession({ storage, service });

    const threadA = session.createThread({ model: CANONICAL_CHAT_MODELS[0] });
    const threadB = session.createThread({ model: CANONICAL_CHAT_MODELS[0] });

    const sendA = session.send(threadA, 'Please cancel-me now');
    const sendB = session.send(threadB, 'Keep running B');

    // Wait for A to start streaming
    await new Promise(r => setTimeout(r, 20));

    // Cancel thread A
    await session.cancel(threadA);
    const resA = await sendA;
    expect(resA.status).toBe('cancelled');

    // Finish thread B
    resolveB();
    const resB = await sendB;
    expect(resB.status).toBe('completed');

    const state = session.getState();
    const tA = state.threads.find(t => t.id === threadA);
    const tB = state.threads.find(t => t.id === threadB);

    expect(tA.messages.at(-1).status).toBe('cancelled');
    expect(tB.messages.at(-1).status).toBe('completed');
    expect(tB.messages.at(-1).content).toBe('Running B Finished B');

    await session.close();
  });

  it('manages contribution pause state and limits', () => {
    const session = createChatSession({ storage: mockStorage() });
    let state = session.getState();
    expect(state.contribution.paused).toBe(false);

    session.setContributionPaused(true);
    state = session.getState();
    expect(state.contribution.paused).toBe(true);

    session.updateContributionLimits({ maxStorageMb: 2048 });
    state = session.getState();
    expect(state.contribution.limits.maxStorageMb).toBe(2048);
  });
});
