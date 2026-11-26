// What the React product's infrastructure holds on to, and when it lets go: each feature's services attach to the
// host on their first subscriber and detach on their last; closing a host removes what the page lifecycle added.
import { cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { mountPoolday } from '../../../apps/poolday-react/src/main-app';
import { createDemoChat } from '../../../apps/poolday-react/src/app/demoChat';
import { createComputersServices } from '../../../apps/poolday-react/src/features/computers/infrastructure/hostComputers';
import { createDetailsServices } from '../../../apps/poolday-react/src/features/details/infrastructure/hostDetails';
import { createSettingsServices } from '../../../apps/poolday-react/src/features/settings/infrastructure/hostSettings';
import { createAppearanceStore } from '../../../apps/poolday-react/src/features/shell/infrastructure/appearance';
import { adoptHost } from '../../../apps/poolday-react/src/features/shell/infrastructure/productHost';

type Listener = (state: unknown) => void;

/** A chat session that counts who listens to it. */
function countedSession(chat: { getState: () => unknown; subscribe: (listener: Listener) => () => void } & Record<string, unknown>) {
  const listeners = new Set<Listener>();
  const session = Object.create(chat) as typeof chat;
  session.subscribe = (listener: Listener) => {
    listeners.add(listener);
    const off = chat.subscribe(listener);
    return () => {
      listeners.delete(listener);
      off();
    };
  };
  return { session, listeners };
}

/** A `prefers-color-scheme` query whose listeners are counted and whose answer can change. */
function stubColorScheme(light = true) {
  const listeners = new Set<() => void>();
  const media = {
    matches: light,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal('matchMedia', () => media);
  return {
    listeners,
    set(next: boolean) {
      media.matches = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('attaches the Computers services to the session on the first subscriber and detaches on the last', () => {
  const { session, listeners } = countedSession(createDemoChat().chat as never);
  const services = createComputersServices({ host: { chat: session }, earning: Promise.resolve(null) });
  expect(listeners.size).toBe(0);
  const first = services.subscribe(() => undefined);
  const second = services.subscribe(() => undefined);
  expect(listeners.size).toBe(1);
  expect(services.getView()).toBe(services.getView());
  first();
  expect(listeners.size).toBe(1);
  second();
  expect(listeners.size).toBe(0);
});

it('attaches Conversation details to the session on the first subscriber and detaches on the last', () => {
  const { session, listeners } = countedSession(createDemoChat().chat as never);
  const services = createDetailsServices({ host: { chat: session } });
  const off = services.subscribe(() => undefined);
  expect(listeners.size).toBe(1);
  expect(services.project(null)).toBe(services.project(null));
  off();
  expect(listeners.size).toBe(0);
});

it('attaches the Settings snapshot to the session on the first subscriber and detaches on the last', () => {
  const { session, listeners } = countedSession(createDemoChat().chat as never);
  const services = createSettingsServices({ host: { chat: session } });
  const seen = vi.fn();
  const off = services.snapshot.subscribe(seen);
  expect(listeners.size).toBe(1);
  expect(services.snapshot.getState()).toBe(services.snapshot.getState());
  off();
  expect(listeners.size).toBe(0);
});

it('follows the system colour scheme while the choice is System', () => {
  const scheme = stubColorScheme(true);
  const store = createAppearanceStore(null);
  const seen = vi.fn();
  const off = store.subscribe(seen);
  expect(store.getTheme()).toBe('light');
  scheme.set(false);
  expect(store.getTheme()).toBe('dark');
  expect(seen).toHaveBeenCalledTimes(1);
  store.setChoice('light');
  scheme.set(false);
  expect(store.getTheme()).toBe('light');
  off();
});

it('removes the page lifecycle listeners and the operations global when the host closes', async () => {
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  const host = { close: vi.fn(async () => undefined), connectOperations: vi.fn() };
  const opened = adoptHost(host);
  const globals = window as unknown as Record<string, unknown>;
  expect(typeof globals.REPLOID_POOL_CONNECT_OPERATIONS).toBe('function');
  await opened.close();
  expect(globals.REPLOID_POOL_CONNECT_OPERATIONS).toBeUndefined();
  const types = (spy: typeof added) => spy.mock.calls.map(([type]) => type).filter((type) => type === 'pagehide' || type === 'pageshow').sort();
  expect(types(removed)).toEqual(types(added));
  expect(host.close).toHaveBeenCalledTimes(1);
  added.mockRestore();
  removed.mockRestore();
});

it('lets go of the session, the window and the colour scheme when the workspace unmounts', async () => {
  const scheme = stubColorScheme(true);
  const { session, listeners } = countedSession(createDemoChat().chat as never);
  const added = vi.spyOn(window, 'addEventListener');
  const removed = vi.spyOn(window, 'removeEventListener');
  const host = { chat: session, close: vi.fn(async () => undefined), historyHandover: null };
  const root = document.body.appendChild(document.createElement('div'));
  const unmount = mountPoolday(root, { host });
  await waitFor(() => expect(root.querySelector('[data-chat-workspace]')).not.toBeNull());
  for (const view of ['computers', 'settings', 'conversation']) {
    await userEvent.click(root.querySelector(`[data-workspace-view="${view}"]`) as HTMLElement);
  }
  await waitFor(() => expect(root.querySelector('[data-inspector-pane="settings"]')?.childElementCount).toBeGreaterThan(0));
  expect(listeners.size).toBeGreaterThan(0);
  expect(scheme.listeners.size).toBe(1);
  unmount();
  await waitFor(() => expect(host.close).toHaveBeenCalledTimes(1));
  expect(listeners.size).toBe(0);
  expect(scheme.listeners.size).toBe(0);
  const count = (spy: typeof added) => {
    const counts = new Map<string, number>();
    for (const [type] of spy.mock.calls) counts.set(type, (counts.get(type) ?? 0) + 1);
    return counts;
  };
  const left = [...count(added)].filter(([type, times]) => times > (count(removed).get(type) ?? 0)).map(([type]) => type);
  // React attaches its own delegated listeners to the root, not the window; anything left on the window is ours.
  expect(left).toEqual([]);
  const globals = window as unknown as Record<string, unknown>;
  expect(Object.keys(globals).filter((key) => key.startsWith('REPLOID_POOL_'))).toEqual([]);
  root.remove();
  added.mockRestore();
  removed.mockRestore();
});

it('disposes the Computers, details and Settings services while they are still subscribed', () => {
  const { session, listeners } = countedSession(createDemoChat().chat as never);
  const product = { host: { chat: session }, earning: Promise.resolve(null) };
  const computers = createComputersServices(product);
  const details = createDetailsServices(product);
  const settings = createSettingsServices(product);
  computers.subscribe(() => undefined);
  details.subscribe(() => undefined);
  settings.snapshot.subscribe(() => undefined);
  expect(listeners.size).toBe(3);
  computers.dispose();
  details.dispose();
  settings.dispose();
  expect(listeners.size).toBe(0);
  computers.subscribe(() => undefined);
  expect(listeners.size).toBe(0);
});

it('aborts the download-size reads the Computers services started when they are disposed', async () => {
  const signals: AbortSignal[] = [];
  const model = { id: 'm', name: 'Model', provider: 'doppler', source: { baseUrl: 'https://models.example/m/' } };
  const session = {
    getState: () => ({ models: [model], network: {} }),
    subscribe: () => () => undefined,
    getModelDownload: (_id: string, { signal }: { signal: AbortSignal }) => {
      signals.push(signal);
      return new Promise(() => undefined);
    },
  };
  const services = createComputersServices({ host: { chat: session }, earning: Promise.resolve(null) });
  services.getView();
  await waitFor(() => expect(signals.length).toBeGreaterThan(0));
  expect(signals[0]?.aborted).toBe(false);
  services.dispose();
  expect(signals.length).toBeGreaterThan(0);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it('follows the colour scheme only while someone shows the theme', async () => {
  const scheme = stubColorScheme(true);
  const store = createAppearanceStore(null);
  expect(scheme.listeners.size).toBe(0);
  const off = store.subscribe(() => undefined);
  expect(scheme.listeners.size).toBe(1);
  off();
  expect(scheme.listeners.size).toBe(0);
  scheme.set(false);
  const seen = vi.fn();
  store.subscribe(seen);
  await Promise.resolve();
  expect(store.getTheme()).toBe('dark');
  expect(seen).toHaveBeenCalledTimes(1);
  store.dispose();
  expect(scheme.listeners.size).toBe(0);
});

it('releases the history handover when the host closes, and keeps it for a tab that handed its history over', async () => {
  const handover = () => {
    const listeners = new Set<(state: { state: 'owner' | 'moved'; failed: boolean }) => void>();
    return { listeners, close: vi.fn(), request: vi.fn(), subscribe: (listener: (state: { state: 'owner' | 'moved'; failed: boolean }) => void) => { listeners.add(listener); return () => listeners.delete(listener); } };
  };
  const plain = handover();
  const closed = adoptHost({ close: async () => undefined, historyHandover: plain });
  expect(plain.listeners.size).toBe(1);
  await closed.close();
  expect(plain.listeners.size).toBe(0);
  expect(plain.close).toHaveBeenCalledTimes(1);

  const moved = handover();
  const kept = adoptHost({ close: async () => undefined, historyHandover: moved, runtime: { attachHandle: vi.fn() } });
  const seen = vi.fn();
  kept.handover.subscribe(seen);
  await kept.close({ keepHandover: true });
  for (const listener of moved.listeners) listener({ state: 'moved', failed: false });
  expect(seen).toHaveBeenCalledTimes(1);
  expect(kept.handover.getState()?.state).toBe('moved');
  expect(moved.close).not.toHaveBeenCalled();
  expect((window as unknown as Record<string, unknown>).REPLOID_POOL_ATTACH_DOPPLER_HANDLE).toBeUndefined();
  await kept.close();
  expect(moved.listeners.size).toBe(0);
  expect(moved.close).toHaveBeenCalledTimes(1);
});
