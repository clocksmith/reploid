/** Every member is required; the partitions component's file is partition-attempt-queue-policy.json. */
export interface AttemptQueuePolicy {
  readonly schema: 'reploid.partition-attempt-queue-policy/v1';
  /** Waiting attempts across every route of one coordinator. */
  readonly maxQueuedAttempts: number;
  /** Waiting attempts of one authenticated requester. */
  readonly maxQueuedPerRequester: number;
  /** Longest wait before CAPACITY_QUEUE_TIMEOUT; an earlier attempt deadline applies first. */
  readonly maxQueueWaitMs: number;
}
export const ATTEMPT_QUEUE_POLICY_SCHEMA: 'reploid.partition-attempt-queue-policy/v1';
export const ATTEMPT_QUEUE_POLICY: AttemptQueuePolicy;
export function validateAttemptQueuePolicy(policy: unknown): AttemptQueuePolicy;
export interface AttemptQueueTicket {
  readonly queued: boolean;
  readonly queuedMs: number;
  /** The attempt now holds the coordinator stage's own reservation (or failed to obtain it). */
  opened(): void;
  /** The attempt's coordinator-side work ended; waiting entries are re-evaluated. */
  release(): void;
}
export interface AttemptQueue {
  readonly policy: AttemptQueuePolicy;
  /** Rejects with CAPACITY_QUEUE_FULL, CAPACITY_QUEUE_TIMEOUT (`bound`: 'policy' | 'authorization'),
   * the signal's reason, or the error a gate throws. */
  admit(request: { key: unknown; attemptId: string; requesterId: string; deadlineAt?: number; signal?: AbortSignal;
    check(state: { admitted: number; opening: number }): boolean;
    onQueued?(state: { position: number; queuedAt: number; waitUntil: number }): void }): Promise<AttemptQueueTicket>;
  pump(): void;
  getState(): AttemptQueuePolicy & { queued: number; admitted: number; opening: number };
}
export function createPartitionAttemptQueue(options: { policy: AttemptQueuePolicy; now?: () => number }): AttemptQueue;
