import { describe, it, expect, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';

describe('Conversation disclosure review', () => {
  it('shows readable contents, resets consent when the payload changes, and never grants on render', () => {
    const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace();
    const model = { id: 'model', name: 'Model', availability: 'ready' };
    const approval = { id: 'preview', peerId: 'recipient-identity', input: [{ role: 'user', content: 'Private draft' }], reusable: true };
    const thread = { id: 'thread', model, messages: [], attempts: [{ id: 'attempt', status: 'approval', approval }] };
    const state = { selectedId: thread.id, activeThread: thread, threads: [thread], models: [model], runningIds: ['thread'], network: {} };
    const listeners = new Set(), approve = vi.fn();
    const session = { getState: () => state, subscribe: fn => { listeners.add(fn); fn(state); return () => listeners.delete(fn); }, approve };
    const dispose = bindConversationWorkspace(root, session);
    expect(root.querySelector('[data-permission-content]').textContent).toContain('user:\nPrivate draft');
    expect(root.querySelector('.permission-summary details').open).toBe(false);
    expect(root.querySelector('[data-permission-technical]').textContent).toContain('recipient-identity');
    const consent = root.querySelector('[data-approval-consent]'); consent.checked = true;
    consent.dispatchEvent(new Event('change'));
    expect(root.querySelector('[data-approval-send]').disabled).toBe(false);
    approval.input[0].content = 'Changed request'; listeners.forEach(fn => fn(state));
    expect(consent.checked).toBe(false); expect(root.querySelector('[data-approval-send]').disabled).toBe(true);
    expect(approve).not.toHaveBeenCalled(); dispose();
  });
});
