export interface ChatModel {
  id: string;
  name: string;
  identity: string;
  adapters?: Array<{ identity: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface ChatPolicy {
  maxThreads: number;
  maxMessagesPerThread: number;
  maxMessageCharacters: number;
  maxResponseCharacters: number;
  maxConcurrentAttempts: number;
  attemptTimeoutMs: number;
  maxQueuedRequests: number;
  maxRecordedAttempts: number;
  maxRequestsPerParticipant: number;
  maxOutputTokens: number;
  participantTokenBudget: number;
  budgetWindowMs: number;
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  attemptId?: string;
}
export interface ChatRequest {
  model: ChatModel;
  messages: Array<{ role: string; content: string }>;
  permissions: Record<string, unknown>;
  members: string[];
}
export interface ChatEnvelope { threadId: string; attemptId: string }
export interface ChatApproval extends ChatEnvelope {
  id: string; peerId: string; expiresAt: number; [key: string]: unknown;
}
export interface ChatResult extends ChatEnvelope {
  modelId: string; modelIdentity: string; adapterIdentities: string[];
  content: string; execution?: Record<string, unknown>;
}
export interface ChatAttempt {
  id: string;
  threadId: string;
  userMessageId: string;
  responseId: string;
  retryOf: string | null;
  status: string;
  createdAt: number;
  finishedAt: number | null;
  error: string | null;
  approval: ChatApproval | null;
  execution: Record<string, unknown> | null;
  request: ChatRequest;
}
export interface ChatThread {
  id: string; model: ChatModel; purpose: string; members: string[];
  permissions: Record<string, unknown>; messages: ChatMessage[];
  attempts: ChatAttempt[]; closed: boolean; createdAt: number;
}
export interface ChatState {
  schema: 'reploid.chat-workspace/v1'; meshId: string; participantId: string;
  threads: ChatThread[]; selectedId: string | null; runningIds: string[]; storageError: string | null;
}
export interface ChatControls {
  signal: AbortSignal;
  onDelta(envelope: ChatEnvelope & { text: string; sequence: number }): void;
  onState(envelope: ChatEnvelope & { status: string; execution?: Record<string, unknown> }): void;
  requestApproval(preview: ChatApproval): Promise<boolean>;
}
export function createChatWorkspace(options: {
  meshId: string; participantId: string;
  store: { load(): unknown; save(state: unknown): void };
  execute(request: ChatRequest & ChatEnvelope & { meshId: string; participantId: string }, controls: ChatControls): Promise<ChatResult>;
  policy?: ChatPolicy; now?: () => number; id?: () => string;
}): {
  getState(): ChatState;
  subscribe(listener: (state: ChatState) => void): () => void;
  createThread(options: { model: ChatModel; purpose?: string; members?: string[]; permissions?: Record<string, unknown> }): string;
  select(threadId: string | null): void;
  closeThread(threadId: string): void;
  reopenThread(threadId: string): void;
  send(threadId: string, content: string): Promise<ChatAttempt>;
  retry(threadId: string, attemptId: string): Promise<ChatAttempt>;
  approve(threadId: string, attemptId: string, previewId: string, accepted: boolean): void;
  cancel(threadId: string): Promise<unknown>;
  close(): Promise<void>;
};
export interface ScheduledChatRequest extends ChatRequest, ChatEnvelope {
  participantId: string; maxOutputTokens: number;
  model: ChatModel & { identity: string };
}
export interface ResidentChatSession {
  reset(): void | Promise<void>;
  setAdapters(adapters: NonNullable<ChatModel['adapters']>, options: { signal?: AbortSignal }): void | Promise<void>;
  run(request: ScheduledChatRequest, controls: { signal: AbortSignal; onDelta(delta: string): void }): Promise<unknown>;
  close(): void | Promise<void>;
}
export function createChatScheduler(options: {
  open(model: ChatModel, controls: { signal: AbortSignal }): Promise<ResidentChatSession>;
  observe(observation: Record<string, unknown>): void | Promise<void>;
  policy?: ChatPolicy; now?: () => number;
}): {
  getState(): { queued: number; activeAttemptId: string | null; residentIdentity: string | null; closed: boolean };
  schedule(request: ScheduledChatRequest, controls: {
    signal: AbortSignal; onDelta?(delta: string): void; onState?(status: string): void;
  }): Promise<unknown>;
  close(): Promise<void>;
};
