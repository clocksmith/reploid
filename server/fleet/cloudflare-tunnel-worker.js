const ALLOWED_PATHS = new Map([
  ['/v1/models', 'GET'],
  ['/v1/responses', 'POST'],
  ['/v1/chat/completions', 'POST'],
  ['/v1/reploid/recover', 'POST']
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

/** HTTPS ingress Worker forwarding /v1 text API routes over a bound Cloudflare VPC
 * tunnel to an authenticated native fleet requester on 127.0.0.1:18785. Signing keys,
 * room tokens, bearer secret verification and disclosure checks remain on the native host. */
export default {
  async fetch(request, env) {
    let url;
    try { url = new URL(request.url); }
    catch { return jsonResponse(400, 'Invalid API route'); }
    const expectedMethod = ALLOWED_PATHS.get(url.pathname);
    if (!expectedMethod) return jsonResponse(404, 'Unsupported API route');
    if (request.method !== expectedMethod) return jsonResponse(405, 'Method not allowed', null, { allow: expectedMethod });
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer\s+\S+$/u.test(authorization) || authorization.length > 4160) {
      return jsonResponse(401, 'Authentication required', 'unauthorized');
    }
    if (!env?.FLEET_API?.fetch) return jsonResponse(503, 'Fleet tunnel service unavailable');
    const headers = new Headers();
    headers.set('authorization', authorization);
    for (const name of ['content-type', 'accept']) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const target = new URL(url.pathname, 'http://127.0.0.1:18785');
    try {
      const upstream = await env.FLEET_API.fetch(new Request(target.toString(), {
        method: request.method,
        headers,
        ...(request.method === 'POST' ? { body: request.body, duplex: 'half' } : {}),
        redirect: 'manual',
        signal: request.signal
      }));
      const responseHeaders = new Headers(upstream.headers);
      responseHeaders.set('cache-control', 'no-store');
      responseHeaders.set('x-content-type-options', 'nosniff');
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      return jsonResponse(503, 'Fleet requester unreachable');
    }
  }
};
