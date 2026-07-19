import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PARTICIPATION_CAPABILITIES,
  PARTICIPATION_MODES,
  createSignedParticipationProfile,
  normalizeParticipationPreferences,
  participationAllows,
  readParticipationPreferences,
  verifyParticipationProfile,
  writeParticipationPreferences
} from '../../self/pool/participation-profile.js';
import { createSigningKeyPair, exportPublicKey } from '../../self/pool/inference-receipt.js';

const createStorage = () => {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    removeItem: vi.fn((key) => values.delete(key))
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('Poolday participation profile', () => {
  it('maps the three product modes to explicit capabilities', () => {
    const request = normalizeParticipationPreferences({ mode: PARTICIPATION_MODES.request });
    const contribute = normalizeParticipationPreferences({ mode: PARTICIPATION_MODES.contribute });
    const both = normalizeParticipationPreferences({ mode: PARTICIPATION_MODES.both });

    expect(request.mode).toBe('request');
    expect(contribute.mode).toBe('contribute');
    expect(both.mode).toBe('both');
  });

  it('persists bounded resource consent without enabling publisher or trainer authority', () => {
    vi.stubGlobal('localStorage', createStorage());
    writeParticipationPreferences({
      mode: 'both',
      permissions: { relayArtifacts: true, verifyResults: true },
      limits: { maxConcurrentJobs: 99, storageBudgetMiB: 1, bandwidthBudgetMbps: 30 }
    });

    const stored = readParticipationPreferences();
    expect(stored).toMatchObject({
      mode: 'both',
      permissions: {
        relayArtifacts: true,
        verifyResults: true,
        publishAdapters: false,
        createAdapters: false
      },
      limits: {
        maxConcurrentJobs: 4,
        storageBudgetMiB: 128,
        bandwidthBudgetMbps: 30
      }
    });
  });

  it('signs a mode profile and rejects capability escalation', async () => {
    const keyPair = await createSigningKeyPair();
    const profile = await createSignedParticipationProfile({
      preferences: { mode: 'request' },
      deviceId: 'device_test',
      devicePublicKey: await exportPublicKey(keyPair.publicKey),
      privateKey: keyPair.privateKey
    });

    expect((await verifyParticipationProfile(profile)).ok).toBe(true);
    expect(participationAllows(profile, PARTICIPATION_CAPABILITIES.requestInference)).toBe(true);
    expect(participationAllows(profile, PARTICIPATION_CAPABILITIES.provideInference)).toBe(false);

    const escalated = {
      ...profile,
      capabilities: [...profile.capabilities, PARTICIPATION_CAPABILITIES.provideInference].sort()
    };
    const verification = await verifyParticipationProfile(escalated);
    expect(verification.ok).toBe(false);
    expect(verification.reasons).toContain('participation capabilities do not match mode and permissions');
  });
});
