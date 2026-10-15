/** Typed failures for search providers and page fetches. Codes are the contract; messages are for people. */
class SearchFailure extends Error {
  constructor(code, { status = null, retryAfterSeconds = null, detail = null, usage = null } = {}, message = code) {
    super(detail ? `${message}: ${detail}` : message);
    this.code = code; this.status = status; this.retryAfterSeconds = retryAfterSeconds; this.detail = detail;
    if (usage) this.usage = usage;
  }
}

export class SearchProviderError extends SearchFailure {
  constructor(code, details = {}) { super(code, details, `Search provider failed (${code})`); this.name = 'SearchProviderError'; }
}

export class PageFetchError extends SearchFailure {
  constructor(code, details = {}) { super(code, details, `Page fetch failed (${code})`); this.name = 'PageFetchError'; }
}

/** Waits `ms` unless `signal` aborts first. */
export const sleep = (ms, signal = null) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(signal.reason); return; }
  const timer = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(timer); reject(signal.reason); };
  signal?.addEventListener('abort', stop, { once: true });
});

/** Maps a caller abort to timeout or cancellation. */
export function abortCode(signal) {
  const reason = signal?.reason;
  return reason?.name === 'TimeoutError' || reason?.code === 'timeout' ? 'timeout' : 'cancelled';
}

/** Reads at most `limit` bytes of a fetch Response body. */
export async function readBounded(response, limit, fail) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) { await response.body?.cancel().catch(() => {}); throw fail(); }
  if (!response.body) return '';
  const reader = response.body.getReader(), chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => {}); throw fail(); }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8');
}
