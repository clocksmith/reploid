import { describe, it, expect } from 'vitest';
import { createConversationList } from '../../self/ui/pool-home/conversation-list.js';
import { attachmentInput, comparisonSources } from '../../self/host/document-comparison.js';

describe('Conversation list', () => {
  it('labels attached-document threads with the question while retaining the complete input', () => {
    const root = document.createElement('div');
    const view = createConversationList(root, new Map(), { getSources: comparisonSources });
    const content = attachmentInput('How much remains to pay?', [{ name: 'invoice.txt', text: 'Balance: $900.' }]);
    const thread = { id: 'invoice', messages: [{ role: 'user', content }], attempts: [] };
    view.update([thread], 'invoice');
    expect(root.querySelector('[data-thread-item-id] span').textContent).toBe('How much remains to pay?');
    expect(root.querySelector('summary').getAttribute('aria-label')).toBe('Actions for How much remains to pay?');
    expect(thread.messages[0].content).toBe(content);
    thread.title = 'My invoice';
    view.update([thread], 'invoice');
    expect(root.querySelector('[data-thread-item-id] span').textContent).toBe('My invoice');
  });
  it('marks a newly completed followup unread without replacing the thread control', () => {
    const root = document.createElement('div'), view = createConversationList(root);
    const thread = { id: 'one', purpose: 'Question', messages: [], attempts: [{ id: 'first', status: 'completed' }] };
    view.update([thread], 'one');
    const button = root.firstElementChild;
    expect(button.textContent).toContain('Complete');
    thread.attempts.push({ id: 'followup', status: 'completed' });
    view.update([thread], null);
    expect(root.firstElementChild).toBe(button);
    expect(button.textContent).toContain('New answer');
    view.update([thread], 'one');
    expect(button.textContent).not.toContain('New answer');
  });
  it('orders recent activity without changing stored order or replacing a focused control', () => {
    const root = document.createElement('div'); document.body.append(root);
    const view = createConversationList(root);
    const older = { id: 'older', purpose: 'Earlier question', createdAt: 1, messages: [], attempts: [] };
    const newer = { id: 'newer', purpose: 'Later question', createdAt: 2, messages: [], attempts: [] };
    const records = [older, newer]; view.update(records, 'older');
    expect([...root.querySelectorAll('[data-thread-item-id]')].map(node => node.dataset.threadItemId)).toEqual(['newer', 'older']);
    const button = root.querySelector('[data-thread-item-id="older"]'); button.focus();
    older.attempts.push({ id: 'followup', createdAt: 3, status: 'executing' });
    view.update(records, 'older');
    expect(root.firstElementChild.firstElementChild).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(records.map(record => record.id)).toEqual(['older', 'newer']);
    expect(button.dataset.activity).toBe('executing');
    expect(button.getAttribute('aria-label')).toContain('Generating');
    older.attempts[0].status = 'interrupted'; view.update(records, 'older');
    expect(button.dataset.activity).toBe('idle');
    expect(button.getAttribute('aria-label')).toContain('Interrupted');
    view.dispose(); root.remove();
  });
});
