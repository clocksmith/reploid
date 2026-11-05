/** Bounded framing for a dedicated, reliable, ordered Pack-custody data channel.
 * Signatures and authorized chunk commitments remain owned by peer-pack-custody.
 * Counts describe application frames, not SCTP/IP bytes or relay charges.
 */
const SCHEMA = 'reploid.pool.pack-custody-channel/v1';
const HEADER_BYTES = 24;
const ID = /^[0-9a-f]{32}$/;
const positive = (value) => Number.isSafeInteger(value) && value > 0;
const assert = (condition, message) => { if (!condition) throw new Error(`Pack channel: ${message}`); };

export function createPeerPackDataChannel({ channel, limits, serve = null }) {
  assert(channel?.ordered === true && channel.maxRetransmits == null && channel.maxPacketLifeTime == null,
    'a reliable ordered dedicated data channel is required');
  assert(typeof channel.send === 'function' && typeof channel.addEventListener === 'function', 'data channel port required');
  for (const name of ['maxFrameBytes', 'maxControlBytes', 'maxChunkBytes', 'maxBufferedBytes', 'maxPendingRequests', 'maxTransferBytes', 'timeoutMs']) {
    assert(positive(limits?.[name]), `explicit ${name} required`);
  }
  assert(limits.maxFrameBytes > HEADER_BYTES && limits.maxFrameBytes <= limits.maxBufferedBytes
    && limits.maxControlBytes <= limits.maxBufferedBytes && limits.maxChunkBytes <= 0xffffffff
    && limits.timeoutMs <= 2147483647, 'invalid framing limits');
  const policy = structuredClone(limits);
  const fragmentBytes = policy.maxFrameBytes - HEADER_BYTES;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 0;
  const pending = new Map();
  const inbound = new Map();
  const lifecycle = new AbortController();
  const counters = { sentFrameBytes: 0, receivedFrameBytes: 0, sentFrames: 0, receivedFrames: 0,
    completedRequests: 0, cancelledRequests: 0, interruptedPayloadBytes: 0, discardedFrames: 0 };
  let closed = false;

  function finish(id, error, response) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (error) {
      counters.interruptedPayloadBytes += entry.receivedBytes;
      entry.reject(error);
    } else {
      counters.completedRequests += 1;
      entry.resolve(response);
    }
  }

  function close(reason = 'channel closed') {
    if (closed) return;
    closed = true;
    lifecycle.abort();
    for (const controller of inbound.values()) controller.abort();
    inbound.clear();
    for (const id of pending.keys()) finish(id, new Error(`Pack channel: ${reason}`));
    channel.removeEventListener('message', onMessage);
    channel.removeEventListener('close', onClose);
    channel.removeEventListener('error', onClose);
    channel.close();
  }

  async function send(data, signal = lifecycle.signal) {
    const byteLength = typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength;
    assert(!closed && channel.readyState === 'open' && !signal.aborted, 'channel unavailable');
    assert(counters.sentFrameBytes + byteLength <= policy.maxTransferBytes, 'outgoing byte budget exhausted');
    if (channel.bufferedAmount + byteLength > policy.maxBufferedBytes) {
      await new Promise((resolve, reject) => {
        const finish = (error) => {
          clearTimeout(timer);
          channel.removeEventListener('bufferedamountlow', low);
          signal.removeEventListener('abort', abort);
          lifecycle.signal.removeEventListener('abort', abort);
          error ? reject(error) : resolve();
        };
        const low = () => finish();
        const abort = () => finish(new Error('Pack channel: send cancelled'));
        const timer = setTimeout(() => finish(new Error('Pack channel: backpressure timeout')), policy.timeoutMs);
        channel.addEventListener('bufferedamountlow', low, { once: true });
        signal.addEventListener('abort', abort, { once: true });
        lifecycle.signal.addEventListener('abort', abort, { once: true });
        if (closed || signal.aborted) abort();
        else if (channel.bufferedAmount + byteLength <= policy.maxBufferedBytes) low();
      });
    }
    assert(!closed && !signal.aborted && channel.readyState === 'open', 'channel unavailable');
    assert(channel.bufferedAmount + byteLength <= policy.maxBufferedBytes, 'send buffer limit exceeded');
    assert(counters.sentFrameBytes + byteLength <= policy.maxTransferBytes, 'outgoing byte budget exhausted');
    channel.send(data);
    counters.sentFrameBytes += byteLength;
    counters.sentFrames += 1;
  }

  function control(value, signal) {
    const text = JSON.stringify({ schema: SCHEMA, ...value });
    assert(new TextEncoder().encode(text).byteLength <= policy.maxControlBytes, 'control frame too large');
    return send(text, signal);
  }

  async function supply(frame) {
    assert(typeof serve === 'function', 'serving is not enabled');
    assert(!inbound.has(frame.id) && inbound.size < policy.maxPendingRequests, 'incoming request limit or duplicate');
    assert(positive(frame.request?.sizeBytes) && frame.request.sizeBytes <= policy.maxChunkBytes, 'incoming chunk limit');
    const controller = new AbortController();
    inbound.set(frame.id, controller);
    const timer = setTimeout(() => controller.abort(), policy.timeoutMs);
    try {
      const response = await serve(structuredClone(frame.request), { signal: controller.signal });
      if (controller.signal.aborted || closed) return;
      assert(response?.bytes instanceof Uint8Array && response.bytes.length === frame.request.sizeBytes, 'supplier response geometry');
      await control({ type: 'response', id: frame.id, message: response.message, byteLength: response.bytes.length }, controller.signal);
      for (let offset = 0; offset < response.bytes.length; offset += fragmentBytes) {
        const part = response.bytes.subarray(offset, offset + fragmentBytes);
        const bytes = new Uint8Array(HEADER_BYTES + part.length);
        for (let index = 0; index < 16; index += 1) bytes[index] = parseInt(frame.id.slice(index * 2, index * 2 + 2), 16);
        const view = new DataView(bytes.buffer);
        view.setUint32(16, offset);
        view.setUint32(20, part.length);
        bytes.set(part, HEADER_BYTES);
        await send(bytes.buffer, controller.signal);
      }
    } catch (error) {
      if (!closed && !controller.signal.aborted) {
        await control({ type: 'error', id: frame.id, error: String(error.message).slice(0, 256) }, controller.signal).catch(() => close('error delivery failed'));
      }
    } finally {
      clearTimeout(timer);
      inbound.delete(frame.id);
    }
  }

  function receiveControl(text) {
    const frame = JSON.parse(text);
    assert(frame?.schema === SCHEMA && ID.test(frame.id), 'invalid control frame');
    if (frame.type === 'request') {
      supply(frame).catch((error) => close(error.message));
      return;
    }
    if (frame.type === 'cancel') {
      inbound.get(frame.id)?.abort();
      return;
    }
    const entry = pending.get(frame.id);
    if (!entry) { counters.discardedFrames += 1; return; }
    if (frame.type === 'error') {
      finish(frame.id, new Error(`Pack channel supplier: ${String(frame.error).slice(0, 256)}`));
      return;
    }
    assert(frame.type === 'response' && !entry.bytes && frame.byteLength === entry.maxBytes, 'response binding or geometry');
    assert(frame.message && typeof frame.message === 'object', 'signed response required');
    entry.message = frame.message;
    entry.bytes = new Uint8Array(frame.byteLength);
  }

  function receiveBinary(buffer) {
    assert(buffer.byteLength > HEADER_BYTES, 'empty binary frame');
    const bytes = new Uint8Array(buffer);
    const id = Array.from(bytes.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const entry = pending.get(id);
    if (!entry) { counters.discardedFrames += 1; return; }
    assert(entry.bytes, 'binary frame before response');
    const view = new DataView(buffer);
    const offset = view.getUint32(16);
    const length = view.getUint32(20);
    assert(offset % fragmentBytes === 0 && offset < entry.maxBytes
      && length === Math.min(fragmentBytes, entry.maxBytes - offset) && length === bytes.length - HEADER_BYTES, 'binary frame range');
    if (entry.offsets.has(offset)) {
      assert(bytes.subarray(HEADER_BYTES).every((byte, index) => entry.bytes[offset + index] === byte), 'conflicting duplicate fragment');
      counters.discardedFrames += 1;
      return;
    }
    entry.bytes.set(bytes.subarray(HEADER_BYTES), offset);
    entry.offsets.add(offset);
    entry.receivedBytes += length;
    if (entry.receivedBytes === entry.maxBytes) finish(id, null, { message: entry.message, bytes: entry.bytes });
  }

  function onMessage(event) {
    try {
      const data = event.data;
      const text = typeof data === 'string';
      assert(text || data instanceof ArrayBuffer, 'unsupported frame type');
      const size = text ? new TextEncoder().encode(data).byteLength : data.byteLength;
      counters.receivedFrameBytes += size;
      counters.receivedFrames += 1;
      assert(size <= (text ? policy.maxControlBytes : policy.maxFrameBytes), 'frame limit exceeded');
      assert(counters.receivedFrameBytes <= policy.maxTransferBytes, 'incoming byte budget exhausted');
      text ? receiveControl(data) : receiveBinary(data);
    } catch (error) { close(error.message); }
  }

  function onClose() { close('transport disconnected'); }
  channel.addEventListener('message', onMessage);
  channel.addEventListener('close', onClose);
  channel.addEventListener('error', onClose);

  return {
    requestChunk(request, { signal, maxBytes }) {
      assert(!closed && channel.readyState === 'open', 'channel unavailable');
      assert(positive(maxBytes) && maxBytes === request?.sizeBytes && maxBytes <= policy.maxChunkBytes, 'requested chunk limit');
      assert(pending.size < policy.maxPendingRequests && !signal?.aborted, 'request cancelled or pending limit exceeded');
      const id = crypto.randomUUID().replaceAll('-', '');
      return new Promise((resolve, reject) => {
        const abort = () => {
          counters.cancelledRequests += 1;
          finish(id, new Error('Pack channel: request cancelled or timed out'));
          control({ type: 'cancel', id }).catch(() => close('cancellation delivery failed'));
        };
        const entry = { resolve, reject, signal, abort, maxBytes, receivedBytes: 0, bytes: null, offsets: new Set(),
          timer: setTimeout(abort, policy.timeoutMs) };
        pending.set(id, entry);
        signal?.addEventListener('abort', abort, { once: true });
        control({ type: 'request', id, request }).catch((error) => finish(id, error));
      });
    },
    close,
    getReceipt() { return { schema: SCHEMA, ...counters, pendingRequests: pending.size, inboundRequests: inbound.size,
      closed, wireBytes: null, relayBytes: null }; },
  };
}
