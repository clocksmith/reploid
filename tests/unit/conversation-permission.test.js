import { describe, it, expect, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { attachmentInput, comparisonSources } from '../../self/host/document-comparison.js';
import { renderPermissionSummary, updatePermissionSummary } from '../../self/ui/components/permission-card.js';
import { createWebSearch } from '../../self/host/web-search.js';

describe('Conversation Send authorization', () => {
  it('renders attachment passages safely without hiding the exact approved payload', () => {
    const root = document.createElement('div'); root.innerHTML = renderPermissionSummary();
    const input = [{ role: 'user', content: attachmentInput('Compare quotes', [{ name: 'Quote.txt', text: '<img src=x onerror=alert(1)> $42' }]) }];
    updatePermissionSummary(root, { input, technical: { input }, getSources: comparisonSources, recipient: 'Peer A', scope: 'Messages' });
    expect(root.querySelector('[data-permission-content]').textContent).toContain('Quote.txt');
    expect(root.querySelector('[data-permission-content]').textContent).not.toContain('reploid-document-sources');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[data-permission-review]').open).toBe(false);
    expect(JSON.parse(root.querySelector('pre').textContent).input).toEqual(input);
    root.querySelector('[data-permission-content] details').open = true;
    updatePermissionSummary(root, { input, technical: { input }, getSources: comparisonSources });
    expect(root.querySelector('[data-permission-content] details').open).toBe(true);
  });
  it('Send never authorizes disclosure and rendering never approves a held request', async () => {
    const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace();
    const model = { id: 'model', name: 'Model', availability: 'ready' };
    const thread = { id: 'thread', model, messages: [], attempts: [], grants: [] };
    const state = { selectedId: thread.id, activeThread: thread, threads: [thread], models: [model], runningIds: [], network: {} };
    const approve = vi.fn(), send = vi.fn(async () => ({ status: 'completed' }));
    const listeners = new Set();
    const dispose = bindConversationWorkspace(root, { getState: () => state,
      subscribe(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }, approve, send });
    expect(send).not.toHaveBeenCalled(); expect(approve).not.toHaveBeenCalled();
    expect(root.querySelector('[data-chat-approval]')).toBeNull();
    root.querySelector('[data-composer-input]').value = 'Hello';
    root.querySelector('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('thread', 'Hello', []));
    thread.attempts.push({ id: 'other-attempt', status: 'approval', approval: { id: 'other-preview' } });
    listeners.forEach(fn => fn(state));
    expect(approve).not.toHaveBeenCalled();
    expect(root.querySelector('[data-remote-permission]')).toBeNull();
    expect(root.querySelector('[data-composer-area]').hidden).toBe(false);
    dispose();
  });
  it('With web search on, Send opts the request into retrieval and shows that search is on', async () => {
    const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace();
    const model = { id: 'model', name: 'Model', availability: 'ready' };
    const thread = { id: 'thread', model, messages: [], attempts: [], grants: [] };
    const state = { selectedId: thread.id, activeThread: thread, threads: [thread], models: [model], runningIds: [], network: {} };
    const send = vi.fn(async () => ({ status: 'completed' }));
    const values = new Map();
    const webSearch = createWebSearch({ storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
    webSearch.configure({ url: 'https://search.example/mcp' }); webSearch.setEnabled(true);
    const dispose = bindConversationWorkspace(root, { getState: () => state, subscribe(fn) { fn(state); return () => {}; }, send }, { webSearch });
    expect(root.querySelector('[data-web-search-on]').hidden).toBe(false);
    root.querySelector('[data-composer-input]').value = 'Hello';
    root.querySelector('[data-composer-form]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith('thread', 'Hello', [], { retrieval: {} }));
    dispose();
  });
});
