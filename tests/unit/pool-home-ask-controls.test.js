import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const peerRoomMocks = vi.hoisted(() => ({
  runPeerJob: vi.fn(async () => ({
    status: 'accepted',
    outputText: 'network answer',
    receiptHash: 'sha256:test-answer',
    receiptRecord: {
      jobId: 'peer_job_test',
      receiptHash: 'sha256:test-answer'
    }
  })),
  createPeerProviderNode: vi.fn()
}));

vi.mock('../../self/pool/peer-room.js', () => peerRoomMocks);

import {
  POOLDAY_PENDING_ASK_STORAGE_KEY,
  bindHomeAskControls,
  bindRunControls
} from '../../self/ui/pool-home/controls.js';

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
    delete window.REPLOID_POOL_PENDING_ASK_PROMPT;
    peerRoomMocks.runPeerJob.mockClear();
    vi.restoreAllMocks();
  });

  it('stores a home prompt and routes to Ask without losing the room or relay', () => {
    window.history.replaceState({}, '', '/?room=test-room&relay=local');
    const render = vi.fn();
    document.body.innerHTML = `
      <form id="pool-home-ask-form">
        <input
          id="pool-home-ask-prompt"
          value="Dinner ideas tonight"
          data-pool-suggested-prompt="Dinner ideas tonight"
        >
      </form>
    `;

    bindHomeAskControls(render);
    document.getElementById('pool-home-ask-form').dispatchEvent(new Event('submit', {
      bubbles: true,
      cancelable: true
    }));

    expect(window.location.pathname).toBe('/ask');
    expect(window.location.search).toBe('?room=test-room&relay=local');
    expect(JSON.parse(window.sessionStorage.getItem(POOLDAY_PENDING_ASK_STORAGE_KEY))).toMatchObject({
      prompt: 'Dinner ideas tonight'
    });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('clears the seeded prompt when the user starts editing', () => {
    const render = vi.fn();
    document.body.innerHTML = `
      <form id="pool-home-ask-form">
        <input
          id="pool-home-ask-prompt"
          value="Plan weekend trip"
          data-pool-suggested-prompt="Plan weekend trip"
        >
      </form>
    `;

    bindHomeAskControls(render);
    const input = document.getElementById('pool-home-ask-prompt');
    input.dispatchEvent(new Event('focus'));

    expect(input.value).toBe('');
    input.value = 'User typed prompt';
    input.dispatchEvent(new Event('focus'));
    expect(input.value).toBe('User typed prompt');
    expect(render).not.toHaveBeenCalled();
  });

  it('consumes the routed prompt on Ask and submits it through runPeerJob', async () => {
    window.sessionStorage.setItem(POOLDAY_PENDING_ASK_STORAGE_KEY, JSON.stringify({
      prompt: 'Explain browser inference',
      createdAt: '2026-07-04T00:00:00.000Z'
    }));
    window.history.replaceState({}, '', '/ask?room=test-room');
    document.body.innerHTML = `
      <textarea id="pool-run-prompt"></textarea>
      <select id="pool-run-policy"><option value="fastest_receipt" selected>First answer</option></select>
      <select id="pool-run-model"><option value="qwen-3-5-0-8b-q4k-ehaf16" selected>Qwen 3.5 0.8B</option></select>
      <button id="pool-run-submit" type="button">Ask</button>
      <div id="pool-run-result-summary"></div>
      <pre id="pool-run-result-stream"></pre>
      <span id="pool-run-result-stream-cursor"></span>
      <div id="pool-run-result-evidence"></div>
      <pre id="pool-run-result-raw"></pre>
    `;

    bindRunControls();
    await vi.waitFor(() => expect(peerRoomMocks.runPeerJob).toHaveBeenCalledTimes(1));

    expect(document.getElementById('pool-run-prompt').value).toBe('Explain browser inference');
    expect(peerRoomMocks.runPeerJob.mock.calls[0][0]).toMatchObject({
      roomId: 'test-room',
      prompt: 'Explain browser inference',
      policyId: 'fastest_receipt'
    });
    expect(window.sessionStorage.getItem(POOLDAY_PENDING_ASK_STORAGE_KEY)).toBeNull();
  });
});
