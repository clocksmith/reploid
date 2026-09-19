import type { ExecutionEvent, ToolCall } from './engine-contracts.js';
export type { ExecutionEvent, ExecutionEventType, ToolCall, ToolAuthorization } from './engine-contracts.js';
import type { Json, ResolvedConfig } from '../config/index.js';
import type { Store } from '../artifacts/store.js';
import type { ResponseParserInstance } from '../agent/response-parser.js';
export { createAgentRuntime } from '../agent/runtime.js';
export { createToolRunner } from '../agent/tool-runner.js';
export { default as ResponseParser } from '../agent/response-parser.js';

export interface Message { role: string; content: string; origin?: string }
export type AgentStatus = 'IDLE' | 'RUNNING' | 'PARKED' | 'LIMIT' | 'ERROR' | 'CLOSED';
/** Evidence from a generic host provider is untrusted until narrowed by its adapter. */
export interface GenerationResult {
  content: string; raw?: string; toolCalls?: ToolCall[]; model?: string | null; requestedModel?: string;
  provider?: string | null; execution?: 'compatibility' | 'verified-operation' | 'local-scoped-session' | 'cloud-proxy-session';
  evidence?: unknown;
}
export type ToolOutcome<T = Json> = { status: 'completed'; value: T } | { status: 'failed' | 'denied' | 'cancelled'; error: string };
export interface DisclosureRequest { action: 'peer.disclose'; providerId: string; payloadDigest: string; expiresAt: number }
export interface AgentCheckpointState {
  schema: 'reploid.agent-checkpoint/v1'; instanceId: string; goal: string; environment: string;
  cycle: number; messages: Message[]; tokenUsage: number; rgrArchive: Json[];
  latestRgrReceiptPath: string; candidateCount: number; toolCallCount: number; errorCount: number;
}
export interface AgentCheckpoint { schema: 'reploid.checkpoint/v1'; instanceId: string; configHash: string; digest: string; state: AgentCheckpointState }
export interface Control { signal?: AbortSignal }
export interface GenerationProvider { generate(messages: Message[], onUpdate?: ((chunk: string) => void) | null, control?: Control): Promise<GenerationResult> }
export interface Closable { close(): void | Promise<void> }
export type AuthorizationRequest =
  | { action: 'agent.execute'; instanceId: string; goal: string }
  | { action: 'mesh.connect'; instanceId: string; roomId: string | null }
  | { action: 'tool.execute'; instanceId?: string; name: string; args: Record<string, unknown> };
export type Authorize = (request: AuthorizationRequest) => boolean | Promise<boolean>;
export interface AgentPorts {
  initialContext(request: { goal: string; environment: string; swarmEnabled: boolean; signal: AbortSignal }): Promise<Message[]>;
  generate: GenerationProvider['generate'];
  executeTool(name: string, args: Record<string, unknown>, control?: Control): Promise<unknown> | unknown;
  getModelLabel(): string;
  getModelConfig(): unknown;
  authorize?: Authorize;
  initialize?(control?: Control): Promise<unknown>;
  on?(event: string, listener: (value: unknown) => void): (() => void) | void;
  listToolNames?(): string[];
  getSwarmSnapshot?(): unknown;
  hasAvailableProvider?(): boolean;
  writeRuntimeArtifact?(path: string, content: string): Promise<unknown>;
  getAnchorObservations?(request: Record<string, unknown>): Promise<unknown[]>;
  rotateIdentity?(input?: object): Promise<unknown>;
}
export interface AgentSnapshot {
  instanceId: string; status: AgentStatus; running: boolean; goal: string | null; context: Message[];
  [field: string]: unknown;
}
export interface ReploidPorts {
  instanceId: string; authorize: Authorize; onExecutionEvent?(event: ExecutionEvent): void; agent?: AgentPorts; responseParser?: ResponseParserInstance;
  providers?: Record<string, GenerationProvider>; mesh?: GenerationProvider & { connect(): Promise<unknown>; describe?(): unknown };
  tools?: Record<string, (args: Record<string, unknown>, control?: Control) => unknown | Promise<unknown>>;
  initialContext?: AgentPorts['initialContext']; stores?: Record<string, Store>; crypto?: Crypto; owned?: Closable[];
}
export interface ReploidInstance extends Closable {
  readonly config: ResolvedConfig; readonly instanceId: string;
  prepare(request: { goal: string; environment?: string }): AgentSnapshot;
  execute(request: { goal: string; environment?: string }): Promise<AgentSnapshot>;
  connect(): Promise<unknown>;
  on(event: string, listener: (value: unknown) => void): () => void;
  subscribe(listener: (snapshot: AgentSnapshot) => void): () => void;
  getSnapshot(): AgentSnapshot; getExecutionEvents(): ExecutionEvent[]; cancel(): void;
  checkpoint(): Promise<AgentCheckpoint>; restore(checkpoint: AgentCheckpoint): Promise<AgentSnapshot>;
  close(): Promise<void>;
}
export function createReploid(options: { config: ResolvedConfig; ports: ReploidPorts }): ReploidInstance;

export { CYCLE_ARTIFACT_ROOT, getCycleId, getCycleArtifactPath, createCycleArtifactWriter } from '../agent/cycle-artifacts.js';
