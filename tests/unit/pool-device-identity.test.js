import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  resetDeviceIdentityForTests,
  verifyRoleDelegation
} from '../../self/pool/device-identity.js';
import { createPoolIdentity } from '../../self/pool/identity.js';
import { writeParticipationPreferences } from '../../self/pool/participation-profile.js';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key))
  };
};

afterEach(() => {
  resetDeviceIdentityForTests();
  vi.unstubAllGlobals();
});

describe('Poolday device identity', () => {
  it('keeps one device root while delegating distinct requester and provider roles', async () => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('indexedDB', undefined);
    writeParticipationPreferences({ mode: 'both' });
    const requester = createPoolIdentity('requester', { localOnly: true, namespace: 'tab_a' });
    const provider = createPoolIdentity('provider', { localOnly: true, namespace: 'tab_a' });

    const requesterState = await requester.resolve();
    const providerState = await provider.resolve();
    expect(requesterState.deviceId).toBe(providerState.deviceId);
    expect(requesterState.identityRootId).toBe(providerState.identityRootId);
    expect(requesterState.roleId).not.toBe(providerState.roleId);
    expect(requesterState.keyProtection).toBe('browser_exportable_fallback');

    const requesterProfile = await requester.getParticipationProfile();
    const requesterProof = await requester.getRoleProof({ participationProfile: requesterProfile });
    const requesterKey = await requester.getSigningKeyPair();
    expect(requesterKey.privateKey.extractable).toBe(false);
    expect((await verifyRoleDelegation(requesterProof, {
      role: 'requester',
      roleId: requesterState.roleId,
      rolePublicKey: requesterProof.rolePublicKey,
      requiredCapability: 'request_inference',
      participationProfileHash: requesterProfile.profileHash
    })).ok).toBe(true);

    const providerProfile = await provider.getParticipationProfile();
    const providerProof = await provider.getRoleProof({ participationProfile: providerProfile });
    expect((await verifyRoleDelegation(providerProof, {
      role: 'provider',
      roleId: providerState.roleId,
      rolePublicKey: providerProof.rolePublicKey,
      requiredCapability: 'provide_inference',
      participationProfileHash: providerProfile.profileHash
    })).ok).toBe(true);
  });

  it('refuses a provider delegation when the signed mode is request-only', async () => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('indexedDB', undefined);
    writeParticipationPreferences({ mode: 'request' });
    const provider = createPoolIdentity('provider', { localOnly: true, namespace: 'tab_b' });

    await expect(provider.getRoleProof()).rejects.toThrow('Participation mode does not allow provide_inference');
  });

  it('refuses locally requested capabilities outside the signed profile', async () => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('indexedDB', undefined);
    writeParticipationPreferences({ mode: 'request' });
    const requester = createPoolIdentity('requester', { localOnly: true, namespace: 'tab_c' });

    await expect(requester.getRoleProof({
      capabilities: ['request_inference', 'publish_adapters']
    })).rejects.toThrow('Participation profile does not allow delegated capability publish_adapters');
  });
});
