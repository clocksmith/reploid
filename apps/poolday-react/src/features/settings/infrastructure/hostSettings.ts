// Adapts the Poolday host to Settings: the chat session's preferences and file sharing, model storage, local data,
// the credits account, web search and the change list. The host decides and stores everything; the wording comes
// from apps/poolday/host/decisions/settings.js, so both shells say the same thing.
import * as decisions from '../../../../../poolday/host/decisions/settings.js';
import * as localDataModule from '../../../../../poolday/host/local-data.js';
import * as context from '../../../../../poolday/host/product-context.js';
import * as peerRoom from '../../../../../poolday/pool/peer-room.js';
import type {
  CreditAccountPort,
  CreditAccountView,
  FileSharingSelection,
  FileSharingView,
  ImportPlan,
  LocalDataPort,
  RoutePreferenceView,
  SettingsServices,
  SettingsSnapshot,
  SignInView,
  StoragePort,
  Store,
  WebSearchPort,
  WebSearchView,
} from '../domain/services';

type State = Record<string, unknown> & { readonly network?: unknown };
type Session = {
  readonly getState: () => State;
  readonly subscribe: (listener: (state: State) => void) => () => void;
  readonly getRoutePreference?: () => string | null;
  readonly setRoutePreference?: (value: string) => void;
  readonly setRemoteAnswersEnabled?: (enabled: boolean) => unknown;
  readonly setFileSharing?: (enabled: boolean, modelId: string | null, approved: boolean, controls: unknown) => Promise<unknown>;
  readonly setCachedFileContribution?: (enabled: boolean) => Promise<unknown>;
  readonly connect?: () => Promise<unknown>;
  readonly exportThreads?: unknown;
  readonly importThreads?: unknown;
};
type ModelStorage = { readonly list: () => Promise<ReadonlyArray<{ id: string; name: string; sizeBytes: number }>>; readonly remove: (id: string) => Promise<unknown> };
type Listener<T> = (state: T) => void;
type Subscribable<T> = { readonly subscribe: (listener: Listener<T>) => () => void };
type WebSearch = Subscribable<WebSearchState> & {
  readonly state: () => WebSearchState;
  readonly setEnabled: (enabled: boolean, options: { serverAvailable: boolean }) => void;
  readonly configure: (settings: { url: string; tool: string; token?: string }) => void;
  readonly check: () => Promise<unknown>;
};
type WebSearchState = { readonly enabled: boolean; readonly url: string; readonly tool: string; readonly hasToken: boolean; readonly recipient?: string; readonly status: { readonly message?: string } };
type SearchStatus = Subscribable<unknown> & { readonly available: () => boolean; readonly state: () => { readonly message?: string; readonly provider?: string } };
type Earning = {
  readonly flow?: { readonly flow?: string };
  readonly account: Subscribable<Record<string, unknown>> & { signOut: () => Promise<unknown>; setSpendingLimit: (value: string) => void; topUp: (id: string) => Promise<unknown> };
  readonly signIn: Subscribable<Record<string, unknown>> & {
    requestLink?: (email: string) => Promise<unknown>; useSubject?: (name: string) => Promise<unknown>; signOut: () => Promise<unknown>; start?: () => Promise<unknown>;
  };
} | null;
type Host = {
  readonly chat?: Session;
  readonly modelStorage?: ModelStorage | null;
  readonly webSearch?: WebSearch | null;
  readonly search?: SearchStatus | null;
  readonly computers?: unknown;
  readonly evolution?: { readonly list: () => Promise<ReadonlyArray<{ readonly status: string }>> } | null;
};

const settings = decisions as unknown as {
  readonly projectRoutePreference: (state: State, session: Session) => RoutePreferenceView;
  readonly storageSummary: (state: State) => string;
  readonly storedModelLabel: (row: { name: string; sizeBytes: number }) => string;
  readonly projectFileSharing: (state: State, selection: FileSharingSelection) => FileSharingView;
  readonly fileSharingRequest: (state: State, selection: FileSharingSelection) => {
    readonly enable: boolean; readonly paused: boolean; readonly cachedOnly: boolean; readonly modelId: string | null; readonly controls: unknown;
  };
  readonly remoteAnswersText: (state: State) => string;
  readonly projectWebSearch: (state: WebSearchState, search: SearchStatus | null | undefined) => WebSearchView;
  readonly projectCreditAccount: (state: Record<string, unknown>) => CreditAccountView;
  readonly projectSignIn: (state: Record<string, unknown>) => SignInView;
  readonly localSignInText: (state: Record<string, unknown>) => string;
};
const { createLocalData, LOCAL_DATA_MAX_BYTES } = localDataModule as unknown as {
  readonly createLocalData: (options: { chat: Session; computers: unknown }) => {
    readonly export: () => { readonly conversations: ReadonlyArray<unknown> };
    readonly plan: (text: string) => { readonly summary: string; readonly empty: boolean; readonly apply: () => { conversations: number; names: number; blocked: number } };
  };
  readonly LOCAL_DATA_MAX_BYTES: number;
};
const { getPeerRoomId } = context as unknown as { readonly getPeerRoomId: () => string };
const { DEFAULT_PEER_ROOM_ID } = peerRoom as unknown as { readonly DEFAULT_PEER_ROOM_ID: string };

/** A store over a host subscription, projecting each notification once. */
function store<S, T>(source: Subscribable<S> | null | undefined, initial: T, project: (state: S) => T): Store<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  let detach: (() => void) | null = null;
  return {
    getState: () => value,
    subscribe(listener) {
      listeners.add(listener);
      if (!detach && source) {
        detach = source.subscribe((state) => {
          value = project(state);
          for (const each of listeners) each();
        });
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && detach) {
          detach();
          detach = null;
        }
      };
    },
  };
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** Saves a file through the browser's download, as the vanilla shell does. */
function saveFile(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The address of another product route in this room (shell-view.js roomHref). */
function roomHref(path: string): string {
  const url = new URL(path, 'https://reploid.invalid');
  const room = getPeerRoomId();
  if (room) url.searchParams.set('room', room);
  const implicit = (window as unknown as { REPLOID_POOL_ROOM_ID?: string }).REPLOID_POOL_ROOM_ID || DEFAULT_PEER_ROOM_ID;
  if (implicit === DEFAULT_PEER_ROOM_ID && url.searchParams.get('room') === DEFAULT_PEER_ROOM_ID) url.searchParams.delete('room');
  return url.pathname + url.search;
}

function snapshotOf(session: Session | undefined, state: State): SettingsSnapshot {
  return {
    routePreference: settings.projectRoutePreference(state, session as Session),
    storageSummary: settings.storageSummary(state),
    remoteAnswers: session?.setRemoteAnswersEnabled ? { enabled: state.remoteAnswersEnabled === true, status: settings.remoteAnswersText(state) } : null,
    fileSharing: (selection) => (session?.setFileSharing ? settings.projectFileSharing(state, selection) : null),
  };
}

function creditAccountPort(earning: NonNullable<Earning>): CreditAccountPort {
  const { account, signIn } = earning;
  const local = earning.flow?.flow === 'local_test_subject';
  void signIn.start?.().catch(() => undefined);
  const emptyAccount = settings.projectCreditAccount({ phase: 'signed_out', topUps: [], journal: [] });
  return {
    local,
    account: store(account, emptyAccount, settings.projectCreditAccount),
    signIn: store(signIn, settings.projectSignIn({ phase: 'idle' }), settings.projectSignIn),
    localSignedIn: store(signIn, '', (state) => (state.phase === 'signed_in' ? settings.localSignInText(state) : '')),
    requestLink: (email) => signIn.requestLink?.(email) ?? Promise.reject(new Error('Sign-in is not available on this server.')),
    useSubject: (name) => signIn.useSubject?.(name) ?? Promise.reject(new Error('Sign-in is not available on this server.')),
    signOut: () => signIn.signOut(),
    accountSignOut: () => account.signOut(),
    setSpendingLimit: (value) => account.setSpendingLimit(value),
    topUp: (id) => account.topUp(id),
  };
}

function webSearchPort(webSearch: WebSearch, search: SearchStatus | null | undefined): WebSearchPort {
  let view = settings.projectWebSearch(webSearch.state(), search);
  const listeners = new Set<() => void>();
  const refresh = () => {
    view = settings.projectWebSearch(webSearch.state(), search);
    for (const listener of listeners) listener();
  };
  let detach: (() => void) | null = null;
  return {
    getState: () => view,
    subscribe(listener) {
      listeners.add(listener);
      if (!detach) {
        const offSearch = webSearch.subscribe(refresh);
        const offStatus = search?.subscribe(refresh) ?? (() => undefined);
        detach = () => {
          offSearch();
          offStatus();
        };
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size && detach) {
          detach();
          detach = null;
        }
      };
    },
    setEnabled: (enabled) => webSearch.setEnabled(enabled, { serverAvailable: !!search?.available() }),
    configure: ({ url, tool, token }) => {
      webSearch.configure({ url, tool, ...(token ? { token } : {}) });
      if (url.trim()) void webSearch.check();
    },
    check: () => void webSearch.check(),
  };
}

function changesStore(host: Host): Store<number> {
  let count = 0;
  const listeners = new Set<() => void>();
  let revision = 0;
  const refresh = () => {
    const current = ++revision;
    void host.evolution?.list().then(
      (candidates) => {
        if (current !== revision) return;
        count = candidates.filter((item) => item.status === 'awaiting-approval').length;
        for (const listener of listeners) listener();
      },
      (error: unknown) => console.warn('[Reploid] Could not read changes awaiting review', error),
    );
  };
  return {
    getState: () => count,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) refresh();
      return () => listeners.delete(listener);
    },
  };
}

export function createSettingsServices(product: { readonly host: object; readonly earning?: Promise<unknown> }): SettingsServices {
  const host = product.host as Host;
  const session = host.chat;
  const chat: Subscribable<State> | null = session ?? null;
  const initial = session ? session.getState() : ({} as State);
  let latest = initial;
  const snapshot = store<State, SettingsSnapshot>(chat, snapshotOf(session, initial), (state) => {
    latest = state;
    return snapshotOf(session, state);
  });
  const storage: StoragePort | null = host.modelStorage
    ? {
        list: async () => (await host.modelStorage!.list()).map((row) => ({ id: row.id, name: row.name, label: settings.storedModelLabel(row) })),
        remove: async (id) => {
          await host.modelStorage!.remove(id);
        },
      }
    : null;
  const localData: LocalDataPort | null =
    session && typeof session.exportThreads === 'function' && typeof session.importThreads === 'function'
      ? (() => {
          const data = createLocalData({ chat: session, computers: host.computers ?? null });
          return {
            exportFile: () => {
              const file = data.export();
              saveFile(JSON.stringify(file, null, 2), 'reploid-data.json', 'application/json');
              return `Exported ${plural(file.conversations.length, 'conversation')}.`;
            },
            plan: async (file: File): Promise<ImportPlan> => {
              if (file.size > LOCAL_DATA_MAX_BYTES) throw new Error('This file is too large to be a Reploid data export.');
              const plan = data.plan(await file.text());
              return {
                summary: plan.summary,
                empty: plan.empty,
                apply: () => {
                  const done = plan.apply();
                  return `Imported ${plural(done.conversations, 'conversation')}, ${plural(done.names, 'computer name')} and ${plural(done.blocked, 'blocked computer')}.`;
                },
              };
            },
          };
        })()
      : null;
  return {
    snapshot,
    setRoutePreference: (value) => {
      if (value !== session?.getRoutePreference?.()) session?.setRoutePreference?.(value);
    },
    setRemoteAnswersEnabled: async (enabled) => session?.setRemoteAnswersEnabled?.(enabled),
    toggleFileSharing: async (selection) => {
      if (!session?.setFileSharing) return;
      const request = settings.fileSharingRequest(session.getState?.() ?? latest, selection);
      if (request.enable && request.paused) await session.connect?.();
      if (request.cachedOnly && session.setCachedFileContribution) return session.setCachedFileContribution(true);
      return session.setFileSharing(request.enable, request.modelId, request.enable, request.controls);
    },
    storage,
    localData,
    creditAccount: Promise.resolve(product.earning ?? null).then(
      (earning) => {
        const opened = earning as Earning;
        return opened?.account ? creditAccountPort(opened) : null;
      },
      () => null,
    ),
    webSearch: host.webSearch ? webSearchPort(host.webSearch, host.search) : null,
    apps: [
      { id: 'improve', href: roomHref('/improve') },
      { id: 'examples', href: '/examples' },
      { id: 'experiments', href: '/experiments' },
    ],
    changesAwaiting: changesStore(host),
  };
}
