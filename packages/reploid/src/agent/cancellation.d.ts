export function abortable<T>(operation: () => T | Promise<T>, signal: AbortSignal): Promise<T>;
