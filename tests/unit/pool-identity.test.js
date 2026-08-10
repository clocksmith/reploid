import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPoolIdentity } from '../../self/pool/identity.js';
import { exportPublicKey } from '../../self/pool/inference-receipt.js';

const storage = () => {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key)),
    clear: vi.fn(() => values.clear())
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pool identity', () => {
  it('rehydrates an exportable public role key for signed evidence attribution', async () => {
    vi.stubGlobal('localStorage', storage());
    const first = createPoolIdentity('reviewer');
    const firstKey = await first.getSigningKeyPair();
    const firstPublicKey = await exportPublicKey(firstKey.publicKey);

    const rehydrated = createPoolIdentity('reviewer');
    const rehydratedKey = await rehydrated.getSigningKeyPair();
    expect(await exportPublicKey(rehydratedKey.publicKey)).toBe(firstPublicKey);
  });

  it('supports local-only peer identities without Firebase auth resolution', async () => {
    const localStorage = storage();
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('firebase', {
      auth() {
        throw new Error('firebase auth should not run for local-only identity');
      }
    });
    const identity = createPoolIdentity('requester', { localOnly: true });

    const resolved = await identity.resolve();
    const token = await identity.getAuthToken();

    expect(resolved).toMatchObject({
      kind: 'requester',
      source: 'local_anonymous',
      isAuthenticated: false
    });
    expect(resolved.roleId).toMatch(/^requester_/);
    expect(token).toBeNull();
    expect(localStorage.setItem).toHaveBeenCalled();
  });
});
