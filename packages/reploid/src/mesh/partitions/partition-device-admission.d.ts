export interface DeviceAdmissionState {
  maxBytes: number; maxConcurrentAttempts: number; residents: number; residentBytes: number;
  attemptBytes: number; active: number; availableBytes: number;
  /** Present only with a queue. */
  queued?: number; maxQueued?: number;
}
/** Bounded waiting instead of immediate refusal; each bound fails with `CAPACITY_UNAVAILABLE`. */
export interface DeviceAdmissionQueue { maxQueued: number; maxQueuedPerRequester: number; maxWaitMs: number }
/** One budget for every resident and route on one executing device; declared allocations, not physical memory. */
export interface DeviceAdmission {
  /** Throws `RESOURCE_EXHAUSTED` when the weights do not fit. */
  admitResident(owner: object, bytes: number): void;
  /** Rejects with `CAPACITY_UNAVAILABLE` when slots or bytes are exhausted and no queue bound admits waiting.
   * Waiting grants go to the route owner (`routeKey`) with the fewest admitted attempts, then the least recently
   * served, then in arrival order. */
  admit(request: { owner: object; attemptId: string; bytes: number; requesterId?: string; routeKey?: string; signal?: AbortSignal }): Promise<void>;
  /** Only after the attempt's cleanup settled. */
  release(owner: object, attemptId: string): void;
  /** Only after the resident's provider closed. */
  releaseResident(owner: object): void;
  available(bytes: number): number;
  getState(): DeviceAdmissionState;
}
export function createDeviceAdmission(options: { maxBytes: number; maxConcurrentAttempts: number; queue?: DeviceAdmissionQueue | null }): DeviceAdmission;
