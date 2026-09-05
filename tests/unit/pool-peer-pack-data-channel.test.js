import { describe, expect, it } from 'vitest';
import { createPeerPackDataChannel } from '../../self/pool/peer-pack-data-channel.js';

const limits = { maxFrameBytes: 32, maxControlBytes: 2048, maxChunkBytes: 1024,
  maxBufferedBytes: 4096, maxPendingRequests: 2, maxTransferBytes: 16384, timeoutMs: 1000 };

// Framing contract only. Physical data channels are exercised by the browser proof.
function pair() {
  const channels = [new EventTarget(), new EventTarget()];
  for (const [index, channel] of channels.entries()) {
    Object.assign(channel, { ordered: true, maxRetransmits: null, maxPacketLifeTime: null,
      readyState: 'open', bufferedAmount: 0, frames: [],
      send(data) {
        if (this.readyState !== 'open') throw new Error('closed');
        this.frames.push(structuredClone(data));
        queueMicrotask(() => channels[1 - index].dispatchEvent(new MessageEvent('message', { data: structuredClone(data) })));
      },
      close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this.dispatchEvent(new Event('close'));
      } });
  }
  return channels;
}

describe('bounded Pack custody data-channel framing', () => {
  it('returns complete bounded bytes and accounts for application framing', async () => {
    const [requester, supplier] = pair();
    const bytes = Uint8Array.from({ length: 19 }, (_, index) => index);
    const client = createPeerPackDataChannel({ channel: requester, limits });
    const server = createPeerPackDataChannel({ channel: supplier, limits,
      serve: async (request) => ({ message: { requestId: request.id }, bytes }) });
    try {
      const result = await client.requestChunk({ id: 'unit', sizeBytes: bytes.length }, { maxBytes: bytes.length });
      expect(result).toEqual({ message: { requestId: 'unit' }, bytes });
      expect(supplier.frames.filter((frame) => frame instanceof ArrayBuffer).map((frame) => frame.byteLength)).toEqual([32, 32, 27]);
      expect(client.getReceipt().completedRequests).toBe(1);
      expect(client.getReceipt().receivedFrameBytes).toBe(server.getReceipt().sentFrameBytes);
      expect(client.getReceipt().wireBytes).toBeNull();
      expect(client.getReceipt().pendingRequests).toBe(0);
    } finally { client.close(); server.close(); }
  });

  it('reassembles out-of-order and duplicate fragments without counting duplicate payload', async () => {
    const [requester, supplier] = pair();
    const bytes = Uint8Array.from({ length: 19 }, (_, index) => index);
    const delayed = [];
    const originalSend = supplier.send;
    supplier.send = function(data) {
      if (typeof data === 'string') return originalSend.call(this, data);
      delayed.push(data);
      if (delayed.length === 3) {
        for (const frame of [delayed[1], delayed[1], delayed[2], delayed[0]]) originalSend.call(this, frame);
      }
    };
    const client = createPeerPackDataChannel({ channel: requester, limits });
    const server = createPeerPackDataChannel({ channel: supplier, limits, serve: async () => ({ message: {}, bytes }) });
    try {
      expect((await client.requestChunk({ sizeBytes: 19 }, { maxBytes: 19 })).bytes).toEqual(bytes);
      expect(client.getReceipt().discardedFrames).toBe(1);
      expect(client.getReceipt().completedRequests).toBe(1);
    } finally { client.close(); server.close(); }
  });

  it('rejects geometry changes before allocating a supplier-declared response', async () => {
    const [requester, supplier] = pair();
    const client = createPeerPackDataChannel({ channel: requester, limits });
    supplier.addEventListener('message', ({ data }) => {
      const request = JSON.parse(data);
      supplier.send(JSON.stringify({ schema: request.schema, type: 'response', id: request.id,
        message: {}, byteLength: 1000000 }));
    });
    await expect(client.requestChunk({ sizeBytes: 19 }, { maxBytes: 19 })).rejects.toThrow(/geometry/);
    expect(client.getReceipt().closed).toBe(true);
    expect(client.getReceipt().pendingRequests).toBe(0);
    supplier.close();
  });

  it('rejects oversized frames and rejects pending work when the supplier disappears', async () => {
    for (const oversized of [true, false]) {
      const [requester, supplier] = pair();
      const client = createPeerPackDataChannel({ channel: requester, limits });
      const result = client.requestChunk({ sizeBytes: 19 }, { maxBytes: 19 });
      if (oversized) requester.dispatchEvent(new MessageEvent('message', { data: new ArrayBuffer(33) }));
      else requester.dispatchEvent(new Event('close'));
      await expect(result).rejects.toThrow(oversized ? /frame limit/ : /disconnected/);
      expect(client.getReceipt().pendingRequests).toBe(0);
      supplier.close();
    }
  });

  it('cancels unfinished requests and charges received partial payload', async () => {
    const [requester, supplier] = pair();
    const originalSend = supplier.send;
    let partial;
    const partialArrived = new Promise((resolve) => { partial = resolve; });
    supplier.send = function(data) {
      if (typeof data === 'string' || new DataView(data).getUint32(16) === 0) {
        originalSend.call(this, data);
        if (typeof data !== 'string') queueMicrotask(partial);
      }
    };
    const client = createPeerPackDataChannel({ channel: requester, limits });
    const server = createPeerPackDataChannel({ channel: supplier, limits, serve: async () => ({ message: {}, bytes: new Uint8Array(19) }) });
    const controller = new AbortController();
    const result = client.requestChunk({ sizeBytes: 19 }, { maxBytes: 19, signal: controller.signal });
    await partialArrived;
    controller.abort();
    await expect(result).rejects.toThrow(/cancelled/);
    expect(client.getReceipt().interruptedPayloadBytes).toBe(8);
    expect(client.getReceipt().cancelledRequests).toBe(1);
    client.close(); server.close();
  });

  it('requires explicit resource limits and bounds requests before sending', () => {
    const [channel, supplier] = pair();
    expect(() => createPeerPackDataChannel({ channel, limits: {} })).toThrow(/explicit/);
    expect(() => createPeerPackDataChannel({ channel: { ...channel, ordered: false }, limits })).toThrow(/reliable ordered/);
    const client = createPeerPackDataChannel({ channel, limits });
    expect(() => client.requestChunk({ sizeBytes: 1025 }, { maxBytes: 1025 })).toThrow(/chunk limit/);
    expect(() => client.requestChunk({ sizeBytes: 5 }, { maxBytes: 4 })).toThrow(/chunk limit/);
    expect(() => client.requestChunk({ sizeBytes: 5 }, { maxBytes: 5, signal: AbortSignal.abort() })).toThrow(/cancelled/);
    client.close(); supplier.close();
  });
});
