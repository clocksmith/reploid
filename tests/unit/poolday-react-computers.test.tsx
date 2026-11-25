// The React Computers pane on a fixture host: what it states comes from the host's decisions, and each
// control calls the host command the vanilla pane called. No real network, pairing or model execution.
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { projectComputers } from '../../apps/poolday/host/decisions/computers.js';
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

const mount = (host: object, filter = null as null | { providerIds: string[]; label: string }) => {
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
