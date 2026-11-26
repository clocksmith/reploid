// The React Computers pane on a fixture host: what it states comes from the host's decisions, and each
// control calls the host command the vanilla pane called. No real network, pairing or model execution.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { projectComputers } from '../../apps/poolday/host/decisions/computers.js';
import { projectChatCatalog } from '../../apps/poolday/host/chat-view.js';
import { createComputersServices } from '../../apps/poolday-react/src/features/computers/infrastructure/hostComputers';
import { ComputersPanel, PairingLinkDialog } from '../../apps/poolday-react/src/features/computers/presentation/ComputersPanel';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const peer = (peerId: string, readiness: string, model = 'qwen-0-8b') => ({ peerId, model, readiness, availableSlots: 1 });

function fixtureHost(initial: Record<string, unknown> = {}) {
  let state: Record<string, unknown> = { models: [], network: { consumer: { connectionState: 'connected', peers: [] } }, ownerPairing: { status: 'idle' }, ...initial };
  const listeners = new Set<(value: unknown) => void>();
  const notify = () => listeners.forEach((listener) => listener(state));
  const chat = {
    getState: () => state,
    subscribe(listener: (value: unknown) => void) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    setComputeContribution: vi.fn(async () => undefined),
    setIntroductionAssistance: vi.fn(),
    ownerPairing: { state: () => ({ transportPath: 'relayed' }), pair: vi.fn(), unpair: vi.fn() },
  };
  return { host: { chat }, chat, set(next: Record<string, unknown>) { state = { ...state, ...next }; notify(); } };
}

const mount = (host: object, filter = null as null | { providerIds: string[]; label: string }, selectedModel = null as string | null) => {
  const services = createComputersServices({ host, earning: Promise.resolve(null) });
  render(
    <PooldayRoot>
      <ComputersPanel services={services} filter={filter} onClearFilter={() => undefined} />
    </PooldayRoot>,
  );
  return services;
};

describe('Computers decisions', () => {
  it('lists serving computers first, counts the ready ones and narrows to one model’s providers', () => {
    const state = { models: [], network: { consumer: { connectionState: 'connected', peers: [peer('peer-idle', 'unknown', ''), peer('peer-ready', 'ready')] } } };
    const view = projectComputers(state);
    expect(view.peers.map((row: { id: string }) => row.id)).toEqual(['peer-ready', 'peer-idle']);
    expect(view.readiness).toBe('1 computer ready');
    expect(view.connection.label).toBe('Discovery connected');
    const narrowed = projectComputers(state, { filter: { providerIds: ['peer-ready'], label: 'Qwen 3.5 0.8B' } });
    expect(narrowed.filterLabel).toBe('Computers for Qwen 3.5 0.8B');
    expect(narrowed.peers.map((row: { id: string }) => row.id)).toEqual(['peer-ready']);
    expect(projectComputers(state, { filter: { providerIds: [], label: 'X' } }).empty).toBe('No computer offers this model right now. Show all computers to choose another.');
  });
});

describe('Computers pane', () => {
  it('connects and disconnects discovery through the host and shows its state', async () => {
    const fixture = fixtureHost({ network: { consumer: { connectionState: 'disconnected', peers: [] } } });
    mount(fixture.host);
    const toggle = screen.getByRole('switch', { name: 'Public network' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Disconnected')).toBeTruthy();
    await userEvent.click(toggle);
    expect(fixture.chat.connect).toHaveBeenCalledOnce();
    act(() => fixture.set({ network: { consumer: { connectionState: 'connected', peers: [peer('peer-a', 'ready')] } } }));
    expect(screen.getByRole('switch', { name: 'Public network' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('1 computer ready')).toBeTruthy();
    await userEvent.click(screen.getByRole('switch', { name: 'Public network' }));
    expect(fixture.chat.disconnect).toHaveBeenCalledOnce();
  });

  it('turns compute contribution and peer introductions on through the host', async () => {
    const fixture = fixtureHost();
    mount(fixture.host);
    await userEvent.click(screen.getByText('Contribute this computer'));
    await userEvent.click(screen.getByRole('switch', { name: 'Answer requests' }));
    expect(fixture.chat.setComputeContribution).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('switch', { name: 'Help peers connect' }));
    expect(fixture.chat.setIntroductionAssistance).toHaveBeenCalledWith(true);
  });

  it('pairs a desktop from a pasted link and says to approve it there', async () => {
    const fixture = fixtureHost();
    let approve: (value: { hostLabel: string }) => void = () => undefined;
    fixture.chat.ownerPairing.pair.mockImplementation(() => new Promise((resolve) => (approve = resolve)));
    mount(fixture.host);
    await userEvent.click(screen.getByText('Connect a desktop'));
    const link = `https://replo.id/#${new URLSearchParams({ pair: 'B'.repeat(24), host: `peer:${'a'.repeat(24)}`, name: 'Studio' })}`;
    await userEvent.type(screen.getByLabelText('Pairing link'), link);
    await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(fixture.chat.ownerPairing.pair).toHaveBeenCalledWith(expect.objectContaining({ hostParticipantId: `peer:${'a'.repeat(24)}`, hostLabel: 'Studio' }));
    expect(screen.getByText('Approve on your desktop.')).toBeTruthy();
    await act(async () => approve({ hostLabel: 'Studio' }));
    expect(screen.getByText('Paired with Studio.')).toBeTruthy();
  });

  it('narrows the roster to the computers Answer on counted', () => {
    const fixture = fixtureHost({ network: { consumer: { connectionState: 'connected', peers: [peer('peer-a', 'ready'), peer('peer-b', 'ready')] } } });
    mount(fixture.host, { providerIds: ['peer-b'], label: 'Qwen 3.5 0.8B' });
    expect(screen.getByText('Computers for Qwen 3.5 0.8B')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show all computers' })).toBeTruthy();
    expect(document.querySelectorAll('[data-computer-id]').length).toBe(1);
  });
});

describe('the roster against the selected model', () => {
  // One computer per reason the catalog's admission can refuse it, plus two it admits.
  const IDENTITY = `sha256:${'a'.repeat(64)}`;
  const OTHER = `sha256:${'b'.repeat(64)}`;
  const provider = (peerId: string, change: Record<string, unknown> = {}) => ({ peerId, model: 'qwen-0-8b', modelIdentity: IDENTITY, readiness: 'ready', hasInference: true,
    availableSlots: 1, identityProtocol: 1, admissionProtocol: 2, attemptId: `try-${peerId}`, ...change });
  const peers = [
    provider('free'),
    provider('full', { availableSlots: 0 }),
    provider('silent-slots', { availableSlots: null }),
    provider('loading', { readiness: 'loading' }),
    provider('idle', { readiness: 'idle' }),
    provider('other-model', { model: 'gemma-27b' }),
    provider('requester-only', { model: undefined, modelIdentity: undefined, readiness: 'idle', hasInference: false }),
    provider('other-build', { modelIdentity: OTHER }),
    provider('old-version', { admissionProtocol: null }),
    provider('blocked', { blocked: true }),
    provider('silent', { unresponsive: true }),
    provider('no-channel'),
    provider('stale-attempt'),
  ];
  const link = (id: string, change: Record<string, unknown> = {}) => ({ id, phase: 'connected', channelState: 'open', iceState: 'connected', attemptId: `try-${id}`, ...change });
  const connections = [
    ...peers.filter((row) => !['no-channel', 'stale-attempt'].includes(row.peerId)).map((row) => link(row.peerId)),
    link('no-channel', { channelState: 'connecting' }),
    link('stale-attempt', { attemptId: 'try-earlier' }),
    link('mute'),
  ];
  const catalog = projectChatCatalog({ models: [{ id: 'qwen-0-8b', name: 'Qwen 0.8B', identity: IDENTITY }], peers, connections });
  const state = { models: catalog, network: { connections, consumer: { connectionState: 'connected', peers, connections } } };
  const EXPECTED: Record<string, [reachable: boolean, eligibility: string]> = {
    free: [true, 'eligible'],
    full: [true, 'busy'],
    'silent-slots': [true, 'capacity-unknown'],
    loading: [true, 'loading'],
    idle: [true, 'not-loaded'],
    'other-model': [true, 'other-model'],
    'requester-only': [true, 'no-model'],
    'other-build': [true, 'other-build'],
    'old-version': [true, 'protocol'],
    blocked: [true, 'blocked'],
    silent: [true, 'unresponsive'],
    'no-channel': [false, 'unreachable'],
    'stale-attempt': [false, 'unreachable'],
    mute: [true, 'no-advertisement'],
  };

  it('gives each computer the reason the catalog used, and agrees with the catalog on who is a provider', () => {
    const rows = projectComputers(state, { selected: 'qwen-0-8b' }).peers as Array<{ id: string; reachable: boolean; eligibility: string; selection: string[][] }>;
    expect(Object.fromEntries(rows.map((row) => [row.id, [row.reachable, row.eligibility]]))).toEqual(EXPECTED);
    const model = catalog[0] as { providerIds: string[]; reachableProviderIds: string[] };
    const fact = (row: { selection: string[][] }, term: string) => row.selection.find(([name]) => name === term)?.[1];
    // "Ready for" is the catalog's provider list; no "Why not used" line is the list Send picks from.
    expect(rows.filter((row) => fact(row, 'Ready for Qwen 0.8B') === 'Yes').map((row) => row.id).sort()).toEqual([...model.providerIds].sort());
    expect(rows.filter((row) => fact(row, 'Why not used') === undefined).map((row) => row.id)).toEqual(model.reachableProviderIds);
    expect(model.providerIds.sort()).toEqual(['free', 'full', 'silent-slots']);
    expect(rows.every((row) => row.eligibility === 'eligible' || !!fact(row, 'Why not used'))).toBe(true);
  });

  it('states only reachability when no whole model is selected', () => {
    const rows = projectComputers(state, {}).peers as Array<{ id: string; eligibility: string; selection: string[][] }>;
    expect(rows.every((row) => row.eligibility === '' && row.selection.length === 1 && row.selection[0]?.[0] === 'Reachable')).toBe(true);
  });

  it('shows the three answers in each row and follows the selection', async () => {
    const fixture = fixtureHost(state);
    const services = createComputersServices({ host: fixture.host, earning: Promise.resolve(null) });
    const panel = (selectedModel: string | null) => (
      <PooldayRoot>
        <ComputersPanel services={services} filter={null} selectedModel={selectedModel} onClearFilter={() => undefined} />
      </PooldayRoot>
    );
    const view = render(panel('qwen-0-8b'));
    const row = (id: string) => document.querySelector(`[data-computer-id="${id}"]`) as HTMLElement;
    expect(row('free').dataset.computerEligibility).toBe('eligible');
    expect(within(row('free')).getByText('Ready for Qwen 0.8B')).toBeTruthy();
    expect(within(row('free')).queryByText('Why not used')).toBeNull();
    // Computers that are not serving stay folded under "Show others", as before; their reasons are in those rows.
    await userEvent.click(document.querySelector('[data-quiet-computers]') as HTMLElement);
    expect(row('full').dataset.computerReachable).toBe('true');
    expect(within(row('full')).getByText('Busy: every request slot is in use')).toBeTruthy();
    expect(within(row('old-version')).getByText('Runs a version this page cannot send requests to')).toBeTruthy();
    expect(row('no-channel').dataset.computerReachable).toBe('false');
    expect(within(row('no-channel')).getByText('No open connection from this page')).toBeTruthy();
    view.rerender(panel(null));
    expect(row('full').dataset.computerEligibility).toBe('');
    expect(within(row('full')).queryByText('Why not used')).toBeNull();
  });
});

describe('pairing link', () => {
  const open = (pair: (target: { signal?: AbortSignal }) => Promise<{ hostLabel: string }>) => {
    window.history.replaceState(null, '', `/#${new URLSearchParams({ pair: 'B'.repeat(24), host: `peer:${'a'.repeat(24)}`, name: 'Studio' })}`);
    const fixture = fixtureHost();
    fixture.chat.ownerPairing.pair.mockImplementation(pair);
    const services = createComputersServices({ host: fixture.host, earning: Promise.resolve(null) });
    render(
      <PooldayRoot>
        <PairingLinkDialog services={services} />
      </PooldayRoot>,
    );
  };

  it('offers one action, waits for approval, then reports the result and forgets the link', async () => {
    let approve: (value: { hostLabel: string }) => void = () => undefined;
    open(() => new Promise((resolve) => (approve = resolve)));
    const dialog = document.querySelector('[data-owner-pairing-link]') as HTMLElement;
    expect(within(dialog).getByRole('heading').textContent).toBe('Connect to Studio');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    expect(within(dialog).getByRole('heading').textContent).toBe('Approve on your desktop');
    expect((within(dialog).getByRole('button', { name: 'Waiting for approval…' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => approve({ hostLabel: 'Studio' }));
    expect(within(dialog).getByRole('heading').textContent).toBe('Paired with Studio');
    expect(within(dialog).getByText('Connection: relayed')).toBeTruthy();
    expect(window.location.hash).toBe('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(document.querySelector('[data-owner-pairing-link]')).toBeNull();
  });

  it('says what to do when the link fails, and cancelling aborts the request', async () => {
    let fail: (cause: Error) => void = () => undefined;
    let signal: AbortSignal | undefined;
    open((target) => {
      signal = target.signal;
      return new Promise((_, reject) => (fail = reject));
    });
    const dialog = document.querySelector('[data-owner-pairing-link]') as HTMLElement;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect' }));
    await act(async () => fail(new Error('Pairing code expired.')));
    expect(within(dialog).getByRole('heading').textContent).toBe('Couldn’t connect');
    expect(within(dialog).getByText('Open a new pairing link from your desktop.')).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(document.querySelector('[data-owner-pairing-link]')).toBeNull();

    cleanup();
    open((target) => {
      signal = target.signal;
      return new Promise(() => undefined);
    });
    const next = document.querySelector('[data-owner-pairing-link]') as HTMLElement;
    await userEvent.click(within(next).getByRole('button', { name: 'Connect' }));
    await userEvent.click(within(next).getByRole('button', { name: 'Close' }));
    expect(document.querySelector('[data-owner-pairing-link]')).toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});
