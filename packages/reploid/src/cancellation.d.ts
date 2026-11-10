export function abortable<T>(operation: () => T | Promise<T>, signal: AbortSignal): Promise<T>;
export function untilAborted<T>(pending: T | Promise<T>, signal: AbortSignal): Promise<T>;
