/**
 * Conversation details: the selected (or last) answer of the current thread, as its own record states it, plus the
 * thread's permissions and context. The host (apps/poolday/host/chat-session.js) owns all of it; these are view
 * records projected in infrastructure and the commands this pane may ask the host for.
 */

export type DetailsView = {
  readonly threadId: string | null;
  readonly hasAttempt: boolean;
  readonly statusLabel: string;
  /** The recorded route: the requester (unless it executes), then each executor. Null before admission. */
  readonly route: {
    readonly requester: { readonly label: string; readonly caption: string } | null;
    readonly model: string | null;
    readonly executors: ReadonlyArray<{ readonly id: string; readonly label: string; readonly caption: string }>;
  } | null;
  readonly activity: {
    readonly attemptId: string;
    readonly summary: string;
    readonly distribution: ReadonlyArray<{ readonly label: string; readonly share: number }> | null;
    readonly distributionLabel: string | null;
    readonly nodes: ReadonlyArray<{ readonly id: string; readonly label: string; readonly value: string; readonly gpu: string | null }>;
    readonly footnote: string | null;
    readonly footnoteTitle: string | null;
    readonly attemptSupply: string | null;
    readonly adapter: string | null;
    readonly facts: ReadonlyArray<readonly [string, string]>;
    readonly error: string | null;
  } | null;
  readonly execution: {
    readonly error: string | null;
    readonly facts: ReadonlyArray<readonly [string, string]>;
    readonly executors: ReadonlyArray<{ readonly id: string; readonly label: string; readonly facts: ReadonlyArray<readonly [string, string]> }>;
    readonly noExecutor: string | null;
    readonly notes: ReadonlyArray<string>;
    readonly planId: string | null;
  } | null;
  readonly timeline: ReadonlyArray<string>;
  readonly creditRequest: string | null;
  readonly creditPending: boolean;
  readonly receiptAvailable: boolean;
  readonly contextDetail: string;
  readonly grants: ReadonlyArray<{ readonly id: string; readonly title: string; readonly status: string; readonly record: string }>;
  readonly canDownload: boolean;
  readonly busy: boolean;
  readonly closed: boolean;
};

/** The context prompt: on or off and a word cap, for a new conversation or stored on a thread. */
export type ContextSelection = { readonly enabled: boolean; readonly maxWords: number };
export type ContextView = ContextSelection & { readonly wordCount: number; readonly content: string };

export type DetailsServices = {
  readonly subscribe: (listener: () => void) => () => void;
  /** The details of the current thread; `attemptId` inspects that answer instead of the last one. */
  readonly project: (attemptId: string | null) => DetailsView;
  /** The word caps a context prompt may use. */
  readonly wordLimits: ReadonlyArray<number>;
  /** The context of the current thread, or of a new one under `draft`; null where the page has no context prompt. */
  readonly context: (draft: ContextSelection | null) => ContextView | null;
  /** Stores a thread's context selection; a new conversation keeps it in the composition root instead. */
  readonly setContext: (threadId: string, selection: ContextSelection) => Promise<unknown>;
  readonly revokeGrant: (threadId: string, grantId: string) => Promise<unknown>;
  readonly copyError: (attemptId: string) => Promise<unknown>;
  /** Saves the service receipt for a request and says what the ledger reports now. */
  readonly saveReceipt: (requestId: string) => Promise<string>;
  /** What the ledger reports now for a pending hold, or null when it cannot be asked. */
  readonly ledgerNow: (requestId: string) => Promise<string | null>;
  readonly downloadConversation: (threadId: string) => void;
};
