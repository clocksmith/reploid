import type { CanonicalRunnerRuntime } from './partition-canonical-execution.js';
import type { SigningIdentity } from '../../artifacts/identity.js';
import type { ChatModel, ChatRequest, ChatControls, ChatResult } from '../../chat/index.js';
import type { PartitionPlan, PartitionRuntime, PartitionLimits, PartitionAttemptReceipt } from './partition-runner.js';
import type { ResidentPartition, ResidentPartitionDescriptor, PartitionReservationsState } from './resident-partition.js';
import type { PartitionChannelLimits } from '../../transport/partition-data-channel.js';
import type { PartitionNetwork } from './partition-network.js';
export interface PartitionCapability {
  transportId: string; participantId: string; observedAt: number; expiresAt: number;
  available: boolean; reason: string; description: Record<string, unknown> | null;
}
export interface AutomaticPartitionState {
  capabilities: PartitionCapability[];
  placementDecision: { participants: string[]; reason: string; eligibility: Array<{
    participantId: string; transportId: string; observedAt: number; expiresAt: number; reason: string; index: 0 | 1 | null;
  }> } | null;
  reservations: PartitionReservationsState | null; attempts: PartitionAttemptReceipt[];
  phase: 'idle' | 'waiting' | 'loading' | 'ready' | 'stopping' | 'failed'; error: string | null;
  unsettledOwners: number;
  offering: boolean; modelId: string | null; placement: string[] | null;
  descriptor: ResidentPartitionDescriptor | null; acquisition: unknown; models: ChatModel[];
}
export interface AutomaticPartitionPolicy {
  pollMs: number; maxPeers: number; connectTimeoutMs: number; grantMs: number; grantClockSkewMs?: number;
  limits: PartitionLimits; inputChannel: PartitionChannelLimits;
  executionChannel: PartitionChannelLimits; controlChannel: PartitionChannelLimits;
  inputLimits: { maxInputCharacters: number; maxOutputCharacters: number; maxAttempts: number;
    maxConcurrentAttempts: number; descriptorTtlMs: number };
  receiver: { maxAttempts: number; maxSteps: number };
}
export interface AutomaticPartitions {
  getState(): AutomaticPartitionState; getModels(): ChatModel[];
  subscribe(listener: (models: ChatModel[]) => void): () => void;
  contribute(modelId: string, approved: boolean): Promise<void>;
  stop(): Promise<void>; close(): Promise<void>;
  generate(request: ChatRequest & { threadId: string; attemptId: string }, controls: ChatControls): Promise<ChatResult>;
}
export interface AutomaticPartitionOptions {
  ordered?: never;
  canonical?:{runtime:PartitionRuntime & CanonicalRunnerRuntime;coordinatorEpoch:string;participantEpoch:string}|null;
  identity: SigningIdentity; meshId: string; models: ChatModel[]; policy: AutomaticPartitionPolicy;
  peers(): Array<{ id: string; localTransportId: string }>;
  createNetwork<T extends { close(): void | Promise<void> }>(options: {
    label: string; maxPeers: number; timeoutMs: number;
    createEndpoint(options: { channel: RTCDataChannel; remoteParticipantId: string }): T;
    onPeer?(transportId: string, endpoint: T): void;
  }): PartitionNetwork<T>;
  loadProgram(model: ChatModel, index: 0 | 1, controls: { signal: AbortSignal; participantId: string;
    canonical?:{identity:SigningIdentity;participantEpoch:string};
    /** Retained if loading rejects; a successful returned resident assumes this ownership. */
    /** Release the registration only after this owner's cleanup succeeds. */
    registerCleanup(owner: { close(): void | Promise<void> }): () => void;
    onProgress(value: unknown): void }): Promise<{ runtime: PartitionRuntime; model: ChatModel;
      plan: PartitionPlan; planId: string; resident: ResidentPartition; getReceipt?(): unknown }>;
  onChange?(state: AutomaticPartitionState & { progress?: unknown }): void;
}
export function createAutomaticPartitions(options: AutomaticPartitionOptions): AutomaticPartitions;

export interface OrderedAutomaticPartitionOptions extends Omit<AutomaticPartitionOptions,
  'ordered' | 'canonical' | 'policy' | 'loadProgram' | 'createNetwork' | 'onChange'> {
  canonical?: null;
  /** Null stage is a weightless requester. Hosts declare actual allocation identity and geometry. */
  ordered: { stage: import('./partition-contract.js').PartitionRouteStage | null;
    maxRouteBytes: number; maxSelectionSteps: number; maxRoutes: number;
    /** Launch 3 mechanisms; each is off unless its member is present. */
    orchestration?: OrderedOrchestration };
  policy: Omit<AutomaticPartitionPolicy, 'limits'> & {
    maxStageOffersPerPeer: number; limits: import('./partition-route-execution.js').OrderedRouteLimits };
  createNetwork: {
    <T extends { close(): void | Promise<void> }>(options: Omit<import('./partition-route-network.js').RoutePartitionNetworkOptions<T>,
      'transport' | 'verifyPeer'>): import('./partition-route-network.js').RoutePartitionNetwork<T>;
    <T extends { close(): void | Promise<void> }>(options: { label: string; maxPeers: number; timeoutMs: number;
      createEndpoint(options: { channel: RTCDataChannel; remoteParticipantId: string }): T;
      onPeer?(transportId: string, endpoint: T): void }): PartitionNetwork<T>;
  };
  loadProgram(model: ChatModel, index: number, controls: { signal: AbortSignal; participantId: string;
    ordered: { stage: import('./partition-contract.js').PartitionRouteStage };
    registerCleanup(owner: { close(): void | Promise<void> }): () => void;
    onProgress(value: unknown): void }): Promise<{ runtime: import('./partition-route-execution.js').OrderedExecutionRuntime;
      model: ChatModel; plan: import('./partition-route-execution.js').OrderedExecutionPlan; planId: string;
      resident: import('./resident-partition.js').OrderedResidentPartition; getReceipt?(): unknown }>;
  onChange?(state: OrderedAutomaticPartitionState & { progress?: unknown }): void;
}
export interface OrderedOrchestration {
  /** The operator chose `auto`: this contributor's own policy picks its stage (stage must be null).
   * It re-evaluates only while idle and at least `dwellMs` after becoming ready. */
  autoStage?: { transportId: string; dwellMs: number };
  /** A coordinator ranks complete routes for new attempts by measured prefill and decode; a measured
   * route must be cheaper by `margin` while the current one is admissible and idle. */
  routeRanking?: { margin: number; smoothing: number; maxObservations: number;
    workload: { promptTokens: number; expectedTokens: number } };
}
export interface OrderedAutomaticPartitionState extends Omit<AutomaticPartitionState,
  'placementDecision' | 'reservations' | 'attempts' | 'descriptor'> {
  placementDecision: { route: import('./partition-contract.js').PartitionRoute | null; reason: string;
    selectionSteps?: number; eligibility?: readonly unknown[]; measured?: boolean; cost?: number | null; ranking?: 'work-limit' } | null;
  reservations: import('./resident-partition.js').OrderedResidentState['reservations'] | null;
  descriptor: import('./resident-partition.js').OrderedResidentState['descriptor'];
  attempts: import('./partition-route-execution.js').OrderedRouteReceipt[];
  /** Receipts of retired routes whose cleanup was never confirmed. */
  unknownAttempts: import('./partition-route-execution.js').OrderedRouteReceipt[];
  /** Present only with `orchestration.autoStage`: the latest own-stage decision. */
  assignment?: (import('./partition-stage-assignment.js').StageAssignmentDecision & { decidedAt: number }) | null;
  /** Present only with `orchestration.routeRanking`. */
  routeObservations?: import('./partition-route-ranking.js').RouteObservation[];
}
export interface OrderedAutomaticPartitions extends Omit<AutomaticPartitions, 'getState'> {
  getState(): OrderedAutomaticPartitionState;
}
export function createAutomaticPartitions(options: OrderedAutomaticPartitionOptions): OrderedAutomaticPartitions;
