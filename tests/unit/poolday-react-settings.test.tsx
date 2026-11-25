// Settings and Conversation details on the React shell: the host's own wording through
// apps/poolday/host/decisions, and the screens' effects through their ports. No host runs here.
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { SettingsPanel } from '../../apps/poolday-react/src/features/settings/presentation/SettingsPanel';
import type { AppearancePort, SettingsServices, SettingsSnapshot, Store } from '../../apps/poolday-react/src/features/settings/domain/services';
import { ConversationDetailsPanel } from '../../apps/poolday-react/src/features/details/presentation/ConversationDetailsPanel';
import { createDetailsServices } from '../../apps/poolday-react/src/features/details/infrastructure/hostDetails';
import { createSettingsServices } from '../../apps/poolday-react/src/features/settings/infrastructure/hostSettings';
import {
  fileSharingRequest, projectCreditAccount, projectFileSharing, projectRoutePreference, projectSignIn, projectWebSearch, remoteAnswersText,
} from '../../apps/poolday/host/decisions/settings.js';
import { projectConversationDetails } from '../../apps/poolday/host/decisions/conversation-details.js';

afterEach(cleanup);

const fixed = <T,>(value: T): Store<T> => ({ getState: () => value, subscribe: () => () => undefined });

function appearanceStore(): AppearancePort & { choice: string } {
  const port = { choice: 'system' as 'system' | 'light' | 'dark', getChoice: () => port.choice, setChoice: vi.fn((next: 'system' | 'light' | 'dark') => { port.choice = next; listeners.forEach((listener) => listener()); }),
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const listeners = new Set<() => void>();
  return port;
}

function services(overrides: Partial<SettingsServices> = {}, snapshot: Partial<SettingsSnapshot> = {}): SettingsServices {
  return {
    snapshot: fixed<SettingsSnapshot>({
      routePreference: projectRoutePreference({ remoteAnswersEnabled: false }, { setRoutePreference() {}, getRoutePreference: () => 'balanced' }),
      storageSummary: 'No downloaded models',
      remoteAnswers: { enabled: false, status: remoteAnswersText({ remoteAnswersEnabled: false }) },
      fileSharing: (selection) => projectFileSharing({ models: [{ id: 'a', name: 'Model A' }], network: {} }, selection),
      ...snapshot,
    }),
    setRoutePreference: vi.fn(),
    setRemoteAnswersEnabled: vi.fn(async () => undefined),
    toggleFileSharing: vi.fn(async () => undefined),
    storage: null,
    localData: null,
    creditAccount: Promise.resolve(null),
    webSearch: null,
    apps: [{ id: 'improve', href: '/improve' }, { id: 'examples', href: '/examples' }, { id: 'experiments', href: '/experiments' }],
    changesAwaiting: fixed(0),
    ...overrides,
  };
}

const renderPanel = (svc: SettingsServices, appearance = appearanceStore()) =>
  render(<PooldayRoot><SettingsPanel services={svc} appearance={appearance} /></PooldayRoot>);

describe('Settings decisions keep the vanilla wording', () => {
  it('says why the answer preference is off and offers Network answers', () => {
    const off = projectRoutePreference({ remoteAnswersEnabled: false }, { setRoutePreference() {}, getRoutePreference: () => 'faster' });
    expect(off.reason).toBe('Network answers are off, so only one computer can answer.');
    expect(off.fix?.label).toBe('Network answers');
    expect(off.options.every((option: { disabled: boolean }) => option.disabled)).toBe(true);
    expect(off.options.find((option: { checked: boolean }) => option.checked)?.value).toBe('faster');
    const fixedPage = projectRoutePreference({ remoteAnswersEnabled: true }, {});
    expect(fixedPage.reason).toBe('This page answers on one computer, so there is nothing to order.');
  });

  it('projects file sharing, fixes its mode while sharing and builds the request', () => {
    const state = { models: [{ id: 'a', name: 'A', localCached: true }, { id: 'b', name: 'B' }], network: { files: { sharing: true, limits: { storedBytes: 2 ** 31, supplyBytes: 2 ** 32 } } } };
    const view = projectFileSharing(state, { modelId: 'b', mode: 'bounded-acquisition', allowance: '64' });
    expect(view.status).toBe('Sharing');
    expect(view.modelId).toBe('b');
    expect(view.modelDisabled).toBe(true);
    expect(view.modes.every((mode: { disabled: boolean }) => mode.disabled)).toBe(true);
    expect(view.limits).toBe('Store up to 2 GiB · Send up to 4 GiB');
    expect(fileSharingRequest({ network: {} }, { modelId: 'a', mode: 'bounded-acquisition', allowance: '64' }))
      .toMatchObject({ enable: true, cachedOnly: false, modelId: 'a', controls: { mode: 'bounded-acquisition', downloadBytes: 64 * 1048576 } });
    expect(fileSharingRequest({ network: { files: { enabled: true } } }, { modelId: 'a', mode: 'cached-only', allowance: null }).enable).toBe(false);
  });

  it('words credits, sign-in and web search as the vanilla panels do', () => {
    const account = projectCreditAccount({ phase: 'ready', balance: { available: 1200, held: 30 }, topUps: [{ topUpId: 't1', price: { amountMinor: 500, currency: 'USD' } }],
      journal: [{ type: 'charge', amount: 12, at: '2026-11-25T10:00:00.000Z' }], spendingLimit: null, lastQuote: { maxCharge: 40, accepted: false } });
    expect(account.balance).toBe('Balance: 1,200 credits · 30 held for answers in progress');
    expect(account.topUps).toEqual([{ id: 't1', label: 'Top up 5.00 USD' }]);
    expect(account.quote).toBe('Last quote: up to 40 credits. Not sent: no spending limit is set.');
    expect(account.journal[0].text).toMatch(/^Charged for an answer −12 credits · /);
    expect(projectSignIn({ phase: 'signed_in', email: 'a@example.test' }).summary).toBe('Signed in as a@example.test.');
    expect(projectSignIn({ phase: 'unavailable' }).formShown).toBe(false);
    const search = projectWebSearch({ enabled: false, url: '', tool: '', hasToken: false, status: {} }, null);
    expect(search).toMatchObject({ disabled: true, reason: 'No search service is available. Add a search server to turn this on.', fix: 'Add server' });
  });
});

describe('Settings drawer', () => {
  it('applies appearance at once and keeps the stable theme hooks', async () => {
    const appearance = appearanceStore();
    const { container } = renderPanel(services(), appearance);
    await userEvent.click(within(container.querySelector('[data-pool-theme-choice=dark]') as HTMLElement).getByRole('radio'));
    expect(appearance.setChoice).toHaveBeenCalledWith('dark');
    expect((container.querySelector('[data-pool-theme-choice=dark] input') as HTMLInputElement).checked).toBe(true);
  });

  it('opens Advanced from the answer preference fix, where Network answers is', async () => {
    const svc = services();
    const { container } = renderPanel(svc);
    const advanced = container.querySelector('[data-settings-advanced]') as HTMLDetailsElement;
    expect(advanced.open).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Network answers' }));
    expect((container.querySelector('[data-settings-advanced]') as HTMLDetailsElement).open).toBe(true);
    await userEvent.click(screen.getByRole('switch', { name: 'Allow network answers' }));
    expect(svc.setRemoteAnswersEnabled).toHaveBeenCalledWith(true);
  });

  it('measures stored downloads and removes one only after confirmation', async () => {
    const rows = [{ id: 'm1', name: 'Model one', label: 'Model one · 1.5 MiB' }];
    const storage = { list: vi.fn(async () => [...rows]), remove: vi.fn(async (id: string) => { rows.splice(rows.findIndex((row) => row.id === id), 1); }) };
    const { container } = renderPanel(services({ storage }));
    expect(await screen.findByText('Model one · 1.5 MiB')).toBeTruthy();
    expect(container.querySelector('[data-storage-status]')?.textContent).toBe('Measured stored files, including partial downloads. Shared files may count toward more than one model.');
    await userEvent.click(screen.getByRole('button', { name: /^Remove .+ download$/ }));
    expect(storage.remove).not.toHaveBeenCalled();
    const dialog = container.querySelector('[data-storage-dialog]') as HTMLDialogElement;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove download' }));
    expect(storage.remove).toHaveBeenCalledWith('m1');
    await vi.waitFor(() => expect(container.querySelector('[data-storage-status]')?.textContent).toBe('No model downloads stored. Choose a model in Answer on to download one.'));
  });

  it('imports data only after showing what it adds', async () => {
    const apply = vi.fn(() => 'Imported 2 conversations, 0 computer names and 0 blocked computers.');
    const localData = { exportFile: vi.fn(() => 'Exported 3 conversations.'), plan: vi.fn(async () => ({ summary: 'Adds 2 conversations.', empty: false, apply })) };
    const { container } = renderPanel(services({ localData }));
    await userEvent.click(screen.getByRole('button', { name: /Export my data/ }));
    expect(container.querySelector('[data-data-status]')?.textContent).toBe('Exported 3 conversations.');
    const input = container.querySelector('[data-data-file]') as HTMLInputElement;
    await userEvent.upload(input, new File(['{}'], 'export.json', { type: 'application/json' }));
    await vi.waitFor(() => expect(container.querySelector('[data-data-summary]')?.textContent).toBe('Adds 2 conversations.'));
    expect(apply).not.toHaveBeenCalled();
    await userEvent.click(within(container.querySelector('[data-data-dialog]') as HTMLElement).getByRole('button', { name: 'Import' }));
    expect(container.querySelector('[data-data-status]')?.textContent).toBe('Imported 2 conversations, 0 computer names and 0 blocked computers.');
  });

  it('links Changes, Examples and Experiments, and says how many changes await review', () => {
    const { container, unmount } = renderPanel(services({ changesAwaiting: fixed(2) }));
    const changes = container.querySelector('[data-pool-changes]') as HTMLAnchorElement;
    expect(changes.getAttribute('aria-label')).toBe('Changes: 2 awaiting review');
    expect(changes.textContent).toContain('2');
    expect([...container.querySelectorAll('[data-pool-nav-id]')].map((link) => link.getAttribute('href'))).toEqual(['/improve', '/examples', '/experiments']);
    unmount();
    const { container: none } = renderPanel(services({ changesAwaiting: fixed(0) }));
    expect((none.querySelector('[data-pool-changes]') as HTMLElement).getAttribute('aria-label')).toBeNull();
  });

  it('adapts a host with only a chat session', () => {
    const chat = { getState: () => ({ remoteAnswersEnabled: true, models: [] }), subscribe: () => () => undefined };
    const svc = createSettingsServices({ host: { chat } });
    expect(svc.storage).toBeNull();
    expect(svc.webSearch).toBeNull();
    expect(svc.snapshot.getState().storageSummary).toBe('No downloaded models');
    expect(svc.apps.map((app) => app.id)).toEqual(['improve', 'examples', 'experiments']);
  });
});

const completedThread = () => {
  const attempt = (id: string, prompt: number, output: number, totalMs: number) => ({ id, status: 'completed', createdAt: 1000, finishedAt: 1000 + totalMs,
    execution: { placement: 'local-webgpu', requesterId: 'me', completion: { promptTokenCount: prompt, generatedTokenCount: output },
      timing: { generatedTokenCount: output, totalMs, firstTokenMs: 250 } } });
  return { id: 't1', model: { id: 'm', name: 'Model', identity: 'sha256:x' }, messages: [{ id: 'u', role: 'user', content: 'Hi' }],
    attempts: [attempt('a1', 256, 768, 21700), attempt('a2', 45, 123, 3000)], grants: [] };
};

describe('Conversation details', () => {
  it('stays bound to a selected answer while later answers arrive', () => {
    const thread = completedThread();
    const state = { selectedId: 't1', activeThread: thread, threads: [thread], models: [{ id: 'm', identity: 'sha256:x', contextLength: 4096 }] };
    const last = projectConversationDetails(state, { inspected: null });
    expect(last.contextDetail).toContain('Last answer used 168 tokens');
    const selected = projectConversationDetails(state, { inspected: { threadId: 't1', attemptId: 'a1' } });
    expect(selected.contextDetail).toContain('Selected answer used 1,024 tokens');
    expect(selected.activity?.facts).toContainEqual(['First token', '0.25 s']);
    expect(selected.activity?.facts).toContainEqual(['Output tokens', '768']);
  });

  it('renders the inspected answer, its context and its download', async () => {
    const thread = { ...completedThread(), grants: [{ id: 'g1', revokedAt: null, recipient: 'peer' }] };
    let state: Record<string, unknown> = { selectedId: 't1', activeThread: thread, threads: [thread], models: [] };
    const listeners = new Set<(next: unknown) => void>();
    const chat = {
      getState: () => state,
      subscribe: (listener: (next: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
      previewContextPrompt: () => ({ content: 'You are Reploid.', metadata: { enabled: true, maxWords: 16, wordCount: 3 } }),
      setContextPrompt: vi.fn(),
      revokeGrant: vi.fn(),
      exportConversation: vi.fn(() => '# Conversation'),
    };
    const svc = createDetailsServices({ host: { chat } });
    const { container, rerender } = render(<PooldayRoot><ConversationDetailsPanel services={svc} attemptId="a1" /></PooldayRoot>);
    expect(container.querySelector('[data-inspected-activity]')?.textContent).toContain('First token0.25 s');
    expect(container.querySelector('[data-inspector-status]')?.textContent).toBe('Complete');
    expect(container.querySelector('[data-context-count]')?.textContent).toBe('3/16 context words. Replies are not limited by this setting.');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(chat.revokeGrant).toHaveBeenCalledWith('t1', 'g1');
    await userEvent.click(screen.getByRole('switch', { name: 'Include app context' }));
    expect(chat.setContextPrompt).toHaveBeenCalledWith('t1', { enabled: false, maxWords: 16 });
    state = { ...state, activeThread: { ...thread, attempts: [...thread.attempts, { id: 'a3', status: 'executing', createdAt: 5000 }] } };
    listeners.forEach((listener) => listener(state));
    rerender(<PooldayRoot><ConversationDetailsPanel services={svc} attemptId="a1" /></PooldayRoot>);
    expect(container.querySelector('[data-inspected-activity]')?.textContent).toContain('768');
    expect(screen.getByRole('button', { name: 'Download conversation' })).toBeTruthy();
  });
});
