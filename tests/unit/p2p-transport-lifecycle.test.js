import { describe, expect, it, vi } from 'vitest';
import { createP2PTransport, SIGNAL_TYPES } from '../../packages/reploid/src/transport/index.js';
import { resolveConfig } from '../../packages/reploid/src/config/index.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture({ phase = null, initiator = true, onStateChange = () => {} } = {}) {
  const pending = deferred();
  const entered = deferred();
  const states = [];
  let signal;
  let pc;
  const channel = {
    readyState: 'connecting',
    close: vi.fn(() => {
      const wasClosed = channel.readyState === 'closed';
      channel.readyState = 'closed';
      if (!wasClosed) channel.onclose?.();
    })
  };
  const pause = async (name) => {
    if (phase !== name) return;
    entered.resolve();
    await pending.promise;
  };
  const unsubscribe = vi.fn();
  const signaling = {
    subscribe: (callback) => { signal = callback; return unsubscribe; },
    sendOffer: vi.fn(), sendAnswer: vi.fn(), sendIceCandidate: vi.fn(), sendClose: vi.fn()
  };
  class PeerConnection {
    constructor() {
      pc = this;
      this.connectionState = 'new';
      this.close = vi.fn(() => {
        const wasClosed = this.connectionState === 'closed';
        this.connectionState = 'closed';
        if (!wasClosed) this.onconnectionstatechange?.();
      });
    }
    createDataChannel() { return channel; }
    async createOffer() { await pause('offer'); return { type: 'offer', sdp: 'offer' }; }
    async createAnswer() { await pause('answer'); return { type: 'answer', sdp: 'answer' }; }
    async setLocalDescription(value) { await pause('description'); this.localDescription = value; }
    async setRemoteDescription(value) { this.remoteDescription = value; }
  }
  const transport = createP2PTransport({
    config: resolveConfig({ overrides: { webrtc: { connectTimeoutMs: 25 } } }),
    signaling, initiator, RTCPeerConnectionImpl: PeerConnection,
    RTCSessionDescriptionImpl: null, RTCIceCandidateImpl: null,
    onStateChange: (state) => { states.push(state); onStateChange(state); }
  });
  return { transport, channel, pending, entered, states, signaling, unsubscribe,
    get pc() { return pc; }, signal: (message) => signal(message) };
}

describe('assignment transport cancellation', () => {
  it('honors cancellation from the connecting-state observer before allocating a peer', async () => {
    vi.useFakeTimers();
    try {
      const f = fixture({ onStateChange: (state) => {
        if (state === 'connecting') void f.transport.close('cancelled');
      } });
      let outcome = null;
      f.transport.connect().catch((error) => { outcome = error; });
      await Promise.resolve();
      expect(outcome).toMatchObject({ code: 'webrtc_connection_failed' });
      expect(f.pc).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
      expect(f.states).toEqual(['connecting', 'closing', 'closed']);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('enforces the connection deadline while the browser offer is unresolved', async () => {
    vi.useFakeTimers();
    const f = fixture({ phase: 'offer' });
    let outcome = null;
    f.transport.connect().catch((error) => { outcome = error; });
    try {
      await f.entered.promise;
      await vi.advanceTimersByTimeAsync(25);
      expect(outcome).toMatchObject({ code: 'webrtc_connection_failed', message: 'Connection deadline exceeded' });
      expect(f.pc.close).toHaveBeenCalledTimes(1);
      expect(f.unsubscribe).toHaveBeenCalledTimes(1);
      expect(f.transport.getState()).toBe('failed');
    } finally {
      f.pending.resolve();
      await Promise.resolve();
      vi.useRealTimers();
    }
    expect(f.signaling.sendOffer).not.toHaveBeenCalled();
  });

  it.each(['offer', 'description'])('settles connect while %s setup is pending', async (phase) => {
    const f = fixture({ phase });
    let outcome = null;
    const connected = f.transport.connect().then(
      () => { outcome = 'connected'; },
      (error) => { outcome = error; }
    );
    // Observe both public waiters; neither may wait for the browser setup call.
    const ready = f.transport.ready().catch((error) => error);
    await f.entered.promise;
    await f.transport.close('requester_connection_retry');
    await Promise.resolve();
    try {
      expect(outcome).toMatchObject({
        code: 'webrtc_connection_failed',
        diagnostics: expect.objectContaining({ state: 'closing' })
      });
      expect(await ready).toBe(outcome);
      expect(f.channel.close).toHaveBeenCalledTimes(1);
      expect(f.pc.close).toHaveBeenCalledTimes(1);
      expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    } finally {
      f.pending.resolve();
      await connected;
    }
    await Promise.resolve();
    expect(f.signaling.sendOffer).not.toHaveBeenCalled();
    expect(f.states).toEqual(['connecting', 'closing', 'closed']);
  });

  it('ignores a pending answer after remote close', async () => {
    const f = fixture({ phase: 'answer', initiator: false });
    const connected = f.transport.connect().catch((error) => error);
    f.signal({ type: SIGNAL_TYPES.OFFER, payload: { type: 'offer', sdp: 'offer' } });
    await f.entered.promise;
    f.signal({ type: SIGNAL_TYPES.CLOSE });
    expect(await connected).toMatchObject({ code: 'webrtc_connection_failed' });
    f.pending.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(f.signaling.sendAnswer).not.toHaveBeenCalled();
    expect(f.pc.close).toHaveBeenCalledTimes(1);
    expect(f.unsubscribe).toHaveBeenCalledTimes(1);
    expect(f.states).toEqual(['connecting', 'closed']);
  });

  it('does not reopen or dispatch queued events after close', async () => {
    const f = fixture({ initiator: false });
    const connecting = f.transport.connect();
    f.pc.ondatachannel({ channel: f.channel });
    const lateOpen = f.channel.onopen;
    const lateCandidate = f.pc.onicecandidate;
    f.channel.readyState = 'open';
    lateOpen();
    await connecting;
    await f.transport.close();
    lateOpen();
    lateCandidate({ candidate: { candidate: 'candidate:late' } });
    await f.transport.close();
    expect(f.signaling.sendIceCandidate).not.toHaveBeenCalled();
    expect(f.signaling.sendClose).toHaveBeenCalledTimes(1);
    expect(f.channel.close).toHaveBeenCalledTimes(1);
    expect(f.pc.close).toHaveBeenCalledTimes(1);
    expect(f.states).toEqual(['connecting', 'connected', 'closing', 'closed']);
    expect(f.transport.getState()).toBe('closed');
  });
});
