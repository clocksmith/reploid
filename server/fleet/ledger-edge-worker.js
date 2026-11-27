/**
 * Public HTTPS front for one separately run fleet ledger (service.js), reached over a Workers VPC binding to a
 * Cloudflare Tunnel that has no public hostname. Callers (participant hosts, `trade.js --service`) hold no tunnel
 * credential and no service token: the link lives only in this Worker's `LEDGER` binding.
 *
 * Off unless the `LEDGER_ROUTE` var is "enabled": disabled, every request is a JSON 404 and nothing reaches the
 * binding. Enabled, only the ledger's two routes pass, matched on the exact path with no query:
 *   POST /v1/fleet               signed fleet operations (each checked by the ledger: schema, clock, enrollment, signature)
 *   GET  /v1/fleet/coordinator   the coordinator's public key
 * Everything else is answered here. POST bodies must be JSON envelopes of at most MAX_BODY_BYTES and are forwarded
 * byte for byte with only content-type and accept; nothing from the caller's other headers is passed on, and this
 * Worker adds nothing the ledger treats as authority. Requests are rate limited per edge-reported client address, per
 * participant and in total (Workers Rate Limiting bindings, counted per Cloudflare location). A ledger that is
 * stopped, locked or unreachable is a plain 503 naming no upstream. CORS headers are never sent: the page does not
 * call the ledger, and CORS is not access control.
 */
export const LEDGER_ROUTES = Object.freeze({ '/v1/fleet': 'POST', '/v1/fleet/coordinator': 'GET' });
export const FLEET_REQUEST_SCHEMA = 'reploid.fleet-service-request/v1';
export const MAX_BODY_BYTES = 262144;
export const MAX_RESPONSE_BYTES = 1048576;
export const UPSTREAM_TIMEOUT_MS = 30000;
// The binding's VPC service decides where this lands; the origin only has to be a valid URL for the request.
const UPSTREAM_ORIGIN = 'http://127.0.0.1:18443';
const UNAVAILABLE = 'The ledger is not reachable right now (it may be stopped or locked). Try again later.';
const PASSED_STATUSES = new Set([200, 400, 404]);

function json(status, value, extra = {}) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }
  });
}
const unavailable = () => json(503, { error: UNAVAILABLE }, { 'retry-after': '30' });
const limited = () => json(429, { error: 'Too many ledger requests. Slow down and retry.' }, { 'retry-after': '60' });

async function readBounded(stream, limit) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader(), chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** True when the limiter allows `key`. A missing or failing limiter refuses (fails closed). */
async function allowed(limiter, key) {
  if (typeof limiter?.limit !== 'function') return false;
  try { return (await limiter.limit({ key })).success === true; } catch { return false; }
}

export default {
  async fetch(request, env) {
    if (env?.LEDGER_ROUTE !== 'enabled') return json(404, { error: 'Unknown fleet endpoint' });
    let url;
    try { url = new URL(request.url); } catch { return json(404, { error: 'Unknown fleet endpoint' }); }
    const method = url.search === '' ? LEDGER_ROUTES[url.pathname] : undefined;
    if (!method) return json(404, { error: 'Unknown fleet endpoint' });
    if (request.method !== method) return json(405, { error: `Use ${method} for this fleet endpoint` }, { allow: method });
    if (typeof env.LEDGER?.fetch !== 'function') return unavailable();
    const address = request.headers.get('cf-connecting-ip') || 'unknown';
    if (!await allowed(env.LEDGER_ADDRESS_LIMIT, `a:${address}`)) return limited();

    let body = null;
    if (method === 'POST') {
      if (!/^application\/json(\s*;|$)/i.test(request.headers.get('content-type') || '')) {
        return json(415, { error: 'Fleet requests must be application/json' });
      }
      const declared = Number(request.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(413, { error: 'Fleet request too large' });
      body = await readBounded(request.body, MAX_BODY_BYTES);
      if (!body) return json(413, { error: 'Fleet request too large' });
      let envelope = null;
      try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); } catch { envelope = null; }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) || envelope.schema !== FLEET_REQUEST_SCHEMA
        || typeof envelope.participantId !== 'string' || !envelope.participantId || envelope.participantId.length > 256) {
        return json(400, { error: 'Invalid fleet request' });
      }
      if (!await allowed(env.LEDGER_PARTICIPANT_LIMIT, `p:${envelope.participantId}`)) return limited();
    }
    if (!await allowed(env.LEDGER_TOTAL_LIMIT, 'total')) return limited();

    try {
      const upstream = await env.LEDGER.fetch(new Request(UPSTREAM_ORIGIN + url.pathname, {
        method,
        headers: { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
      }));
      if (!PASSED_STATUSES.has(upstream.status) || !(upstream.headers.get('content-type') || '').includes('application/json')) {
        await upstream.body?.cancel().catch(() => {});
        return unavailable();
      }
      const bytes = await readBounded(upstream.body, MAX_RESPONSE_BYTES);
      if (!bytes) return unavailable();
      const text = new TextDecoder().decode(bytes);
      JSON.parse(text);
      return json(upstream.status, text);
    } catch {
      return unavailable();
    }
  }
};
