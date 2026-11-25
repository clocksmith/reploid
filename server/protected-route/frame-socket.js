/**
 * Length-prefixed frames over a Node byte stream: the protected wire between requester and evaluator peers, and
 * the two local links to Doppler's Go processes (the requester's key holder over stdio, the evaluator engine over
 * loopback TCP). All three use u32 header length | header JSON | blobs; they differ in how a header announces
 * its blob sizes, which `inspect` decides before any blob byte is buffered.
 */
import net from 'node:net';
import { createFrameDecoder, encodeProtectedFrame, inspectProtectedHeader } from '../../shared/vendor/reploid/mesh/protected-generation.js';

const closedError = message => Object.assign(new Error(message), { code: 'PROTECTED_SESSION_CLOSED' });

/** Wrap a readable/writable pair. `receive` yields frames in order; a decode error or close rejects every waiter. */
export function frameStream({ readable, writable, inspect, destroy = () => {} }) {
  const queue = [], waiters = [];
  let failure = null;
  const finish = error => {
    if (failure) return;
    failure = error;
    for (const waiter of waiters.splice(0)) waiter.reject(failure);
  };
  const decoder = createFrameDecoder({ inspect, onFrame: frame => {
    const waiter = waiters.shift();
    if (waiter) waiter.resolve(frame); else queue.push(frame);
  } });
  readable.on('data', chunk => {
    try { decoder.push(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.length)); } catch (error) { finish(closedError(`Malformed frame: ${error.message}`)); destroy(); }
  });
  readable.on('end', () => finish(closedError('The peer closed the connection')));
  readable.on('close', () => finish(closedError('The connection closed')));
  readable.on('error', error => finish(closedError(`Connection error: ${error.message}`)));
  writable.on?.('error', error => finish(closedError(`Connection error: ${error.message}`)));
  const write = chunk => new Promise((resolve, reject) => {
    if (failure) { reject(failure); return; }
    writable.write(chunk, error => error ? reject(closedError(error.message)) : resolve());
  });
  return {
    async send({ header, blobs = [] }) {
      for (const chunk of encodeProtectedFrame(header, blobs)) await write(chunk);
    },
    receive({ timeoutMs = 60000 } = {}) {
      if (queue.length) return Promise.resolve(queue.shift());
      if (failure) return Promise.reject(failure);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(waiter), 1);
          reject(closedError('The peer did not answer in time'));
        }, timeoutMs);
        const waiter = { resolve: frame => { clearTimeout(timer); resolve(frame); }, reject: error => { clearTimeout(timer); reject(error); } };
        waiters.push(waiter);
      });
    },
    close() { finish(closedError('The connection closed')); destroy(); }
  };
}

const socketStream = (socket, inspect) => {
  socket.setNoDelay(true);
  return frameStream({ readable: socket, writable: socket, inspect, destroy: () => socket.destroy() });
};

const parseEndpoint = endpoint => {
  const match = /^(.+):(\d{1,5})$/.exec(String(endpoint));
  if (!match) throw new Error(`Endpoint must be host:port, got ${endpoint}`);
  return { host: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]) };
};

export function connectFrameSocket(endpoint, { inspect = inspectProtectedHeader, signal, timeoutMs = 30000 } = {}) {
  const { host, port } = parseEndpoint(endpoint);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); reject(closedError(`Could not reach ${endpoint}`)); }, timeoutMs);
    const abort = () => { socket.destroy(); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
    socket.once('connect', () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(socketStream(socket, inspect)); });
    socket.once('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(closedError(`Could not reach ${endpoint}: ${error.message}`)); });
  });
}

/** Listen for protected-wire connections; `onChannel` gets one frame channel per connection. */
export function listenFrameSocket({ host = '127.0.0.1', port = 0, onChannel, inspect = inspectProtectedHeader }) {
  const sockets = new Set();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    onChannel(socketStream(socket, inspect));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({ endpoint: `${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`,
        close: () => new Promise(done => { for (const socket of sockets) socket.destroy(); server.close(() => done()); }) });
    });
  });
}

/** Header inspection for Doppler's Go framing: `blobs` is an array of sizes, with a per-kind ceiling. */
export const goHeaderInspector = ceilings => header => {
  if (!header || typeof header.kind !== 'string' || !Object.hasOwn(ceilings, header.kind)) throw new RangeError(`Unexpected engine frame ${header?.kind}`);
  const sizes = header.blobs ?? [];
  if (!Array.isArray(sizes) || !sizes.every(size => Number.isSafeInteger(size) && size >= 0)) throw new RangeError('Invalid engine blob sizes');
  if (sizes.reduce((a, b) => a + b, 0) > ceilings[header.kind]) throw new RangeError(`${header.kind} exceeds its ceiling`);
  return sizes;
};
