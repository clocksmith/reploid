import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const peerRoomMocks = vi.hoisted(() => ({
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

vi.mock('../../self/pool/peer-room.js', () => peerRoomMocks);
vi.mock('../../self/pool/adapter-registry.js', async (importOriginal) => ({
  ...(await importOriginal()),
  ...adapterRegistryMocks
}));

import {
  POOL_CONTRIBUTION_RESUME_STORAGE_KEY,
  bindCapabilityAssessmentControls,
  bindHomeAskControls,
  bindProviderControls,
  bindRunControls,
  getPageIdentityNamespace,
  refreshParticipationControls,
  resetPoolDeviceCapabilityForTests,
  resetProviderContributionControllerForTests,
  resolveCapabilityAvailabilityLimits,
  scorePoolDeviceCapability
} from '../../self/ui/pool-home/controls.js';
import {
  findReceiptLedgerRecord,
  getPeerSessionAcceptWindowMs,
  getPeerTransportConnectWindowMs
} from '../../self/ui/pool-home/view.js';
import { LAUNCH_MODEL, getEnabledPoolModelContract } from '../../self/pool/model-contract.js';
import {
  normalizeParticipationPreferences,
  readParticipationPreferences,
  writeParticipationPreferences
} from '../../self/pool/participation-profile.js';

const clearStorage = () => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
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

  it('preserves workload and registry availability across participation modes', async () => {
    document.body.innerHTML = `
      <section data-pool-run-surface="home">
        <button id="text-lane" type="button" data-pool-request-control>Text</button>
        <button id="sequence-lane" type="button" data-pool-request-control disabled>Sequence</button>
        <select id="adapter-pack" data-pool-request-control disabled><option>Loading published packs…</option></select>
      </section>
      <form class="pool-home-ask-dock"></form>
      <button class="pool-home-share-toggle" type="button">Start sharing</button>
    `;
    const request = normalizeParticipationPreferences({ mode: 'request' });
    const contribute = normalizeParticipationPreferences({ mode: 'contribute' });
    const both = normalizeParticipationPreferences({ mode: 'both' });

    await refreshParticipationControls(request);
    expect(document.getElementById('text-lane').disabled).toBe(false);
    expect(document.getElementById('sequence-lane').disabled).toBe(true);
    expect(document.getElementById('adapter-pack').disabled).toBe(true);

    await refreshParticipationControls(contribute);
    expect(document.getElementById('text-lane').disabled).toBe(true);
    expect(document.getElementById('sequence-lane').disabled).toBe(true);
    expect(document.getElementById('adapter-pack').disabled).toBe(true);

    await refreshParticipationControls(both);
    expect(document.getElementById('text-lane').disabled).toBe(false);
    expect(document.getElementById('sequence-lane').disabled).toBe(true);
    expect(document.getElementById('adapter-pack').disabled).toBe(true);
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

  afterEach(async () => {
    await resetProviderContributionControllerForTests();
    resetPoolDeviceCapabilityForTests();
    document.body.innerHTML = '';
    clearStorage();
    delete window.REPLOID_POOL_DISCOVERY_WINDOW_MS;
    delete window.REPLOID_POOL_RECEIPT_WINDOW_MS;
    delete window.REPLOID_POOL_SESSION_ACCEPT_WINDOW_MS;
    delete window.REPLOID_POOL_TRANSPORT_CONNECT_WINDOW_MS;
    delete window.REPLOID_POOL_RUN_VISUAL_STATE;
    delete window.REPLOID_DOPPLER_RUNTIME;
    peerRoomMocks.runPeerJob.mockClear();
    vi.restoreAllMocks();
  });

  it('turns the adapter lane into an exact adapter job instead of a visual mode', async () => {
    window.history.replaceState({}, '', '/?room=adapter-room&relay=local');
    document.body.innerHTML = `
      <section class="pool-home-stage" data-pool-run-surface="home" data-run-state="idle" data-pool-lane="text">
        <button class="pool-lane-chip is-active" data-pool-lane="text" aria-pressed="true">Text</button>
        <button class="pool-lane-chip" data-pool-lane="adapters" data-pool-composer-adapter-lane aria-pressed="false">Adapters</button>
        <form id="pool-home-ask-form">
          <label data-pool-home-adapter-picker hidden>
            <select id="pool-home-adapter"></select>
          </label>
          <input id="pool-home-ask-prompt" value="Explain browser inference" data-pool-suggested-prompt="Explain browser inference">
          <button id="pool-home-run-submit" type="submit">Run</button>
        </form>
        <p data-pool-run-status></p>
        <section data-pool-run-output hidden>
          <div id="pool-home-run-result-summary"></div>
          <pre id="pool-home-run-result-stream"></pre>
          <span id="pool-home-run-result-stream-cursor"></span>
          <div id="pool-home-run-result-evidence"></div>
          <pre id="pool-home-run-result-raw"></pre>
        </section>
      </section>
    `;

    bindHomeAskControls();
    document.querySelector('[data-pool-lane="adapters"]').click();
    await vi.waitFor(() => expect(adapterRegistryMocks.listFetchableAdapterPublications).toHaveBeenCalled());
    await vi.waitFor(() => expect(document.getElementById('pool-home-adapter').options.length).toBe(2));
    expect(document.querySelector('[data-pool-home-adapter-picker]').hidden).toBe(false);
    document.getElementById('pool-home-adapter').value = adapterPublication.packHash;
    document.getElementById('pool-home-ask-form').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true
    }));
    await vi.waitFor(() => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(1));

    expect(peerRoomMocks.runPeerJob.mock.calls[0][0].modelRequirements.adapter).toMatchObject({
      packHash: adapterPublication.packHash,
      publicationHash: adapterPublication.publicationHash,
      publisherId: 'publisher-ui',
      state: 'fetchable'
    });
    expect(document.querySelector('.pool-home-stage').dataset.poolLane).toBe('adapters');
  });

  it('returns to text and removes adapter controls when no promoted pack remains', async () => {
    window.history.replaceState({}, '', '/?room=adapter-empty-room&relay=local');
    document.body.innerHTML = `
      <section class="pool-home-stage" data-pool-run-surface="home" data-run-state="idle" data-pool-lane="text">
        <button class="pool-lane-chip is-active" data-pool-lane="text" aria-pressed="true">Text</button>
        <button class="pool-lane-chip" data-pool-lane="adapters" data-pool-composer-adapter-lane aria-pressed="false" hidden>Adapter</button>
        <select id="pool-home-request-model">
          <option value="${LAUNCH_MODEL.modelId}" selected>${LAUNCH_MODEL.label}</option>
        </select>
        <form id="pool-home-ask-form">
          <label data-pool-home-adapter-picker hidden>
            <span>Adapter pack</span>
            <select id="pool-home-adapter"></select>
            <small data-pool-adapter-status hidden></small>
          </label>
          <input id="pool-home-ask-prompt" value="Explain browser inference">
          <button id="pool-home-run-submit" type="submit">Run</button>
        </form>
        <p data-pool-run-status></p>
        <section data-pool-run-output hidden>
          <div id="pool-home-run-result-summary"></div>
          <pre id="pool-home-run-result-stream"></pre>
          <span id="pool-home-run-result-stream-cursor"></span>
          <div id="pool-home-run-result-evidence"></div>
          <pre id="pool-home-run-result-raw"></pre>
        </section>
      </section>
    `;

    bindHomeAskControls();
    await vi.waitFor(() => expect(document.querySelector('[data-pool-lane="adapters"]').hidden).toBe(false));
    adapterRegistryMocks.listFetchableAdapterPublications.mockResolvedValue([]);
    document.querySelector('[data-pool-lane="adapters"]').click();

    await vi.waitFor(() => expect(document.querySelector('.pool-home-stage').dataset.poolLane).toBe('text'));
    expect(document.querySelector('[data-pool-lane="adapters"]').hidden).toBe(true);
    expect(document.querySelector('[data-pool-home-adapter-picker]').hidden).toBe(true);
    expect(document.querySelector('.pool-lane-chip[data-pool-lane="text"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('turns the sequence lane into a public ESM-2 peer request', async () => {
    window.history.replaceState({}, '', '/?room=sequence-room&relay=local');
    document.body.innerHTML = `
      <section class="pool-home-stage" data-pool-run-surface="home" data-run-state="idle" data-pool-lane="text">
        <button class="pool-lane-chip is-active" data-pool-lane="text" aria-pressed="true">Text</button>
        <button class="pool-lane-chip" data-pool-lane="adapters" aria-pressed="false">Adapters</button>
        <button class="pool-lane-chip" data-pool-lane="sequence" aria-pressed="false">Sequence</button>
        <div data-pool-sequence-options hidden>
          <label data-pool-sequence-consent-row>
            <input id="pool-home-sequence-public" type="checkbox">
          </label>
          <strong data-pool-sequence-consent-saved hidden>Public-sequence acknowledgement saved.</strong>
        </div>
        <select id="pool-home-request-model">
          <option value="${LAUNCH_MODEL.modelId}" selected>${LAUNCH_MODEL.label}</option>
        </select>
        <form id="pool-home-ask-form">
          <input id="pool-home-ask-prompt" value="" data-pool-suggested-prompt="Dinner ideas tonight">
          <button id="pool-home-run-submit" type="submit">Run</button>
        </form>
        <p data-pool-run-status></p>
        <section data-pool-run-output hidden>
          <div id="pool-home-run-result-summary"></div>
          <pre id="pool-home-run-result-stream"></pre>
          <span id="pool-home-run-result-stream-cursor"></span>
          <div id="pool-home-run-result-evidence"></div>
          <pre id="pool-home-run-result-raw"></pre>
        </section>
      </section>
    `;

    bindHomeAskControls();
    document.querySelector('[data-pool-lane="sequence"]').click();

    const input = document.getElementById('pool-home-ask-prompt');
    const modelSelect = document.getElementById('pool-home-request-model');
    expect(document.querySelector('[data-pool-sequence-options]').hidden).toBe(false);
    expect(input.name).toBe('sequence');
    expect(input.placeholder).toMatch(/^[A-Z*.-]+$/);
    expect(modelSelect.value).toBe('esm2-t12-35m-ur50d-f32-af32');
    expect(modelSelect.selectedOptions[0].textContent).toBe('ESM-2 35M (Protein)');

    input.value = 'MKTAYIAKQRQISFVKSHFSRQ';
    document.getElementById('pool-home-sequence-public').checked = true;
    document.getElementById('pool-home-sequence-public').dispatchEvent(new Event('change'));
    expect(window.localStorage.getItem('reploid.pool.sequence-public-consent.v1')).toBe('true');
    expect(document.querySelector('[data-pool-sequence-consent-row]').hidden).toBe(true);
    expect(document.querySelector('[data-pool-sequence-consent-saved]').hidden).toBe(false);
    document.getElementById('pool-home-ask-form').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true
    }));
    await vi.waitFor(() => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(1));
    document.querySelector('[data-pool-lane="text"]').click();
    document.querySelector('[data-pool-lane="sequence"]').click();
    expect(document.getElementById('pool-home-sequence-public').checked).toBe(true);
    expect(document.querySelector('[data-pool-sequence-consent-row]').hidden).toBe(true);

    expect(peerRoomMocks.runPeerJob.mock.calls[0][0]).toMatchObject({
      roomId: 'sequence-room',
      prompt: null,
      sequence: 'MKTAYIAKQRQISFVKSHFSRQ',
      sequenceRequest: {
        workload: 'sequence.embedding.v1',
        alphabet: 'amino_acid',
        sensitivity: 'public',
        includeTokenEmbeddings: false,
        includeLogits: false
      },
      modelRequirements: {
        modelId: 'esm2-t12-35m-ur50d-f32-af32',
        workload: 'sequence.embedding.v1',
        executionMode: 'full_model_browser_sequence'
      }
    });
  });

  it('runs a home prompt in place without losing the room or relay', async () => {
    window.history.replaceState({}, '', '/?room=test-room&relay=local');
    document.body.innerHTML = `
      <section data-pool-run-surface="home" data-run-state="idle">
      <select id="pool-home-request-model">
        <option value="gemma-3-270m-it-q4k-ehf16-af32" selected>Gemma 3 270M</option>
      </select>
      <select id="pool-home-request-policy">
        <option value="canary_audited" selected>Sample checked - one tab</option>
      </select>
      <form id="pool-home-ask-form">
        <input
          id="pool-home-ask-prompt"
          value="Dinner ideas tonight"
          data-pool-suggested-prompt="Dinner ideas tonight"
        >
        <button id="pool-home-run-submit" type="submit">Run</button>
      </form>
      <p data-pool-run-status></p>
      <section data-pool-run-output hidden>
        <div id="pool-home-run-result-summary"></div>
        <pre id="pool-home-run-result-stream"></pre>
        <span id="pool-home-run-result-stream-cursor"></span>
        <div id="pool-home-run-result-evidence"></div>
        <pre id="pool-home-run-result-raw"></pre>
      </section>
      </section>
    `;

    bindHomeAskControls();
    document.getElementById('pool-home-ask-form').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true
    }));
    await vi.waitFor(() => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(1));

    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?room=test-room&relay=local');
    expect(peerRoomMocks.runPeerJob.mock.calls[0][0]).toMatchObject({
      roomId: 'test-room',
      prompt: 'Dinner ideas tonight',
      policyId: 'canary_audited',
      sessionAcceptWindowMs: 11,
      transportConnectWindowMs: 12,
      modelRequirements: {
        modelId: 'gemma-3-270m-it-q4k-ehf16-af32'
      }
    });
    expect(document.querySelector('[data-pool-run-surface]').dataset.runState).toBe('complete');
    expect(document.querySelector('[data-pool-run-output]').hidden).toBe(false);
    expect(document.getElementById('pool-home-run-result-stream').textContent).toBe('network answer');
  });

  it('persists provider rejection reasons with the accepted receipt', async () => {
    window.history.replaceState({}, '', '/?room=route-reasons-room&relay=local');
    peerRoomMocks.runPeerJob.mockResolvedValueOnce({
      status: 'accepted',
      outputText: 'network answer',
      receiptHash: 'sha256:route-reasons',
      receiptRecord: {
        jobId: 'peer_job_route_reasons',
        receiptHash: 'sha256:route-reasons'
      },
      plan: {
        routeDecision: {
          decisionHash: 'sha256:route-decision',
          selectedProviderIds: ['provider_selected'],
          candidates: [
            {
              providerId: 'provider_selected',
              eligible: true,
              rejectionReasons: []
            },
            {
              providerId: 'provider_rejected',
              eligible: false,
              rejectionReasons: ['model_hash_mismatch']
            }
          ]
        }
      }
    });
    document.body.innerHTML = `
      <section data-pool-run-surface="home" data-run-state="idle">
        <form id="pool-home-ask-form">
          <input id="pool-home-ask-prompt" value="Preserve route evidence">
          <button id="pool-home-run-submit" type="submit">Run</button>
        </form>
        <p data-pool-run-status></p>
        <section data-pool-run-output hidden>
          <div id="pool-home-run-result-summary"></div>
          <pre id="pool-home-run-result-stream"></pre>
          <span id="pool-home-run-result-stream-cursor"></span>
          <div id="pool-home-run-result-evidence"></div>
          <pre id="pool-home-run-result-raw"></pre>
        </section>
      </section>
    `;

    bindHomeAskControls();
    document.getElementById('pool-home-ask-form').requestSubmit();

    await vi.waitFor(() => expect(findReceiptLedgerRecord('sha256:route-reasons')).not.toBeNull());
    expect(findReceiptLedgerRecord('sha256:route-reasons')?.routeDecision).toMatchObject({
      decisionHash: 'sha256:route-decision',
      candidates: expect.arrayContaining([
        expect.objectContaining({
          providerId: 'provider_rejected',
          rejectionReasons: ['model_hash_mismatch']
        })
      ])
    });
  });

  it('tries the peer network before offering an optional local fallback', async () => {
    window.history.replaceState({}, '', '/?room=network-first-room&relay=local');
    const discoveryError = new Error('No peer providers advertised in room "network-first-room"');
    discoveryError.code = 'peer_provider_not_found';
    discoveryError.retryable = true;
    discoveryError.payload = {
      code: discoveryError.code,
      retryable: true,
      roomId: 'network-first-room'
    };
    peerRoomMocks.runPeerJob.mockRejectedValueOnce(discoveryError);
    document.body.innerHTML = `
      <section data-pool-run-surface="home" data-run-state="idle">
        <form id="pool-home-ask-form">
          <input id="pool-home-ask-prompt" value="Use the network first">
          <button id="pool-home-run-submit" type="submit">Run</button>
        </form>
        <p data-pool-run-status></p>
        <section data-pool-run-output hidden>
          <div id="pool-home-run-result-summary"></div>
          <pre id="pool-home-run-result-stream"></pre>
          <span id="pool-home-run-result-stream-cursor"></span>
          <div id="pool-home-run-result-evidence"></div>
          <div id="pool-home-run-result-recovery" hidden></div>
          <pre id="pool-home-run-result-raw"></pre>
        </section>
      </section>
    `;

    bindHomeAskControls();
    document.getElementById('pool-home-ask-form').requestSubmit();

    await vi.waitFor(() => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(document.getElementById('pool-home-run-result-recovery').hidden).toBe(false));
    expect(peerRoomMocks.runPeerJob.mock.calls[0][0]).toMatchObject({
      roomId: 'network-first-room',
      prompt: 'Use the network first'
    });
    expect(peerRoomMocks.createPeerProviderNode).not.toHaveBeenCalled();
    expect(document.getElementById('pool-home-run-result-recovery').textContent).toContain(
      'Reploid tried the network first'
    );

    document.querySelector('[data-pool-run-recovery-action="offer_local_provider"]').click();
    expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(1);
    expect(peerRoomMocks.createPeerProviderNode).not.toHaveBeenCalled();
    expect(document.getElementById('pool-home-run-result-recovery').textContent).toContain(
      'Changes participation to Both'
    );

    document.querySelector('[data-pool-run-recovery-action="back_to_network"]').click();
    document.querySelector('[data-pool-run-recovery-action="retry_network"]').click();
    await vi.waitFor(() => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(document.getElementById('pool-home-run-result-stream').textContent).toBe('network answer');
    });
    expect(peerRoomMocks.runPeerJob.mock.calls[1][0]).toMatchObject({
      roomId: 'network-first-room',
      prompt: 'Use the network first'
    });
  });

  it('starts an explicitly confirmed local provider and retries the preserved request', async () => {
    window.history.replaceState({}, '', '/?room=local-fallback-room&relay=local');
    writeParticipationPreferences({ mode: 'request' });
    const discoveryError = new Error('No peer providers advertised in room "local-fallback-room"');
    discoveryError.code = 'peer_provider_not_found';
    discoveryError.retryable = true;
    discoveryError.payload = {
      code: discoveryError.code,
      retryable: true,
      roomId: 'local-fallback-room'
    };
    peerRoomMocks.runPeerJob.mockRejectedValueOnce(discoveryError);

    let loadedModel = null;
    window.REPLOID_DOPPLER_RUNTIME = {
      getDeviceInfo: vi.fn(async () => ({
        hasWebGPU: true,
        maxBufferSize: 512 * 1024 * 1024,
        limits: {
          maxBufferSize: 512 * 1024 * 1024,
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxComputeInvocationsPerWorkgroup: 256
        },
        hasF16: true,
        hasSubgroups: true,
        capabilityBenchmark: {
          status: 'measured',
          gigaOpsPerSecond: 120,
          stability: 0.95
        }
      })),
      getModelInfo: vi.fn(() => loadedModel),
      getLoadState: vi.fn(() => ({ status: loadedModel ? 'ready' : 'idle' })),
      isReady: vi.fn(() => Boolean(loadedModel)),
      loadModel: vi.fn(async (model) => {
        loadedModel = { ...model };
        return { ok: true };
      }),
      prepare: vi.fn(async () => ({ ok: true }))
    };
    const localProviderAdvert = {
      messageHash: 'local-provider-advert',
      fromPeerId: 'provider_local_fallback',
      body: {
        providerId: 'provider_local_fallback',
        models: [{ ...LAUNCH_MODEL }]
      }
    };
    const stopProvider = vi.fn(async () => ({ status: 'peer_provider_stopped' }));
    let providerActivity = null;
    peerRoomMocks.createPeerProviderNode.mockImplementation(({ onActivity }) => {
      providerActivity = onActivity;
      return {
        start: vi.fn(async () => {
          onActivity?.({ status: 'provider_advertised' });
          return {
            status: 'peer_provider_listening',
            roomId: 'local-fallback-room',
            advert: localProviderAdvert
          };
        }),
        stop: stopProvider
      };
    });

    document.body.innerHTML = `
      <main id="app">
        <section data-pool-run-surface="home" data-run-state="idle">
          <form id="pool-home-ask-form">
            <input id="pool-home-ask-prompt" value="Preserve this exact prompt">
            <button id="pool-home-run-submit" type="submit">Run</button>
          </form>
          <p data-pool-run-status></p>
          <section data-pool-run-output hidden>
            <div id="pool-home-run-result-summary"></div>
            <pre id="pool-home-run-result-stream"></pre>
            <span id="pool-home-run-result-stream-cursor"></span>
            <div id="pool-home-run-result-evidence"></div>
            <div id="pool-home-run-result-recovery" hidden></div>
            <pre id="pool-home-run-result-raw"></pre>
          </section>
        </section>
        <section data-pool-provider>
          <p data-pool-provider-status>Idle</p>
          <select id="pool-provider-model">
            <option value="${LAUNCH_MODEL.modelId}" selected>${LAUNCH_MODEL.label}</option>
          </select>
          <button id="pool-home-provider-toggle" type="button">Start sharing</button>
          <div id="pool-provider-health"></div>
          <div id="pool-provider-result-summary"></div>
          <p id="pool-provider-result"></p>
          <pre id="pool-provider-result-raw"></pre>
        </section>
      </main>
    `;

    bindHomeAskControls();
    bindProviderControls();
    document.getElementById('pool-home-ask-form').requestSubmit();
    await vi.waitFor(() => expect(document.getElementById('pool-home-run-result-recovery').hidden).toBe(false));

    document.querySelector('[data-pool-run-recovery-action="offer_local_provider"]').click();
    expect(peerRoomMocks.createPeerProviderNode).not.toHaveBeenCalled();
    expect(readParticipationPreferences().mode).toBe('request');
    expect(window.REPLOID_DOPPLER_RUNTIME.prepare).toHaveBeenCalledTimes(1);

    document.querySelector('[data-pool-run-recovery-action="confirm_local_provider"]').click();
    await vi.waitFor(
      () => expect(peerRoomMocks.createPeerProviderNode).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    await vi.waitFor(
      () => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(2),
      { timeout: 5000 }
    );
    await vi.waitFor(() => {
      expect(document.getElementById('pool-home-run-result-stream').textContent).toBe('network answer');
    });

    expect(readParticipationPreferences().mode).toBe('both');
    expect(window.REPLOID_DOPPLER_RUNTIME.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: LAUNCH_MODEL.modelId })
    );
    expect(peerRoomMocks.runPeerJob.mock.calls[1][0]).toMatchObject({
      roomId: 'local-fallback-room',
      prompt: 'Preserve this exact prompt',
      knownProviderAdverts: [localProviderAdvert]
    });
    expect(document.getElementById('pool-home-ask-prompt').value).toBe('Preserve this exact prompt');
    expect(JSON.parse(window.sessionStorage.getItem(POOL_CONTRIBUTION_RESUME_STORAGE_KEY))).toMatchObject({
      active: true,
      modelId: LAUNCH_MODEL.modelId,
      roomId: 'local-fallback-room',
      relay: 'local'
    });

    await resetProviderContributionControllerForTests({ preserveResumeIntent: true });
    peerRoomMocks.createPeerProviderNode.mockClear();
    document.body.innerHTML = `
      <main id="app">
        <section data-pool-provider>
          <p data-pool-provider-status>Idle</p>
          <select id="pool-provider-model">
            <option value="${LAUNCH_MODEL.modelId}" selected>${LAUNCH_MODEL.label}</option>
          </select>
          <button id="pool-home-provider-toggle" type="button">Start sharing</button>
          <div id="pool-provider-health"></div>
          <div id="pool-provider-result-summary"></div>
          <p id="pool-provider-result"></p>
          <pre id="pool-provider-result-raw"></pre>
        </section>
      </main>
    `;
    bindProviderControls();
    await vi.waitFor(
      () => expect(peerRoomMocks.createPeerProviderNode).toHaveBeenCalledTimes(1),
      { timeout: 5000 }
    );
    expect(document.querySelector('[data-pool-provider-status]').textContent).toBe('Available');
    providerActivity?.({ status: 'peer_acceptance_received', acceptance: { accepted: true } });
    expect(JSON.parse(document.getElementById('pool-provider-result-raw').textContent)).toMatchObject({
      runner: 'peer_room_listening',
      roomId: 'local-fallback-room',
      advert: localProviderAdvert,
      status: 'peer_acceptance_received'
    });

    document.getElementById('pool-provider-model').dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    expect(peerRoomMocks.createPeerProviderNode).toHaveBeenCalledTimes(1);

    document.getElementById('pool-home-provider-toggle').click();
    await vi.waitFor(() => expect(stopProvider).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => {
      expect(window.sessionStorage.getItem(POOL_CONTRIBUTION_RESUME_STORAGE_KEY)).toBeNull();
    });
  }, 15000);

  it('does not emit a provider model change when capability rendering keeps the selection', async () => {
    window.REPLOID_DOPPLER_RUNTIME = {
      getDeviceInfo: vi.fn(async () => ({
        hasWebGPU: true,
        maxBufferSize: 512 * 1024 * 1024,
        limits: {
          maxBufferSize: 512 * 1024 * 1024,
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxComputeInvocationsPerWorkgroup: 256
        },
        hasF16: true,
        hasSubgroups: true,
        capabilityBenchmark: {
          status: 'measured',
          gigaOpsPerSecond: 120,
          stability: 0.95
        }
      }))
    };
    document.body.innerHTML = `
      <section data-pool-capability-profile>
        <span data-pool-capability-tier></span>
      </section>
      <select id="pool-provider-model">
        <option value="${LAUNCH_MODEL.modelId}" selected>${LAUNCH_MODEL.label}</option>
      </select>
    `;
    const change = vi.fn();
    document.getElementById('pool-provider-model').addEventListener('change', change);

    bindCapabilityAssessmentControls();
    await vi.waitFor(() => {
      expect(document.querySelector('[data-pool-capability-profile]').dataset.capabilityState).toBe('ready');
    });

    expect(change).not.toHaveBeenCalled();
  });

  it('starts a registry-backed sequence provider without manifest or adapter preflight requests', async () => {
    window.history.replaceState({}, '', '/?room=sequence-provider-room&relay=local');
    writeParticipationPreferences({
      mode: 'both',
      permissions: { relayArtifacts: true }
    });
    const sequenceModel = getEnabledPoolModelContract('esm2-t12-35m-ur50d-f32-af32');
    let loadedModel = null;
    window.REPLOID_DOPPLER_RUNTIME = {
      getDeviceInfo: vi.fn(async () => ({
        hasWebGPU: true,
        maxBufferSize: 512 * 1024 * 1024,
        limits: {
          maxBufferSize: 512 * 1024 * 1024,
          maxStorageBufferBindingSize: 256 * 1024 * 1024,
          maxComputeInvocationsPerWorkgroup: 256
        },
        hasF16: true,
        hasSubgroups: true,
        capabilityBenchmark: {
          status: 'measured',
          gigaOpsPerSecond: 120,
          stability: 0.95
        }
      })),
      getModelInfo: vi.fn(() => loadedModel),
      getLoadState: vi.fn(() => ({ status: loadedModel ? 'ready' : 'idle' })),
      getRuntimeInfo: vi.fn(() => ({ version: 'test' })),
      isReady: vi.fn(() => Boolean(loadedModel)),
      loadModel: vi.fn(async (model) => {
        loadedModel = { ...model };
        return { ok: true, model: loadedModel };
      })
    };
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    peerRoomMocks.createPeerProviderNode.mockReturnValue({
      start: vi.fn(async ({ models }) => ({
        status: 'peer_provider_listening',
        advert: { body: { models } }
      })),
      stop: vi.fn(async () => ({ status: 'peer_provider_stopped' }))
    });
    document.body.innerHTML = `
      <main id="app">
        <section data-pool-provider>
          <p data-pool-provider-status>Idle</p>
          <select id="pool-provider-model">
            <option value="${sequenceModel.modelId}" data-workload="${sequenceModel.workload}" selected>
              ${sequenceModel.label}
            </option>
          </select>
          <button id="pool-home-provider-toggle" type="button">Start sharing</button>
          <div id="pool-provider-health"></div>
          <div id="pool-provider-result-summary"></div>
          <p id="pool-provider-result"></p>
          <pre id="pool-provider-result-raw"></pre>
        </section>
      </main>
    `;

    bindProviderControls();
    document.getElementById('pool-home-provider-toggle').click();
    await vi.waitFor(() => expect(peerRoomMocks.createPeerProviderNode).toHaveBeenCalledTimes(1));

    expect(window.REPLOID_DOPPLER_RUNTIME.loadModel).toHaveBeenCalledTimes(1);
    expect(window.REPLOID_DOPPLER_RUNTIME.loadModel).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: sequenceModel.modelId })
    );
    expect(adapterRegistryMocks.listFetchableAdapterPublications).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(peerRoomMocks.createPeerProviderNode.mock.results[0].value.start).toHaveBeenCalledWith(
      expect.objectContaining({
        models: [expect.objectContaining({
          modelId: sequenceModel.modelId,
          adapterPacks: []
        })]
      })
    );
  });

  it('clears the seeded prompt when the user starts editing', () => {
    document.body.innerHTML = `
      <form id="pool-home-ask-form">
        <input
          id="pool-home-ask-prompt"
          value="Plan weekend trip"
          data-pool-suggested-prompt="Plan weekend trip"
        >
        <button id="pool-home-run-submit" type="submit">Run</button>
      </form>
      <section data-pool-run-surface="home"></section>
    `;

    bindHomeAskControls();
    const input = document.getElementById('pool-home-ask-prompt');
    input.dispatchEvent(new Event('focus'));

    expect(input.value).toBe('');
    input.value = 'User typed prompt';
    input.dispatchEvent(new Event('focus'));
    expect(input.value).toBe('User typed prompt');
    expect(peerRoomMocks.runPeerJob).not.toHaveBeenCalled();
  });

  it('submits the Run route prompt through runPeerJob', async () => {
    window.history.replaceState({}, '', '/ask?room=test-room');
    document.body.innerHTML = `
      <section data-pool-run-surface="run" data-run-state="idle">
      <textarea id="pool-run-prompt">Explain browser inference</textarea>
      <select id="pool-run-policy"><option value="fastest_receipt" selected>First answer</option></select>
      <select id="pool-run-model"><option value="qwen-3-5-0-8b-q4k-ehaf16" selected>Qwen 3.5 0.8B</option></select>
      <button id="pool-run-submit" type="button">Run</button>
      <p data-pool-run-status></p>
      <section data-pool-run-output hidden>
      <div id="pool-run-result-summary"></div>
      <pre id="pool-run-result-stream"></pre>
      <span id="pool-run-result-stream-cursor"></span>
      <div id="pool-run-result-evidence"></div>
      <pre id="pool-run-result-raw"></pre>
      </section>
      </section>
    `;

    bindRunControls();
    document.getElementById('pool-run-submit').click();
    await vi.waitFor(() => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(1));

    expect(document.getElementById('pool-run-prompt').value).toBe('Explain browser inference');
    expect(peerRoomMocks.runPeerJob.mock.calls[0][0]).toMatchObject({
      roomId: 'test-room',
      prompt: 'Explain browser inference',
      policyId: 'fastest_receipt'
    });
    expect(document.getElementById('pool-run-result-stream').textContent).toBe('network answer');
  });
});
