/** Pinned public origin for model files: the last source after the approved local directory and
 * authorized custody peers. The origin is fixed here per exact model identity (repository and
 * immutable revision), never taken from peers or requests, and fetched without credentials.
 * Callers verify every byte against pinned piece identities or file hashes; this module only
 * bounds what it returns. The manifest never comes from an origin: the bundled pinned copy is used. */
import origins from './native-model-origins.json' with { type: 'json' };

const assert = (ok, message, code = 'MODEL_ORIGIN_INVALID') => { if (!ok) throw Object.assign(new Error(message), { code }); };
export const PINNED_ORIGIN_SOURCE = 'pinned-origin';

/** The pinned origin for this exact model, or null. `table` and `fetch` replace the shipped pins and
 * the network in tests. */
export function resolvePinnedOrigin(model, table = origins, fetch = (...args) => globalThis.fetch(...args)) {
  assert(table?.schema === 'reploid.native-model-origins/v1', 'Unknown model origin table');
  const pin = table.origins?.[model?.id];
  if (!pin) return null;
  assert(pin.modelIdentity === model.identity, 'Pinned origin names another model identity');
  assert(pin.kind === 'huggingface' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(pin.repoId)
    && /^[a-f0-9]{40}$/.test(pin.revision) && typeof pin.path === 'string'
    && pin.path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && !/^\.\.?$/.test(part)), 'Pinned origin must name a repository, an immutable revision and a plain path');
  const base = `https://huggingface.co/${pin.repoId}/resolve/${pin.revision}/${pin.path}/`;
  return Object.freeze({ id: `${PINNED_ORIGIN_SOURCE}:huggingface`, label: `huggingface:${pin.repoId}@${pin.revision}/${pin.path}`, fetch,
    url: name => { assert(/^[A-Za-z0-9_.-]+$/.test(name) && !/^\.\.?$/.test(name), 'Plain model filename required'); return base + name; } });
}

/** Reads `size` bytes at `offset` of `name` (a range request), or the whole file when `whole` is
 * set. Returns exactly the requested length or throws. Credentials and cookies are never sent. */
export async function readPinnedOrigin(origin, name, { offset = 0, size, whole = false, signal, fetch = origin.fetch }) {
  assert(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(size) && size > 0, 'Explicit origin range required');
  const response = await fetch(origin.url(name), { signal, credentials: 'omit', redirect: 'follow', cache: 'no-store',
    headers: whole ? {} : { range: `bytes=${offset}-${offset + size - 1}` } });
  const ranged = response.status === 206, complete = response.status === 200 && (whole || offset === 0);
  if (!ranged && !complete) { await response.body?.cancel(); assert(false, `Pinned origin answered ${response.status} for ${name}`, 'MODEL_ORIGIN_UNAVAILABLE'); }
  if (ranged) {
    const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(response.headers.get('content-range') || '');
    if (!match || Number(match[1]) !== offset || Number(match[2]) !== offset + size - 1) {
      await response.body?.cancel(); assert(false, `Pinned origin returned another range of ${name}`, 'MODEL_ORIGIN_RANGE');
    }
  }
  const bytes = new Uint8Array(size); let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.byteLength, size - received);
      bytes.set(value.subarray(0, take), received); received += take;
      // A whole-file answer to a range request at offset 0 is cut to the requested length.
      if (received === size) { if (ranged || whole) assert((await reader.read()).done, `Pinned origin sent more than ${size} bytes of ${name}`, 'MODEL_ORIGIN_RANGE'); break; }
    }
  } finally { await reader.cancel().catch(() => {}); }
  assert(received === size, `Pinned origin sent ${received} of ${size} bytes of ${name}`, 'MODEL_ORIGIN_RANGE');
  return bytes;
}
