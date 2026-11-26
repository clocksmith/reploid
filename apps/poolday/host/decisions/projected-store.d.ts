/** A store attached to its source only while someone listens; its snapshot is projected once per change. */
export interface ProjectedStore<T> {
  /** The current projection: the same value until `changed()` runs. */
  getSnapshot(): T;
  /** Marks the projection stale and tells every listener. */
  changed(): void;
  /** Attaches on the first listener; the returned function detaches after the last one leaves. */
  subscribe(listener: () => void): () => void;
  /** Listeners currently subscribed. */
  readonly size: number;
  /** Drops every listener and detaches; later subscriptions are inert. */
  dispose(): void;
}

export function createProjectedStore<T>(options: {
  /** Connects the source; called with the store's `changed`, returns how to disconnect. */
  readonly attach?: (changed: () => void) => (() => void) | void;
  readonly project: () => T;
}): ProjectedStore<T>;
