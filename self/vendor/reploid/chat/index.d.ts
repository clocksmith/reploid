import type { PartitionRoute } from '../mesh/partitions/partition-contract.js';
import type { PartitionActivity } from '../mesh/partitions/partition-summary.js';
import type { PartitionGenerationRequest, PartitionTokenUsage } from '../mesh/partitions/partition-generation-request.js';
export { openCanonicalWorkspaceHistory } from './workspace-history.js';
import type { CanonicalWorkspaceHistory } from './workspace-history.js';
import type { CanonicalPublicationPort } from '../mesh/partitions/partition-canonical-execution.js';
import type { EntryPublicationRecord } from '../mesh/partitions/partition-entry-publication.js';
import type { OrderedPublicationPort } from '../mesh/partitions/partition-ordered-publication.js';
export { createConversationPublication } from './workspace-publication.js';
export { REMOTE_PERMISSION_SCHEMA, PERMISSION_KINDS, REMOTE_DISCLOSURES, remoteDisclosureKind, remotePermissionNeed, remotePermissionCovers,
  createRemotePermission, validateRemotePermission, validPermissionWording } from './remote-permission.js';
export { SEARCH_PERMISSION_KIND, SEARCH_RECIPIENTS_CHANGED, searchPermissionWording, createSearchPermission,
  validateSearchPermission } from './search-permission.js';
export { ANSWER_PROVENANCE_SCHEMA, SUPPLY_CLASSES, HOSTED_EXECUTION_REFUSED, UNRECOGNIZED_EXECUTION_REFUSED, supplyOf,
  classifyExecutionSupply, executionRefusal, retrievalSupply, attemptExecutionSupply, answerProvenance } from './supply-provenance.js';
export type { SupplyClass, SupplyLabel, ExecutionPlacement, SupplyParticipant, ExecutionSupply, RetrievalSupply, AnswerProvenance,
  HostedExecutionRecord } from './supply-provenance.js';
import type { AnswerProvenance } from './supply-provenance.js';
import type { RemotePermission, RemotePermissionNeed } from './remote-permission.js';
import type { SearchPermission } from './search-permission.js';
import type { RetrievalPorts, RetrievalRecord, RetrievalRequest, RetrievalRequestInput } from '../retrieval/index.js';
export type { RemotePermission, RemotePermissionNeed, PermissionWording, PermissionKind } from './remote-permission.js';
export type { SearchPermission } from './search-permission.js';
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
  /** The requester's opt-in to retrieval for this request. Executors never receive it; they receive the sources in messages. */
  retrieval?: RetrievalRequest & { route?: string };
}
export interface ChatEnvelope { threadId: string; attemptId: string }
export interface ChatApproval extends ChatEnvelope {
  id: string; peerId: string; expiresAt: number; recipientIdentity?: string | null; reusable?: boolean;
  /** Optional bounded execution window beginning when first-use permission is granted. */
  executionTimeoutMs?: number;
  /** Set by the workspace when no stored remote permission covers this disclosure; nothing is sent meanwhile. */
  permissionNeed?: RemotePermissionNeed;
  [key: string]: unknown;
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
  /** Text is authoritative only in requester-owned publication records (canonical or ordinary ordered). */
  publicationMode?: 'canonical' | 'whole-model';
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
  /** kind 'permission' cites the stored remote permission (permissionId). recipients are the verified executors this
   * attempt was dispatched to, in order: route stages, the split pair, or the one recipient. */
  authorization: { kind: 'once' | 'thread-grant' | 'permission'; grantId: string | null; permissionId?: string; peerId: string; recipientIdentity?: string | null;
    source?: 'send' | 'approval' | 'permission'; recipients?: string[]; expiresAt?: number; modelId?: string; modelIdentity?: string; adapterIdentities?: string[];
    participantA?: string; planId?: string; route?: PartitionRoute; requesterIdentity?: string; sharingScope?: string; disclosure?: string } | null;
  execution: Record<string, unknown> | null;
  request: ChatRequest;
  systemContext?: ChatSystemContext | null;
  /** Present when the request opted into retrieval: query, sources with provenance, failure and citation verification.
   * The sources were disclosed with the request's messages under `authorization`. */
  retrieval?: RetrievalRecord;
  /** The per-answer search permission this attempt was sent under; its passages reached only the listed recipients. */
  searchPermission?: SearchPermission;
  /** Terminal attempts: execution supply (this attempt and its retry lineage) and retrieval supply, from execution and route records. */
  provenance?: AnswerProvenance;
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
  publication?:CanonicalPublicationPort & OrderedPublicationPort;publisherEpoch?:string;onPublished?:(record:EntryPublicationRecord)=>Promise<void>;
  signal: AbortSignal;
  onDelta(envelope: ChatEnvelope & { text: string; sequence: number }): void;
  onState(envelope: ChatEnvelope & { status: string; execution?: Record<string, unknown> }): void;
  requestApproval(preview: ChatApproval): Promise<boolean>;
  authorizationExpiresAt?(): number | null;
}
/** Live host authorization for this Send/Retry only. Never persisted or reused. */
export interface ChatSendOptions {
  select?: boolean;
  /** Receives the request as dispatched, retrieved sources included, with its retrieval record. */
  authorizeDisclosure?: ((input: { request: Omit<ChatRequest, 'retrieval'> & ChatEnvelope & { retrieval?: RetrievalRecord };
    preview: ChatApproval }) => boolean) | null;
  /** Opts this request into retrieval-backed answering; requires the workspace `retrieval` ports. `route` names one of `retrieval.routes`. */
  retrieval?: (RetrievalRequestInput & { route?: string }) | null;
  /** Required by a search-answer route, for this answer only; refused anywhere else. */
  searchPermission?: SearchPermission | null;
}
/** One retrieval route. A search-answer route needs a per-answer search permission and sends only the question and passages. */
export type ChatRetrievalRoute = RetrievalPorts & { permission?: 'search-answer'; provider: RetrievalPorts['provider'] & { searchProvider?: string } };
export interface ChatWorkspaceOptions {
  meshId: string; participantId: string;
  /** Host-authenticated peer identity that execution binds into ordered requester disclosure; null until
   * authenticated. Defaults to participantId for hosts whose history participant is that peer. */
  requesterIdentity?: () => string | null;
  /** The host's stored remote contributor permissions. When supplied, every remote disclosure needs one that covers it. */
  remotePermissions?: (() => readonly RemotePermission[]) | null;
  /** The network (room) a remote request is sent on; permissions cover only the network they were granted on. Defaults to meshId. */
  networkId?: () => string;
  /** Search provider, optional passage extractor and support checker, or named routes of them. Without them, retrieval requests are refused. */
  retrieval?: RetrievalPorts | { routes: Record<string, ChatRetrievalRoute> } | null;
  store: { load(): unknown; save(state: unknown): void };
  execute(request: ChatRequest & ChatEnvelope & { meshId: string; participantId: string }, controls: ChatControls): Promise<ChatResult>;
  policy?: ChatPolicy; now?: () => number; id?: () => string;
}
export interface ChatAttemptCompletion extends Promise<ChatAttempt> { readonly admitted?:Promise<void>; }
export interface ChatWorkspace {
 authorizePublication(scope:{conversationId:string;writerEpoch:string;action:string;attempt: {attemptId:string;requesterId:string;
  schema?:string;threadId?:string;route?:PartitionRoute;stages?:readonly {participantId:string}[]} | null}):boolean;
  getState(): ChatState;
  subscribe(listener: (state: ChatState) => void): () => void;
  createThread(options: { model: ChatModel; purpose?: string; members?: string[]; permissions?: Record<string, unknown>; systemContext?: ChatSystemContext | null }): string;
  setExecutionLocation(threadId: string, location: 'auto' | 'local' | 'network'): void;
  setSystemContext(threadId: string, value: ChatSystemContext | null): void;
  select(threadId: string | null): void;
  renameThread(threadId: string, title: string): void;
  closeThread(threadId: string): void;
  reopenThread(threadId: string): void;
  send(threadId: string, content: string, options?: ChatSendOptions): ChatAttemptCompletion;
  /** Retrieves again under the same limits. A changed query and every search-answer retry require a fresh searchPermission. */
  retry(threadId: string, attemptId: string, options?: Pick<ChatSendOptions, 'authorizeDisclosure' | 'searchPermission'> & { retrievalQuery?: string | null }): ChatAttemptCompletion;
  /** Decline cancels only this attempt. Accepting is refused when the host supplies remotePermissions. */
  approve(threadId: string, attemptId: string, previewId: string, accepted: boolean, options?: { remember?: boolean }): void;
  /** Continues waiting attempts a stored permission now covers; returns how many. */
  resumePermitted(): number;
  revokeGrant(threadId: string, grantId: string): void;
  cancel(threadId: string): Promise<unknown>;
  close(): Promise<void>;
}
export type TransactionalChatWorkspace = Omit<ChatWorkspace,'createThread'|'setExecutionLocation'|'setSystemContext'|'renameThread'|'closeThread'|'reopenThread'|'approve'|'revokeGrant'|'resumePermitted'> & {
 createThread(input:Parameters<ChatWorkspace['createThread']>[0]):Promise<string>;
 setExecutionLocation(...input:Parameters<ChatWorkspace['setExecutionLocation']>):Promise<void>;
 setSystemContext(...input:Parameters<ChatWorkspace['setSystemContext']>):Promise<void>;
 renameThread(...input:Parameters<ChatWorkspace['renameThread']>):Promise<void>;
 closeThread(...input:Parameters<ChatWorkspace['closeThread']>):Promise<void>;
 reopenThread(...input:Parameters<ChatWorkspace['reopenThread']>):Promise<void>;
 approve(...input:Parameters<ChatWorkspace['approve']>):void|Promise<void>;
 revokeGrant(...input:Parameters<ChatWorkspace['revokeGrant']>):void|Promise<void>;
 resumePermitted():Promise<number>;
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
