// The shipped conversation screens (ChatWorkspace and the Threads drawer) on the host's conversation controller
// over an in-memory session with the host session's shape: what a person does, and what the screens then show.
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoChat } from '../../../apps/poolday-react/src/app/demoChat';
import { createConversation } from '../../../apps/poolday-react/src/features/chat/infrastructure/conversation';
import { ChatWorkspace } from '../../../apps/poolday-react/src/features/chat/presentation/ChatWorkspace';
import { ConversationProvider } from '../../../apps/poolday-react/src/features/chat/presentation/ConversationProvider';
import { ThreadsPanel } from '../../../apps/poolday-react/src/features/chat/presentation/ThreadsPanel';

beforeEach(() => localStorage.clear());
afterEach(cleanup);

function mount(options: Parameters<typeof createDemoChat>[0] = {}) {
  const demo = createDemoChat({ answerDelayMs: 5, ...options });
  const create = () => createConversation({ host: { chat: demo.chat } });
  render(
    <ConversationProvider create={create}>
      <ChatWorkspace />
      <ThreadsPanel onDone={() => undefined} />
    </ConversationProvider>,
  );
  return demo;
}

const composer = () => screen.getByRole('textbox', { name: 'Message' });
const answerOn = () => screen.getByRole('button', { name: /^Answer on/ });
const sheet = () => document.querySelector('[data-model-picker]') as HTMLElement;
const transcript = () => screen.getByRole('log', { name: 'Messages' });

async function openSheet() {
  await userEvent.click(answerOn());
  await waitFor(() => expect(sheet().hasAttribute('open')).toBe(true));
  return sheet();
}

async function closeSheet() {
  await userEvent.click(within(sheet()).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(sheet().hasAttribute('open')).toBe(false));
}

async function chooseContributors() {
  const picker = await openSheet();
  await userEvent.click(within(picker).getByRole('radio', { name: 'Contributors' }));
  await waitFor(() => expect((within(sheet()).getByRole('radio', { name: 'Contributors' }) as HTMLInputElement).checked).toBe(true));
  await closeSheet();
}

async function send(text: string) {
  await userEvent.type(composer(), `${text}{Enter}`);
}

describe('ChatWorkspace', () => {
  it('sends a draft on this device and shows the answer with its measurements', async () => {
    mount();
    await waitFor(() => expect(answerOn().getAttribute('aria-label')).toBe('Answer on This device · Qwen 3.5 2B, Ready'));
    expect(document.querySelector('[data-prompt-disclosure]')?.textContent).toBe('Nothing leaves this device.');
    await send('Explain ocean tides.');
    await waitFor(() => expect(within(transcript()).getByText('A synthetic answer to: Explain ocean tides.')).toBeTruthy());
    expect(within(transcript()).getByLabelText('Your message').textContent).toBe('Explain ocean tides.');
    expect(within(transcript()).getByLabelText('Generation time including prompt processing')).toBeTruthy();
    expect((composer() as HTMLTextAreaElement).value).toBe('');
  });

  it('moves the answer to contributors from Answer on, and says who can read the prompt', async () => {
    mount();
    await chooseContributors();
    expect(document.querySelector('[data-composer-model-source]')?.textContent).toBe('Contributors');
    expect(document.querySelector('[data-prompt-disclosure]')?.textContent).toBe('The answering computer can read your prompt.');
    await send('Pick 3 light comedies.');
    await waitFor(() => expect(within(transcript()).getByText('A synthetic answer to: Pick 3 light comedies.')).toBeTruthy());
  });

  it('reviews a download: its size is shown before anything downloads', async () => {
    const demo = mount();
    const picker = await openSheet();
    await userEvent.click(within(picker).getByRole('radio', { name: 'Qwen 3.5 0.8B' }));
    const primary = within(sheet()).getByRole('button', { name: 'Download Qwen 3.5 0.8B' });
    await userEvent.click(primary);
    const dialog = document.querySelector('[data-model-dialog]') as HTMLElement;
    await waitFor(() => expect(dialog.querySelector('[data-download-size]')?.textContent).toBe('640 MB download'));
    expect(demo.chat.getState().models.find((model) => model.id === 'qwen-0-8b')?.localCached).toBeFalsy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download model' }));
    await waitFor(() => expect(demo.chat.getState().models.find((model) => model.id === 'qwen-0-8b')?.localCached).toBe(true));
  });

  it('keeps the chosen model and computer when a new thread starts', async () => {
    mount();
    const picker = await openSheet();
    await userEvent.click(within(picker).getByRole('radio', { name: 'Contributors' }));
    await userEvent.click(within(sheet()).getByRole('radio', { name: 'Gemma 27B' }));
    await waitFor(() => expect(sheet().hasAttribute('open')).toBe(false));
    expect(document.querySelector('[data-composer-model-name]')?.textContent).toBe('Gemma 27B');
    await send('First question');
    await waitFor(() => expect(within(transcript()).getByText('A synthetic answer to: First question')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
    await waitFor(() => expect(within(transcript()).queryByText('A synthetic answer to: First question')).toBeNull());
    expect(document.querySelector('[data-composer-model-name]')?.textContent).toBe('Gemma 27B');
    expect(document.querySelector('[data-composer-model-source]')?.textContent).toBe('Contributors');
  });

  it('queues a first Send while computers are found, asks nothing, and sends when one arrives', async () => {
    const demo = mount({ searching: true, stored: false });
    await userEvent.type(composer(), 'Explain ocean tides.');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    // Type and send is the whole journey (docs/first-visit-journeys.md): no sheet asks where this should run.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy());
    expect(sheet().hasAttribute('open')).toBe(false);
    expect(document.querySelector('[data-model-status]')?.textContent).toContain('Finding computers');
    act(() => demo.contributorsArrive());
    await waitFor(() => expect(within(transcript()).getByText('A synthetic answer to: Explain ocean tides.')).toBeTruthy());
  });

  it('keeps each thread\'s draft when switching between threads', async () => {
    mount();
    await send('Thread one');
    await waitFor(() => expect(within(transcript()).getByText('A synthetic answer to: Thread one')).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'New thread' }));
    await send('Thread two');
    await waitFor(() => expect(within(transcript()).getByText('A synthetic answer to: Thread two')).toBeTruthy());
    await userEvent.type(composer(), 'Unsent follow-up');
    const list = document.querySelector('[data-thread-list]') as HTMLElement;
    await userEvent.click(within(list).getByRole('button', { name: /^Thread one/ }));
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toBe(''));
    expect(list.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
    await userEvent.click(within(list).getByRole('button', { name: /^Thread two/ }));
    await waitFor(() => expect((composer() as HTMLTextAreaElement).value).toBe('Unsent follow-up'));
  });

  it('renames and archives a thread from its menu', async () => {
    mount();
    await send('Plan a trip');
    await waitFor(() => expect(within(transcript()).getByText('A synthetic answer to: Plan a trip')).toBeTruthy());
    const list = document.querySelector('[data-thread-list]') as HTMLElement;
    const menu = list.querySelector('details') as HTMLDetailsElement;
    menu.open = true;
    await userEvent.click(within(menu).getByRole('button', { name: 'Rename' }));
    const dialog = document.querySelector('[data-rename-dialog]') as HTMLElement;
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    await userEvent.clear(name);
    await userEvent.type(name, 'Lisbon weekend');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(within(list).getByRole('button', { name: /^Lisbon weekend/ })).toBeTruthy());
    (list.querySelector('details') as HTMLDetailsElement).open = true;
    await userEvent.click(within(list).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.getByText('No threads yet.')).toBeTruthy());
    await userEvent.click(screen.getByRole('radio', { name: 'Archived' }));
    expect(within(list).getByRole('button', { name: /^Lisbon weekend/ })).toBeTruthy();
  });
});
