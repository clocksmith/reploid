import type { PartitionCommitRuntime, PartitionCommitAttempt, PartitionCommitStage } from './partition-stage-commit.js';
import type { PartitionBinding, PartitionStep } from './partition-runner.js';
export interface PartitionStepRequest extends PartitionStep {
  identity: PartitionBinding;
  payload: unknown;
  grant: object;
}
export interface CanonicalPartitionPhaseRequest {
  identity: PartitionBinding; canonicalAttempt: PartitionCommitAttempt; generationId: string;
  phase: 'admit' | 'step' | 'published'; sequence: number; step: number; tokenPosition: number; inputTokenCount: number;
  payload?: Uint8Array; [key: string]: unknown;
}
export interface PartitionStepReceiver {
  receive(request: PartitionStepRequest, options?: { signal?: AbortSignal }): Promise<unknown>;
  /** Explicit output-stage canonical capability; legacy callers remain on receive. */
  receiveCanonical(request: CanonicalPartitionPhaseRequest, options?: { signal?: AbortSignal }): Promise<unknown>;
  /** Host-authorized cancellation. Retains a bounded tombstone even before first delivery. */
  closeAttempt(identity: PartitionBinding): Promise<void>;
  close(): Promise<void>;
}
export function createPartitionStepReceiver(options: {
  executeStep(request: PartitionStepRequest, options: { signal: AbortSignal }): Promise<unknown>;
  /** Includes execution and output disclosure; called again on cached responses. */
  authorize(request: PartitionStepRequest | CanonicalPartitionPhaseRequest): Promise<boolean>;
  /** Canonical SHA-256 of all bindings and payload bytes; not metadata alone. */
  fingerprint(request: PartitionStepRequest | CanonicalPartitionPhaseRequest): Promise<string>;
  settleAttempt(identity: PartitionBinding): Promise<void>;
  limits: { maxAttempts: number; maxSteps: number };
  canonical?: {
    runtime: Pick<PartitionCommitRuntime, 'metadataDigest' | 'validateResidentAttemptIdentity' | 'residentAttemptDigest'>;
    stage: PartitionCommitStage; now(): number;
    /** Authenticated durable-publication acknowledgment, bound to the retained stage result. */
    verifyPublication(request: CanonicalPartitionPhaseRequest, retainedResult: unknown): Promise<boolean>;
    execute(request: CanonicalPartitionPhaseRequest, options: { signal: AbortSignal }): Promise<unknown>;
  };
}): PartitionStepReceiver;

export interface OrderedPartitionStepRequest extends PartitionStep {
  identity: import('./partition-contract.js').RouteAttemptBinding; partitionIndex: number; payload: unknown;
  [key: string]: unknown;
}
export interface OrderedPartitionStepReceiver {
  receive(request: OrderedPartitionStepRequest, options?: { signal?: AbortSignal }): Promise<unknown>;
  closeAttempt(identity: import('./partition-contract.js').RouteAttemptBinding): Promise<void>;
  close(): Promise<void>;
}
export function createPartitionStepReceiver(options: {
  ordered: { stage: import('./partition-contract.js').PartitionRouteStage }; limits: { maxAttempts: number; maxSteps: number };
  executeStep(request: OrderedPartitionStepRequest, options: { signal: AbortSignal }): Promise<unknown>;
  authorize(request: OrderedPartitionStepRequest): Promise<boolean>;
  fingerprint(request: OrderedPartitionStepRequest): Promise<string>;
  settleAttempt(identity: import('./partition-contract.js').RouteAttemptBinding): Promise<void>;
}): OrderedPartitionStepReceiver;
