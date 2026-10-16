export declare class TimeoutError extends Error {
  isTimeout: boolean;
  constructor(message: string);
}

export declare class RetryExhaustedError extends Error {
  attempts: number;
  lastError: unknown;
  constructor(message: string, attempts: number, lastError: unknown);
}

export interface ToolOperationRetryOptions {
  timeoutMs?: number;
  operationName?: string;
  maxAttempts?: number;
  initialDelayMs?: number;
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export declare function withTimeoutAndRetry<T>(
  operation: (attempt: number) => Promise<T>,
  options?: ToolOperationRetryOptions
): Promise<T>;
