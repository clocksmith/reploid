import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPartitionDataChannel } from '../../packages/reploid/src/transport/partition-data-channel.js';
import { createBoundedChannelWriter } from '../../packages/reploid/src/transport/bounded-channel-writer.js';

const limits = { maxFrameBytes: 32, maxControlBytes: 1024, maxPayloadBytes: 128,
  maxPendingBytes: 256, maxPendingRequests: 4, maxRequestsPerChannel: 32,
  maxBufferedBytes: 2048, maxTransferBytes: 32768, timeoutMs: 1000 };
const cleanups = [];
afterEach(() => { for (const close of cleanups.splice(0)) close(); });
const gate = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function pair() {
  const channels = [new EventTarget(), new EventTarget()];
  for (const [index, channel] of channels.entries()) {
    Object.assign(channel, { ordered: true, maxRetransmits: null, maxPacketLifeTime: null,
      readyState: 'open', bufferedAmount: 0, frames: [],
      send(data) {
        this.frames.push(structuredClone(data));
        queueMicrotask(() => {
          if (channels[1 - index].readyState === 'open') {
            channels[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) }));
          }
        });
      },
      close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this.dispatchEvent(new Event('close'));
        queueMicrotask(() => channels[1 - index].close());
      } });
  }
  return channels;
}
function fixture(overrides = {}) {
  const [a, b] = pair();
  const authorize = vi.fn(async () => true);
  const serve = vi.fn(async (metadata, bytes) => ({ thread: metadata.thread, values: [...bytes] }));
  const base = { authorize, serve, limits };
  const client = createPartitionDataChannel({ ...base, channel: a, localParticipantId: 'a', remoteParticipantId: 'b', ...overrides.client });
  const server = createPartitionDataChannel({ ...base, channel: b, localParticipantId: 'b', remoteParticipantId: 'a', ...overrides.server });
  cleanups.push(() => { client.close(); server.close(); });
  return { a, b, client, server, authorize, serve };
}
const frames = channel => channel.frames.filter(frame => frame instanceof ArrayBuffer);

describe('partition binary transport (injected host ports)', () => {
  it('observes bounded request phases without letting an observer break delivery', async () => {
    const f = fixture();
    let measured;
    const result = await f.client.request({ thread: 'timed' }, new Uint8Array([1]), {
      onTiming(timing) { measured = timing; throw Error('observer failure'); }
    });
    expect(result.values).toEqual([1]);
    expect(Object.keys(measured)).toEqual(['authorizationMs', 'readyWaitMs', 'payloadUploadMs',
      'responseWaitMs', 'acceptanceMs', 'totalMs']);
    expect(Object.values(measured).every(value => Number.isFinite(value) && value >= 0)).toBe(true);
    const { totalMs, ...phases } = measured;
    expect(Object.values(phases).reduce((sum, value) => sum + value, 0)).toBeCloseTo(totalMs, 5);
  });
  it('fragments exact binary bytes, snapshots caller input, isolates concurrent replies and counts application bytes', async () => {
    const f = fixture();
    const bytes = Uint8Array.from({ length: 49 }, (_, index) => index);
    const metadata = { thread: 'one' };
    const one = f.client.request(metadata, bytes);
    const two = f.client.request({ thread: 'two' }, new Uint8Array([200]));
    bytes.fill(0); metadata.thread = 'mutated';
    expect(await one).toEqual({ thread: 'one', values: Array.from({ length: 49 }, (_, i) => i) });
    expect(await two).toEqual({ thread: 'two', values: [200] });
    expect(frames(f.a).map(frame => frame.byteLength).sort()).toEqual([13, 21, 32, 32]);
    await vi.waitFor(() => expect(f.client.getReceipt().reservedBytes).toBe(0));
    expect(f.client.getReceipt().sentFrameBytes).toBe(f.server.getReceipt().receivedFrameBytes);
    expect(f.client.getReceipt().receivedFrameBytes).toBe(f.server.getReceipt().sentFrameBytes);
    expect(f.client.getReceipt().completedRequests).toBe(2);
    expect(f.client.getReceipt().wireBytes).toBeNull();
    expect(f.authorize).toHaveBeenCalledWith(expect.objectContaining({ action: 'receive',
      localParticipantId: 'b', remoteParticipantId: 'a', byteLength: 49 }), expect.anything());
  });

  it('authorizes both endpoints before any activation bytes are sent', async () => {
    for (const side of ['client', 'server']) {
      const f = fixture({ [side]: { authorize: async () => false } });
      await expect(f.client.request({ thread: 'denied' }, new Uint8Array([1]))).rejects.toThrow(/authorization|declined/);
      expect(frames(f.a)).toEqual([]);
      expect(f.serve).not.toHaveBeenCalled();
      if (side === 'client') expect(f.a.frames).toEqual([]);
    }
  });

  it('does not confuse asynchronous authorization order with transport replay', async () => {
    const delayed = gate();
    const f = fixture({ client: { authorize: async ({ metadata }) => { if (metadata.thread === 'slow') await delayed.promise; return true; } } });
    const slow = f.client.request({ thread: 'slow' }, new Uint8Array([1]));
    expect(await f.client.request({ thread: 'fast' }, new Uint8Array([2]))).toEqual({ thread: 'fast', values: [2] });
    delayed.resolve();
    expect(await slow).toEqual({ thread: 'slow', values: [1] });
  });

  it('rechecks result disclosure after permission is revoked during work', async () => {
    let permitted = true;
    const f = fixture({ server: {
      authorize: async () => permitted,
      serve: async () => { permitted = false; return { token: 42 }; },
    } });
    await expect(f.client.request({}, new Uint8Array([1]))).rejects.toThrow('declined');
    expect(f.b.frames.filter(frame => typeof frame === 'string').map(frame => JSON.parse(frame).type)).not.toContain('result');
  });

  it('cancels one delivery, retains uncooperative work against budgets, and keeps another thread live', async () => {
    const entered = gate(), release = gate();
    let workSignal;
    const f = fixture({ server: { serve: async (metadata, bytes, { signal }) => {
      if (metadata.thread === 'one') { workSignal = signal; entered.resolve(); await release.promise; }
      return { thread: metadata.thread };
    } } });
    const controller = new AbortController();
    const pending = f.client.request({ thread: 'one' }, new Uint8Array([1]), { signal: controller.signal });
    const rejected = expect(pending).rejects.toThrow('cancelled');
    await entered.promise;
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(workSignal.aborted).toBe(true));
    expect(f.server.getReceipt().reservedBytes).toBe(1);
    expect(await f.client.request({ thread: 'two' }, new Uint8Array([2]))).toEqual({ thread: 'two' });
    release.resolve();
    await vi.waitFor(() => expect(f.server.getReceipt().reservedBytes).toBe(0));
    expect(f.b.frames.filter(frame => typeof frame === 'string' && JSON.parse(frame).type === 'result')).toHaveLength(1);
  });

  it('cancels before authorization finishes without sending a stray cancel or releasing its occupied slot', async () => {
    const release = gate();
    const f = fixture({ client: { authorize: async () => { await release.promise; return true; },
      limits: { ...limits, maxPendingRequests: 1 } } });
    const controller = new AbortController();
    const pending = f.client.request({}, new Uint8Array([1]), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toThrow('cancelled');
    expect(() => f.client.request({}, new Uint8Array())).toThrow('pending request');
    expect(f.a.frames).toEqual([]);
    release.resolve();
    await vi.waitFor(() => expect(f.client.getReceipt().reservedBytes).toBe(0));
    expect(f.a.frames).toEqual([]);
  });

  it('waits under backpressure and serializes concurrent writes within the buffer limit', async () => {
    const f = fixture();
    f.a.bufferedAmount = limits.maxBufferedBytes;
    const pending = f.client.request({ thread: 'buffered' }, new Uint8Array([3]));
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(f.a.frames).toEqual([]);
    f.a.bufferedAmount = 0;
    f.a.dispatchEvent(new Event('bufferedamountlow'));
    expect(await pending).toEqual({ thread: 'buffered', values: [3] });
  });

  it('settles waiting callers on peer loss and timeout', async () => {
    for (const loss of [true, false]) {
      const release = gate();
      const f = fixture({ server: { authorize: async () => { await release.promise; return true; } },
        client: { limits: { ...limits, timeoutMs: 30 } } });
      const pending = f.client.request({}, new Uint8Array([1]));
      if (loss) f.b.close();
      await expect(pending).rejects.toThrow(loss ? /disconnected/ : /timed out/);
      release.resolve();
    }
  });

  it('closes on corrupted binary geometry before invoking execution', async () => {
    const f = fixture();
    const original = f.a.send;
    f.a.send = function(data) {
      if (data instanceof ArrayBuffer) new DataView(data).setUint32(4, 999);
      original.call(this, data);
    };
    await expect(f.client.request({}, new Uint8Array([1]))).rejects.toThrow('disconnected');
    expect(f.server.getReceipt().closed).toBe(true);
    expect(f.serve).not.toHaveBeenCalled();
  });

  it('bounds payload, metadata, pending memory and connection request identities', async () => {
    const f = fixture({ client: { limits: { ...limits, maxRequestsPerChannel: 1 } } });
    expect(() => f.client.request({}, new Uint8Array(129))).toThrow('geometry');
    expect(() => f.client.request({ text: 'x'.repeat(1024) }, new Uint8Array())).toThrow('control frame');
    expect(await f.client.request({ thread: 'empty-control' }, new Uint8Array())).toEqual({ thread: 'empty-control', values: [] });
    expect(() => f.client.request({}, new Uint8Array())).toThrow('identity budget');
    const held = gate();
    const g = fixture({ client: { limits: { ...limits, maxPendingBytes: 128 }, authorize: async () => { await held.promise; return true; } } });
    const pending = g.client.request({}, new Uint8Array(128));
    expect(() => g.client.request({}, new Uint8Array(1))).toThrow('pending byte');
    held.resolve(); await pending;
  });

  it('requires reliable transport, identified endpoints, authorization and explicit budgets', () => {
    const [channel] = pair();
    const options = { channel, localParticipantId: 'a', remoteParticipantId: 'b', authorize: () => true, serve: () => ({}), limits };
    expect(() => createPartitionDataChannel({ ...options, authorize: null })).toThrow('ports required');
    expect(() => createPartitionDataChannel({ ...options, limits: {} })).toThrow('explicit');
    expect(() => createPartitionDataChannel({ ...options, remoteParticipantId: 'a' })).toThrow('identities');
    channel.ordered = false;
    expect(() => createPartitionDataChannel(options)).toThrow('reliable');
  });

  it('serializes two waiters when only one frame fits after the buffer drains', async () => {
    const [channel] = pair();
    const controller = new AbortController();
    channel.bufferedAmount = 32;
    const sent = [];
    channel.send = data => { channel.bufferedAmount += data.byteLength; sent.push(data.byteLength); };
    const write = createBoundedChannelWriter({ channel, limits: { ...limits, maxBufferedBytes: 32 },
      signal: controller.signal, account: () => {} });
    const first = write(new ArrayBuffer(24)), second = write(new ArrayBuffer(24));
    await Promise.resolve();
    channel.bufferedAmount = 0;
    channel.dispatchEvent(new Event('bufferedamountlow'));
    await first;
    expect(sent).toEqual([24]);
    expect(channel.bufferedAmount).toBe(24);
    channel.bufferedAmount = 0;
    channel.dispatchEvent(new Event('bufferedamountlow'));
    await second;
    expect(sent).toEqual([24, 24]);
  });

  it('rejects replayed wire headers and oversized declared allocations before execution', async () => {
    for (const replay of [true, false]) {
      const f = fixture();
      if (replay) {
        await f.client.request({}, new Uint8Array([1]));
        f.a.send(f.a.frames[0]);
      } else {
        f.a.send(JSON.stringify({ schema: 'reploid.partition-channel/v1', type: 'request',
          id: 1, metadata: {}, size: 0xffffffff }));
      }
      await vi.waitFor(() => expect(f.server.getReceipt().closed).toBe(true));
      expect(f.serve).toHaveBeenCalledTimes(replay ? 1 : 0);
      expect(f.server.getReceipt().reservedBytes).toBe(0);
    }
  });

  it('enforces lifetime application-byte budgets and does not leak host exceptions', async () => {
    const f = fixture({ client: { limits: { ...limits, maxTransferBytes: 1 } } });
    await expect(f.client.request({}, new Uint8Array([1]))).rejects.toThrow('outgoing byte budget');
    expect(f.a.frames).toEqual([]);
    const g = fixture({ server: { limits: { ...limits, maxTransferBytes: 1 } } });
    await expect(g.client.request({}, new Uint8Array([1]))).rejects.toThrow('disconnected');
    expect(g.serve).not.toHaveBeenCalled();
    const h = fixture({ server: { serve: async () => { throw new Error('private host details'); } } });
    await expect(h.client.request({}, new Uint8Array([1]))).rejects.toThrow('declined or failed');
    expect(h.b.frames.filter(frame => typeof frame === 'string').join('')).not.toContain('private host');
  });
});
