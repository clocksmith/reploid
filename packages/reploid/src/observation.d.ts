export function reportObserverError(error: unknown): void;
export function notifyObservers<T>(listeners: Iterable<(snapshot: T) => unknown>, snapshot: () => T,
  onError?: (error: unknown) => unknown): void;
