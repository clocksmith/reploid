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
  bindHomeAskControls,
  bindRunControls,
  refreshParticipationControls,
  resolveCapabilityAvailabilityLimits,
  scorePoolDeviceCapability
} from '../../self/ui/pool-home/controls.js';
import { LAUNCH_MODEL } from '../../self/pool/model-contract.js';
import { normalizeParticipationPreferences } from '../../self/pool/participation-profile.js';

const clearStorage = () => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
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
    adapterRegistryMocks.listFetchableAdapterPublications.mockReset().mockResolvedValue([adapterPublication]);
    adapterRegistryMocks.resolveFetchableAdapterPublication.mockReset().mockResolvedValue(adapterPublication);
    window.history.replaceState({}, '', '/');
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 1;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 1;
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

  afterEach(() => {
    document.body.innerHTML = '';
    clearStorage();
    delete window.REPLOID_POOL_DISCOVERY_WINDOW_MS;
    delete window.REPLOID_POOL_RECEIPT_WINDOW_MS;
    delete window.REPLOID_POOL_RUN_VISUAL_STATE;
    peerRoomMocks.runPeerJob.mockClear();
    vi.restoreAllMocks();
  });

  it('turns the adapter lane into an exact adapter job instead of a visual mode', async () => {
    window.history.replaceState({}, '', '/?room=adapter-room&relay=local');
    document.body.innerHTML = `
      <section class="pool-home-stage" data-pool-run-surface="home" data-run-state="idle" data-pool-lane="text">
        <button class="pool-lane-chip is-active" data-pool-lane="text" aria-pressed="true">Text</button>
        <button class="pool-lane-chip" data-pool-lane="adapters" aria-pressed="false">Adapters</button>
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

  it('runs a home prompt in place without losing the room or relay', async () => {
    window.history.replaceState({}, '', '/?room=test-room&relay=local');
    document.body.innerHTML = `
      <section data-pool-run-surface="home" data-run-state="idle">
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
      prompt: 'Dinner ideas tonight'
    });
    expect(document.querySelector('[data-pool-run-surface]').dataset.runState).toBe('complete');
    expect(document.querySelector('[data-pool-run-output]').hidden).toBe(false);
    expect(document.getElementById('pool-home-run-result-stream').textContent).toBe('network answer');
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
