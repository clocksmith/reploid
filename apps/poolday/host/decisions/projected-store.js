/**
 * A store over a host source that is attached only while someone listens: `attach(changed)` runs on the
 * first subscriber and returns its detach, which runs when the last one leaves or the store is disposed.
 * `project()` is read once per change and cached, so a reader sees the same snapshot until the next one.
 */
export function createProjectedStore({ attach = () => undefined, project }) {
  const listeners = new Set();
  let detach = null;
  let snapshot;
  let current = false;
  let disposed = false;
  const changed = () => {
    current = false;
    for (const listener of [...listeners]) listener();
  };
  const release = () => {
    const off = detach;
    detach = null;
    off?.();
  };
  return {
    getSnapshot() {
      if (!current) {
        snapshot = project();
        current = true;
      }
      return snapshot;
    },
    changed,
    subscribe(listener) {
      if (disposed) return () => undefined;
      listeners.add(listener);
      if (!detach) detach = attach(changed) ?? (() => undefined);
      return () => {
        listeners.delete(listener);
        if (!listeners.size) release();
      };
    },
    /** Listeners currently subscribed. */
    get size() {
      return listeners.size;
    },
    dispose() {
      disposed = true;
      listeners.clear();
      release();
    }
  };
}
