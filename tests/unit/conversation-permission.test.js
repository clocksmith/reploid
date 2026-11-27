import { describe, it, expect, vi } from 'vitest';
import { openConversation } from '../fixtures/conversation-view.js';
import { attachmentInput, comparisonSources } from '../../apps/poolday/host/document-comparison.js';
import { createWebSearch } from '../../apps/poolday/host/web-search.js';

describe('Conversation Send authorization', () => {
  it('Send never authorizes disclosure and rendering never approves a held request', async () => {
    const model = { id: 'model', name: 'Model', availability: 'ready', localReady: true };
    const thread = { id: 'thread', model, messages: [], attempts: [], grants: [] };
    const state = { selectedId: thread.id, activeThread: thread, threads: [thread], models: [model], runningIds: [], network: {} };
    const approve = vi.fn(), send = vi.fn(async () => ({ status: 'completed' }));
    const listeners = new Set();
    const view = openConversation({ getState: () => state,
      subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }, approve, send });
    expect(send).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
    view.send('Hello');
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('thread', 'Hello', []));
    thread.attempts.push({ id: 'other-attempt', status: 'approval', approval: { id: 'other-preview' } });
    listeners.forEach(fn => fn(state));
    expect(approve).not.toHaveBeenCalled();
    // A held request without a permission need asks nothing of the person, and the composer stays.
    expect(view.snapshot().remotePermission).toBeNull();
    expect(view.composer().send.visible).toBe(true);
    view.dispose();
  });
  it('With web search on, Send opts the request into retrieval and shows that search is on', async () => {
    const model = { id: 'model', name: 'Model', availability: 'ready', localReady: true };
    const thread = { id: 'thread', model, messages: [], attempts: [], grants: [] };
    const state = { selectedId: thread.id, activeThread: thread, threads: [thread], models: [model], runningIds: [], network: {} };
    const send = vi.fn(async () => ({ status: 'completed' }));
    const values = new Map();
    const webSearch = createWebSearch({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
    webSearch.configure({ url: 'https://search.example/mcp' }); webSearch.setEnabled(true);
    const view = openConversation({ getState: () => state, subscribe(fn) { fn(state); return () => {}; }, send }, { webSearch });
    expect(view.composer().search).toEqual({ visible: true, pressed: true });
    view.send('Hello');
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('thread', 'Hello', [], { retrieval: {} }));
    view.dispose();
  });
});
