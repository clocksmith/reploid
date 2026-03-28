import { describe, expect, it, vi } from 'vitest';

import {
  clearRequestedFreshIdentity,
  createReploidPeerUrl,
  createScopedReploidStorage,
  ensureReploidWindowInstance,
  hasRequestedFreshIdentity,
  getScopedReploidStorageKey,
  getScopedReploidVfsDbName
} from '../../src/self/instance.js';
import {
  ensureIdentityBundle,
  getIdentityStorageKey,
  readStoredIdentityBundle,
  rotateIdentityBundle,
  saveIdentityBundle
} from '../../src/self/identity.js';

const createMockStorage = () => {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] || null;
    },
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
};

describe('self instance helpers', () => {
  it('namespaces storage keys and VFS database names per instance', () => {
    expect(getScopedReploidStorageKey('REPLOID_MODE', 'peer-a')).toBe('REPLOID_INSTANCE_peer-a::REPLOID_MODE');
    expect(getScopedReploidVfsDbName('peer-a')).toBe('reploid-vfs-v0--peer-a');
  });

  it('falls back to legacy unscoped storage reads when scoped data is absent', () => {
    const storage = createMockStorage();
    storage.setItem('REPLOID_MODE', 'reploid');

    const scoped = createScopedReploidStorage(storage, 'peer-b');

    expect(scoped.getItem('REPLOID_MODE')).toBe('reploid');

    scoped.setItem('REPLOID_MODE', 'zero');

    expect(storage.getItem('REPLOID_MODE')).toBe('reploid');
    expect(storage.getItem('REPLOID_INSTANCE_peer-b::REPLOID_MODE')).toBe('zero');
    expect(scoped.getItem('REPLOID_MODE')).toBe('zero');
  });

  it('does not reuse a legacy unscoped identity for a new instance unless explicitly requested', () => {
    const storage = createMockStorage();
    storage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify({
      peerId: 'peer:legacy',
      publicJwk: { x: 'legacy' },
      privateJwk: { d: 'legacy' },
      contribution: {}
    }));

    expect(readStoredIdentityBundle(storage, { instanceId: 'peer-a' })).toBeNull();
    expect(readStoredIdentityBundle(storage, { instanceId: 'peer-a', legacyFallback: true })?.peerId).toBe('peer:legacy');
  });

  it('persists identity bundles per instance without collisions', () => {
    const storage = createMockStorage();
    const alpha = {
      peerId: 'peer:alpha',
      publicJwk: { x: 'a' },
      privateJwk: { d: 'a' },
      contribution: {}
    };
    const beta = {
      peerId: 'peer:beta',
      publicJwk: { x: 'b' },
      privateJwk: { d: 'b' },
      contribution: {}
    };

    saveIdentityBundle(alpha, storage, { instanceId: 'alpha' });
    saveIdentityBundle(beta, storage, { instanceId: 'beta' });

    expect(getIdentityStorageKey('alpha')).toBe('REPLOID_INSTANCE_alpha::REPLOID_SELF_IDENTITY_V1');
    expect(readStoredIdentityBundle(storage, { instanceId: 'alpha', legacyFallback: false })?.peerId).toBe('peer:alpha');
    expect(readStoredIdentityBundle(storage, { instanceId: 'beta', legacyFallback: false })?.peerId).toBe('peer:beta');
  });

  it('claims a legacy identity for only one instance and mints a new peer for others', async () => {
    const storage = createMockStorage();
    storage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify({
      peerId: 'peer:legacy',
      publicJwk: { x: 'legacy' },
      privateJwk: { d: 'legacy' },
      contribution: {}
    }));

    const alpha = await ensureIdentityBundle({
      storage,
      instanceId: 'alpha',
      cryptoApi: globalThis.crypto
    });
    const beta = await ensureIdentityBundle({
      storage,
      instanceId: 'beta',
      cryptoApi: globalThis.crypto
    });

    expect(alpha.peerId).toBe('peer:legacy');
    expect(beta.peerId).not.toBe('peer:legacy');
    expect(readStoredIdentityBundle(storage, { instanceId: 'alpha' })?.peerId).toBe('peer:legacy');
    expect(readStoredIdentityBundle(storage, { instanceId: 'beta' })?.peerId).toBe(beta.peerId);
  });

  it('repairs duplicated scoped identities for non-owning instances', async () => {
    const storage = createMockStorage();
    const legacy = {
      peerId: 'peer:legacy',
      publicJwk: { x: 'legacy' },
      privateJwk: { d: 'legacy' },
      contribution: {}
    };

    storage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify(legacy));
    storage.setItem('REPLOID_SELF_IDENTITY_V1_MIGRATED_INSTANCE', 'alpha');
    saveIdentityBundle(legacy, storage, { instanceId: 'alpha' });
    saveIdentityBundle(legacy, storage, { instanceId: 'beta' });

    const alpha = await ensureIdentityBundle({
      storage,
      instanceId: 'alpha',
      cryptoApi: globalThis.crypto
    });
    const beta = await ensureIdentityBundle({
      storage,
      instanceId: 'beta',
      cryptoApi: globalThis.crypto
    });

    expect(alpha.peerId).toBe('peer:legacy');
    expect(beta.peerId).not.toBe('peer:legacy');
  });

  it('lets the first repaired instance claim the legacy identity when duplicates predate migration', async () => {
    const storage = createMockStorage();
    const legacy = {
      peerId: 'peer:legacy',
      publicJwk: { x: 'legacy' },
      privateJwk: { d: 'legacy' },
      contribution: {}
    };

    storage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify(legacy));
    saveIdentityBundle(legacy, storage, { instanceId: 'alpha' });
    saveIdentityBundle(legacy, storage, { instanceId: 'beta' });

    const alpha = await ensureIdentityBundle({
      storage,
      instanceId: 'alpha',
      cryptoApi: globalThis.crypto
    });
    const beta = await ensureIdentityBundle({
      storage,
      instanceId: 'beta',
      cryptoApi: globalThis.crypto
    });

    expect(alpha.peerId).toBe('peer:legacy');
    expect(beta.peerId).not.toBe('peer:legacy');
  });

  it('ensures the browser URL carries an instance id', () => {
    const replaceState = vi.fn();
    const win = {
      REPLOID_INSTANCE_ID: null,
      crypto: { randomUUID: () => 'Peer_A' },
      history: {
        state: null,
        replaceState
      },
      location: {
        href: 'http://localhost:3000/'
      }
    };

    const instanceId = ensureReploidWindowInstance(win);

    expect(instanceId).toBe('peer_a');
    expect(win.REPLOID_INSTANCE_ID).toBe('peer_a');
    expect(replaceState).toHaveBeenCalledWith(null, '', '/?instance=peer_a');
  });

  it('builds peer URLs that can request a fresh identity once', () => {
    const previousWindow = globalThis.window;
    globalThis.window = {
      location: {
        origin: 'http://localhost:3000',
        href: 'http://localhost:3000/?dopplerBase=%2Fdoppler'
      },
      history: {
        state: null,
        replaceState: vi.fn()
      }
    };

    try {
      const peerUrl = new URL(createReploidPeerUrl('/x', {
        instanceId: 'peer-b',
        freshIdentity: true
      }));

      expect(peerUrl.pathname).toBe('/x');
      expect(peerUrl.searchParams.get('instance')).toBe('peer-b');
      expect(peerUrl.searchParams.get('dopplerBase')).toBe('/doppler');
      expect(hasRequestedFreshIdentity(peerUrl.toString())).toBe(true);

      globalThis.window.location.href = peerUrl.toString();
      clearRequestedFreshIdentity(globalThis.window);
      expect(globalThis.window.history.replaceState).toHaveBeenCalledTimes(1);
      const [, , clearedUrl] = globalThis.window.history.replaceState.mock.calls[0];
      const clearedPeerUrl = new URL(String(clearedUrl), 'http://localhost:3000');
      expect(clearedPeerUrl.pathname).toBe('/x');
      expect(clearedPeerUrl.searchParams.get('instance')).toBe('peer-b');
      expect(clearedPeerUrl.searchParams.get('dopplerBase')).toBe('/doppler');
      expect(clearedPeerUrl.searchParams.has('freshIdentity')).toBe(false);
    } finally {
      if (previousWindow === undefined) {
        delete globalThis.window;
      } else {
        globalThis.window = previousWindow;
      }
    }
  });

  it('rotates a claimed legacy identity and retires it from future implicit reuse', async () => {
    const storage = createMockStorage();
    storage.setItem('REPLOID_SELF_IDENTITY_V1', JSON.stringify({
      peerId: 'peer:legacy',
      publicJwk: { x: 'legacy' },
      privateJwk: { d: 'legacy' },
      contribution: {}
    }));

    const alpha = await ensureIdentityBundle({
      storage,
      instanceId: 'alpha',
      cryptoApi: globalThis.crypto
    });
    const rotated = await rotateIdentityBundle({
      storage,
      instanceId: 'alpha',
      cryptoApi: globalThis.crypto
    });
    const beta = await ensureIdentityBundle({
      storage,
      instanceId: 'beta',
      cryptoApi: globalThis.crypto
    });

    expect(alpha.peerId).toBe('peer:legacy');
    expect(rotated.peerId).not.toBe('peer:legacy');
    expect(readStoredIdentityBundle(storage, { instanceId: 'alpha' })?.peerId).toBe(rotated.peerId);
    expect(beta.peerId).not.toBe('peer:legacy');
    expect(beta.peerId).not.toBe(rotated.peerId);
  });
});
