import { describe, it, expect } from 'vitest';
import { createMessageList } from '../../self/ui/pool-home/message-list.js';

function conversation() {
  return { id: 'one', messages: [
    { id: 'question', role: 'user', content: 'Question' },
    { id: 'reply', role: 'assistant', content: 'First words', attemptId: 'attempt' }
  ], attempts: [{ id: 'attempt', status: 'executing' }] };
}

describe('Stable message presentation', () => {
  it('shows every line of an attached question as inert text', () => {
    const root = document.createElement('div'), thread = conversation();
    const question = 'Compare prices.\nInclude <script> and exclusions.\n\nCheck the date.';
    const view = createMessageList(root, { getSources: text => text === 'Question' ? {
      question, documents: [{ name: 'Quote', passages: [{ id: 'D1:P1', text: 'May deliver Friday.' }] }]
    } : null });
    view.update(thread, { usable: true, busy: false });
    expect(root.querySelector('[data-message-id="question"] .chat-message-content').textContent).toContain(question);
    expect(root.querySelector('script')).toBeNull();
    view.dispose();
  });

  it('keeps existing text nodes, selection, focus, and source disclosures while streaming', () => {
    const root = document.createElement('div'); document.body.append(root);
    const thread = conversation();
    const view = createMessageList(root, { getSources: text => text === 'Question' ? {
      question: 'Question', documents: [{ name: 'Notes', passages: [{ id: 'D1:P1', text: 'Evidence' }] }]
    } : null });
    view.update(thread, { usable: true, busy: true });
    const source = root.querySelector('details'); source.open = true;
    const summary = source.querySelector('summary'); summary.focus();
    const row = root.querySelector('[data-message-id="reply"]');
    const text = row.querySelector('[data-text-block] span').firstChild;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 5);
    const selection = document.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    thread.messages[1].content += ' and more';
    view.update(thread, { usable: true, busy: true });
    expect(root.querySelector('[data-message-id="reply"]')).toBe(row);
    expect(row.querySelector('[data-text-block] span').firstChild).toBe(text);
    expect(selection.toString()).toBe('First'); expect(document.activeElement).toBe(summary);
    expect(root.querySelector('details')).toBe(source); expect(source.open).toBe(true);
    thread.messages[1].content += ' [D1:P1]';
    view.update(thread, { usable: true, busy: true });
    const citation = row.querySelector('[data-source-reference]'); citation.focus();
    thread.messages[1].content += ' continued';
    view.update(thread, { usable: true, busy: true });
    expect(row.querySelector('[data-source-reference]')).toBe(citation);
    expect(document.activeElement).toBe(citation);
    expect(row.querySelector('[data-text-block] span').firstChild).toBe(text);
    selection.removeAllRanges(); view.dispose(); root.remove();
  });

  it('formats ordinary answers safely and retains earlier Markdown nodes during streaming', () => {
    const root = document.createElement('div'), view = createMessageList(root), thread = conversation();
    thread.messages[1].content = '# Result\n**Strong** and *emphasis*\n- first\n- second\n\n| Choice | Score |\n| --- | --- |\n| A | 1 |\n\n[Safe](https://example.com) [Bad](javascript:alert%281%29) <img src=x onerror=alert(1)>';
    view.update(thread, { usable: true, busy: true });
    expect(root.querySelector('h1').textContent).toBe('Result');
    expect(root.querySelector('strong').textContent).toBe('Strong');
    expect(root.querySelectorAll('li')).toHaveLength(2); expect(root.querySelectorAll('td')).toHaveLength(2);
    expect(root.querySelector('img')).toBeNull(); expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    const heading = root.querySelector('h1'), link = root.querySelector('a');
    thread.messages[1].content += ' More text'; view.update(thread, { usable: true, busy: true });
    expect(root.querySelector('h1')).toBe(heading); expect(root.querySelector('a')).toBe(link);
    thread.messages[1].content = 'x'.repeat(100001); view.update(thread, { usable: true, busy: true });
    expect(root.querySelector('[data-message-id="reply"] .chat-message-content').textContent).toHaveLength(100001);
  });

  it('restores the reading position when switching conversations', () => {
    const root = document.createElement('div'), positions = new Map();
    const view = createMessageList(root, { positions }), one = conversation(), two = { ...conversation(), id: 'two' };
    view.update(one, { usable: true, busy: false }); root.scrollTop = 150;
    view.update(two, { usable: true, busy: false }); root.scrollTop = 30;
    view.update(one, { usable: true, busy: false }); expect(root.scrollTop).toBe(150);
    view.dispose(); expect(positions.get('two')).toBe(30);
  });

  it('renders code as inert text with a copy action and keeps failed partial answers', () => {
    const root = document.createElement('div'), view = createMessageList(root), thread = conversation();
    thread.messages[1].content = 'Example:\n```html\n<script>alert(1)</script>\n```';
    thread.attempts[0] = { id: 'attempt', status: 'failed', error: 'Contributor disconnected' };
    view.update(thread, { usable: true, busy: false });
    expect(root.querySelector('script')).toBeNull(); expect(root.querySelector('code').textContent).toContain('<script>');
    expect(root.querySelector('[data-copy-code]')).not.toBeNull();
    expect(root.textContent).toContain('A computer disconnected. Retry this answer.');
    expect(root.querySelector('[data-retry-attempt]').disabled).toBe(false);
  });
  it('presents declined sharing as not sent rather than a network failure', () => {
    const root = document.createElement('div'), view = createMessageList(root), thread = conversation();
    thread.messages[1].content = '';
    thread.attempts[0] = { id: 'attempt', status: 'cancelled', error: 'Disclosure declined' };
    view.update(thread, { usable: true, busy: false });
    expect(root.textContent).toContain('Not sent. You declined sharing this request.');
    expect(root.textContent).not.toContain('could not finish');
    view.dispose();
  });

  it('shows each answer\'s recorded supply provenance in its technical details', () => {
    const root = document.createElement('div'), thread = { ...conversation(), model: { name: 'Model' } };
    thread.messages[1].content = 'Answer';
    thread.attempts[0] = { id: 'attempt', status: 'completed', execution: { provider: 'peer', placement: 'peer-whole-request', peerId: 'peer-1' },
      provenance: { schema: 'reploid.answer-provenance/v1', supply: 'mesh', classes: ['mesh'],
        execution: { supply: 'mesh', classes: ['mesh'], placement: 'peer-whole-request', participants: [] }, earlierAttempts: [], retrieval: { supply: 'none' } } };
    const view = createMessageList(root);
    view.update(thread, { usable: true, busy: false, state: { participantId: 'requester' } });
    const details = root.querySelector('[data-message-id="reply"] [data-execution-activity]');
    expect(details.hidden).toBe(false);
    expect(details.querySelector('[data-execution-trigger]').getAttribute('aria-label')).toBe('Complete · 1 computer · Mesh. Execution details');
    view.dispose();
  });

});


it('shows recorded answer metadata and omits unknown or invalid measurements', () => {
  const root = document.createElement('div'), thread = conversation();
  thread.model = { name: 'Recorded model' };
  const view = createMessageList(root);
  view.update(thread, { usable: true, busy: false });
  const meta = root.querySelector('.is-assistant .chat-message-meta');
  expect(meta.querySelector('[aria-label="Model: Recorded model"]')).not.toBeNull();
  expect(meta.textContent).toBe('');
  thread.attempts[0].execution = { placement: 'local-webgpu', timing: { generatedTokenCount: 59, totalMs: 7900 } };
  view.update(thread, { usable: true, busy: false });
  expect(meta.querySelector('[title="59 generated tokens"]')).not.toBeNull();
  expect(meta.textContent).toContain('7.9 s');
  expect(meta.textContent).toContain('7.5 tok/s');
  expect(meta.querySelector('[title="Generation time including prompt processing"]')).not.toBeNull();
  thread.attempts[0].execution.timing = { generatedTokenCount: -1, totalMs: NaN };
  view.update(thread, { usable: true, busy: false });
  expect(meta.textContent).toBe('');
  view.dispose();
});

it('shows each answer’s own route and latency, without borrowing metrics from a later attempt', () => {
  const root = document.createElement('div'), thread = conversation();
  thread.model = { name: 'Model' };
  thread.attempts[0].execution = { placement: 'local-webgpu', timing: { generatedTokenCount: 10, totalMs: 1000, firstTokenMs: 250, prefillMs: 200, decodeMs: 800 } };
  thread.attempts.push({ id: 'later', status: 'completed', execution: { placement: 'two-device-layer-partition', participantA: 'a', participantB: 'b' } });
  thread.messages.push({ id: 'later-reply', role: 'assistant', attemptId: 'later', content: 'Later answer' });
  const view = createMessageList(root);
  view.update(thread, { usable: true, busy: false });
  const first = root.querySelector('[data-message-id="reply"]'), second = root.querySelector('[data-message-id="later-reply"]');
  expect(first.querySelector('.chat-message-meta').textContent).toContain('10.0 tok/s');
  expect(first.querySelector('[data-activity-detail]').textContent).toContain('First token0.25 s');
  expect(first.textContent).toContain('Prompt processing');
  expect(second.querySelector('[data-execution-trigger]').getAttribute('aria-label')).toContain('2 computers · Partitioned');
  expect(second.textContent).not.toContain('tok/s');
  expect(second.textContent).not.toContain('First token');
  view.dispose();
});


it('keeps retrieval failure and retry controls outside model output, with no empty copy action', () => {
  const root = document.createElement('div'), thread = conversation();
  thread.messages[1].content = '';
  thread.attempts[0] = { id: 'attempt', status: 'failed', retryOf: 'previous',
    error: 'Could not retrieve sources: retrieval exceeded its time limit.',
    retrieval: { outcome: 'failed', limits: { timeoutMs: 10000 }, error: { code: 'timeout', stage: 'extraction' } } };
  const view = createMessageList(root); view.update(thread, { usable: true, busy: false });
  const row = root.querySelector('.is-assistant');
  expect(row.querySelector('[data-system-status]').textContent).toBe('System · Reading search results timed out after 10 seconds. No model answer was generated.');
  expect(row.querySelector('.chat-message-content').textContent).toBe('');
  expect(row.querySelector('.chat-message-content').hidden).toBe(true);
  expect(row.querySelector('[data-copy-message]')).toBeNull();
  expect(row.querySelector('[data-retry-attempt]').textContent).toBe('Retry');
  expect(row.textContent).not.toContain('New attempt');
  thread.messages[1].content = 'Actual model words'; view.update(thread, { usable: true, busy: false });
  expect(row.querySelector('[aria-label="Model output"]').textContent).toBe('Actual model words');
  expect(row.querySelector('[aria-label="Model output"]').textContent).not.toContain('System');
  view.dispose();
});

it('updates retrieval progress in system status and groups empty retries while preserving partial model output', () => {
  const root = document.createElement('div'), thread = conversation(), view = createMessageList(root);
  thread.messages[1].content = '';
  thread.attempts[0] = { id: 'attempt', status: 'queued', retrieval: { outcome: 'pending' } };
  view.update(thread, { usable: true, busy: true });
  const row = root.querySelector('.is-assistant'), status = row.querySelector('[data-system-status]');
  expect(status.textContent).toContain('System · Searching the web');
  expect(row.querySelector('.chat-message-footer').hidden).toBe(true);
  thread.attempts[0].retrieval.progress = { stage: 'extraction', completed: 1, total: 3, available: 1 };
  view.update(thread, { usable: true, busy: true });
  expect(row.querySelector('[data-system-status]')).toBe(status);
  expect(status.textContent).toContain('1 of 3 pages checked; 1 usable');
  thread.attempts[0].status = 'failed'; thread.attempts[0].retrieval.outcome = 'failed';
  thread.attempts[0].error = 'Could not retrieve sources: the search provider failed.';
  thread.attempts.push({ id: 'retry', retryOf: 'attempt', status: 'failed', error: 'Contributor disconnected' });
  thread.messages.push({ id: 'retry-reply', role: 'assistant', content: 'Partial model words', attemptId: 'retry' });
  view.update(thread, { usable: true, busy: false });
  expect(root.querySelectorAll('.is-assistant')).toHaveLength(1);
  expect(root.querySelector('[data-previous-attempts]').textContent).toContain('the search provider failed');
  expect(root.querySelector('[aria-label="Model output"]').textContent).toBe('Partial model words');
  thread.attempts.push({ id: 'retry-again', retryOf: 'retry', status: 'queued', retrieval: { outcome: 'pending' } });
  thread.messages.push({ id: 'new-reply', role: 'assistant', content: '', attemptId: 'retry-again' });
  view.update(thread, { usable: true, busy: true });
  expect(root.querySelectorAll('.is-assistant')).toHaveLength(2);
  expect(root.querySelector('[data-message-id="retry-reply"]').textContent).toContain('Partial model words');
  expect(thread.messages).toHaveLength(4); expect(thread.attempts).toHaveLength(3);
  view.dispose();
});
