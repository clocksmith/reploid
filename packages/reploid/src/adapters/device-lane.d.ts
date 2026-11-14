export interface DeviceQueueState { capacity: 1; active: number; queued: number }
export function getDeviceQueue(service: object): DeviceQueueState;
/** Cancellation releases waiters; running work retains its slot until settlement. */
export function withDevice<T>(service: object, signal: AbortSignal, operation: () => T | Promise<T>,
  onProgress?: (message: string) => void): Promise<T>;
