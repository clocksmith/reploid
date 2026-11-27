import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const peerRoomMocks = vi.hoisted(() => ({
  DEFAULT_PEER_ROOM_ID: 'reploid-default',
  runPeerJob: vi.fn(async (options = {}) => {
    options.onActivity?.({ status: 'peer_run_intent_created', phase: 'prompt' });
    options.onActivity?.({ status: 'peer_inference_started', phase: 'infer' });
    options.onActivity?.({ status: 'peer_run_completed', phase: 'answer' });
    return {
      status: 'accepted',
      outputText: 'network answer',
      receiptHash: 'sha256:test-answer',
      receiptRecord: {
        jobId: 'peer_job_test',
        receiptHash: 'sha256:test-answer'
      }
    };
  }),
  createPeerProviderNode: vi.fn()
}));

const adapterRegistryMocks = vi.hoisted(() => ({
  listFetchableAdapterPublications: vi.fn(),
  resolveFetchableAdapterPublication: vi.fn(),
  createPublishedAdapterOriginFetcher: vi.fn(() => vi.fn())
}));

vi.mock('../../apps/poolday/pool/peer-room.js', () => peerRoomMocks);
const localExecutorMocks = vi.hoisted(() => ({ run: vi.fn(), close: vi.fn(async () => {}), cancel: vi.fn() }));
vi.mock('../../apps/poolday/pool/local-pack-executor.js', () => ({ createLocalPackExecutor: () => localExecutorMocks }));
vi.mock('../../apps/poolday/pool/adapter-registry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...adapterRegistryMocks
}));
import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../../shared/pool/model-contract.js';
import {
  normalizeParticipationPreferences,
  readParticipationPreferences,
  writeParticipationPreferences
} from '../../shared/pool/participation-profile.js';
import { POOL_CONTRIBUTION_RESUME_STORAGE_KEY } from '../../apps/poolday/host/contribution-resume.js';
import { POOL_PENDING_REQUEST_STORAGE_KEY } from '../../apps/poolday/ui/pool-home/pending-request-recovery.js';
import { getPageIdentityNamespace } from '../../apps/poolday/ui/pool-home/page-identity.js';
import { resetPoolDeviceCapabilityForTests, resolveCapabilityAvailabilityLimits, scorePoolDeviceCapability } from '../../apps/poolday/host/device-capability.js';
import { getPeerSessionAcceptWindowMs, getPeerTransportConnectWindowMs } from '../../apps/poolday/host/peer-execution-config.js';

const clearStorage = () => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
};

const mountLocalFallbackRequest = (policyId = 'fastest_receipt') => {
  document.body.innerHTML = `<section class="pool-home-stage" data-pool-run-surface data-pool-lane="sequence">
    <select id="pool-home-request-policy"><option value="${policyId}">${policyId}</option></select>
    <form id="pool-home-ask-form"><input id="pool-home-ask-prompt" value="MKTAYIAKQRQISFVKSHFSRQ">
    <input id="pool-home-sequence-public" type="checkbox" checked><button id="pool-home-run-submit">Run</button></form>
    <p data-pool-run-status></p><section data-pool-run-output hidden>
    <div id="pool-home-run-result-summary"></div><pre id="pool-home-run-result-stream"></pre>
    <div id="pool-home-run-result-evidence"></div><div id="pool-home-run-result-recovery" hidden></div>
    <pre id="pool-home-run-result-raw"></pre></section></section>`;
};

const createMemoryStorage = (entries = []) => {
  const values = new Map(entries);
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, String(value))
  };
};

describe('Poolday home ask controls', () => {
  const adapterPublication = {
    packHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    publicationHash: 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    publisher: { publisherId: 'publisher-ui' },
    pack: {
      packHash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      packId: 'adapter-ui',
      label: 'Adapter UI',
      adapter: {
        id: 'adapter-ui',
        sha256: 'sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
      },
      baseModel: {
        modelId: LAUNCH_MODEL.modelId,
        modelHash: LAUNCH_MODEL.modelHash,
        manifestHash: LAUNCH_MODEL.manifestHash
      },
      evidence: {
        humanPromotionReceiptHash: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
        dopplerParityReceiptHash: 'sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
        gammaSelectionReceiptHash: 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      }
    }
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    clearStorage();
    peerRoomMocks.runPeerJob.mockClear();
    peerRoomMocks.createPeerProviderNode.mockClear();
    localExecutorMocks.run.mockReset();
    localExecutorMocks.close.mockClear();
    localExecutorMocks.cancel.mockClear();
    adapterRegistryMocks.listFetchableAdapterPublications.mockReset().mockResolvedValue([adapterPublication]);
    adapterRegistryMocks.resolveFetchableAdapterPublication.mockReset().mockResolvedValue(adapterPublication);
    window.history.replaceState({}, '', '/');
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 1;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 1;
    window.REPLOID_POOL_SESSION_ACCEPT_WINDOW_MS = 11;
    window.REPLOID_POOL_TRANSPORT_CONNECT_WINDOW_MS = 12;
  });

  it('does not reuse a duplicated tab identity namespace but restores it after reload', () => {
    const key = 'REPLOID_POOL_REQUESTER_NAMESPACE';
    const storage = createMemoryStorage();
    const sourceTab = { sessionStorage: storage, crypto: { randomUUID: () => 'source' } };
    const sourceNamespace = getPageIdentityNamespace(key, {
      windowRef: sourceTab,
      navigationType: 'navigate'
    });
    const duplicateTab = {
      sessionStorage: createMemoryStorage(Object.entries({
        [`reploid.pool.page-identity.${key}`]: sourceNamespace
      })),
      crypto: { randomUUID: () => 'duplicate' }
    };
    const duplicateNamespace = getPageIdentityNamespace(key, {
      windowRef: duplicateTab,
      navigationType: 'navigate'
    });
    const reloadedDuplicate = {
      sessionStorage: duplicateTab.sessionStorage,
      crypto: { randomUUID: () => 'unexpected' }
    };

    expect(duplicateNamespace).not.toBe(sourceNamespace);
    expect(getPageIdentityNamespace(key, {
      windowRef: reloadedDuplicate,
      navigationType: 'reload'
    })).toBe(duplicateNamespace);
  });

  it('scores bounded WebGPU evidence into four contribution categories', () => {
    expect(scorePoolDeviceCapability({
      deviceInfo: { hasWebGPU: false }
    })).toMatchObject({
      supported: false,
      score: 0,
      tier: { id: 'unsupported', label: 'Request only' }
    });

    const unmeasured = scorePoolDeviceCapability({
      deviceInfo: {
        hasWebGPU: true,
        maxBufferSize: 512 * 1024 * 1024,
        limits: {
          maxBufferSize: 512 * 1024 * 1024,
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxComputeInvocationsPerWorkgroup: 256
        },
        hasF16: true,
        hasSubgroups: true
      },
      benchmark: { status: 'failed' }
    });
    expect(unmeasured).toMatchObject({ measured: false, score: 39, tier: { id: 'basic' } });

    const measured = scorePoolDeviceCapability({
      deviceInfo: {
        hasWebGPU: true,
        maxBufferSize: 512 * 1024 * 1024,
        limits: {
          maxBufferSize: 512 * 1024 * 1024,
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxComputeInvocationsPerWorkgroup: 256
        },
        hasF16: true,
        hasSubgroups: true
      },
      benchmark: { status: 'measured', gigaOpsPerSecond: 120, stability: 0.92 }
    });
    expect(measured).toMatchObject({ measured: true, score: 100, tier: { id: 'high' } });
  });

  it('clamps provider budgets to both user limits and measured capacity', () => {
    expect(resolveCapabilityAvailabilityLimits({
      limits: { maxConcurrentJobs: 4, maxTokensPerJob: 1024 }
    }, {
      tier: { maxConcurrentJobs: 2, maxTokensPerJob: 256 }
    })).toEqual({ maxConcurrentJobs: 2, maxTokensPerJob: 256 });

    expect(resolveCapabilityAvailabilityLimits({
      limits: { maxConcurrentJobs: 1, maxTokensPerJob: 64 }
    }, {
      tier: { maxConcurrentJobs: 3, maxTokensPerJob: 512 }
    })).toEqual({ maxConcurrentJobs: 1, maxTokensPerJob: 64 });
  });

  it('allows server relay polling enough time to accept and connect a peer session', () => {
    delete window.REPLOID_POOL_SESSION_ACCEPT_WINDOW_MS;
    delete window.REPLOID_POOL_TRANSPORT_CONNECT_WINDOW_MS;
    window.history.replaceState({}, '', '/?relay=server');

    expect(getPeerSessionAcceptWindowMs()).toBe(15000);
    expect(getPeerTransportConnectWindowMs()).toBe(20000);

    window.history.replaceState({}, '', '/?relay=local');
    expect(getPeerSessionAcceptWindowMs()).toBe(5000);
    expect(getPeerTransportConnectWindowMs()).toBe(5000);
  });
});
