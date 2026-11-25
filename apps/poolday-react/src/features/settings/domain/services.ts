/**
 * What the composition root supplies to Settings. The host (apps/poolday/host) stores preferences, holds downloads,
 * runs the credits account and enforces permissions; these ports read its records and ask it to act. Every visible
 * line is the host's own wording, projected in infrastructure.
 */

/** A subscription to a value the host owns. `getState` returns the same object until the next notification. */
export type Store<T> = {
  readonly getState: () => T;
  readonly subscribe: (listener: () => void) => () => void;
};

/** This browser's appearance, owned by the shell and passed in by the composition root. */
export type Appearance = 'system' | 'light' | 'dark';
export type AppearancePort = {
  readonly getChoice: () => Appearance;
  readonly setChoice: (choice: Appearance) => void;
  readonly subscribe: (listener: () => void) => () => void;
};

/** "When several computers can answer": the options, why they are off, and the fix that opens Network answers. */
export type RoutePreferenceView = {
  readonly reason: string;
  readonly fix: { readonly label: string } | null;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string; readonly checked: boolean; readonly disabled: boolean }>;
};

export type FileMode = 'cached-only' | 'bounded-acquisition' | 'full-model';
export type FileSharingSelection = { readonly modelId: string | null; readonly mode: FileMode; readonly allowance: string | null };
export type FileSharingView = {
  readonly enabled: boolean;
  readonly toggleDisabled: boolean;
  readonly status: string;
  readonly progress: string;
  readonly models: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly modelId: string | null;
  readonly modelDisabled: boolean;
  readonly modes: ReadonlyArray<{ readonly value: FileMode; readonly title: string; readonly status: string; readonly disabled: boolean }>;
  readonly mode: FileMode;
  readonly allowanceShown: boolean;
  readonly allowance: string;
  readonly allowanceDisabled: boolean;
  readonly limits: string;
};

/** The Settings snapshot drawn from the chat session's state on each notification. */
export type SettingsSnapshot = {
  readonly routePreference: RoutePreferenceView;
  /** The catalog's downloaded models, where this page has no storage port. */
  readonly storageSummary: string;
  /** Network answers, where the session offers them. */
  readonly remoteAnswers: { readonly enabled: boolean; readonly status: string } | null;
  /** The file-sharing switch and options for the staged selection, where the session offers file sharing. */
  readonly fileSharing: (selection: FileSharingSelection) => FileSharingView | null;
};

export type StoredDownload = { readonly id: string; readonly name: string; readonly label: string };

/** Measured downloads in this browser's storage, and their guarded removal. */
export type StoragePort = {
  readonly list: () => Promise<ReadonlyArray<StoredDownload>>;
  readonly remove: (id: string) => Promise<void>;
};

/** What an import would add, checked before anything changes; `apply` performs exactly that and reports it. */
export type ImportPlan = { readonly summary: string; readonly empty: boolean; readonly apply: () => string };

/** Export and import of this browser's conversations, computer names and blocks. */
export type LocalDataPort = {
  /** Saves the export file and reports what it holds. */
  readonly exportFile: () => string;
  readonly plan: (file: File) => Promise<ImportPlan>;
};

export type CreditAccountView = {
  readonly ready: boolean;
  readonly balance: string;
  readonly topUps: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly checkout: string | null;
  readonly spendingLimit: number | null;
  readonly quote: string;
  readonly journal: ReadonlyArray<{ readonly id: string; readonly type: string; readonly text: string }>;
  readonly status: string;
};

export type SignInView = {
  readonly formShown: boolean;
  readonly signedIn: boolean;
  readonly sendDisabled: boolean;
  readonly summary: string;
  readonly message: string;
};

/** The credits account the page's server publishes, and its sign-in (email link, or a local test name). */
export type CreditAccountPort = {
  readonly local: boolean;
  readonly account: Store<CreditAccountView>;
  readonly signIn: Store<SignInView>;
  /** The local test sign-in's signed-in line. */
  readonly localSignedIn: Store<string>;
  readonly requestLink: (email: string) => Promise<unknown>;
  readonly useSubject: (name: string) => Promise<unknown>;
  readonly signOut: () => Promise<unknown>;
  readonly accountSignOut: () => Promise<unknown>;
  readonly setSpendingLimit: (value: string) => void;
  readonly topUp: (id: string) => Promise<unknown>;
};

export type WebSearchView = {
  readonly enabled: boolean;
  readonly disabled: boolean;
  readonly reason: string;
  readonly fix: string | null;
  readonly disclosure: string;
  readonly url: string;
  readonly tool: string;
  readonly tokenPlaceholder: string;
  readonly status: string;
};

export type WebSearchPort = Store<WebSearchView> & {
  readonly setEnabled: (enabled: boolean) => void;
  readonly configure: (settings: { readonly url: string; readonly tool: string; readonly token: string }) => void;
  readonly check: () => void;
};

/** A route outside the workspace: Changes, Examples and Experiments. */
export type AppShortcut = { readonly id: 'improve' | 'examples' | 'experiments'; readonly href: string };

export type SettingsServices = {
  readonly snapshot: Store<SettingsSnapshot>;
  readonly setRoutePreference: (value: string) => void;
  readonly setRemoteAnswersEnabled: (enabled: boolean) => Promise<unknown>;
  readonly toggleFileSharing: (selection: FileSharingSelection) => Promise<unknown>;
  readonly storage: StoragePort | null;
  readonly localData: LocalDataPort | null;
  /** Resolves to the credits account, or null when this page's server publishes none. */
  readonly creditAccount: Promise<CreditAccountPort | null>;
  readonly webSearch: WebSearchPort | null;
  readonly apps: ReadonlyArray<AppShortcut>;
  /** Changes awaiting review, counted from the host's change list. */
  readonly changesAwaiting: Store<number>;
};
