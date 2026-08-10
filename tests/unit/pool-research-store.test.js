import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSignedResearchResult, createSignedResearchSubmission } from '../../self/pool/evidence-network.js';
import { createSigningKeyPair } from '../../self/pool/inference-receipt.js';
import { buildLaunchProviderModel, getPoolModelContract } from '../../self/pool/model-contract.js';
import { hashSequenceFloat32Values } from '../../self/pool/sequence-result.js';
import {
  appendResearchRecord,
  getResearchSyncState,
  hydrateResearchRecords,
  loadQuarantinedResearchRecords,
  loadResearchRecords,
  publishResearchRecord,
  resetResearchStore
} from '../../self/ui/pool-home/research-store.js';

const storage = () => {
  const values = new Map();
  return {
    getItem: vi.fn((key) => values.get(key) || null),
    setItem: vi.fn((key, value) => values.set(key, String(value))),
    seed(key, value) {
      values.set(key, String(value));
    }
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
    modelContract: buildLaunchProviderModel(),
    policyId: 'redundant_agreement'
  });
};

const makeCandidateRecord = async (roomId = 'store-room') => {
  const keyPair = await createSigningKeyPair();
  return createSignedResearchSubmission({
    identity: {
      resolve: async () => ({ kind: 'requester', roleId: 'requester_candidate', userId: 'user_candidate', deviceId: 'device_candidate', identityRootId: 'root_candidate' }),
      getSigningKeyPair: async () => keyPair
    },
    roomId,
    sequence: 'MAPLALLLLGLVAGA',
    intent: { kind: 'question', text: 'Candidate records must not enter the enabled evidence lane.' },
    consent: { publicSequence: true, publicEvidenceNetwork: true, publishEmbedding: true },
    modelContract: getPoolModelContract('amplify-120m-f16-af32'),
    policyId: 'redundant_agreement'
  });
};

afterEach(() => {
  resetResearchStore();
  vi.unstubAllGlobals();
});

const makeResult = async (submission) => {
  const model = buildLaunchProviderModel();
  const vector = Array.from({ length: model.embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0));
  return createSignedResearchResult({
    identity: await (async () => {
      const keyPair = await createSigningKeyPair();
      return {
        resolve: async () => ({ kind: 'researcher', roleId: 'researcher_store_result', userId: 'user_store_result', deviceId: 'device_store_result', identityRootId: 'root_store_result' }),
        getSigningKeyPair: async () => keyPair
      };
    })(),
    submission,
    receiptRecord: {
      receiptHash: `sha256:${'c'.repeat(64)}`,
      verifierDecision: { accepted: true },
      receipt: {
        model,
        providerId: 'provider_store_result',
        assignmentId: 'assignment_store_result',
        jobId: 'job_store_result',
        outputKind: 'sequence.embedding.v1',
        vectorHash: await hashSequenceFloat32Values(vector)
      }
    },
    embedding: vector
  });
};

describe('Poolday research store', () => {
  it('persists immutable records by room and treats duplicate publication as idempotent', async () => {
    const localStorage = storage();
    vi.stubGlobal('localStorage', localStorage);
    const record = await makeRecord();
    await appendResearchRecord(record);
    await appendResearchRecord(record);
    expect(loadResearchRecords('store-room')).toEqual([record]);
    expect(getResearchSyncState('store-room')).toMatchObject({ phase: 'local_only', remote: 'unknown' });
    expect(localStorage.setItem).toHaveBeenCalled();
  });

  it('notifies the active room after a verified local append', async () => {
    const localStorage = storage();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('dispatchEvent', dispatchEvent);
    const record = await makeRecord();

    await appendResearchRecord(record);

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'reploid:pool-research-update',
      detail: {
        roomId: 'store-room',
        recordHash: record.recordHash,
        kind: 'research_submission'
      }
    }));
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
    expect(getResearchSyncState('store-room')).toMatchObject({
      phase: 'stale',
      remote: 'unavailable',
      remoteError: 'offline'
    });

    const hydrated = await hydrateResearchRecords('store-room', {
      sdk: { listResearchRecords: vi.fn().mockResolvedValue({ records: [remote] }) }
    });
    expect(hydrated.remote).toBe(true);
    expect(hydrated.records.map((record) => record.recordHash)).toEqual([local.recordHash, remote.recordHash]);
    expect(getResearchSyncState('store-room')).toMatchObject({ phase: 'synchronized', remote: 'synchronized' });
  });

  it('exposes verified local history before coordinator hydration completes', async () => {
    const localStorage = storage();
    vi.stubGlobal('localStorage', localStorage);
    const local = await makeRecord('store-room');
    localStorage.seed('reploid.pool.research-evidence.v1::store-room', JSON.stringify([local]));
    let resolveRemote;
    const remote = new Promise((resolve) => { resolveRemote = resolve; });
    const onLocalHydrated = vi.fn();
    const hydration = hydrateResearchRecords('store-room', {
      sdk: { listResearchRecords: vi.fn(() => remote) },
      onLocalHydrated
    });

    await vi.waitFor(() => expect(onLocalHydrated).toHaveBeenCalledWith(expect.objectContaining({
      records: [local],
      rejectedRecords: []
    })));
    expect(loadResearchRecords('store-room')).toEqual([local]);

    resolveRemote({ records: [] });
    await expect(hydration).resolves.toMatchObject({ remote: true, records: [local] });
  });

  it('hydrates linked evidence regardless of remote record order', async () => {
    vi.stubGlobal('localStorage', storage());
    const submission = await makeRecord('store-room');
    const result = await makeResult(submission);
    const hydrated = await hydrateResearchRecords('store-room', {
      sdk: { listResearchRecords: vi.fn().mockResolvedValue({ records: [result, submission] }) }
    });

    expect(hydrated.records.map((record) => record.recordHash)).toEqual([
      submission.recordHash,
      result.recordHash
    ]);
    expect(hydrated.rejectedRecords).toEqual([]);
  });

  it('rejects a structurally valid but disabled candidate model before local persistence', async () => {
    vi.stubGlobal('localStorage', storage());
    const record = await makeRecord('store-room');
    const candidateRecord = await makeCandidateRecord(record.roomId);
    await expect(appendResearchRecord(candidateRecord)).rejects.toThrow('model contract is not a currently enabled Poolday model');
  });

  it('contains a remote candidate record while hydrating the remaining valid evidence', async () => {
    vi.stubGlobal('localStorage', storage());
    const candidate = await makeCandidateRecord();
    const admitted = await makeRecord();
    const hydrated = await hydrateResearchRecords('store-room', {
      sdk: { listResearchRecords: vi.fn().mockResolvedValue({ records: [candidate, admitted] }) }
    });
    expect(hydrated).toMatchObject({
      remote: true,
      records: [admitted],
      rejectedRecords: [{
        recordHash: candidate.recordHash,
        reason: expect.stringContaining('model contract is not a currently enabled Poolday model')
      }]
    });
    expect(getResearchSyncState('store-room')).toMatchObject({
      phase: 'synchronized',
      remote: 'synchronized',
      rejectedRecords: [{ recordHash: candidate.recordHash }]
    });
  });

  it('does not project a persisted record until signature and admission checks pass', async () => {
    const localStorage = storage();
    vi.stubGlobal('localStorage', localStorage);
    const record = await makeRecord('store-room');
    const tampered = {
      ...record,
      requesterIntent: { ...record.requesterIntent, text: 'tampered after persistence' }
    };
    localStorage.seed('reploid.pool.research-evidence.v1::store-room', JSON.stringify([tampered]));

    expect(loadResearchRecords('store-room')).toEqual([]);
    const hydrated = await hydrateResearchRecords('store-room', {
      sdk: { listResearchRecords: vi.fn().mockRejectedValue(new Error('offline')) }
    });
    expect(hydrated).toMatchObject({
      remote: false,
      records: [],
      rejectedRecords: [{
        recordHash: record.recordHash,
        reason: expect.stringContaining('record hash mismatch')
      }]
    });
    expect(getResearchSyncState('store-room')).toMatchObject({
      phase: 'stale',
      remote: 'unavailable',
      rejectedRecords: [{ recordHash: record.recordHash }]
    });
    expect(localStorage.getItem('reploid.pool.research-evidence.v1::store-room')).toBe('[]');
    expect(loadQuarantinedResearchRecords('store-room')).toEqual([
      expect.objectContaining({
        record: tampered,
        reason: expect.stringContaining('record hash mismatch'),
        quarantinedAt: expect.any(String)
      })
    ]);
  });

  it('rejects a candidate result even when its question uses the enabled ESM-2 contract', async () => {
    vi.stubGlobal('localStorage', storage());
    const source = await makeRecord('store-room');
    const candidate = getPoolModelContract('amplify-120m-f16-af32');
    const vector = Array.from({ length: candidate.embeddingDimensions }, (_, index) => (index === 0 ? 1 : 0));
    const resultIdentity = {
      resolve: async () => ({ kind: 'researcher', roleId: 'researcher_candidate_result', userId: 'user_candidate_result', deviceId: 'device_candidate_result', identityRootId: 'root_candidate_result' }),
      getSigningKeyPair: async () => (await createSigningKeyPair())
    };
    const candidateResult = await createSignedResearchResult({
      identity: resultIdentity,
      submission: source,
      modelContract: candidate,
      receiptRecord: {
        receiptHash: `sha256:${'c'.repeat(64)}`,
        verifierDecision: { accepted: true },
        receipt: {
          model: candidate,
          providerId: 'provider_candidate_result',
          assignmentId: 'assignment_candidate_result',
          jobId: 'job_candidate_result',
          outputKind: 'sequence.embedding.v1',
          vectorHash: await hashSequenceFloat32Values(vector)
        }
      },
      embedding: vector
    });
    await expect(appendResearchRecord(candidateResult)).rejects.toThrow('model contract is not a currently enabled Poolday model');
  });
});
