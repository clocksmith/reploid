export interface DeviceAdmissionState {
  maxBytes: number; maxConcurrentAttempts: number; residents: number; residentBytes: number;
  attemptBytes: number; active: number; availableBytes: number;
}
/** One budget for every resident and route on one executing device; declared allocations, not physical memory. */
export interface DeviceAdmission {
  /** Throws `RESOURCE_EXHAUSTED` when the weights do not fit. */
  admitResident(owner: object, bytes: number): void;
  /** Rejects with `CAPACITY_UNAVAILABLE` when slots or bytes are exhausted. */
  admit(request: { owner: object; attemptId: string; bytes: number; requesterId?: string; routeKey?: string; signal?: AbortSignal }): Promise<void>;
  /** Only after the attempt's cleanup settled. */
  release(owner: object, attemptId: string): void;
  /** Only after the resident's provider closed. */
  releaseResident(owner: object): void;
  available(bytes: number): number;
  getState(): DeviceAdmissionState;
}
export function createDeviceAdmission(options: { maxBytes: number; maxConcurrentAttempts: number }): DeviceAdmission;
