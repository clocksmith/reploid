const ALLOWED_PATHS = new Map([
  ['/v1/models', 'GET'],
  ['/v1/responses', 'POST'],
  ['/v1/chat/completions', 'POST'],
  ['/v1/reploid/recover', 'POST']
]);

const BRIDGE_PATHS = new Set([
  '/bridge/state',
  '/bridge/receipt',
  '/bridge/accounts',
  '/bridge/cancel',
  '/bridge/recover',
  '/bridge/generate'
]);

function jsonResponse(status, message, code = null, extraHeaders = {}) {
  return new Response(JSON.stringify({
    error: { message, type: status < 500 ? 'invalid_request_error' : 'server_error', param: null, code }
  }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders
    }
  });
}

/** HTTPS ingress Worker forwarding /v1 text API and /bridge paired-browser routes
 * over a bound Cloudflare VPC tunnel to an authenticated native fleet requester on
 * 127.0.0.1:18785. Signing keys, room tokens, secret verification, origin checks
 * and disclosure gates remain on the native host. */
export default {
  async fetch(request, env) {
    let url;
    try { url = new URL(request.url); }
    catch { return jsonResponse(400, 'Invalid API route'); }
    const isBridge = BRIDGE_PATHS.has(url.pathname);
    const expectedMethod = ALLOWED_PATHS.get(url.pathname);
    if (!isBridge && !expectedMethod) return jsonResponse(404, 'Unsupported API route');
    if (isBridge) {
      if (request.method !== 'POST' && request.method !== 'OPTIONS') {
        return jsonResponse(405, 'Method not allowed', null, { allow: 'POST, OPTIONS' });
      }
      const origin = request.headers.get('origin') || '';
      if (!origin || origin.length > 512) return jsonResponse(403, 'Browser origin required');
    } else if (request.method !== expectedMethod) {
      return jsonResponse(405, 'Method not allowed', null, { allow: expectedMethod });
    }
    const authorization = request.headers.get('authorization') || '';
    if (request.method !== 'OPTIONS' && (!/^Bearer\s+\S+$/u.test(authorization) || authorization.length > 4160)) {
      return jsonResponse(401, 'Authentication required', 'unauthorized');
    }
    if (!env?.FLEET_API?.fetch) return jsonResponse(503, 'Fleet tunnel service unavailable');
    const headers = new Headers();
    if (authorization) headers.set('authorization', authorization);
    for (const name of ['content-type', 'accept', ...(isBridge ? ['origin', 'access-control-request-method', 'access-control-request-headers'] : [])]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const target = new URL(url.pathname, 'http://127.0.0.1:18785');
    const controller = new AbortController();
    const abortUpstream = () => controller.abort(request.signal.reason);
    request.signal.addEventListener('abort', abortUpstream, { once: true });
    if (request.signal.aborted) abortUpstream();
    try {
      const upstream = await env.FLEET_API.fetch(new Request(target.toString(), {
        method: request.method,
        headers,
        ...(request.method === 'POST' ? { body: request.body, duplex: 'half' } : {}),
        redirect: 'manual',
        signal: controller.signal
      }));
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('cache-control', 'no-store');
      responseHeaders.set('x-content-type-options', 'nosniff');
      const contentType = responseHeaders.get('content-type') || '';
      if (upstream.body && (contentType.includes('text/event-stream') || contentType.includes('application/x-ndjson'))) {
        request.signal.removeEventListener('abort', abortUpstream);
        const reader = upstream.body.getReader();
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          request.signal.removeEventListener('abort', cancelStream);
        };
        const cancelStream = () => {
          controller.abort(request.signal.reason);
          release();
          reader.cancel(request.signal.reason).catch(() => {});
        };
        request.signal.addEventListener('abort', cancelStream, { once: true });
        if (request.signal.aborted) cancelStream();
        const body = new ReadableStream({
          async pull(streamController) {
            try {
              const { done, value } = await reader.read();
              if (done) {
                release();
                streamController.close();
                return;
              }
              streamController.enqueue(value);
            } catch (error) {
              release();
              streamController.error(error);
            }
          },
          async cancel(reason) {
            controller.abort(reason);
            release();
            await reader.cancel(reason).catch(() => {});
          }
        });
        return new Response(body, { status: upstream.status, headers: responseHeaders });
      }
      request.signal.removeEventListener('abort', abortUpstream);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      request.signal.removeEventListener('abort', abortUpstream);
      if (request.signal.aborted || controller.signal.aborted) {
        return new Response(null, {
          status: 499,
          headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
        });
      }
      return jsonResponse(503, 'Fleet requester unreachable');
    }
  }
};
