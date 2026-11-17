import { getIdentityStorageKey, readStoredIdentityBundle, rotateIdentityBundle, saveIdentityBundle } from '../../../shared/identity.js';

const SLOT_KEY = 'REPLOID_CONTRIBUTOR_SLOT_V1';
const MAX_SLOTS = 64;
const validSlot = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value) && Number(value) < MAX_SLOTS;

/** Stable profile-local signing slots, with exclusive live ownership per slot.
 * Reload/rebuild prefers the tab's prior slot. Copied tabs claim another slot;
 * a new tab reuses an idle slot. Connection/observation sessions remain fresh.
 * Slots identify browser participants, not physical computers or independent parties.
 * Existing unreferenced random-session keys are never guessed, migrated or deleted. */
export function createContributorIdentity({ storage: pageStorage, locks = globalThis.navigator?.locks,
  tabStorage = globalThis.sessionStorage } = {}) {
  // Poolday supplies createScopedReploidStorage(), whose raw port is the profile
  // store. Only contributor signing slots bypass the page namespace: account,
  // permissions, preferences and requester identities keep their original scope.
  // The lock and storage must have the same origin/profile lifetime.
  const storage = pageStorage && Object.hasOwn(pageStorage, 'raw') ? pageStorage.raw : pageStorage;
  let pending = null, lease = null, release = null, closed = false, instanceId = null;
  const claim = slot => new Promise((resolve, reject) => {
    lease = locks.request(`reploid:work-contributor:identity:v1:${slot}`, { ifAvailable: true }, async lock => {
      if (!lock) { resolve(null); return; }
      if (closed) throw new Error('Contributor identity is closed');
      const held = new Promise(done => { release = done; });
      try {
        instanceId = `work-contributor:v1:${slot}`;
        const raw = storage.getItem(getIdentityStorageKey(instanceId));
        let bundle = readStoredIdentityBundle(storage, { instanceId });
        if (raw !== null && !bundle) throw new Error('Stored contributor identity is unreadable; refusing to replace it');
        if (!bundle) bundle = await rotateIdentityBundle({ storage, instanceId, retireLegacy: false });
        const saved = readStoredIdentityBundle(storage, { instanceId });
        if (!saved || saved.peerId !== bundle.peerId) throw new Error('Contributor identity could not be persisted');
        if (closed) throw new Error('Contributor identity is closed');
        tabStorage.setItem(SLOT_KEY, slot);
        if (tabStorage.getItem(SLOT_KEY) !== slot) throw new Error('Contributor tab identity could not be persisted');
        resolve(structuredClone(bundle));
        await held;
      } finally { release = null; }
    });
    lease.catch(reject);
  });
  const ensure = () => {
    if (closed) return Promise.reject(new Error('Contributor identity is closed'));
    if (pending) return pending;
    pending = (async () => {
      if (!locks?.request || !storage?.getItem || !storage?.setItem || !tabStorage?.getItem || !tabStorage?.setItem) {
        throw new Error('Persistent contributor identity requires browser storage and Web Locks');
      }
      const preferred = tabStorage.getItem(SLOT_KEY);
      if (preferred !== null && !validSlot(preferred)) throw new Error('Stored contributor slot is invalid');
      const slots = [...new Set([...(preferred === null ? [] : [preferred]),
        ...Array.from({ length: MAX_SLOTS }, (_, index) => String(index))])];
      for (const slot of slots) {
        if (closed) throw new Error('Contributor identity is closed');
        const identity = await claim(slot);
        if (identity) return identity;
      }
      throw new Error('All browser contributor identity slots are in use');
    })();
    return pending;
  };
  return Object.freeze({ ensure,
    save(bundle) {
      if (closed || !release) throw new Error('Contributor identity is not leased');
      return saveIdentityBundle(bundle, storage, { instanceId });
    },
    async close() {
      closed = true;
      release?.();
      await lease?.catch(() => {});
    }
  });
}
