/**
 * The conversation state and commands the Poolday host's chat session exposes
 * (apps/poolday/host/chat-session.js), typed to what the React screens read. The host owns
 * execution, admission and settlement; these records are its snapshot, never a stronger claim.
 */
export type ExecutionLocation = 'auto' | 'local' | 'network';

export type HostModel = {
  readonly id: string;
  readonly name?: string;
  readonly identity?: string;
  readonly selectionId?: string;
  readonly availability?: string;
  readonly networkAvailability?: string;
  readonly localReady?: boolean;
  readonly localCached?: boolean;
  readonly fleet?: unknown;
  readonly partition?: unknown;
  readonly providerIds?: ReadonlyArray<string>;
  readonly reachableProviderIds?: ReadonlyArray<string>;
  readonly source?: { readonly baseUrl?: string };
  readonly adapters?: ReadonlyArray<{ readonly id: string; readonly name?: string }>;
};

export type HostAttempt = {
  readonly id: string;
  readonly status: string;
  readonly error?: string;
  readonly retryOf?: string;
  readonly createdAt?: number;
  readonly finishedAt?: number;
  readonly execution?: {
    readonly placement?: string;
    readonly timing?: { readonly totalMs?: number; readonly generatedTokenCount?: number };
    readonly completion?: { readonly generatedTokenCount?: number };
    readonly receipt?: unknown;
    readonly serviceCredit?: { readonly heldCredits?: number; readonly settledAt?: number; readonly chargedCredits?: number };
  };
};

export type HostMessage = {
  readonly id?: string;
  readonly role: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly attemptId?: string;
};

export type HostThread = {
  readonly id: string;
  readonly title?: string;
  readonly purpose?: string;
  readonly closed?: boolean;
  readonly createdAt?: number;
  readonly model: HostModel;
  readonly messages: ReadonlyArray<HostMessage>;
  readonly attempts: ReadonlyArray<HostAttempt>;
  readonly permissions?: { readonly executionLocation?: ExecutionLocation; readonly sharingScope?: string };
  readonly privacy?: unknown;
};

export type HostChatState = {
  readonly threads: ReadonlyArray<HostThread>;
  readonly selectedId: string | null;
  readonly activeThread: HostThread | null;
  readonly models?: ReadonlyArray<HostModel>;
  readonly defaultModel?: HostModel | null;
  readonly defaultModels?: Partial<Record<ExecutionLocation, HostModel>>;
  readonly runningIds?: ReadonlyArray<string>;
  readonly discoveryPhase?: string;
  readonly acquisition?: { readonly phase?: string; readonly modelId?: string; readonly error?: string; readonly progress?: { readonly message?: string; readonly receivedBytes?: number | null; readonly totalBytes?: number | null } } | null;
  readonly localDownloadIssue?: string | null;
  readonly ownerPairing?: { readonly status?: string; readonly hostParticipantId?: string; readonly hostLabel?: string } | null;
  readonly guestAccess?: unknown;
  readonly comparisonPhase?: unknown;
};

export type Draft = { readonly text: string; readonly files: ReadonlyArray<unknown> };

/** The session's commands the screens use. Each returns what the host returns. */
export type ChatPort = {
  readonly getState: () => HostChatState;
  readonly subscribe: (listener: (state: HostChatState) => void) => () => void;
  readonly select: (threadId: string | null) => unknown;
  readonly createThread: (options: { model: HostModel; executionLocation: ExecutionLocation; sharingScope: 'local' | 'mesh'; privacy?: unknown }) => Promise<string> | string;
  readonly send: (threadId: string, content: string, attachments?: ReadonlyArray<unknown>) => Promise<unknown>;
  readonly cancel: (threadId: string) => unknown;
  readonly setExecutionLocation: (threadId: string, location: ExecutionLocation) => Promise<unknown> | unknown;
  readonly setExecutionPrivacy: (threadId: string, privacy: unknown) => Promise<unknown> | unknown;
  readonly getDraft: (threadId: string | null) => Draft | null | undefined;
  /** `null` clears the draft. */
  readonly saveDraft: (threadId: string | null, value: Draft | null) => Promise<unknown> | unknown;
  readonly archiveThread: (threadId: string) => unknown;
  /** Checks a model's download size; a download needs this first. */
  readonly getModelDownload: (modelId: string, options?: { signal?: AbortSignal }) => Promise<{ readonly sizeBytes: number }>;
  /** Starts an approved download to this browser. */
  readonly downloadLocalModel: (modelId: string, approved: true) => Promise<unknown>;
  readonly cancelModelDownload: () => unknown;
};
