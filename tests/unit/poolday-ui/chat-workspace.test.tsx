// The React conversation screen against an in-memory session that implements the host's port.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createDemoChat } from '../../../apps/poolday-react/src/app/demoChat';
import { ChatServicesContext } from '../../../apps/poolday-react/src/features/chat/presentation/chatServices';
import { ChatWorkspace } from '../../../apps/poolday-react/src/features/chat/presentation/ChatWorkspace';
import { projectMessages, projectThreads, relativeTime } from '../../../apps/poolday-react/src/features/chat/application/projections';

afterEach(cleanup);

function renderWorkspace(options: { searching?: boolean } = {}) {
  const services = createDemoChat({ answerDelayMs: 10, ...options });
  render(
    <ChatServicesContext.Provider value={services}>
      <ChatWorkspace />
    </ChatServicesContext.Provider>,
  );
  return services;
}

describe('ChatWorkspace', () => {
  it('sends a draft on this device, streams the answer and shows its receipt', async () => {
    const services = renderWorkspace();
    expect(screen.getByRole('button', { name: /Answer on · This device · Qwen 3.5 2B/ })).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Hello{Enter}');
    await waitFor(() => expect(screen.getByText('A synthetic answer to: Hello')).toBeTruthy());
    const log = screen.getByRole('log', { name: 'Messages' });
    expect(within(log).getByText('Hello')).toBeTruthy();
    expect(within(log).getByText('Receipt')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('');
    const state = services.chat.getState();
    expect(state.threads).toHaveLength(1);
    expect(state.activeThread?.permissions?.executionLocation).toBe('local');
  });

  it('moves the answer to contributors from the sheet, and the next thread runs there', async () => {
    const services = renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: /Answer on/ }));
    const sheet = document.querySelector('[data-model-picker]') as HTMLElement;
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Contributors' }));
    expect(within(sheet).getByText('The answering computer can read your prompt.')).toBeTruthy();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Answer with contributors' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Answer on · Contributors/ })).toBeTruthy());
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Hi{Enter}');
    await waitFor(() => expect(services.chat.getState().activeThread?.permissions?.executionLocation).toBe('network'));
  });

  it('shows a download size before approval, and only then downloads', async () => {
    const services = renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: /Answer on/ }));
    const sheet = document.querySelector('[data-model-picker]') as HTMLElement;
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Qwen 3.5 0.8B' }));
    expect(within(sheet).getByText('Not on this device yet. You see its size before it downloads.')).toBeTruthy();
    await userEvent.click(within(sheet).getByRole('button', { name: 'Download Qwen 3.5 0.8B' }));
    const review = document.querySelector('[data-download-review]') as HTMLElement;
    await waitFor(() => expect(within(review).getByText('0.64 GB')).toBeTruthy());
    expect(services.chat.getState().models!.find((model) => model.id === 'qwen-0-8b')?.localCached).toBeFalsy();
    await userEvent.click(within(review).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(services.chat.getState().models!.find((model) => model.id === 'qwen-0-8b')?.localCached).toBe(true));
    await waitFor(() => expect(screen.getByRole('button', { name: /Answer on · This device · Qwen 3.5 0.8B/ })).toBeTruthy());
  });

  it('keeps the chosen model, computer and privacy when a new thread starts', async () => {
    const services = renderWorkspace();
    await userEvent.click(screen.getByRole('button', { name: /Answer on/ }));
    const sheet = document.querySelector('[data-model-picker]') as HTMLElement;
    // Not the default model: the default would be Qwen 3.5 2B.
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Gemma 27B' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Answer with contributors' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Answer on · Contributors · Gemma 27B/ })).toBeTruthy());
    // From a fresh choice, before any thread exists.
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Answer on · Contributors · Gemma 27B/ })).toBeTruthy());
    // From a thread that ran on it.
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Hi{Enter}');
    await waitFor(() => expect(services.chat.getState().activeThread?.model.id).toBe('gemma-27b'));
    await waitFor(() => expect(screen.getByText('A synthetic answer to: Hi')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
    await waitFor(() => expect(services.chat.getState().selectedId).toBeNull());
    expect(screen.getByRole('button', { name: /Answer on · Contributors · Gemma 27B/ })).toBeTruthy();
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Again{Enter}');
    await waitFor(() => expect(services.chat.getState().threads).toHaveLength(2));
    expect(services.chat.getState().activeThread).toMatchObject({ model: { id: 'gemma-27b' }, permissions: { executionLocation: 'network' } });
  });

  it('queues Send while computers are found, sends when one arrives, and a draft edit cancels the wait', async () => {
    const services = renderWorkspace({ searching: true });
    await userEvent.click(screen.getByRole('button', { name: /Answer on/ }));
    const sheet = document.querySelector('[data-model-picker]') as HTMLElement;
    await userEvent.click(within(sheet).getByRole('radio', { name: 'Contributors' }));
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Answer on · Contributors/ })).toBeTruthy());
    expect(services.chat.getState().discoveryPhase).toBe('searching');
    await userEvent.type(screen.getByRole('textbox', { name: 'Message' }), 'Wait{Enter}');
    expect(services.chat.getState().threads).toHaveLength(0);
    expect(screen.getByText(/Waiting for a computer running Qwen 3.5 2B/)).toBeTruthy();
    act(() => services.controls.contributorsArrive());
    await waitFor(() => expect(services.chat.getState().threads).toHaveLength(1));
  });

  it('keeps one current thread and switches between threads from the threads sheet', async () => {
    const services = renderWorkspace();
    await act(async () => {
      const first = await services.chat.createThread({ model: services.chat.getState().models![0]!, executionLocation: 'local', sharingScope: 'local' });
      await services.chat.send(first, 'First');
      await services.chat.createThread({ model: services.chat.getState().models![0]!, executionLocation: 'local', sharingScope: 'local' });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Threads' }));
    const threads = document.querySelector('[data-threads-dialog]') as HTMLElement;
    expect(threads.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    await userEvent.click(within(threads).getByRole('button', { name: /First/ }));
    await waitFor(() => expect(services.chat.getState().selectedId).toBe('thread-1'));
  });
});

describe('chat projections', () => {
  it('words relative times and orders threads by recent activity', () => {
    expect(relativeTime(0, 30000)).toBe('now');
    expect(relativeTime(0, 5 * 60000)).toBe('5m');
    expect(relativeTime(0, 3 * 3600000)).toBe('3h');
    expect(relativeTime(0, 2 * 86400000)).toBe('2d');
    const services = createDemoChat();
    const state = services.chat.getState();
    const thread = (id: string, at: number) => ({ id, model: state.models![0]!, messages: [{ role: 'user' as const, content: id }], attempts: [{ id: `a-${id}`, status: 'completed', createdAt: at }] });
    const projected = projectThreads({ ...state, threads: [thread('old', 1), thread('new', 2)], selectedId: 'old' }, 'active', new Map(), 10, 'New thread');
    expect(projected.map((item) => [item.id, item.unread])).toEqual([['new', true], ['old', false]]);
  });

  it('collapses a retried failure and keeps a failure as a system note, never as model output', () => {
    const { decisions, chat } = createDemoChat();
    const model = chat.getState().models![0]!;
    const thread = {
      id: 't',
      model,
      messages: [
        { role: 'user' as const, content: 'Q' },
        { role: 'assistant' as const, content: '', attemptId: 'a1' },
        { role: 'assistant' as const, content: '', attemptId: 'a2' },
      ],
      attempts: [{ id: 'a1', status: 'failed' }, { id: 'a2', status: 'failed', retryOf: 'a1' }],
    };
    const messages = projectMessages(thread, chat.getState(), decisions);
    expect(messages.map((message) => message.id)).toEqual(['message-0', 'message-2']);
    expect(messages[1]).toMatchObject({ text: '', systemNote: 'This answer could not finish.' });
  });
});
