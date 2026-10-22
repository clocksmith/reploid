import { describe, expect, it, vi } from 'vitest';
import { createHistoryHandover } from '../../self/host/history-handover.js';

/** BroadcastChannel stand-in: delivers to every other instance with the same name. */
function channels() {
  const open = new Set();
  return class FakeChannel {
    constructor(name) { this.name = name; this.onmessage = null; open.add(this); }
    postMessage(data) { for (const other of open) if (other !== this && other.name === this.name) queueMicrotask(() => other.onmessage?.({ data })); }
    close() { open.delete(this); }
  };
}

/** Web Locks stand-in for one exclusive lock that the owner tab holds until it releases. */
function heldLock() {
  let held = true; const waiters = new Set();
  return {
    release() { held = false; for (const wake of waiters) wake(); waiters.clear(); },
    get held() { return held; },
    async request(name, { signal } = {}, callback) {
      if (held) await new Promise((resolve, reject) => {
        waiters.add(resolve);
        signal?.addEventListener('abort', () => { waiters.delete(resolve); reject(signal.reason); }, { once: true });
      });
      return callback({ name });
    }
  };
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('history handover', () => {
  it('releases the owner session on request and lets the asking tab reload as owner', async () => {
    const Channel = channels(), locks = heldLock(), reload = vi.fn(), states = [];
    const release = vi.fn(async () => { locks.release(); });
    const owner = createHistoryHandover({ name: 'history', owner: true, release, locks, Channel, reload: () => {} });
    const asking = createHistoryHandover({ name: 'history', owner: false, release: async () => {}, locks, Channel, reload });
    owner.subscribe(state => states.push(state.state));
    expect(asking.state().state).toBe('elsewhere');

    await expect(asking.request()).resolves.toBe(true);
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(states).toEqual(['owner', 'moving', 'moved']);
  });

  it('keeps the asking tab where it was and reports the failure when the owner never releases', async () => {
    const Channel = channels(), locks = heldLock(), reload = vi.fn();
    const asking = createHistoryHandover({ name: 'history', owner: false, release: async () => {}, locks, Channel, reload, timeoutMs: 20 });
    await expect(asking.request()).resolves.toBe(false);
    expect(asking.state()).toEqual({ state: 'elsewhere', failed: true });
    expect(reload).not.toHaveBeenCalled();
    expect(locks.held).toBe(true);
  });

  it('lets a tab that handed over ask for the history back', async () => {
    const Channel = channels(), locks = heldLock(), reload = vi.fn();
    const first = createHistoryHandover({ name: 'history', owner: true, release: async () => locks.release(), locks, Channel, reload });
    const second = createHistoryHandover({ name: 'history', owner: false, release: async () => {}, locks, Channel, reload: () => {} });
    await second.request(); await settle();
    expect(first.state().state).toBe('moved');
    // The second tab reloads as a new owner holding the lock again.
    const relocked = heldLock();
    const reopened = createHistoryHandover({ name: 'history', owner: true, release: async () => relocked.release(), locks: relocked, Channel, reload: () => {} });
    const back = createHistoryHandover({ name: 'history', owner: false, release: async () => {}, locks: relocked, Channel, reload });
    second.close();
    await expect(back.request()).resolves.toBe(true);
    await settle();
    expect(reopened.state().state).toBe('moved');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores requests in tabs that do not own the history and refuses repeated asks while waiting', async () => {
    const Channel = channels(), locks = heldLock();
    const releaseA = vi.fn(), releaseB = vi.fn();
    const a = createHistoryHandover({ name: 'history', owner: false, release: releaseA, locks, Channel, reload: () => {}, timeoutMs: 20 });
    const b = createHistoryHandover({ name: 'history', owner: false, release: releaseB, locks, Channel, reload: () => {}, timeoutMs: 20 });
    const pending = a.request();
    await expect(a.request()).resolves.toBe(false);
    await pending; await settle();
    expect(releaseA).not.toHaveBeenCalled(); expect(releaseB).not.toHaveBeenCalled();
    expect(b.state().state).toBe('elsewhere');
  });

  it('is unavailable without BroadcastChannel or Web Locks', () => {
    expect(createHistoryHandover({ name: 'h', owner: true, release: () => {}, locks: heldLock(), Channel: null })).toBeNull();
    expect(createHistoryHandover({ name: 'h', owner: true, release: () => {}, locks: null, Channel: channels() })).toBeNull();
  });
});
