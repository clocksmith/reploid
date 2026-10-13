// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeNativeDataChannel } from '../../server/native-participant.js';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';

// Installed wrtc shape: bufferedAmount exists, low-water threshold/events do not.
class NativeEvents {
  // wrtc lib/eventtarget.js uses nextTick and ignores the once option.
  listeners = new Map();
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatchEvent(event) {
    process.nextTick(() => {
      for (const listener of new Set(this.listeners.get(event.type))) {
        if (typeof listener === 'function') listener.call(this, event); else listener.handleEvent(event);
      }
    });
  }
}
function channels(Events = EventTarget) {
  const result = [new Events(), new Events()];
  for (const [index, channel] of result.entries()) Object.assign(channel, {
    ordered: true, maxRetransmits: 65535, maxPacketLifeTime: 65535,
    readyState: 'open', bufferedAmount: 0, frames: [],
    send(data) {
      this.frames.push(data);
      Promise.resolve().then(() => result[1 - index].dispatchEvent(new MessageEvent('message', { data })));
    },
    close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
  });
  for (const channel of result) Object.defineProperty(channel, 'close', { value: channel.close, writable: false, configurable: false });
  return result.map(normalizeNativeDataChannel);
}
const limits = { maxFrameBytes: 128, maxControlBytes: 1024, maxChunkBytes: 1024,
  maxBufferedBytes: 1024, maxPendingRequests: 2, maxTransferBytes: 16384, timeoutMs: 100 };
afterEach(() => vi.useRealTimers());

describe('native custody backpressure', () => {
  it.each([EventTarget, NativeEvents])('resumes framing after native drain without an event (%s)', async Events => {
    vi.useFakeTimers();
    const [requester, supplier] = channels(Events);
    const client = createPeerPackDataChannel({ channel: requester, limits });
    const bytes = new Uint8Array(400).fill(17);
    const server = createPeerPackDataChannel({ channel: supplier, limits, serve: async () => ({ bytes, message: {} }) });
    supplier.bufferedAmount = 1024;
    const pending = client.requestChunk({ sizeBytes: 400 }, { maxBytes: 400 }).then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(20);
    expect(supplier.frames).toHaveLength(0);
    supplier.bufferedAmount = 0; // The provider emits no low-water event.
    await vi.advanceTimersByTimeAsync(100);
    const result = await pending;
    expect(result.error).toBeUndefined();
    expect(result.value.bytes).toEqual(bytes);
    expect(client.getReceipt().pendingRequests).toBe(0);
    client.close(); server.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['timeout', 'abort', 'close'])('stops polling after %s and never sends over the budget', async mode => {
    vi.useFakeTimers();
    const [requester, supplier] = channels();
    const client = createPeerPackDataChannel({ channel: requester, limits });
    const server = createPeerPackDataChannel({ channel: supplier, limits, serve: async () => ({ bytes: new Uint8Array(400), message: {} }) });
    const controller = new AbortController();
    supplier.bufferedAmount = 1024;
    const pending = client.requestChunk({ sizeBytes: 400 }, { maxBytes: 400, signal: controller.signal })
      .then(value => ({ value }), error => ({ error }));
    await vi.advanceTimersByTimeAsync(20);
    if (mode === 'abort') controller.abort();
    if (mode === 'close') { client.close(); server.close(); }
    await vi.advanceTimersByTimeAsync(150);
    expect((await pending).error).toBeInstanceOf(Error);
    expect(supplier.frames).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    client.close(); server.close();
  });

  it('owns only active drain polls and honors once, removal, abort, and close', async () => {
    vi.useFakeTimers();
    const [channel, peer] = channels();
    channel.bufferedAmount = 1024;
    expect(vi.getTimerCount()).toBe(0);
    const listener = vi.fn();
    const add = channel.addEventListener;
    normalizeNativeDataChannel(channel);
    expect(channel.addEventListener).toBe(add);
    channel.addEventListener('bufferedamountlow', listener, { once: true });
    channel.addEventListener('bufferedamountlow', listener, { once: true });
    expect(vi.getTimerCount()).toBe(1);
    channel.bufferedAmountLowThreshold = 128;
    channel.bufferedAmount = 129;
    await vi.advanceTimersByTimeAsync(16);
    expect(listener).not.toHaveBeenCalled();
    channel.bufferedAmount = 128;
    await vi.advanceTimersByTimeAsync(16);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    for (const mode of ['remove', 'abort', 'close']) {
      channel.bufferedAmount = 1024;
      const controller = new AbortController();
      channel.addEventListener('bufferedamountlow', listener, { signal: controller.signal });
      expect(vi.getTimerCount()).toBe(1);
      if (mode === 'remove') channel.removeEventListener('bufferedamountlow', listener);
      if (mode === 'abort') controller.abort();
      if (mode === 'close') channel.close();
      expect(vi.getTimerCount()).toBe(0);
      channel.bufferedAmount = 0;
      await vi.advanceTimersByTimeAsync(32);
      expect(listener).toHaveBeenCalledTimes(1);
    }
    peer.close();
  });

  it('leaves an existing standard low-water event implementation unchanged', () => {
    const channel = new EventTarget();
    Object.assign(channel, { bufferedAmountLowThreshold: 0, maxRetransmits: null, maxPacketLifeTime: null, send() {} });
    const add = channel.addEventListener, remove = channel.removeEventListener, send = channel.send;
    normalizeNativeDataChannel(channel);
    expect(channel.addEventListener).toBe(add); expect(channel.removeEventListener).toBe(remove); expect(channel.send).toBe(send);
  });
});
