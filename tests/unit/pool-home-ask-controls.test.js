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

vi.mock('../../self/pool/peer-room.js', () => peerRoomMocks);

import { bindHomeAskControls, bindRunControls } from '../../self/ui/pool-home/controls.js';

const clearStorage = () => {
  window.localStorage?.clear();
  window.sessionStorage?.clear();
};

describe('Poolday home ask controls', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearStorage();
    peerRoomMocks.runPeerJob.mockClear();
    window.history.replaceState({}, '', '/');
    window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 1;
    window.REPLOID_POOL_RECEIPT_WINDOW_MS = 1;
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
