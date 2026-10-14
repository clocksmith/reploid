import type { PartitionRoute } from '../mesh/partitions/partition-contract.js';
import type { PartitionActivity } from '../mesh/partitions/partition-summary.js';
import type { PartitionGenerationRequest, PartitionTokenUsage } from '../mesh/partitions/partition-generation-request.js';
export { openCanonicalWorkspaceHistory } from './workspace-history.js';
import type { CanonicalWorkspaceHistory } from './workspace-history.js';
import type { CanonicalPublicationPort } from '../mesh/partitions/partition-canonical-execution.js';
import type { EntryPublicationRecord } from '../mesh/partitions/partition-entry-publication.js';
export { createConversationPublication } from './workspace-publication.js';
export type { TransactionalChatStore, PublicationReceipt } from './workspace-publication.js';
export interface ChatModel {
  id: string;
  name: string;
  identity: string;
  adapters?: Array<{ identity: string; [key: string]: unknown }>;
  [key: string]: unknown;
}
export interface ChatPolicy {
  maxThreads: number;
  maxThreadGrants: number;
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
  generationRequest?:PartitionGenerationRequest;
  model: ChatModel;
  messages: Array<{ role: string; content: string }>;
  permissions: Record<string, unknown>;
  members: string[];
}
export interface ChatEnvelope { threadId: string; attemptId: string }
export interface ChatApproval extends ChatEnvelope {
  id: string; peerId: string; expiresAt: number; recipientIdentity?: string | null; reusable?: boolean; [key: string]: unknown;
}
export interface ChatThreadGrant {
  id: string; meshId: string; threadId: string; recipientIdentity: string;
  modelId: string; modelIdentity: string; adapterIdentities: string[];
  sharingScope: string; disclosure: 'public' | 'partition-activations' | 'partition-activations-and-tokens' | 'ordered-partition-activations-and-tokens';
  planId?: string; participantA?: string; route?: PartitionRoute; requesterIdentity?: string; createdAt: number; revokedAt: number | null;
}
export interface ChatResult extends ChatEnvelope {
  modelId: string; modelIdentity: string; adapterIdentities: string[];
  content: string; usage?:PartitionTokenUsage; execution?: Record<string, unknown>;
}
export interface ChatAttempt {
  publicationMode?: 'canonical';
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
  authorization: { kind: 'once' | 'thread-grant'; grantId: string | null; peerId: string; recipientIdentity?: string | null;
    source?: 'send'; expiresAt?: number; modelId?: string; modelIdentity?: string; adapterIdentities?: string[];
    participantA?: string; planId?: string; route?: PartitionRoute; requesterIdentity?: string; sharingScope?: string; disclosure?: string } | null;
  execution: Record<string, unknown> | null;
  request: ChatRequest;
  systemContext?: ChatSystemContext | null;
}
export interface ChatThread {
  id: string; model: ChatModel; purpose: string; title?: string; members: string[];
  permissions: Record<string, unknown>; grants: ChatThreadGrant[]; messages: ChatMessage[];
  attempts: ChatAttempt[]; closed: boolean; createdAt: number;
  systemContext?: ChatSystemContext | null;
}
export interface ChatSystemContext { content: string; metadata: Record<string, unknown> }
export interface ChatState {
  schema: 'reploid.chat-workspace/v1'; meshId: string; participantId: string;
  threads: ChatThread[]; selectedId: string | null; runningIds: string[]; storageError: string | null;
  ephemeralExecutions?: Array<ChatEnvelope & {status:string;approval:ChatApproval|null;execution:Record<string,unknown>|null}>;
  limits: { maxThreads: number; maxMessageCharacters: number };
}
export interface ChatControls {
  onActivity?(activity:ChatEnvelope & PartitionActivity):void|Promise<void>;
  onUsage?(usage:ChatEnvelope & PartitionTokenUsage):void|Promise<void>;
  publication?:CanonicalPublicationPort;publisherEpoch?:string;onPublished?:(record:EntryPublicationRecord)=>Promise<void>;
  signal: AbortSignal;
  onDelta(envelope: ChatEnvelope & { text: string; sequence: number }): void;
  onState(envelope: ChatEnvelope & { status: string; execution?: Record<string, unknown> }): void;
  requestApproval(preview: ChatApproval): Promise<boolean>;
}
/** Live host authorization for this Send/Retry only. Never persisted or reused. */
export interface ChatSendOptions {
  select?: boolean;
  authorizeDisclosure?: ((input: { request: ChatRequest & ChatEnvelope; preview: ChatApproval }) => boolean) | null;
}
export interface ChatWorkspaceOptions {
  meshId: string; participantId: string;
  /** Host-authenticated peer identity that execution binds into ordered requester disclosure; null until
   * authenticated. Defaults to participantId for hosts whose history participant is that peer. */
  requesterIdentity?: () => string | null;
  store: { load(): unknown; save(state: unknown): void };
  execute(request: ChatRequest & ChatEnvelope & { meshId: string; participantId: string }, controls: ChatControls): Promise<ChatResult>;
  policy?: ChatPolicy; now?: () => number; id?: () => string;
}
export interface ChatAttemptCompletion extends Promise<ChatAttempt> { readonly admitted?:Promise<void>; }
export interface ChatWorkspace {
 authorizePublication(scope:{conversationId:string;writerEpoch:string;action:string;attempt: {attemptId:string;requesterId:string;stages?:readonly {participantId:string}[]} | null}):boolean;
  getState(): ChatState;
  subscribe(listener: (state: ChatState) => void): () => void;
  createThread(options: { model: ChatModel; purpose?: string; members?: string[]; permissions?: Record<string, unknown>; systemContext?: ChatSystemContext | null }): string;
  setSystemContext(threadId: string, value: ChatSystemContext | null): void;
  select(threadId: string | null): void;
  renameThread(threadId: string, title: string): void;
  closeThread(threadId: string): void;
  reopenThread(threadId: string): void;
  send(threadId: string, content: string, options?: ChatSendOptions): ChatAttemptCompletion;
  retry(threadId: string, attemptId: string, options?: Pick<ChatSendOptions, 'authorizeDisclosure'>): ChatAttemptCompletion;
  approve(threadId: string, attemptId: string, previewId: string, accepted: boolean, options?: { remember?: boolean }): void;
  revokeGrant(threadId: string, grantId: string): void;
  cancel(threadId: string): Promise<unknown>;
  close(): Promise<void>;
}
export type TransactionalChatWorkspace = Omit<ChatWorkspace,'createThread'|'setSystemContext'|'renameThread'|'closeThread'|'reopenThread'|'approve'|'revokeGrant'> & {
 createThread(input:Parameters<ChatWorkspace['createThread']>[0]):Promise<string>;
 setSystemContext(...input:Parameters<ChatWorkspace['setSystemContext']>):Promise<void>;
 renameThread(...input:Parameters<ChatWorkspace['renameThread']>):Promise<void>;
 closeThread(...input:Parameters<ChatWorkspace['closeThread']>):Promise<void>;
 reopenThread(...input:Parameters<ChatWorkspace['reopenThread']>):Promise<void>;
 approve(...input:Parameters<ChatWorkspace['approve']>):void|Promise<void>;
 revokeGrant(...input:Parameters<ChatWorkspace['revokeGrant']>):void|Promise<void>;
};
export function createChatWorkspace(options:Omit<ChatWorkspaceOptions,'store'> & {store:CanonicalWorkspaceHistory}):TransactionalChatWorkspace;
export function createChatWorkspace(options:ChatWorkspaceOptions):ChatWorkspace;
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
  prepare(model: ChatModel): Promise<void>;
  close(): Promise<void>;
};
