// A streaming answer re-renders only its own message: the cost of an update follows the new output, not the
// length of the conversation or how many threads this browser keeps.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renders = vi.hoisted(() => ({ messages: new Map<string, number>() }));

vi.mock('@reploid/poolday-ui', async (load) => {
  const actual = await load<typeof import('@reploid/poolday-ui')>();
  return {
    ...actual,
    MessageRow: (props: Parameters<typeof actual.MessageRow>[0]) => {
      const id = String(props.data?.['data-message-id'] ?? '');
      renders.messages.set(id, (renders.messages.get(id) ?? 0) + 1);
      return actual.MessageRow(props);
    },
  };
});

const { createDemoChat } = await import('../../../apps/poolday-react/src/app/demoChat');
const { createConversation } = await import('../../../apps/poolday-react/src/features/chat/infrastructure/conversation');
const { ChatWorkspace } = await import('../../../apps/poolday-react/src/features/chat/presentation/ChatWorkspace');
const { ConversationProvider } = await import('../../../apps/poolday-react/src/features/chat/presentation/ConversationProvider');

beforeEach(() => localStorage.clear());
afterEach(cleanup);

async function streamingRenders(threads: number) {
  // The answer stays running for the whole test, and grows by five deltas.
  const demo = createDemoChat({ answerDelayMs: 600000, threads });
  const create = () => createConversation({ host: { chat: demo.chat } });
  render(
    <ConversationProvider create={create}>
      <ChatWorkspace />
    </ConversationProvider>,
  );
  await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Tell me about tides{Enter}');
  const log = screen.getByRole('log', { name: 'Messages' });
  await waitFor(() => expect(log.querySelectorAll('article')).toHaveLength(2));
  const threadId = demo.chat.getState().selectedId as string;
  const [question, answer] = [...log.querySelectorAll('article')].map((node) => node.getAttribute('data-message-id') as string);
  renders.messages.clear();
  for (let step = 0; step < 5; step++) act(() => demo.chat.stream(threadId, ` part ${step}`));
  await waitFor(() => expect(within(log).getByText(/part 4/)).toBeTruthy());
  const result = { question: renders.messages.get(question as string) ?? 0, answer: renders.messages.get(answer as string) ?? 0 };
  cleanup();
  return result;
}

describe('transcript rendering', () => {
  it('re-renders only the streaming answer, the same with 2 or 30 threads', async () => {
    const few = await streamingRenders(2);
    const many = await streamingRenders(30);
    expect(few.question).toBe(0);
    expect(few.answer).toBeGreaterThan(0);
    expect(few.answer).toBeLessThanOrEqual(5);
    expect(many).toEqual(few);
  });
});
