/** Moves the profile's conversation history between tabs. One tab holds the history
 * Web Lock (chat-history.js); another asks it over BroadcastChannel to hand over.
 * The owner closes its session, which settles running answers and pending saves and
 * closes the store before the lock releases. The asking tab waits for that lock and
 * then reloads, opening as the owner. Chrome ignores window.focus() from a background
 * tab, so a tab cannot bring the owner forward; handing over is the dependable move. */
const RESPONSE_TIMEOUT_MS = 15000;
const REQUEST = 'reploid.history-handover/request';

export function createHistoryHandover({ name, owner, release, locks = globalThis.navigator?.locks,
  Channel = globalThis.BroadcastChannel, reload = () => globalThis.location.reload(), timeoutMs = RESPONSE_TIMEOUT_MS }) {
  if (typeof Channel !== 'function' || typeof locks?.request !== 'function' || typeof release !== 'function') return null;
  const lockName = `reploid:chat-history:${name}`;
  const channel = new Channel(lockName);
  const listeners = new Set();
  // owner: holds the lock. elsewhere: another tab holds it. moving: releasing on request.
  // moved: released to another tab. waiting: asked the owner and waiting for its lock.
  let state = owner ? 'owner' : 'elsewhere', failed = false, closed = false;
  const snapshot = () => Object.freeze({ state, failed });
  const set = (next, failure = false) => {
    state = next; failed = failure;
    for (const listener of listeners) { try { listener(snapshot()); } catch (error) { console.error('[HistoryHandover] listener failed', error); } }
  };
  channel.onmessage = event => {
    if (event.data?.type !== REQUEST || state !== 'owner') return;
    set('moving');
    // A failed cleanup still releases the lock (chat-history.js closes it in finally);
    // the failure is reported where the session reports it.
    Promise.resolve().then(release).catch(error => console.warn('[HistoryHandover] Session cleanup failed during handover', error))
      .finally(() => { if (!closed) set('moved'); });
  };
  return Object.freeze({
    state: snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot()); return () => listeners.delete(listener); },
    /** Ask the owner to hand over; resolves true once this tab reloads as owner. */
    async request() {
      if (closed || !['elsewhere', 'moved'].includes(state)) return false;
      const previous = state;
      set('waiting');
      channel.postMessage({ type: REQUEST });
      try {
        // The lock frees only after the owner has closed its store. Holding it is not
        // needed: the reload reacquires it as this tab opens.
        await locks.request(lockName, { signal: AbortSignal.timeout(timeoutMs) }, () => {});
      } catch {
        if (!closed) set(previous, true);
        return false;
      }
      reload();
      return true;
    },
    close() { closed = true; listeners.clear(); channel.close(); }
  });
}
