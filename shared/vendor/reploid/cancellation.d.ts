export function abortable<T>(operation: () => T | Promise<T>, signal: AbortSignal): Promise<T>;
export function abortableBefore<T>(operation: () => T | Promise<T>, signal: AbortSignal,
  limit: { deadline: number; expired: () => unknown }): Promise<T>;
export function untilAborted<T>(pending: T | Promise<T>, signal: AbortSignal): Promise<T>;
