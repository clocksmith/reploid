import { describe, it, expect } from 'vitest';
import { createConversationList } from '../../self/ui/pool-home/conversation-list.js';

describe('Conversation list', () => {
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
});
