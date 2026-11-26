// What the React product's infrastructure holds on to, and when it lets go: each feature's services attach to the
// host on their first subscriber and detach on their last; closing a host removes what the page lifecycle added.
import { afterEach, expect, it, vi } from 'vitest';
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
