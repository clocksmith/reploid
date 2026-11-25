/**
 * A frame channel over one WebSocket, for a browser requester (and Node 22+, which has a global WebSocket).
 * Each binary message is one frame: u32 little-endian header length | header JSON | blobs, the same layout as the
 * TCP frames in server/protected-route/frame-socket.js. TLS on the socket is not what protects content: the prompt is
 * sealed with HPKE to the attested key, so a terminating proxy or relay sees only ciphertext, sizes and timing.
 */
import { inspectAttestedHeader, attestedSessionError } from './session.js';

const MAX_HEADER_BYTES = 64 << 10;

export function encodeAttestedFrame({ header, blobs = [] }) {
  const raw = new TextEncoder().encode(JSON.stringify(header));
  if (!raw.length || raw.length > MAX_HEADER_BYTES) throw new RangeError('Attested frame header too large');
  const total = 4 + raw.length + blobs.reduce((n, blob) => n + blob.length, 0);
  const out = new Uint8Array(total);
  new DataView(out.buffer).setUint32(0, raw.length, true);
  out.set(raw, 4);
  let offset = 4 + raw.length;
  for (const blob of blobs) { out.set(blob, offset); offset += blob.length; }
  return out;
}

export function decodeAttestedFrame(bytes) {
  if (bytes.length < 4) throw new RangeError('Truncated attested frame');
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  if (!length || length > MAX_HEADER_BYTES || 4 + length > bytes.length) throw new RangeError('Attested frame header length out of range');
  const header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(4, 4 + length)));
  const sizes = inspectAttestedHeader(header);
  let offset = 4 + length;
  const blobs = sizes.map(size => { const blob = bytes.slice(offset, offset + size); offset += size; return blob; });
  if (offset !== bytes.length || blobs.some((blob, i) => blob.length !== sizes[i])) throw new RangeError('Attested frame blob sizes do not match');
  return { header, blobs };
}

/** Open `url` (ws: or wss:) and return { send, receive, close } once connected. */
export function connectWebSocketFrames(url, { signal, timeoutMs = 30000, WebSocketImpl = globalThis.WebSocket } = {}) {
  if (typeof WebSocketImpl !== 'function') throw new TypeError('WebSocket is not available here');
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    socket.binaryType = 'arraybuffer';
    const queue = [], waiters = [];
    let failure = null;
    const finish = error => {
      if (failure) return;
      failure = error;
      for (const waiter of waiters.splice(0)) waiter.reject(failure);
    };
    const timer = setTimeout(() => { socket.close(); reject(attestedSessionError('ATTESTED_SESSION_CLOSED', `Could not reach ${url}`)); }, timeoutMs);
    const abort = () => { socket.close(); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    socket.addEventListener('message', event => {
      if (!(event.data instanceof ArrayBuffer)) { finish(attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', 'Text frame on an attested socket')); socket.close(); return; }
      let value;
      try { value = decodeAttestedFrame(new Uint8Array(event.data)); } catch (error) { finish(attestedSessionError('ATTESTED_PROTOCOL_VIOLATION', error.message)); socket.close(); return; }
      const waiter = waiters.shift();
      if (waiter) waiter.resolve(value); else queue.push(value);
    });
    socket.addEventListener('close', () => finish(attestedSessionError('ATTESTED_SESSION_CLOSED', 'The connection closed')));
    socket.addEventListener('error', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); finish(attestedSessionError('ATTESTED_SESSION_CLOSED', 'Connection error')); reject(failure); });
    socket.addEventListener('open', () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({
        async send(value) {
          if (failure) throw failure;
          socket.send(encodeAttestedFrame(value));
        },
        receive({ timeoutMs: wait = 60000 } = {}) {
          if (queue.length) return Promise.resolve(queue.shift());
          if (failure) return Promise.reject(failure);
          return new Promise((done, fail) => {
            const t = setTimeout(() => { waiters.splice(waiters.indexOf(waiter), 1); fail(attestedSessionError('ATTESTED_SESSION_CLOSED', 'No answer in time')); }, wait);
            const waiter = { resolve: value => { clearTimeout(t); done(value); }, reject: error => { clearTimeout(t); fail(error); } };
            waiters.push(waiter);
          });
        },
        close() { finish(attestedSessionError('ATTESTED_SESSION_CLOSED', 'The connection closed')); socket.close(); }
      });
    }, { once: true });
  });
}
