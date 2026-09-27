import type { PartitionBinding, PartitionStep } from './partition-runner.js';
export interface PartitionStepRequest extends PartitionStep {
  identity: PartitionBinding;
  payload: unknown;
  grant: object;
}
export interface PartitionStepReceiver {
  receive(request: PartitionStepRequest, options?: { signal?: AbortSignal }): Promise<unknown>;
  /** Host-authorized cancellation. Retains a bounded tombstone even before first delivery. */
  closeAttempt(identity: PartitionBinding): Promise<void>;
  close(): Promise<void>;
}
export function createPartitionStepReceiver(options: {
  executeStep(request: PartitionStepRequest, options: { signal: AbortSignal }): Promise<unknown>;
  /** Includes execution and output disclosure; called again on cached responses. */
  authorize(request: PartitionStepRequest): Promise<boolean>;
  /** Canonical SHA-256 of all bindings and payload bytes; not metadata alone. */
  fingerprint(request: PartitionStepRequest): Promise<string>;
  settleAttempt(identity: PartitionBinding): Promise<void>;
  limits: { maxAttempts: number; maxSteps: number };
}): PartitionStepReceiver;
