import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSignedResearchSubmission } from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import {
  appendResearchRecord,
  hydrateResearchRecords,
  loadResearchRecords,
  publishResearchRecord,
  resetResearchStore
} from '../../self/ui/pool-home/research-store.js';

const fakeHash = (character) => `sha256:${character.repeat(64)}`;
const storage = () => {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, String(value)))
  };
};

const makeRecord = async (roomId = 'store-room') => {
  const keyPair = await createSigningKeyPair();
  return createSignedResearchSubmission({
    identity: {
      resolve: async () => ({ kind: 'requester', roleId: 'requester_store', userId: 'user_store', deviceId: 'device_store', identityRootId: 'root_store' }),
      getSigningKeyPair: async () => keyPair
    },
    roomId,
    sequence: 'MAPLALLLLGLVAGA',
    intent: { kind: 'question', text: 'Which related records have accepted evidence?' },
    consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
    modelContract: {
      id: 'esm2-small', hash: fakeHash('1'), manifestHash: fakeHash('2'), runtime: 'doppler',
      backend: 'browser-webgpu', workload: 'sequence.embedding.v1', executionMode: 'full_model_browser_sequence', dimensions: 3
    },
    policyId: 'redundant_agreement'
  });
};

afterEach(() => {
  resetResearchStore();
  vi.unstubAllGlobals();
});

describe('Poolday research store', () => {
  it('persists immutable records by room and treats duplicate publication as idempotent', async () => {
    const localStorage = storage();
    vi.stubGlobal('localStorage', localStorage);
    const record = await makeRecord();
    await appendResearchRecord(record);
    await appendResearchRecord(record);
    expect(loadResearchRecords('store-room')).toEqual([record]);
    expect(localStorage.setItem).toHaveBeenCalled();
  });

  it('preserves locally before a failed remote publication and merges remote evidence on hydration', async () => {
    vi.stubGlobal('localStorage', storage());
    const local = await makeRecord('store-room');
    const remote = await makeRecord('store-room');
    const failed = await publishResearchRecord(local, {
      sdk: { publishResearchRecord: vi.fn().mockRejectedValue(new Error('offline')) }
    });
    expect(failed.remote).toBe(false);
    expect(loadResearchRecords('store-room')).toEqual([local]);

    const hydrated = await hydrateResearchRecords('store-room', {
      sdk: { listResearchRecords: vi.fn().mockResolvedValue({ records: [remote] }) }
    });
    expect(hydrated.remote).toBe(true);
    expect(hydrated.records.map((record) => record.recordHash)).toEqual([local.recordHash, remote.recordHash]);
  });
});
