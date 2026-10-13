import type { PartitionActivity } from './partition-summary.js';
import type { OrderedPartitionPlan, OrderedPartitionRuntime, PartitionRoute, RouteAttemptBinding } from './partition-contract.js';
import type { ActivationTensor, ActivationFrame } from './partition-runner.js';
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
}
export interface OrderedStageDevice {
  id: string; transportId: string; residentId: string; executionId: string;
  reserve(options: OrderedStageBinding & { inputTokenCount: number; maxTokens: number; generationDigest: string;
    generation: Record<string, unknown> & { maxTokens: number }; executionGrant: object; signal: AbortSignal }): Promise<OrderedReservation>;
  executeStage(options: OrderedStageBinding & OrderedStep & { inputTokenIds: number[];
    generation: Record<string, unknown> & { maxTokens: number }; continuation: unknown; activation?: unknown;
    executionGrant: object; tokenContextGrant: object; incomingActivationGrant?: object; outgoingActivationGrant?: object; outputGrant?: object; signal: AbortSignal }): Promise<OrderedStageResult>;
  closeAttempt(options: OrderedStageBinding): Promise<void>;
}
export interface OrderedRouteLimits {
  maxTokens: number; maxPromptTokens: number; maxActivationBytes: number; maxOutputCharacters: number;
  maxAttempts: number; maxConcurrentAttempts: number; maxStages: number;
}
export interface OrderedRouteRequest {
  identity: RouteAttemptBinding; tokenIds: number[]; generation: Record<string, unknown> & { maxTokens: number };
  grants: { execution: object[]; tokenContext: object[]; activation: object[]; output: object };
  maxTokens: number; signal?: AbortSignal; onActivity?: (activity:PartitionActivity)=>void|Promise<void>; onDelta?: (delta: string) => void | Promise<void>;
}
export interface OrderedRouteReceipt {
  identity: RouteAttemptBinding; phase: 'admitting' | 'executing' | 'settling' | 'cleanup-failed' | 'completed' | 'cancelled' | 'failed';
  reservations: OrderedReservation[]; cleanup: Array<{ partitionIndex: number; status: 'settled' | 'unknown'; error: string | null }>;
  cleanupSettledAt: number | null; failure: string | null;
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
  getState(): { closed: boolean; active: number; unsettled: number; attempts: OrderedRouteReceipt[] };
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
