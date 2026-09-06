/** Dedicated reliable WebRTC channel for bounded signed complete-job messages. */
import { PACK_JOB_MAX_WIRE_BYTES, requirePackJob } from './peer-pack-job.js';

const SCHEMA = 'reploid.peer.pack_job_channel/v1';
const FRAME_BYTES = 16 * 1024;
export function createPackJobDataChannel({ channel, maxTransferBytes = 64 * 1024 * 1024, timeoutMs = 10000 }) {
  requirePackJob(channel?.ordered === true && channel.maxRetransmits == null && channel.maxPacketLifeTime == null,
    'reliable ordered dedicated operation channel required');
  requirePackJob(Number.isSafeInteger(maxTransferBytes) && maxTransferBytes > 0 && maxTransferBytes <= 256 * 1024 * 1024
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300000, 'invalid channel limits');
  const listeners = new Set(), disconnects = new Set();
  const lifecycle = new AbortController();
  let closed = false, outbound = Promise.resolve(), pendingBytes = 0, pendingMessages = 0, inbound = null;
  const counters = { sentFrameBytes: 0, receivedFrameBytes: 0, sentMessages: 0, receivedMessages: 0 };
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = FRAME_BYTES;
  function close(reason = 'operation channel closed') {
    if (closed) return;
    closed = true;
    lifecycle.abort(new Error(reason));
    clearTimeout(inbound?.timer); inbound = null;
    channel.removeEventListener('message', receive);
    channel.removeEventListener('close', onClose);
    channel.removeEventListener('error', onClose);
    channel.close();
    for (const listener of disconnects) listener(reason);
    listeners.clear(); disconnects.clear();
  }
  async function frame(value) {
    requirePackJob(!closed && channel.readyState === 'open', 'operation channel unavailable');
    if (channel.bufferedAmount > 4 * FRAME_BYTES) await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer); channel.removeEventListener('bufferedamountlow', low);
        lifecycle.signal.removeEventListener('abort', abort);
        error ? reject(error) : resolve();
      };
      const low = () => finish();
      const abort = () => finish(lifecycle.signal.reason);
      const timer = setTimeout(() => finish(new Error('operation channel backpressure timeout')), timeoutMs);
      channel.addEventListener('bufferedamountlow', low, { once: true });
      lifecycle.signal.addEventListener('abort', abort, { once: true });
      if (closed) abort(); else if (channel.bufferedAmount <= FRAME_BYTES) low();
    });
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value).length : value.byteLength;
    requirePackJob(!closed && counters.sentFrameBytes + bytes <= maxTransferBytes, 'channel send budget exhausted');
    channel.send(value); counters.sentFrameBytes += bytes;
  }
  function receive({ data }) {
    try {
      const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.byteLength;
      requirePackJob(Number.isSafeInteger(size) && size > 0 && size <= FRAME_BYTES, 'operation frame limit');
      counters.receivedFrameBytes += size;
      requirePackJob(counters.receivedFrameBytes <= maxTransferBytes, 'channel receive budget exhausted');
      if (typeof data === 'string') {
        const header = JSON.parse(data);
        requirePackJob(!inbound && header.schema === SCHEMA && Number.isSafeInteger(header.byteLength)
          && header.byteLength > 0 && header.byteLength <= PACK_JOB_MAX_WIRE_BYTES, 'invalid message header');
        inbound = { bytes: new Uint8Array(header.byteLength), offset: 0,
          timer: setTimeout(() => close('incomplete operation message'), timeoutMs) };
        return;
      }
      requirePackJob(data instanceof ArrayBuffer && inbound && size > 4, 'fragment before message header');
      const offset = new DataView(data).getUint32(0);
      requirePackJob(offset === inbound.offset && size - 4 <= inbound.bytes.length - offset, 'operation fragment gap or overflow');
      inbound.bytes.set(new Uint8Array(data, 4), offset); inbound.offset += size - 4;
      if (inbound.offset === inbound.bytes.length) {
        const complete = inbound; clearTimeout(complete.timer); inbound = null;
        const message = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(complete.bytes));
        counters.receivedMessages++;
        for (const listener of listeners) listener(message);
      }
    } catch (error) { close(error.message); }
  }
  function onClose() { close('operation transport disconnected'); }
  channel.addEventListener('message', receive);
  channel.addEventListener('close', onClose);
  channel.addEventListener('error', onClose);
  return {
    send(message) {
      if (closed) return Promise.reject(new Error('operation channel closed'));
      const bytes = new TextEncoder().encode(JSON.stringify(message));
      if (bytes.length > PACK_JOB_MAX_WIRE_BYTES || pendingBytes + bytes.length > PACK_JOB_MAX_WIRE_BYTES || pendingMessages >= 16) {
        return Promise.reject(new Error('operation send queue budget exhausted'));
      }
      pendingBytes += bytes.length; pendingMessages++;
      const operation = outbound.then(async () => {
        await frame(JSON.stringify({ schema: SCHEMA, byteLength: bytes.length }));
        for (let offset = 0; offset < bytes.length; offset += FRAME_BYTES - 4) {
          const part = bytes.subarray(offset, offset + FRAME_BYTES - 4);
          const value = new Uint8Array(4 + part.length);
          new DataView(value.buffer).setUint32(0, offset); value.set(part, 4);
          await frame(value.buffer);
        }
        counters.sentMessages++;
      }).finally(() => { pendingBytes -= bytes.length; pendingMessages--; });
      outbound = operation.catch(error => close(error.message));
      return operation;
    },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    onDisconnect(listener) { disconnects.add(listener); return () => disconnects.delete(listener); },
    getState() { return { closed, pendingBytes, pendingMessages, ...counters, wireBytes: null }; },
    close
  };
}
