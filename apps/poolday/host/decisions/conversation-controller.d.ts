/**
 * The conversation controller's contract: the snapshot it projects for the conversation screens and the commands
 * they call. The React workspace keeps its own copy of these records in its domain
 * (apps/poolday-react/src/features/chat/domain/conversation.ts) and checks it against this declaration where it
 * adapts the controller (features/chat/infrastructure/conversation.ts), so the two cannot drift apart unnoticed.
 */
import type { Protection, RouteKind } from '../../../../shared/vendor/reploid/chat/execution-policy.js';

/** The session's discovery reading: still searching, the bounded search ended, the connection broke, or paused. */
export type DiscoveryPhase = 'searching' | 'observed' | 'interrupted' | 'paused';
/** An attempt's status as the thread list labels it. */
export type AttemptStatus = 'queued' | 'loading' | 'executing' | 'approval' | 'completed' | 'cancelled' | 'cancelling' | 'failed'
  | 'interrupted' | 'disconnected' | 'recovering';
/** The reviewed download of a model to this device. */
export type AcquisitionPhase = 'downloading' | 'failed' | 'cancelled' | 'completed';

export type Availability = 'ready' | 'waiting' | 'unavailable';
export type NextAction = 'join' | 'cancel-download' | 'cancel-queued' | 'review-shared' | 'network-opt-in' | 'download-local' | 'retry';
export type FocusTarget = 'composer' | 'answer-on' | 'sheet' | 'sheet-commit' | 'privacy' | 'download' | 'threads';
/** A destination the composer offers when the chosen one cannot answer, and the "Answer on" sheet applies. */
export type RouteAlternativeKey = 'device' | 'desktop' | 'contributors';
/** What the sheet's primary button does: commit the choice, review the download, or move to the network or this device. */
export type OutcomeAction = 'commit' | 'download' | 'use-contributors' | 'use-device';
export type ComputerChoice = 'local' | 'desktop' | 'network';
/** "Where it runs" in "Who can read it?": an execution route, or let it choose. */
export type PrivacyRoute = RouteKind | 'auto';
export type PrivacyPreset = 'standard' | 'own-devices';

/** What Send does on one press: send now, hold for up to 30 s while computers are found, ask where to run, or nothing. */
export type SendMode = 'dispatch' | 'queue' | 'choose' | 'none';
/**
 * The one resolved Ask route the composer's placeholder, chip, disclosure, status, next action and Send read: where the
 * request goes (`desktop` is this device's paired desktop, `invited` a host invite's computer), the name shown for it,
 * whether it is restricted to your own desktop, and whether it can go now.
 */
export type AskRoute = {
  readonly destination: 'device' | 'desktop' | 'invited' | 'contributors' | 'named';
  readonly computer: string;
  readonly restricted: boolean;
  readonly status: 'ready' | 'waiting' | 'queued' | 'blocked' | 'unavailable';
  readonly send: SendMode;
};

export type ComposerView = {
  readonly draft: string;
  readonly files: ReadonlyArray<{ readonly name: string; readonly size: number }>;
  readonly attachmentsPending: boolean;
  readonly attachmentHelp: boolean;
  readonly attachmentHelpText: string;
  readonly placeholder: string;
  readonly send: { readonly visible: boolean; readonly disabled: boolean; readonly mode: SendMode };
  readonly route: AskRoute;
  readonly stop: { readonly visible: boolean };
  /** The chat host's held Send (reploid.send-intent/1): held until expiresAt, or expired with nothing sent. No wording yet. */
  readonly sendIntent: { readonly status: 'held' | 'expired'; readonly expiresAt: number } | null;
  readonly chip: {
    readonly visible: boolean;
    readonly caption: boolean;
    readonly findingFirst: boolean;
    readonly source: string;
    readonly name: string;
    readonly availability: Availability;
    readonly label: string;
    readonly activity: 'ready' | 'idle';
    readonly executionSource: string;
    readonly selectionId: string | null;
  };
  readonly privacy: { readonly label: string; readonly caption: string; readonly disabled: boolean };
  readonly search: { readonly visible: boolean; readonly pressed: boolean };
  readonly status: { readonly text: string };
  readonly acquisition: { readonly text: string; readonly progress: { readonly value: number | null; readonly max: number | null } | null };
  readonly nextAction: NextAction | null;
  /** A recovery offered beside the next action, never in its place: the reviewed download to this device. */
  readonly optionalAction: 'download-local' | null;
  readonly nextLabels: { readonly join: string; readonly reviewShared: string; readonly downloadLocal: string; readonly retry: string; readonly retryPending: boolean };
  readonly disclosure: string;
  readonly routeAlternatives: ReadonlyArray<{ readonly key: RouteAlternativeKey; readonly title: string; readonly reads: string }>;
  readonly executionSettingsReset: boolean;
  readonly startingPrompt: { readonly text: string; readonly texts: readonly string[]; readonly inert: boolean } | null;
  readonly error: string;
  readonly answerLimit: string;
};

export type ModelRow = {
  readonly key: string;
  readonly value: string;
  readonly nested: boolean;
  readonly title: string;
  readonly status: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly providers: { readonly count: number; readonly label: string } | null;
};

export type ModelSection = {
  readonly id: string;
  readonly label: string;
  readonly folded: boolean;
  readonly open: boolean;
  readonly empty: string;
  readonly rows: ReadonlyArray<ModelRow>;
};

export type SheetView =
  | { readonly open: false }
  | {
      readonly open: true;
      readonly title: string;
      readonly computers: ReadonlyArray<{ readonly choice: ComputerChoice; readonly title: string; readonly status: string; readonly checked: boolean; readonly disabled: boolean }>;
      readonly disclosure: string;
      readonly threadNote: boolean;
      readonly sections: ReadonlyArray<ModelSection>;
      readonly selectedKey: string | null;
      /** `action` is empty when nothing on the sheet can fix the outcome. */
      readonly outcome: { readonly issue: string; readonly action: OutcomeAction | ''; readonly label: string; readonly disabled: boolean };
      readonly facts: string;
      readonly localFit: string;
      readonly routes: ReadonlyArray<{ readonly selectionId: string; readonly type: string; readonly status: string }>;
      readonly adapterGuide: string;
      readonly adapter: { readonly title: string; readonly purpose: string; readonly evidence: string; readonly evidenceStatus: string; readonly availability: string; readonly identities: string } | null;
      readonly detailsOpen: boolean;
    };

export type PrivacyOption<T extends string = string> = { readonly value: T; readonly title: string; readonly status: string; readonly disabled: boolean };

export type PrivacyView = {
  readonly open: boolean;
  readonly editable: boolean;
  readonly error: string;
  readonly applying: boolean;
  readonly protection: Protection | null;
  readonly route: PrivacyRoute | null;
  readonly ownDevices: boolean;
  readonly protections: ReadonlyArray<PrivacyOption<Protection>>;
  readonly routes: ReadonlyArray<PrivacyOption<PrivacyRoute>>;
  readonly ownDevicesOption: PrivacyOption<'own-devices'>;
  readonly splitNote: string;
  readonly preset: PrivacyPreset;
  readonly note: string;
  readonly notes: Readonly<Record<PrivacyPreset, string>>;
};

export type DownloadView = {
  readonly open: boolean;
  readonly modelId: string | null;
  readonly choose: boolean;
  readonly title: string;
  readonly models: ReadonlyArray<{ readonly value: string; readonly title: string }>;
  readonly explanation: string;
  readonly sharing: ReadonlyArray<{ readonly value: string; readonly title: string; readonly status: string; readonly disabled: boolean }>;
  readonly sharingValues: ReadonlyArray<string>;
  readonly size: string;
  readonly ready: boolean;
  readonly retry: boolean;
  readonly fit: string;
  readonly confirm: string;
};

export type ThreadRowView = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  readonly current: boolean;
  readonly monogram: string;
  readonly working: boolean;
  readonly unread: boolean;
  readonly attention: boolean;
  readonly time: string;
  readonly timestamp: number | null;
  readonly context: { readonly percent: number; readonly text: string } | null;
};

export type Measurement = { readonly metric: string; readonly icon: 'privacy' | 'activity' | 'tokens' | 'clock'; readonly text: string; readonly title: string | null };

export type MessageView = {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly attemptId: string | null;
  readonly content: string;
  readonly question: string | null;
  readonly documents: ReadonlyArray<{ readonly name: string; readonly passages: ReadonlyArray<{ readonly id: string; readonly anchor: string; readonly text: string }> }> | null;
  readonly markdownTargets: ReadonlyArray<readonly [string, string]>;
  readonly authorStatus: string;
  readonly systemText: string;
  readonly systemOnly: boolean;
  readonly measurements: ReadonlyArray<Measurement> | null;
  readonly activity: {
    readonly active: boolean;
    readonly stopDisabled: boolean;
    readonly summary: string;
    readonly label: string;
    readonly title: string;
    readonly icon: 'search' | 'device' | 'peers' | 'activity' | null;
    readonly count: number | null;
    readonly readable: string;
    readonly activeText: string;
  } | null;
  readonly previousAttempts: ReadonlyArray<string>;
  readonly sources: ReadonlyArray<{ readonly number: number; readonly title: string; readonly url: string; readonly anchor: string }>;
  readonly retry: { readonly attemptId: string; readonly disabled: boolean } | null;
  readonly copy: boolean;
  readonly error: string | null;
};

export type ContextSelection = { readonly enabled: boolean; readonly maxWords: number };

export type ConversationSnapshot = {
  readonly selectedId: string | null;
  readonly threadClosed: boolean;
  readonly busy: boolean;
  readonly hasMessages: boolean;
  readonly composer: ComposerView;
  readonly sheet: SheetView;
  readonly privacy: PrivacyView;
  readonly rename: { readonly open: boolean; readonly id: string | null; readonly value: string };
  readonly download: DownloadView | null;
  readonly remotePermission: { readonly key: string; readonly title: string; readonly what: string; readonly recipient: string } | null;
  readonly threads: { readonly archived: boolean; readonly items: ReadonlyArray<ThreadRowView>; readonly empty: string };
  readonly messages: ReadonlyArray<MessageView>;
  readonly canExport: boolean;
  readonly draftContext: ContextSelection | null;
  readonly focus: { readonly target: FocusTarget | null; readonly seq: number };
};

export type ConversationController = {
  readonly getSnapshot: () => ConversationSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly dispose: () => void;
  readonly setDraft: (text: string) => void;
  readonly useStartingPrompt: (text: string) => void;
  readonly attach: (files: Iterable<File>) => void;
  readonly showAttachmentHelp: () => void;
  readonly removeFile: (index: number) => void;
  readonly toggleSearch: () => void;
  readonly send: () => void;
  readonly stop: () => void;
  readonly cancelQueuedSend: () => void;
  readonly retryConnection: () => void;
  readonly cancelDownload: () => void;
  readonly downloadLocal: () => void;
  readonly reviewSharedModel: () => void;
  readonly reviewNetworkExecution: () => void;
  readonly takeRouteAlternative: (key: RouteAlternativeKey) => void;
  readonly joinHost: () => void;
  readonly openSheet: () => void;
  readonly closeSheet: () => void;
  readonly setSheetDetails: (open: boolean) => void;
  readonly pickComputer: (choice: ComputerChoice) => void;
  readonly pickModel: (key: string, input?: { readonly browsing?: boolean }) => void;
  readonly commitSheet: () => void;
  readonly runSheetAction: () => void;
  readonly modelProviders: (key: string) => { readonly providerIds: ReadonlyArray<string>; readonly label: string } | null;
  readonly openPrivacy: () => void;
  readonly pickProtection: (value: Protection) => void;
  readonly pickRoute: (value: PrivacyRoute) => void;
  readonly setOwnDevices: (on: boolean) => void;
  readonly closePrivacy: () => void;
  readonly applyPrivacy: () => void;
  readonly selectDownloadModel: (modelId: string) => void;
  readonly setDownloadSharing: (values: ReadonlyArray<string>) => void;
  readonly startSharing: (modelId: string | null) => void;
  readonly setDraftContext: (selection: ContextSelection) => void;
  readonly retryDownloadCheck: () => void;
  readonly closeDownload: () => void;
  readonly confirmDownload: () => void;
  readonly newThread: () => void;
  readonly selectThread: (id: string) => void;
  readonly showArchived: (archived: boolean) => void;
  readonly archiveThread: (id: string) => void;
  readonly openRename: (id: string) => void;
  readonly setRenameValue: (value: string) => void;
  readonly closeRename: () => void;
  readonly saveRename: () => void;
  readonly retryAttempt: (attemptId: string) => void;
  readonly copyMessage: (messageId: string) => Promise<void>;
  readonly copyText: (text: string) => Promise<void>;
  readonly copyError: (attemptId: string) => Promise<void>;
  readonly exportConversation: () => string;
  readonly allowRemote: () => void;
  readonly declineRemote: () => void;
  readonly clearError: () => void;
};

/** The parts of the host chat session's state the controller reads by name; the rest is the session's own record. */
export type ConversationSessionState = {
  readonly discoveryPhase?: DiscoveryPhase;
  readonly peerDiscoveryTimedOut?: boolean;
  readonly acquisition?: { readonly phase?: AcquisitionPhase } | null;
  readonly [field: string]: unknown;
};

/** The host chat session (apps/poolday/host/chat-session.js); the controller calls the optional ports it offers. */
export type ConversationSession = {
  readonly getState: () => ConversationSessionState;
  readonly subscribe: (listener: (state: ConversationSessionState) => void) => () => void;
  readonly [port: string]: unknown;
};

export type ConversationOptions = {
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  readonly webSearch?: object | null;
  readonly search?: object | null;
  readonly historyHandover?: object | null;
  readonly canDownload?: boolean;
  /** What the person has staged, kept by the caller across remounts. */
  readonly viewState?: object;
  readonly href?: () => string;
  readonly forgetInvite?: () => void;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly clipboard?: (text: string) => unknown;
  readonly onProjectMessage?: ((message: unknown) => void) | null;
};

export function createConversationController(session: ConversationSession, options?: ConversationOptions): ConversationController;

/** Up to `count` distinct prompts drawn at random from `prompts`. */
export function pickStartingPrompts(prompts: ReadonlyArray<unknown>, random?: () => number, count?: number): string[];
/** The quoted ceiling for a priced route, shown before Send; empty for a free route. */
export function creditCapText(model: { readonly creditCap?: { readonly maximum?: number; readonly spendable?: number } } | null | undefined): string;
export const ATTACHMENT_HELP: string;
export const ATTACHMENT_ACCEPT: string;
/** Relative time of the last activity: now, minutes, hours or days. */
export function relativeTime(timestamp: number, now: number): string;
