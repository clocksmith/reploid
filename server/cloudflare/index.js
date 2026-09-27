import bootstrap from '../../self/config/swarm-bootstrap.json';
import { namespace } from './room.js';
import { handleTurn } from './turn.js';
export { SwarmRoom } from './room.js';
export { SwarmAdmission } from './admission.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ service: 'reploid-swarm', release: env.RELEASE_ID, discoveryOnly: true }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const origin = request.headers.get('Origin');
    if (!bootstrap.allowedOrigins.includes(origin)) return new Response('Origin not allowed', { status: 403 });
    const headers = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, X-Reploid-Client-Id',
      'Access-Control-Expose-Headers': 'Retry-After' };
    if (url.pathname === '/rtc-config' && request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers });
    try {
      if (url.pathname === bootstrap.path) {
        const join = namespace(url);
        if (!join) return new Response('Invalid discovery namespace', { status: 400 });
        // WebSocket upgrade uses fetch; actor admission uses RPC. Tokens never enter URLs.
        return await env.ROOMS.getByName(`${join.scope}:${join.roomId}`).fetch(request);
      }
      if (url.pathname === '/rtc-config') {
        const response = await handleTurn(request, env);
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
        return response;
      }
      return new Response('Not found', { status: 404, headers });
    } catch {
      console.error(JSON.stringify({ event: 'swarm-handler-failed', path: url.pathname }));
      return Response.json({ error: 'Service unavailable' }, { status: 503, headers });
    }
  }
};
