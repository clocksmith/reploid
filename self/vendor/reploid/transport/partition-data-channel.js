import { createBoundedChannelWriter } from './bounded-channel-writer.js';

const SCHEMA = 'reploid.partition-channel/v1';
const HEADER_BYTES = 12;
const encoder = new TextEncoder();
const positive = value => Number.isSafeInteger(value) && value > 0;
const assert = (condition, message) => { if (!condition) throw new Error(`Partition channel: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Binary activation requests and bounded JSON replies on an owned, dedicated RTC channel.
 * Host ports bind grants to authenticated peers. Receipt/abort is not GPU settlement.
 */
export function createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId, authorize, serve, limits }) {
  assert(channel?.ordered === true && channel.maxRetransmits == null && channel.maxPacketLifeTime == null,
    'reliable ordered channel required');
  assert(typeof authorize === 'function' && typeof serve === 'function', 'authorization and serving ports required');
  assert([localParticipantId, remoteParticipantId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)
    && localParticipantId !== remoteParticipantId, 'distinct authenticated peer identities required');
  for (const key of ['maxFrameBytes', 'maxControlBytes', 'maxPayloadBytes', 'maxPendingBytes',
    'maxPendingRequests', 'maxRequestsPerChannel', 'maxBufferedBytes', 'maxTransferBytes', 'timeoutMs']) {
    assert(positive(limits?.[key]), `explicit ${key} required`);
  }
  const policy = Object.freeze(structuredClone(limits));
  assert(policy.maxFrameBytes > HEADER_BYTES && policy.maxFrameBytes <= policy.maxBufferedBytes
    && policy.maxControlBytes <= policy.maxBufferedBytes && policy.maxPayloadBytes <= 0xffffffff
    && policy.maxPayloadBytes <= policy.maxPendingBytes && policy.maxRequestsPerChannel <= 0xffffffff
    && policy.timeoutMs <= 2147483647, 'invalid limits');
  const fragmentBytes = policy.maxFrameBytes - HEADER_BYTES;
  const outgoing = new Map();
  const incoming = new Map();
  const receivedIds = new Set();
  const lifecycle = new AbortController();
  const counters = { sentFrameBytes: 0, receivedFrameBytes: 0, sentFrames: 0, receivedFrames: 0,
    completedRequests: 0, cancelledRequests: 0, discardedFrames: 0 };
  let nextId = 0;
  let reservedBytes = 0;
  let closed = false;
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = 0;
  const send = createBoundedChannelWriter({ channel, limits: policy, signal: lifecycle.signal,
    account: size => { counters.sentFrameBytes += size; counters.sentFrames++; } });

  function encodeControl(frame) {
    const text = JSON.stringify({ schema: SCHEMA, ...frame });
    assert(encoder.encode(text).byteLength <= policy.maxControlBytes, 'control frame too large');
    return text;
  }
  const control = (frame, signal) => send(encodeControl(frame), signal);
  function reserve(size) {
    assert(outgoing.size + incoming.size < policy.maxPendingRequests, 'pending request limit');
    assert(reservedBytes + size <= policy.maxPendingBytes, 'pending byte limit');
    reservedBytes += size;
  }
  async function permit(action, entry) {
    entry.controller.signal.throwIfAborted();
    const allowed = await authorize({ action, localParticipantId, remoteParticipantId,
      metadata: structuredClone(entry.metadata), byteLength: entry.size }, { signal: entry.controller.signal });
    entry.controller.signal.throwIfAborted();
    assert(allowed === true, 'authorization declined');
  }
  function release(map, id, entry) {
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (map.delete(id)) reservedBytes -= entry.size;
  }
  function cancelIncoming(entry) {
    clearTimeout(entry.timer);
    entry.controller.abort(new Error('Partition request cancelled or timed out'));
    // A host callback may ignore abort. Keep its slot charged until it settles.
    if (!entry.busy) release(incoming, entry.id, entry);
  }
  function finish(entry, error, value) {
    if (entry.finished) return;
    entry.finished = true;
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (!error && entry.onTiming) {
      const completedAt = performance.now();
      // Response waiting includes remote authorization and computation.
      try { entry.onTiming({ authorizationMs: entry.authorizedAt - entry.startedAt,
        readyWaitMs: entry.uploadStartedAt - entry.authorizedAt,
        payloadUploadMs: entry.uploadFinishedAt - entry.uploadStartedAt,
        responseWaitMs: Math.max(0, entry.resultAt - entry.uploadFinishedAt),
        acceptanceMs: completedAt - Math.max(entry.resultAt, entry.uploadFinishedAt),
        totalMs: completedAt - entry.startedAt }); } catch {}
    }
    error ? entry.reject(error) : entry.resolve(value);
    entry.controller.abort(error ?? new Error('Partition request complete'));
    if (!entry.busy) release(outgoing, entry.id, entry);
  }
  function close(reason = 'channel closed') {
    if (closed) return;
    closed = true;
    const error = new Error(`Partition channel: ${reason}`);
    lifecycle.abort(error);
    for (const entry of outgoing.values()) finish(entry, error);
    for (const entry of incoming.values()) cancelIncoming(entry);
    channel.removeEventListener('message', onMessage);
    channel.removeEventListener('close', onClose);
    channel.removeEventListener('error', onClose);
    channel.close();
  }
  const failDelivery = () => close('control delivery failed');

  async function accept(frame) {
    assert(!receivedIds.has(frame.id), 'duplicate request');
    assert(frame.id <= policy.maxRequestsPerChannel && receivedIds.size < policy.maxRequestsPerChannel, 'request identity budget exhausted');
    receivedIds.add(frame.id);
    assert(object(frame.metadata) && Number.isSafeInteger(frame.size) && frame.size >= 0
      && frame.size <= policy.maxPayloadBytes, 'request geometry');
    reserve(frame.size);
    const entry = { id: frame.id, metadata: frame.metadata, size: frame.size, offset: 0,
      controller: new AbortController(), busy: true, bytes: null };
    incoming.set(frame.id, entry);
    entry.timer = setTimeout(() => {
      cancelIncoming(entry);
      if (!closed) control({ type: 'error', id: entry.id }).catch(failDelivery);
    }, policy.timeoutMs);
    try {
      await permit('receive', entry);
      entry.bytes = new Uint8Array(entry.size);
      // Mark ready before sending: a local test port may deliver synchronously.
      entry.ready = true;
      await control({ type: 'ready', id: entry.id }, entry.controller.signal);
    } catch {
      cancelIncoming(entry);
      if (!closed) await control({ type: 'error', id: entry.id }).catch(failDelivery);
    } finally {
      entry.busy = false;
      if (entry.controller.signal.aborted) release(incoming, entry.id, entry);
      else if (entry.offset === entry.size) execute(entry);
    }
  }

  async function execute(entry) {
    if (entry.busy || entry.executing) return;
    entry.busy = true;
    entry.executing = true;
    try {
      // Permission may change during a fragmented upload.
      await permit('receive', entry);
      const result = await serve(structuredClone(entry.metadata), entry.bytes, { signal: entry.controller.signal });
      await permit('respond', entry);
      assert(object(result), 'JSON result object required');
      await control({ type: 'result', id: entry.id, result }, entry.controller.signal);
    } catch {
      if (!closed && !entry.controller.signal.aborted) await control({ type: 'error', id: entry.id }).catch(failDelivery);
    } finally {
      entry.busy = false;
      release(incoming, entry.id, entry);
    }
  }

  async function upload(entry) {
    entry.busy = true;
    entry.uploadStartedAt = performance.now();
    try {
      await permit('send', entry);
      for (let offset = 0; offset < entry.size; offset += fragmentBytes) {
        const part = entry.bytes.subarray(offset, offset + fragmentBytes);
        const frame = new Uint8Array(HEADER_BYTES + part.length);
        const view = new DataView(frame.buffer);
        view.setUint32(0, entry.id);
        view.setUint32(4, offset);
        view.setUint32(8, part.length);
        frame.set(part, HEADER_BYTES);
        await send(frame.buffer, entry.controller.signal);
      }
    } catch (error) { entry.abort(error); }
    finally {
      entry.uploadFinishedAt = performance.now();
      entry.busy = false;
      if (entry.finished) release(outgoing, entry.id, entry);
      else if (entry.result) disclose(entry);
    }
  }
  async function disclose(entry) {
    entry.busy = true;
    try {
      await permit('accept', entry);
      counters.completedRequests++;
      finish(entry, null, entry.result);
    } catch (error) { finish(entry, error); }
    finally { entry.busy = false; release(outgoing, entry.id, entry); }
  }

  function receiveControl(text) {
    const frame = JSON.parse(text);
    assert(frame?.schema === SCHEMA && positive(frame.id) && frame.id <= 0xffffffff, 'invalid control');
    if (frame.type === 'request') { accept(frame).catch(error => close(error.message)); return; }
    if (frame.type === 'cancel') {
      assert(receivedIds.has(frame.id), 'cancellation before request');
      const entry = incoming.get(frame.id);
      if (entry) cancelIncoming(entry);
      return;
    }
    assert(['ready', 'error', 'result'].includes(frame.type) && frame.id <= nextId, 'unexpected response');
    const entry = outgoing.get(frame.id);
    if (!entry || entry.finished) { counters.discardedFrames++; return; }
    if (frame.type === 'error') { finish(entry, new Error('Partition peer declined or failed request')); return; }
    if (frame.type === 'ready') {
      assert(!entry.ready, 'duplicate ready');
      entry.ready = true;
      // Header write completion can race its acknowledgement.
      if (!entry.busy) upload(entry);
      return;
    }
    assert(entry.ready && !entry.result && object(frame.result), 'unexpected result');
    entry.resultAt = performance.now();
    entry.result = frame.result;
    if (!entry.busy) disclose(entry);
  }
  function receiveBinary(buffer) {
    assert(buffer.byteLength > HEADER_BYTES, 'empty activation fragment');
    const view = new DataView(buffer);
    const id = view.getUint32(0);
    assert(receivedIds.has(id), 'fragment before request');
    const entry = incoming.get(id);
    if (!entry || entry.controller.signal.aborted) { counters.discardedFrames++; return; }
    const offset = view.getUint32(4);
    const size = view.getUint32(8);
    assert(entry.ready && !entry.executing && offset === entry.offset
      && size === Math.min(fragmentBytes, entry.size - offset)
      && size === buffer.byteLength - HEADER_BYTES, 'activation fragment geometry');
    entry.bytes.set(new Uint8Array(buffer, HEADER_BYTES), offset);
    entry.offset += size;
    if (entry.offset === entry.size && !entry.busy) execute(entry);
  }
  function onMessage({ data }) {
    try {
      const text = typeof data === 'string';
      assert(text || data instanceof ArrayBuffer, 'unsupported frame');
      const size = text ? encoder.encode(data).byteLength : data.byteLength;
      counters.receivedFrameBytes += size;
      counters.receivedFrames++;
      assert(size <= (text ? policy.maxControlBytes : policy.maxFrameBytes), 'frame limit');
      assert(counters.receivedFrameBytes <= policy.maxTransferBytes, 'incoming byte budget exhausted');
      text ? receiveControl(data) : receiveBinary(data);
    } catch (error) { close(error.message); }
  }
  const onClose = () => close('peer disconnected');
  channel.addEventListener('message', onMessage);
  channel.addEventListener('close', onClose);
  channel.addEventListener('error', onClose);

  return Object.freeze({
    request(metadata, bytes, { signal, onTiming } = {}) {
      const startedAt = performance.now();
      assert(!closed && channel.readyState === 'open', 'unavailable');
      signal?.throwIfAborted();
      assert(object(metadata) && bytes instanceof Uint8Array && bytes.length <= policy.maxPayloadBytes, 'request geometry');
      assert(nextId < policy.maxRequestsPerChannel, 'request identity budget exhausted');
      // Bound metadata before copying or invoking any asynchronous host port.
      const text = encodeControl({ type: 'request', id: nextId + 1, metadata, size: bytes.length });
      reserve(bytes.length);
      const entry = { metadata: JSON.parse(text).metadata, bytes: bytes.slice(), size: bytes.length,
        controller: new AbortController(), busy: true, finished: false, signal, onTiming, startedAt, id: ++nextId };
      outgoing.set(entry.id, entry);
      const result = new Promise((resolve, reject) => { entry.resolve = resolve; entry.reject = reject; });
      entry.abort = error => {
        if (entry.finished) return;
        counters.cancelledRequests++;
        finish(entry, error instanceof Error ? error : new Error('Partition request cancelled or timed out'));
        cancelRemote(entry);
      };
      signal?.addEventListener('abort', entry.abort, { once: true });
      entry.timer = setTimeout(entry.abort, policy.timeoutMs);
      start(entry, text);
      return result;
    },
    close,
    getReceipt: () => ({ schema: SCHEMA, ...counters, pendingRequests: outgoing.size,
      inboundRequests: incoming.size, reservedBytes, closed, wireBytes: null, relayBytes: null }),
  });

  function cancelRemote(entry) {
    if (entry.sent && !entry.cancelSent && !closed) {
      entry.cancelSent = true;
      control({ type: 'cancel', id: entry.id }).catch(failDelivery);
    }
  }
  async function start(entry, text) {
    try {
      await permit('send', entry);
      entry.authorizedAt = performance.now();
      await send(text, entry.controller.signal);
      entry.sent = true;
      if (entry.finished) cancelRemote(entry);
    } catch (error) { finish(entry, error); }
    finally {
      entry.busy = false;
      if (entry.finished) release(outgoing, entry.id, entry);
      else if (entry.ready) upload(entry);
    }
  }
}
