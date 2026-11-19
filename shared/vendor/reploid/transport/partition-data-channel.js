import { createBoundedChannelWriter } from './bounded-channel-writer.js';
import failureMessages from './partition-errors.json' with { type: 'json' };

const SCHEMA = 'reploid.partition-channel/v2';
// Fragment header: kind (request or response payload), request id, offset, length.
const HEADER_BYTES = 13;
const REQUEST_PAYLOAD = 0, RESPONSE_PAYLOAD = 1, COMBINED_REQUEST = 2, COMBINED_RESPONSE = 3;
const encoder = new TextEncoder(), decoder = new TextDecoder();
const positive = value => Number.isSafeInteger(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const assert = (condition, message) => { if (!condition) throw new Error(`Partition channel: ${message}`); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const binaryResults = new WeakSet();

/** A serve result that returns bytes on the direct reply path, bounded by the
 * request's declared `maxResponseBytes`. */
export function partitionBinaryResult(result, bytes) {
  assert(object(result) && bytes instanceof Uint8Array, 'binary result requires a JSON object and bytes');
  const value = Object.freeze({ result, bytes });
  binaryResults.add(value);
  return value;
}

/** Binary requests and bounded JSON (optionally binary) replies on an owned, dedicated RTC channel.
 * Pipelined: a request's header and payload leave together, under credit that the receiver's
 * declared window grants and its terminal reply (result, error or released) returns.
 * Host ports bind grants to authenticated peers. Receipt/abort is not GPU settlement.
 */
export function createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId, authorize, serve, limits, onReceiveTiming }) {
  assert(channel?.ordered === true && channel.maxRetransmits == null && channel.maxPacketLifeTime == null,
    'reliable ordered channel required');
  assert(typeof authorize === 'function' && typeof serve === 'function', 'authorization and serving ports required');
  assert([localParticipantId, remoteParticipantId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 256)
    && localParticipantId !== remoteParticipantId, 'distinct authenticated peer identities required');
  for (const key of ['maxFrameBytes', 'maxControlBytes', 'maxPayloadBytes', 'maxPendingBytes',
    'maxPendingRequests', 'maxRequestsPerChannel', 'maxBufferedBytes', 'maxTransferBytes', 'timeoutMs']) {
    assert(positive(limits?.[key]), `explicit ${key} required`);
  }
  assert(onReceiveTiming === undefined || typeof onReceiveTiming === 'function', 'receive timing observer must be a function');
  const receiveNow = onReceiveTiming ? () => performance.now() : () => 0;
  const policy = Object.freeze(structuredClone(limits));
  assert(policy.maxFrameBytes > HEADER_BYTES && policy.maxFrameBytes <= policy.maxBufferedBytes
    && policy.maxControlBytes <= policy.maxBufferedBytes && policy.maxPayloadBytes <= 0xffffffff
    && policy.maxPayloadBytes <= policy.maxPendingBytes && policy.maxRequestsPerChannel <= 0xffffffff
    && policy.timeoutMs <= 2147483647, 'invalid limits');
  // An SCTP data channel sends a few packets per send call and then waits for acknowledgements, so one
  // large frame takes several network round trips where the same bytes in small frames take one. A
  // payload no larger than burstPayloadBytes therefore travels in frames of at most burstFrameBytes.
  // Small frames are negotiated on the channel itself: every request and result header carries this
  // endpoint's burst limits (`accepts`), small frames are sent only once the peer has declared the same
  // limits, and a header whose payload travels in them says so (`frameBytes`). A peer that declares
  // nothing, or other limits, gets full frames, so endpoints with different policies interoperate. The
  // first request on a channel therefore always travels in full frames.
  assert((policy.burstFrameBytes === undefined) === (policy.burstPayloadBytes === undefined)
    && (policy.burstFrameBytes === undefined || positive(policy.burstFrameBytes) && positive(policy.burstPayloadBytes)
      && policy.burstFrameBytes > HEADER_BYTES && policy.burstFrameBytes <= policy.maxFrameBytes
      && policy.burstPayloadBytes <= policy.maxPayloadBytes), 'invalid burst frame limits');
  const burst = policy.burstFrameBytes === undefined ? null
    : Object.freeze({ frameBytes: policy.burstFrameBytes, payloadBytes: policy.burstPayloadBytes });
  const declared = burst ? { accepts: burst } : {};
  let peerAgrees = false;
  const frameBytesFor = size => burst && peerAgrees && size > 0 && size <= burst.payloadBytes
    ? burst.frameBytes : policy.maxFrameBytes;
  // Header fields for a payload of this size, and the frame size they announce.
  const announce = size => {
    const frameBytes = frameBytesFor(size);
    return { frameBytes, fields: frameBytes === policy.maxFrameBytes ? declared : { ...declared, frameBytes } };
  };
  // The peer's header: remember whether it accepts this endpoint's small frames, and return the frame
  // size its payload uses. Only this endpoint's own declared geometry is ever accepted.
  const announced = (frame, size) => {
    if (frame.accepts !== undefined) {
      assert(object(frame.accepts) && positive(frame.accepts.frameBytes) && positive(frame.accepts.payloadBytes), 'burst declaration');
      peerAgrees = burst !== null && frame.accepts.frameBytes === burst.frameBytes && frame.accepts.payloadBytes === burst.payloadBytes;
    }
    if (frame.frameBytes === undefined) return policy.maxFrameBytes;
    assert(burst !== null && frame.frameBytes === burst.frameBytes && size > 0 && size <= burst.payloadBytes, 'payload frame geometry');
    return frame.frameBytes;
  };
  // Requests this endpoint sent, and the peer's requests it holds. Each direction is bounded by
  // the declared window (maxPendingRequests, maxPendingBytes): both endpoints of a channel declare
  // the same channel policy, and a peer that exceeds this endpoint's window closes the channel.
  const outgoing = new Map();
  const incoming = new Map();
  const receivedIds = new Set();
  // Credit: the peer's window less what its terminal replies have not yet returned.
  const held = new Map();
  const waiting = [];
  // Response fragments of requests that already ended here are skipped, never buffered.
  const skipping = new Map();
  const lifecycle = new AbortController();
  const counters = { sentFrameBytes: 0, receivedFrameBytes: 0, sentFrames: 0, receivedFrames: 0,
    completedRequests: 0, cancelledRequests: 0, discardedFrames: 0 };
  let nextId = 0;
  let outgoingBytes = 0;
  let incomingBytes = 0;
  let closed = false;
  let lastFailure = null;
  const failureCode = error => Object.hasOwn(failureMessages, error?.code) ? error.code : 'EXECUTION_FAILED';
  const coded = code => Object.assign(new Error(failureMessages[code]), { code });
  const recordFailure = (entry, phase, error) => {
    lastFailure = { requestId: entry.id, phase, code: failureCode(error),
      message: String(error?.message || error).slice(0, policy.maxControlBytes),
      failedAt: Date.now(), settledAt: null };
  };
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
  async function sendPayload(kind, id, bytes, frameBytes, signal, startOffset = 0) {
    const fragment = frameBytes - HEADER_BYTES;
    for (let offset = startOffset; offset < bytes.length; offset += fragment) {
      const part = bytes.subarray(offset, offset + fragment);
      const frame = new Uint8Array(HEADER_BYTES + part.length);
      const view = new DataView(frame.buffer);
      view.setUint8(0, kind);
      view.setUint32(1, id);
      view.setUint32(5, offset);
      view.setUint32(9, part.length);
      frame.set(part, HEADER_BYTES);
      await send(frame.buffer, signal);
    }
  }
  function packCombinedFrame(kind, id, controlBytes, bytes, frameBytes) {
    // A control frame larger than a burst frame still leaves in one frame; it then carries no payload.
    const firstChunk = Math.max(0, Math.min(bytes.length, frameBytes - HEADER_BYTES - controlBytes.length));
    const frame = new Uint8Array(HEADER_BYTES + controlBytes.length + firstChunk);
    const view = new DataView(frame.buffer);
    view.setUint8(0, kind);
    view.setUint32(1, id);
    view.setUint32(5, controlBytes.length);
    view.setUint32(9, firstChunk);
    frame.set(controlBytes, HEADER_BYTES);
    frame.set(bytes.subarray(0, firstChunk), HEADER_BYTES + controlBytes.length);
    return { buffer: frame.buffer, firstChunk };
  }
  async function permit(action, entry, responseByteLength) {
    entry.controller.signal.throwIfAborted();
    const allowed = await authorize({ action, localParticipantId, remoteParticipantId,
      metadata: structuredClone(entry.metadata), byteLength: entry.size,
      ...(responseByteLength === undefined ? {} : { responseByteLength }) },
    { signal: entry.controller.signal });
    entry.controller.signal.throwIfAborted();
    if (allowed !== true) throw Object.assign(new Error('Partition channel: authorization declined'),
      { code: 'AUTHORIZATION_DENIED' });
  }

  // Credit is taken in request order; a request never overtakes an earlier waiting one.
  const heldBytes = () => { let total = 0; for (const size of held.values()) total += size; return total; };
  const fits = entry => held.size < policy.maxPendingRequests && heldBytes() + entry.size <= policy.maxPendingBytes;
  function pump() {
    while (waiting.length && fits(waiting[0].entry)) {
      const next = waiting.shift();
      next.entry.controller.signal.removeEventListener('abort', next.cancel);
      held.set(next.entry.id, next.entry.size);
      next.resolve();
    }
  }
  function acquireCredit(entry) {
    entry.controller.signal.throwIfAborted();
    if (!waiting.length && fits(entry)) { held.set(entry.id, entry.size); return Promise.resolve(); }
    return new Promise((resolve, reject) => {
      const item = { entry, resolve, cancel: () => {
        const index = waiting.indexOf(item);
        if (index >= 0) waiting.splice(index, 1);
        reject(entry.controller.signal.reason);
        pump();
      } };
      entry.controller.signal.addEventListener('abort', item.cancel, { once: true });
      waiting.push(item);
    });
  }
  function returnCredit(id) {
    assert(held.delete(id), 'unexpected terminal reply');
    pump();
  }

  function releaseOutgoing(entry) {
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (outgoing.delete(entry.id)) outgoingBytes -= entry.reserved;
    // A reply still arriving for an ended request is skipped, never buffered.
    const remaining = entry.response && !entry.complete ? entry.response.length - entry.responseOffset : 0;
    if (remaining > 0) skipping.set(entry.id, remaining);
    entry.bytes = null; entry.response = null;
  }
  function finish(entry, error, value) {
    if (entry.finished) return;
    entry.finished = true;
    clearTimeout(entry.timer);
    entry.signal?.removeEventListener('abort', entry.abort);
    if (!error && entry.onTiming) {
      const completedAt = performance.now();
      // Response waiting includes remote authorization and computation. Credit
      // waiting replaces the former ready round trip and is zero with free credit.
      try { entry.onTiming({ authorizationMs: entry.authorizedAt - entry.startedAt,
        readyWaitMs: entry.uploadStartedAt - entry.authorizedAt,
        payloadUploadMs: entry.uploadFinishedAt - entry.uploadStartedAt,
        responseWaitMs: Math.max(0, entry.resultAt - entry.uploadFinishedAt),
        acceptanceMs: completedAt - Math.max(entry.resultAt, entry.uploadFinishedAt),
        totalMs: completedAt - entry.startedAt }); } catch {}
    }
    error ? entry.reject(error) : entry.resolve(value);
    entry.controller.abort(error ?? new Error('Partition request complete'));
    if (!entry.busy) releaseOutgoing(entry);
  }
  // The receiver releases its window before any terminal reply, so returned credit is exact.
  function observeReceived(entry, replyReadyAt, queuedAt) {
    if (!onReceiveTiming || entry.terminal?.type !== 'result' || entry.serveFinishedAt == null) return;
    // All durations use this provider's monotonic clock. Admission and payload
    // arrival overlap; enqueue completion is not network delivery or GPU settlement.
    try { onReceiveTiming({ requestId: entry.id,
      admissionMs: entry.admittedAt - entry.receivedAt,
      payloadArrivalMs: entry.payloadReadyAt - entry.receivedAt,
      readyToExecuteWaitMs: entry.executeStartedAt - Math.max(entry.admittedAt, entry.payloadReadyAt),
      receiveToExecuteMs: entry.executeStartedAt - entry.receivedAt,
      preServeAuthorizationMs: entry.serveStartedAt - entry.executeStartedAt,
      serveMs: entry.serveFinishedAt - entry.serveStartedAt,
      responseAuthorizationMs: entry.responseAuthorizedAt - entry.serveFinishedAt,
      responsePreparationMs: replyReadyAt - entry.responseAuthorizedAt,
      replyQueueAndEnqueueMs: queuedAt - replyReadyAt,
      totalMs: queuedAt - entry.receivedAt,
    }, structuredClone(entry.metadata)); } catch {}
  }
  function releaseIncoming(entry) {
    clearTimeout(entry.timer);
    if (!incoming.delete(entry.id)) return;
    incomingBytes -= entry.size;
    entry.bytes = null;
    if (lastFailure?.requestId === entry.id) lastFailure.settledAt = Date.now();
    if (closed) return;
    const terminal = entry.terminal ?? (entry.timedOut ? { type: 'error', code: 'REQUEST_TIMEOUT' }
      : entry.failure ? { type: 'error', code: entry.failure } : { type: 'released' });
    const response = entry.responsePayload, responseFrameBytes = entry.responseFrameBytes;
    entry.responsePayload = null;
    (async () => {
      const text = encodeControl({ ...terminal, id: entry.id });
      const controlBytes = response?.length ? encoder.encode(text) : null;
      if (controlBytes && HEADER_BYTES + controlBytes.length < policy.maxFrameBytes) {
        const packed = packCombinedFrame(COMBINED_RESPONSE, entry.id, controlBytes, response, responseFrameBytes);
        const replyReadyAt = receiveNow();
        await send(packed.buffer);
        if (packed.firstChunk < response.length) {
          await sendPayload(RESPONSE_PAYLOAD, entry.id, response, responseFrameBytes, undefined, packed.firstChunk);
        }
        observeReceived(entry, replyReadyAt, receiveNow());
      } else {
        const replyReadyAt = receiveNow();
        await send(text);
        if (response?.length) await sendPayload(RESPONSE_PAYLOAD, entry.id, response, responseFrameBytes);
        observeReceived(entry, replyReadyAt, receiveNow());
      }
    })().catch(failDelivery);
  }
  function cancelIncoming(entry) {
    clearTimeout(entry.timer);
    entry.controller.abort(new Error('Partition request cancelled or timed out'));
    // A host callback may ignore abort. Keep its window charged until it settles.
    if (!entry.busy) releaseIncoming(entry);
  }
  function close(reason = 'channel closed') {
    if (closed) return;
    closed = true;
    const error = Object.assign(new Error(failureMessages.CONNECTION_LOST),
      { code: 'CONNECTION_LOST', cause: new Error(`Partition channel: ${reason}`) });
    lifecycle.abort(error);
    for (const entry of outgoing.values()) finish(entry, error);
    for (const entry of incoming.values()) cancelIncoming(entry);
    channel.removeEventListener('message', onMessage);
    channel.removeEventListener('close', onClose);
    channel.removeEventListener('error', onClose);
    channel.close();
  }
  const failDelivery = () => close('control delivery failed');

  function accept(frame) {
    assert(!receivedIds.has(frame.id), 'duplicate request');
    assert(frame.id <= policy.maxRequestsPerChannel && receivedIds.size < policy.maxRequestsPerChannel, 'request identity budget exhausted');
    receivedIds.add(frame.id);
    assert(object(frame.metadata) && count(frame.size) && frame.size <= policy.maxPayloadBytes
      && count(frame.responseBytes) && frame.responseBytes <= policy.maxPayloadBytes, 'request geometry');
    // Credit the peer took: its request and payload must fit the window this endpoint declares.
    assert(incoming.size < policy.maxPendingRequests && incomingBytes + frame.size <= policy.maxPendingBytes, 'receive window exceeded');
    incomingBytes += frame.size;
    const receivedAt = receiveNow();
    const entry = { id: frame.id, metadata: frame.metadata, size: frame.size, responseBytes: frame.responseBytes,
      receivedAt, payloadReadyAt: frame.size === 0 ? receivedAt : null, fragment: announced(frame, frame.size) - HEADER_BYTES,
      offset: 0, unfragmented: frame.size === 0, controller: new AbortController(), busy: true, permitted: false, bytes: new Uint8Array(frame.size) };
    incoming.set(frame.id, entry);
    entry.timer = setTimeout(() => { entry.timedOut = true; cancelIncoming(entry); }, policy.timeoutMs);
    admit(entry);
  }
  // Authorization runs while payload fragments arrive; refused bytes are discarded unexecuted.
  async function admit(entry) {
    try {
      await permit('receive', entry);
      entry.permitted = true;
    } catch (error) {
      recordFailure(entry, 'admission', error);
      if (!entry.controller.signal.aborted) entry.failure = failureCode(error);
      entry.controller.abort(error);
    } finally {
      entry.admittedAt = receiveNow();
      entry.busy = false;
      if (entry.controller.signal.aborted) releaseIncoming(entry);
      else if (entry.offset === entry.size) execute(entry);
    }
  }

  async function execute(entry) {
    if (entry.busy || entry.executing) return;
    entry.busy = true;
    entry.executing = true;
    entry.executeStartedAt = receiveNow();
    try {
      // Permission may change during a fragmented upload.
      if (!entry.unfragmented) await permit('receive', entry);
      entry.serveStartedAt = receiveNow();
      const returned = await serve(structuredClone(entry.metadata), entry.bytes, { signal: entry.controller.signal });
      entry.serveFinishedAt = receiveNow();
      const binary = binaryResults.has(returned);
      const result = binary ? returned.result : returned;
      const payload = binary ? returned.bytes : null;
      await permit('respond', entry, payload?.length ?? 0);
      entry.responseAuthorizedAt = receiveNow();
      assert(object(result), 'JSON result object required');
      assert(!payload || payload.length <= entry.responseBytes, 'response exceeds the declared allocation');
      // Bound the reply before releasing the window that carries it.
      const reply = announce(payload?.length ?? 0);
      entry.terminal = { type: 'result', result, size: payload?.length ?? 0, ...reply.fields };
      encodeControl({ ...entry.terminal, id: entry.id });
      entry.responseFrameBytes = reply.frameBytes;
      entry.responsePayload = payload?.slice() ?? null;
    } catch (error) {
      recordFailure(entry, 'execution', error);
      if (!entry.controller.signal.aborted) entry.failure = failureCode(error);
    } finally {
      entry.busy = false;
      releaseIncoming(entry);
    }
  }

  async function start(entry, text) {
    try {
      await permit('send', entry);
      entry.authorizedAt = performance.now();
      await acquireCredit(entry);
      entry.uploadStartedAt = performance.now();
      const controlBytes = entry.bytes.length ? encoder.encode(text) : null;
      if (controlBytes && HEADER_BYTES + controlBytes.length < policy.maxFrameBytes) {
        const packed = packCombinedFrame(COMBINED_REQUEST, entry.id, controlBytes, entry.bytes, entry.frameBytes);
        try { await send(packed.buffer, entry.controller.signal); }
        catch (error) { held.delete(entry.id); pump(); throw error; }
        entry.sent = true;
        if (packed.firstChunk < entry.bytes.length) {
          await sendPayload(REQUEST_PAYLOAD, entry.id, entry.bytes, entry.frameBytes, entry.controller.signal, packed.firstChunk);
        }
      } else {
        try { await send(text, entry.controller.signal); }
        catch (error) { held.delete(entry.id); pump(); throw error; }
        entry.sent = true;
        // The payload follows its header without waiting for a reply.
        await sendPayload(REQUEST_PAYLOAD, entry.id, entry.bytes, entry.frameBytes, entry.controller.signal);
      }
      entry.bytes = null;
    } catch (error) { entry.abort(error); }
    finally {
      entry.uploadFinishedAt = performance.now();
      entry.busy = false;
      if (entry.finished) { if (entry.sent) cancelRemote(entry); releaseOutgoing(entry); }
      else if (entry.complete) disclose(entry);
    }
  }
  async function disclose(entry) {
    entry.busy = true;
    try {
      await permit('accept', entry, entry.response.length);
      counters.completedRequests++;
      finish(entry, null, entry.binary ? { result: entry.result, bytes: entry.response } : entry.result);
    } catch (error) { finish(entry, error); }
    finally { entry.busy = false; releaseOutgoing(entry); }
  }
  function responseComplete(entry) {
    entry.complete = true;
    if (!entry.busy) disclose(entry);
  }

  function receiveControl(text, parsedFrame) {
    const frame = parsedFrame ?? JSON.parse(text);
    assert(frame?.schema === SCHEMA && positive(frame.id) && frame.id <= 0xffffffff, 'invalid control');
    if (frame.type === 'request') { accept(frame); return; }
    if (frame.type === 'cancel') {
      assert(receivedIds.has(frame.id), 'cancellation before request');
      const entry = incoming.get(frame.id);
      if (entry) cancelIncoming(entry);
      return;
    }
    assert(['result', 'error', 'released'].includes(frame.type) && frame.id <= nextId, 'unexpected response');
    returnCredit(frame.id);
    const size = frame.type === 'result' ? frame.size : 0;
    assert(count(size) && size <= policy.maxPayloadBytes, 'response geometry');
    const responseFrameBytes = announced(frame, size);
    const entry = outgoing.get(frame.id);
    if (!entry || entry.finished) {
      counters.discardedFrames++;
      if (size) skipping.set(frame.id, size);
      return;
    }
    if (frame.type === 'released') { finish(entry, coded('REQUEST_TIMEOUT')); return; }
    if (frame.type === 'error') {
      const code = failureCode(frame);
      finish(entry, coded(code)); return;
    }
    assert(!entry.result && object(frame.result) && size <= entry.responseBytes, 'unexpected result');
    entry.responseFragment = responseFrameBytes - HEADER_BYTES;
    entry.resultAt = performance.now();
    entry.result = frame.result;
    entry.response = new Uint8Array(size);
    entry.responseOffset = 0;
    if (size === 0) responseComplete(entry);
  }
  function receiveBinary(buffer) {
    assert(buffer.byteLength > HEADER_BYTES, 'empty activation fragment');
    const view = new DataView(buffer);
    const kind = view.getUint8(0), id = view.getUint32(1), offset = view.getUint32(5), size = view.getUint32(9);
    if (kind === COMBINED_REQUEST || kind === COMBINED_RESPONSE) {
      const controlLen = offset, payloadLen = size;
      assert(controlLen > 0 && controlLen <= policy.maxControlBytes
        && HEADER_BYTES + controlLen + payloadLen === buffer.byteLength, 'combined frame geometry');
      const controlText = decoder.decode(new Uint8Array(buffer, HEADER_BYTES, controlLen));
      const controlFrame = JSON.parse(controlText);
      assert(controlFrame?.id === id
        && controlFrame.type === (kind === COMBINED_REQUEST ? 'request' : 'result'), 'combined control binding');
      receiveControl(controlText, controlFrame);
      if (payloadLen === 0) return;
      if (kind === COMBINED_RESPONSE) {
        const skipped = skipping.get(id);
        if (skipped !== undefined) {
          counters.discardedFrames++;
          if (skipped - payloadLen > 0) skipping.set(id, skipped - payloadLen); else skipping.delete(id);
          return;
        }
        const entry = outgoing.get(id);
        assert(entry?.response && !entry.complete && entry.responseOffset === 0
          && payloadLen <= entry.response.length, 'response fragment geometry');
        entry.response.set(new Uint8Array(buffer, HEADER_BYTES + controlLen, payloadLen), 0);
        entry.responseOffset = payloadLen;
        if (entry.responseOffset === entry.response.length) responseComplete(entry);
        return;
      }
      assert(receivedIds.has(id), 'fragment before request');
      const entry = incoming.get(id);
      if (!entry || entry.controller.signal.aborted) { counters.discardedFrames++; return; }
      assert(!entry.executing && entry.offset === 0 && payloadLen <= entry.size, 'activation fragment geometry');
      entry.bytes.set(new Uint8Array(buffer, HEADER_BYTES + controlLen, payloadLen), 0);
      entry.offset = payloadLen;
      if (payloadLen === entry.size) { entry.unfragmented = true; entry.payloadReadyAt = receiveNow(); }
      if (entry.offset === entry.size && entry.permitted && !entry.busy) execute(entry);
      return;
    }
    assert(size === buffer.byteLength - HEADER_BYTES, 'activation fragment geometry');
    if (kind === RESPONSE_PAYLOAD) {
      const skipped = skipping.get(id);
      if (skipped !== undefined) {
        counters.discardedFrames++;
        if (skipped - size > 0) skipping.set(id, skipped - size); else skipping.delete(id);
        return;
      }
      const entry = outgoing.get(id);
      assert(entry?.response && !entry.complete && offset === entry.responseOffset
        && size === Math.min(entry.responseFragment, entry.response.length - offset), 'response fragment geometry');
      entry.response.set(new Uint8Array(buffer, HEADER_BYTES), offset);
      entry.responseOffset += size;
      if (entry.responseOffset === entry.response.length) responseComplete(entry);
      return;
    }
    assert(kind === REQUEST_PAYLOAD && receivedIds.has(id), 'fragment before request');
    const entry = incoming.get(id);
    if (!entry || entry.controller.signal.aborted) { counters.discardedFrames++; return; }
    assert(!entry.executing && offset === entry.offset
      && size === Math.min(entry.fragment, entry.size - offset), 'activation fragment geometry');
    entry.bytes.set(new Uint8Array(buffer, HEADER_BYTES), offset);
    entry.offset += size;
    if (entry.offset === entry.size) entry.payloadReadyAt = receiveNow();
    if (entry.offset === entry.size && entry.permitted && !entry.busy) execute(entry);
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
    request(metadata, bytes, { signal, onTiming, maxResponseBytes } = {}) {
      const startedAt = performance.now();
      if (closed || channel.readyState !== 'open') {
        throw Object.assign(new Error(failureMessages.CONNECTION_LOST), { code: 'CONNECTION_LOST' });
      }
      signal?.throwIfAborted();
      const binary = maxResponseBytes !== undefined;
      assert(object(metadata) && bytes instanceof Uint8Array && bytes.length <= policy.maxPayloadBytes, 'request geometry');
      assert(!binary || count(maxResponseBytes) && maxResponseBytes <= policy.maxPayloadBytes, 'response geometry');
      assert(nextId < policy.maxRequestsPerChannel, 'request identity budget exhausted');
      // Bound metadata before copying or invoking any asynchronous host port.
      const responseBytes = binary ? maxResponseBytes : 0;
      const outgoingFrames = announce(bytes.length);
      const text = encodeControl({ type: 'request', id: nextId + 1, metadata, size: bytes.length, responseBytes, ...outgoingFrames.fields });
      // Local memory: the payload copy until written, and the reply allocation it may receive.
      const reserved = bytes.length + responseBytes;
      assert(outgoing.size < policy.maxPendingRequests, 'pending request limit');
      assert(outgoingBytes + reserved <= policy.maxPendingBytes, 'pending byte limit');
      outgoingBytes += reserved;
      const entry = { metadata: JSON.parse(text).metadata, bytes: bytes.slice(), size: bytes.length, responseBytes, reserved, binary,
        frameBytes: outgoingFrames.frameBytes,
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
      entry.timer = setTimeout(() => entry.abort(coded('REQUEST_TIMEOUT')), policy.timeoutMs);
      start(entry, text);
      return result;
    },
    close,
    getReceipt: () => ({ schema: SCHEMA, ...counters, pendingRequests: outgoing.size,
      inboundRequests: incoming.size, reservedBytes: outgoingBytes + incomingBytes,
      creditHeld: { requests: held.size, bytes: heldBytes() }, creditWaiting: waiting.length,
      closed, wireBytes: null, relayBytes: null, lastFailure: structuredClone(lastFailure) }),
  });

  function cancelRemote(entry) {
    // Only a request whose header left needs the peer to release its window.
    if (entry.sent && !entry.cancelSent && !closed && held.has(entry.id)) {
      entry.cancelSent = true;
      control({ type: 'cancel', id: entry.id }).catch(failDelivery);
    }
  }
}
