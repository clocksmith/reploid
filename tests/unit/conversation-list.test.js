import { describe, it, expect, vi } from 'vitest';
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
  it('shows measured context, unread and attention markers without guessing missing usage', () => {
    const root = document.createElement('div'), view = createConversationList(root);
    const model = { id: 'model', identity: 'checkpoint', contextLength: 1000 };
    const thread = { id: 'one', title: 'Movie night', model, messages: [], attempts: [{ id: 'a', status: 'completed',
      execution: { completion: { promptTokenCount: 300, generatedTokenCount: 120 } } }] };
    view.update([thread], null, { models: [model] });
    const button = root.querySelector('[data-thread-item-id]');
    expect(button.querySelector('[data-thread-monogram]').textContent).toBe('M');
    expect(button.querySelector('[data-context-ring]').hasAttribute('hidden')).toBe(false);
    expect(button.querySelector('[data-context-ring-value]').getAttribute('stroke-dasharray')).toBe('42 58');
    expect(button.getAttribute('aria-label')).toContain('last answer 42% of advertised context');
    expect(button.querySelector('[data-thread-unread]').hidden).toBe(false);
    view.update([thread], 'one', { models: [{ ...model, identity: 'different-checkpoint' }] });
    expect(button.querySelector('[data-thread-unread]').hidden).toBe(true);
    expect(button.querySelector('[data-context-ring]').hasAttribute('hidden')).toBe(true);
    thread.attempts.push({ id: 'b', status: 'failed' });
    view.update([thread], 'one', { models: [model] });
    expect(button.querySelector('[data-thread-attention]').hidden).toBe(false);
    expect(button.querySelector('[data-context-ring]').hasAttribute('hidden')).toBe(true);
    view.dispose();
  });
  it('shows only the current state dot through waiting, execution, unread and read transitions', () => {
    const root = document.createElement('div'), view = createConversationList(root);
    const thread = { id: 'one', title: 'Hello', messages: [], attempts: [{ id: 'a', status: 'queued' }] };
    try {
      for (const [status, selected, marker] of [
        ['queued', null, 'attention'], ['loading', null, 'attention'],
        ['executing', null, 'working'], ['cancelling', null, 'attention'],
        ['cancelled', null, null], ['failed', null, 'attention'],
        ['approval', null, 'attention'], ['disconnected', null, 'attention'],
        ['recovering', null, 'attention'], ['interrupted', null, 'attention'],
        ['completed', null, 'unread'], ['completed', 'one', null]
      ]) {
        thread.attempts[0].status = status;
        view.update([thread], selected);
        const visible = [...root.querySelectorAll('.chat-thread-mark')].filter(node => !node.hidden);
        expect(visible).toHaveLength(marker ? 1 : 0);
        if (marker) expect(visible[0].hasAttribute(`data-thread-${marker}`)).toBe(true);
      }
    } finally { view.dispose(); }
  });
  it('refreshes last-activity age without changing focus and clears its clock on disposal', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T20:00:00Z'));
    const root = document.createElement('div'); document.body.append(root);
    const view = createConversationList(root), before = vi.getTimerCount();
    try {
      view.update([{ id: 'one', messages: [], attempts: [{ status: 'completed', createdAt: Date.now() - 3600000, finishedAt: Date.now() - 120000 }] }], 'one');
      const button = root.querySelector('button'); button.focus();
      expect(button.querySelector('time').textContent).toBe('2m');
      vi.advanceTimersByTime(60000);
      expect(button.querySelector('time').textContent).toBe('3m');
      expect(document.activeElement).toBe(button);
      view.dispose(); expect(vi.getTimerCount()).toBe(before);
    } finally { view.dispose(); root.remove(); vi.useRealTimers(); }
  });
});
