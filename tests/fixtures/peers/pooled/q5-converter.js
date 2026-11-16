// Executes the exact captured peer conversion-worker bytes; never opens a model.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';

export function createQ5Converter({ source, sha256, signal, maxInputBytes, maxOutputBytes }) {
  assert(typeof source === 'string' && createHash('sha256').update(source).digest('hex') === sha256,
    'Pinned peer conversion worker bytes differ');
  signal?.throwIfAborted();
  assert(Number.isSafeInteger(maxInputBytes) && maxInputBytes > 0 && Number.isSafeInteger(maxOutputBytes) && maxOutputBytes > 0,
    'Explicit per-tensor conversion bounds required');
  const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)));
  let serial = 0, pending, closed = false, closing;
  const fail = error => { if (pending) { pending.reject(error); pending = null; } };
  worker.on('error', error => { closed = true; fail(error); });
  worker.on('exit', () => { closed = true; fail(signal?.aborted ? signal.reason : new Error('Peer converter closed')); });
  worker.on('message', message => {
    const request = pending;
    if (!request) return;
    pending = null;
    if (message.id !== request.id || message.error) request.reject(new Error(message.error ?? 'Peer converter response identity mismatch'));
    else request.resolve(message);
  });
  const close = () => {
    closed = true;
    if (!closing) {
      const operation = worker.terminate().then(() => {});
      closing = operation;
      operation.catch(() => { if (closing === operation) closing = null; });
    }
    return closing;
  };
  const cancel = () => { close().catch(fail); };
  signal?.addEventListener('abort', cancel, { once: true });
  return {
    async convert(bytes, shape) {
      signal?.throwIfAborted();
      assert(!closed && !pending, 'Peer converter is closed or busy');
      assert(bytes instanceof ArrayBuffer && shape.length === 2 && shape.every(value => Number.isSafeInteger(value) && value > 0)
        && shape[1] % 32 === 0,
        'Owned Q5 tensor and explicit matrix shape required');
      const elements = shape[0] * shape[1], blocks = elements / 32;
      assert(Number.isSafeInteger(elements) && Number.isSafeInteger(blocks) && bytes.byteLength === blocks * 22,
        'Q5 tensor range does not match its matrix shape');
      assert(bytes.byteLength <= maxInputBytes && blocks * 34 <= maxOutputBytes, 'Q5 tensor exceeds conversion bounds');
      const result = await new Promise((resolve, reject) => {
        const id = ++serial; pending = { id, resolve, reject };
        try { worker.postMessage({ id, ggmlType: 6, rows: shape[0], cols: shape[1], bytes }, [bytes]); }
        catch (error) { pending = null; reject(error); }
      });
      signal?.throwIfAborted();
      assert(!closed && result.qs instanceof Uint8Array && result.qs.buffer instanceof ArrayBuffer && result.qs.length === elements
        && result.scales instanceof Uint32Array && result.scales.buffer instanceof ArrayBuffer
        && result.scales.byteLength === Math.ceil(blocks / 2) * 4,
      'Peer converter returned incomplete tensor buffers');
      const scales = new Uint16Array(result.scales.buffer, result.scales.byteOffset, blocks), packed = new Uint8Array(blocks * 34);
      for (let block = 0; block < blocks; block++) {
        packed[block * 34] = scales[block] & 255; packed[block * 34 + 1] = scales[block] >>> 8;
        packed.set(result.qs.subarray(block * 32, block * 32 + 32), block * 34 + 2);
      }
      return { packed, quantSha256: createHash('sha256').update(result.qs).digest('hex'),
        scaleSha256: createHash('sha256').update(new Uint8Array(result.scales.buffer, result.scales.byteOffset, blocks * 2)).digest('hex') };
    },
    async close() { signal?.removeEventListener('abort', cancel); await close(); },
  };
}
