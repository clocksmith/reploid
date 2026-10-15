import type { PartitionActivity } from './partition-summary.js';
import type { OrderedPartitionPlan, OrderedPartitionRuntime, PartitionRoute, RouteAttemptBinding } from './partition-contract.js';
import type { ActivationTensor, ActivationFrame } from './partition-runner.js';
import type { OrderedPublicationStep } from './partition-ordered-publication.js';
import type { AcknowledgedOutput, OutputAcknowledgment, StageReceipt } from './partition-attempt-evidence.js';
export interface OrderedExecutionPlan extends OrderedPartitionPlan {
  hiddenSize: number; vocabSize: number; totalLayers: number;
}
export interface OrderedExecutionRuntime extends OrderedPartitionRuntime {
  hashPartitionGeneration(generation: Record<string, unknown>): string | Promise<string>;
  serializeActivationFrame(tensor: ActivationTensor & { metadata: Record<string, unknown> }): ActivationFrame;
}
export interface OrderedStep {
  step: number; tokenPosition: number; inputTokenCount: number; maxTokens: number; generationDigest: string;
}
export interface OrderedStageBinding { identity: RouteAttemptBinding; partitionIndex: number }
export interface OrderedReservation extends OrderedStageBinding { status: 'reserved' }
export interface OrderedStageResult extends OrderedStageBinding {
  step: number; tokenPosition: number; continuation: unknown;
  activationTensor?: ActivationTensor; tokenId?: number; delta?: string; done?: boolean; stopReason?: string;
  logits?: Float32Array | number[]; metrics?: Record<string, unknown>;
  /** A stage's signed cumulative receipt of a charged attempt. */
  receipt?: StageReceipt;
}
export interface OrderedStageDevice {
  id: string; transportId: string; residentId: string; executionId: string;
  reserve(options: OrderedStageBinding & { inputTokenCount: number; maxTokens: number; generationDigest: string;
    generation: Record<string, unknown> & { maxTokens: number }; executionGrant: object; charge?: OutputAcknowledgment; signal: AbortSignal }): Promise<OrderedReservation>;
  executeStage(options: OrderedStageBinding & OrderedStep & { inputTokenIds: number[];
    generation: Record<string, unknown> & { maxTokens: number }; continuation: unknown; activation?: unknown;
    executionGrant: object; tokenContextGrant: object; incomingActivationGrant?: object; outgoingActivationGrant?: object; outputGrant?: object;
    acknowledged?: AcknowledgedOutput; signal: AbortSignal }): Promise<OrderedStageResult>;
  closeAttempt(options: OrderedStageBinding & { acknowledged?: AcknowledgedOutput }): Promise<void>;
}
export interface OrderedRouteLimits {
  maxTokens: number; maxPromptTokens: number; maxActivationBytes: number; maxOutputCharacters: number;
  maxAttempts: number; maxConcurrentAttempts: number; maxStages: number;
}
export interface OrderedRouteRequest {
  identity: RouteAttemptBinding; tokenIds: number[]; generation: Record<string, unknown> & { maxTokens: number };
  grants: { execution: object[]; tokenContext: object[]; activation: object[]; output: object };
  maxTokens: number; signal?: AbortSignal; onActivity?: (activity:PartitionActivity)=>void|Promise<void>; onDelta?: (delta: string) => void | Promise<void>;
  /** Awaited after each final-stage result and before activity, delivery or the next step; holds no stage lease. */
  onStep?: ((step: OrderedPublicationStep) => void | Promise<void>) | null;
  /** The requester's signed binding of this attempt to its reservation, given to every stage's reservation. */
  charge?: OutputAcknowledgment | null;
  /** A charged step s waits, until this ms-epoch deadline at most, for acknowledgments of s - K outputs; then ACKNOWLEDGMENT_OVERDUE. */
  acknowledgmentDeadlineAt?: number | null;
  /** Each final-stage output with its receipt; the answer, if any, is the requester's acknowledgment. Not awaited before the next step. */
  onOutput?: ((output: { step: number; delta: string; done: boolean; receipt: StageReceipt | null }) => AcknowledgedOutput | null | Promise<AcknowledgedOutput | null>) | null;
}
export interface OrderedRouteReceipt {
  identity: RouteAttemptBinding; phase: 'admitting' | 'executing' | 'settling' | 'cleanup-failed' | 'completed' | 'cancelled' | 'failed';
  reservations: OrderedReservation[]; cleanup: Array<{ partitionIndex: number; status: 'settled' | 'unknown'; error: string | null; code?: 'CONNECTION_LOST' }>;
  cleanupSettledAt: number | null; failure: string | null;
  /** Charged attempts only: the bound K and the measured waits for acknowledgments. */
  acknowledgments?: { bound: number; waits: number; waitedMs: number };
}
export interface OrderedRouteResult {
  content: string; tokenIds: number[]; logits: Float32Array | number[] | null; stopReason: string;
  execution: { schema: 'reploid.mesh.partition-execution/v3'; identity: RouteAttemptBinding; activationBytes: number; stopReason: string;
    steps: Array<OrderedStep & { tokenId: number; stages: Array<{ partitionIndex: number; elapsedMs: number; metrics: Record<string, unknown> | null }> }>;
    settlement: OrderedRouteReceipt };
}
export interface OrderedRouteRunner {
  plan: OrderedExecutionPlan; route: PartitionRoute;
  execute(request: OrderedRouteRequest): Promise<OrderedRouteResult>;
  getState(): { closed: boolean; active: number; unsettled: number; unknown: number; attempts: OrderedRouteReceipt[] };
  retryCleanup(attemptId: string): Promise<void>;
  close(): Promise<void>;
}
export interface OrderedRouteRunnerOptions {
  runtime: OrderedExecutionRuntime; plan: OrderedExecutionPlan; route: PartitionRoute;
  stages: OrderedStageDevice[]; canonical?: false; limits: OrderedRouteLimits;
  transport: { transferActivation(frame: ActivationFrame, options: OrderedStep & { identity: RouteAttemptBinding;
    fromStage: number; toStage: number; coordinatorId: string; recipients: string[]; signal: AbortSignal }): Promise<ActivationFrame> };
  authorize(options: { action: 'mesh.execute_partition_stage' | 'mesh.transfer_token_context'
    | 'mesh.transfer_intermediate_activation' | 'mesh.transfer_partition_output'; grant: object;
    identity: RouteAttemptBinding; plan: OrderedExecutionPlan; coordinatorId: string; recipients?: string[]; signal: AbortSignal } & OrderedStep
    & { partitionIndex?: number; fromStage?: number; toStage?: number }): Promise<boolean>;
}
export function createOrderedPartitionExecution(options: OrderedRouteRunnerOptions): OrderedRouteRunner;
