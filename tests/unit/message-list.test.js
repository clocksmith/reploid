import { describe, it, expect } from 'vitest';
import { createMessageList } from '../../self/ui/pool-home/message-list.js';

function conversation() {
  return { id: 'one', messages: [
    { id: 'question', role: 'user', content: 'Question' },
    { id: 'reply', role: 'assistant', content: 'First words', attemptId: 'attempt' }
  ], attempts: [{ id: 'attempt', status: 'executing' }] };
}

describe('Stable message presentation', () => {
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
});
