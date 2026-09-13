export function retryAfterMsFromError(error: unknown, options?: { maxDelayMs?: number }): number;
export function boundedRetryDelay(options?: { consecutiveFailures?: number; baseDelayMs?: number; maxDelayMs?: number; retryAfterMs?: number }): number;
declare const api: { retryAfterMsFromError: typeof retryAfterMsFromError; boundedRetryDelay: typeof boundedRetryDelay };
export default api;
