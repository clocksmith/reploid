// The Threads list as the conversation controller projects it (host/decisions/conversation-controller.js); the React
// Threads drawer renders one ThreadItem per row. Rows are keyed by thread, so React keeps a row's control (and its
// focus) when the list reorders; that is the component library's job, tested there.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { openConversation } from '../fixtures/conversation-view.js';
import { attachmentInput, comparisonSources } from '../../apps/poolday/host/document-comparison.js';

const views = [];
afterEach(() => { for (const view of views.splice(0)) view.dispose(); vi.useRealTimers(); });

function list({ threads, selectedId = null, models = [] }) {
  const listeners = new Set();
  let state = { threads, selectedId, activeThread: threads.find(thread => thread.id === selectedId) ?? null, models, runningIds: [], network: {} };
  const session = { getState: () => state, subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); }, getDocumentSources: comparisonSources };
  const view = openConversation(session); views.push(view);
  return {
    rows: () => view.snapshot().threads.items,
    row: id => view.snapshot().threads.items.find(item => item.id === id),
    update(change = {}) {
      state = { ...state, ...change, threads: structuredClone(change.threads ?? state.threads) };
      state.activeThread = state.threads.find(thread => thread.id === state.selectedId) ?? null;
      listeners.forEach(listener => listener(state));
    }
  };
}

describe('Conversation list', () => {
  it('labels attached-document threads with the question while retaining the complete input', () => {
    const content = attachmentInput('How much remains to pay?', [{ name: 'invoice.txt', text: 'Balance: $900.' }]);
    const thread = { id: 'invoice', messages: [{ role: 'user', content }], attempts: [] };
    const f = list({ threads: [thread], selectedId: 'invoice' });
    expect(f.row('invoice').title).toBe('How much remains to pay?');
    expect(thread.messages[0].content).toBe(content);
    f.update({ threads: [{ ...thread, title: 'My invoice' }] });
    expect(f.row('invoice').title).toBe('My invoice');
  });

  it('marks a newly completed followup unread, and read once the thread is shown', () => {
    const thread = { id: 'one', purpose: 'Question', messages: [], attempts: [{ id: 'first', status: 'completed' }] };
    const f = list({ threads: [thread], selectedId: 'one' });
    expect(f.row('one').summary).toBe('Complete');
    f.update({ selectedId: null, threads: [{ ...thread, attempts: [...thread.attempts, { id: 'followup', status: 'completed' }] }] });
    expect(f.row('one').summary).toBe('New answer');
    expect(f.row('one').unread).toBe(true);
    f.update({ selectedId: 'one' });
    expect(f.row('one').summary).toBe('Complete');
  });

  it('orders recent activity without changing stored order', () => {
    const older = { id: 'older', purpose: 'Earlier question', createdAt: 1, messages: [], attempts: [] };
    const newer = { id: 'newer', purpose: 'Later question', createdAt: 2, messages: [], attempts: [] };
    const records = [older, newer];
    const f = list({ threads: records, selectedId: 'older' });
    expect(f.rows().map(row => row.id)).toEqual(['newer', 'older']);
    f.update({ threads: [{ ...older, attempts: [{ id: 'followup', createdAt: 3, status: 'executing' }] }, newer] });
    expect(f.rows().map(row => row.id)).toEqual(['older', 'newer']);
    expect(records.map(record => record.id)).toEqual(['older', 'newer']);
    expect(f.row('older').working).toBe(true);
    expect(f.row('older').summary).toBe('Generating');
    f.update({ threads: [{ ...older, attempts: [{ id: 'followup', createdAt: 3, status: 'interrupted' }] }, newer] });
    expect(f.row('older').working).toBe(false);
    expect(f.row('older').summary).toBe('Interrupted');
  });

  it('shows measured context, unread and attention markers without guessing missing usage', () => {
    const model = { id: 'model', identity: 'checkpoint', contextLength: 1000 };
    const thread = { id: 'one', title: 'Movie night', model, messages: [], attempts: [{ id: 'a', status: 'completed',
      execution: { completion: { promptTokenCount: 300, generatedTokenCount: 120 } } }] };
    const f = list({ threads: [thread], models: [model] });
    expect(f.row('one').monogram).toBe('M');
    expect(f.row('one').context).toEqual({ percent: 42, text: '42%' });
    expect(f.row('one').unread).toBe(true);
    f.update({ selectedId: 'one', models: [{ ...model, identity: 'different-checkpoint' }] });
    expect(f.row('one').unread).toBe(false);
    expect(f.row('one').context).toBeNull();
    f.update({ models: [model], threads: [{ ...thread, attempts: [...thread.attempts, { id: 'b', status: 'failed' }] }] });
    expect(f.row('one').attention).toBe(true);
    expect(f.row('one').context).toBeNull();
  });

  it('shows only the current state mark through waiting, execution, unread and read transitions', () => {
    const thread = { id: 'one', title: 'Hello', messages: [], attempts: [{ id: 'a', status: 'queued' }] };
    const f = list({ threads: [thread] });
    for (const [status, selected, marker] of [
      ['queued', null, 'attention'], ['loading', null, 'attention'],
      ['executing', null, 'working'], ['cancelling', null, 'attention'],
      ['cancelled', null, null], ['failed', null, 'attention'],
      ['approval', null, 'attention'], ['disconnected', null, 'attention'],
      ['recovering', null, 'attention'], ['interrupted', null, 'attention'],
      ['completed', null, 'unread'], ['completed', 'one', null]
    ]) {
      f.update({ selectedId: selected, threads: [{ ...thread, attempts: [{ id: 'a', status }] }] });
      const row = f.row('one');
      const marks = ['working', 'unread', 'attention'].filter(name => row[name]);
      expect(marks, status).toEqual(marker ? [marker] : []);
    }
  });

  it('refreshes last-activity age on its own and clears its clock on disposal', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T20:00:00Z'));
    const before = vi.getTimerCount();
    const f = list({ threads: [{ id: 'one', messages: [], attempts: [{ status: 'completed', createdAt: Date.now() - 3600000, finishedAt: Date.now() - 120000 }] }], selectedId: 'one' });
    expect(f.row('one').time).toBe('2m');
    vi.advanceTimersByTime(60000);
    expect(f.row('one').time).toBe('3m');
    views.splice(0).forEach(view => view.dispose());
    expect(vi.getTimerCount()).toBe(before);
  });
});
