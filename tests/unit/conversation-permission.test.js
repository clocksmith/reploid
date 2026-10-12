import { describe, it, expect, vi } from 'vitest';
import { renderConversationWorkspace, bindConversationWorkspace } from '../../self/ui/pool-home/conversation-workspace.js';
import { attachmentInput, comparisonSources } from '../../self/host/document-comparison.js';
import { renderPermissionSummary, updatePermissionSummary } from '../../self/ui/components/permission-card.js';

describe('Conversation disclosure review', () => {
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
  it('shows both partition recipients and their disclosure roles before approval', () => {
    const root = document.createElement('div'); root.innerHTML = renderConversationWorkspace();
    const model = { id: 'model', name: 'Model', identity: 'sha256:model', availability: 'ready' };
    const recipients = ['peer:0b4018c83a3f71679522bb52', 'peer:6fef3a618f40d5acfc712941'];
    const approval = { id: 'partition-preview', peerId: recipients[0], modelIdentity: model.identity,
      planId: 'sha256:plan', disclosure: 'partition-activations-and-tokens',
      input: { messages: [{ role: 'user', content: 'Three tickets' }], recipients } };
    const thread = { id: 'thread', model, messages: [], attempts: [{ id: 'attempt', status: 'approval', approval }] };
    const state = { selectedId: thread.id, activeThread: thread, threads: [thread], models: [model], runningIds: ['thread'], network: {} };
    const approve = vi.fn();
    const dispose = bindConversationWorkspace(root, { getState: () => state,
      subscribe: fn => { fn(state); return () => {}; }, approve });
    const recipientText = root.querySelector('[data-permission-recipient]').textContent;
    expect(recipientText).toContain('0b4018c8'); expect(recipientText).toContain('6fef3a61');
    expect(root.querySelector('[data-permission-scope]').textContent).toContain('model data and tokens');
    expect(root.querySelector('[data-approval-description]').textContent).toContain('these computers');
    expect(root.querySelector('[data-approval-remember-description]').textContent).toContain('these computers');
    const details = JSON.parse(root.querySelector('[data-permission-technical]').textContent);
    expect(details.recipients).toEqual(recipients); expect(details.modelIdentity).toBe(model.identity);
    expect(approve).not.toHaveBeenCalled(); dispose();
  });
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
