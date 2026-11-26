// Opens the Poolday host for the React shell the way the vanilla shell does
// (apps/poolday/host/open-product-host.js), and wires the page lifecycle both shells wire. The host
// owns sessions, execution, admission and settlement; nothing here decides any of them.
import * as hostOpening from '../../../../../poolday/host/open-product-host.js';
import { createProjectedStore } from '../../../../../poolday/host/decisions/projected-store.js';
import type { HandoverPort, HandoverState, HostHandle } from '../domain/host';

type Handover = { readonly subscribe: (listener: (state: HandoverState) => void) => () => void; readonly request: () => unknown; readonly close?: () => void };
type ProductHost = {
  readonly close: () => Promise<unknown>;
  readonly pause?: () => Promise<unknown>;
  readonly resume?: () => void;
  readonly connectOperations?: (network: unknown) => unknown;
  readonly runtime?: { readonly attachHandle: (handle: unknown, model: unknown, info: unknown) => unknown };
  readonly historyHandover?: Handover | null;
};

const { openProductHost, resolveOrderedParticipation } = hostOpening as unknown as {
  readonly openProductHost: (options: { ordered: unknown }) => { readonly host: ProductHost | Promise<ProductHost>; readonly earningOpening: Promise<unknown> };
  readonly resolveOrderedParticipation: () => unknown;
};

export type OpenedProduct = HostHandle & {
  readonly handover: HandoverPort;
  /** Closes the session; with `keepHandover` this tab can still ask for the history back. */
  readonly close: (options?: { readonly keepHandover?: boolean }) => Promise<void>;
};

/**
 * A handover port over the host's history handover, or an inert one where there is none. It follows the
 * handover from the start, so a move announced before any screen listens is not missed, until `release`.
 */
function handoverPort(handover: Handover | null | undefined): HandoverPort & { readonly release: () => void } {
  let state: HandoverState | null = null;
  const store = createProjectedStore({ project: () => state });
  const unsubscribe = handover?.subscribe((next) => {
    state = next;
    store.changed();
  });
  return {
    getState: () => state,
    subscribe: store.subscribe,
    request: () => void handover?.request(),
    release: () => {
      unsubscribe?.();
      store.dispose();
    },
  };
}

/** Wraps an already opened host (the page's, or a test's) with the page lifecycle. */
export function adoptHost(host: ProductHost, earning: Promise<unknown> = Promise.resolve(null)): OpenedProduct {
  const globals = window as unknown as Record<string, unknown>;
  const connectOperations = (network: unknown) => host.connectOperations?.(network);
  globals.REPLOID_POOL_CONNECT_OPERATIONS = connectOperations;
  const attachHandle = (handle: unknown, model: unknown = null, info: unknown = null) => host.runtime?.attachHandle(handle, model, info);
  globals.REPLOID_POOL_ATTACH_DOPPLER_HANDLE = attachHandle;
  const onPageHide = (event: PageTransitionEvent) => {
    if (event.persisted) void host.pause?.();
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) host.resume?.();
  };
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  let closing: Promise<void> | null = null;
  let handoverClosed = false;
  const handover = handoverPort(host.historyHandover);
  return {
    host,
    earning,
    handover,
    close: ({ keepHandover = false } = {}) => {
      // A tab that handed its history over keeps following the handover, so it can ask for it back, until a
      // later close without `keepHandover` (the page going away) closes the handover too.
      if (!keepHandover && !handoverClosed) {
        handoverClosed = true;
        host.historyHandover?.close?.();
        handover.release();
      }
      if (closing) return closing;
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      if (globals.REPLOID_POOL_CONNECT_OPERATIONS === connectOperations) delete globals.REPLOID_POOL_CONNECT_OPERATIONS;
      if (globals.REPLOID_POOL_ATTACH_DOPPLER_HANDLE === attachHandle) delete globals.REPLOID_POOL_ATTACH_DOPPLER_HANDLE;
      closing = Promise.resolve(host.close()).then(() => undefined);
      return closing;
    },
  };
}

/** Opens this page's host: its storage, room and earning loop, then the session. */
export async function openPageHost({ signal }: { readonly signal?: AbortSignal } = {}): Promise<OpenedProduct> {
  signal?.throwIfAborted();
  const ordered = resolveOrderedParticipation();
  const opened = openProductHost({ ordered });
  const host = await opened.host;
  return adoptHost(host, opened.earningOpening);
}
