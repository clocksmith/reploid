import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';

const assert = (ok, message) => { if (!ok) throw Error(message); };
/** Explicitly paired, loopback-only access to an owner-operated native requester.
 * The pairing secret authorizes delegation to this host's enrolled private pool;
 * it never exposes the signing identity, room credential, file paths or raw config. */
export async function startFleetBrowserBridge({ host, token, origins, port = 0, maxBodyBytes = 262144, maxConcurrent = 2 }) {
  assert(typeof token === 'string' && token.length >= 32, 'Strong pairing secret required');
  assert(Array.isArray(origins) && origins.length && origins.every(origin => new URL(origin).origin === origin), 'Exact allowed browser origins required');
  const pending = new Map(), seen = new Set();
  const authenticate = request => {
    const received = Buffer.from(request.headers.authorization || ''), expected = Buffer.from(`Bearer ${token}`);
    return received.length === expected.length && timingSafeEqual(received, expected);
  };
  const server = http.createServer(async (request, response) => {
    let attemptId = null;
    try {
      assert(origins.includes(request.headers.origin), 'Browser origin is not paired');
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type');
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
      assert(request.method === 'POST' && authenticate(request), 'Pair this browser with the native host first');
      let length = 0; const chunks = [];
      for await (const chunk of request) { length += chunk.length; assert(length <= maxBodyBytes, 'Request exceeds browser bridge limit'); chunks.push(chunk); }
      const body = JSON.parse(Buffer.concat(chunks));
      if (request.url === '/state') {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await host.browserState())); return;
      }
      if (request.url === '/receipt') {
        assert(typeof body.id === 'string' && body.id.length < 512, 'Receipt identity required');
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await host.receipt(body.id))); return;
      }
      if (request.url === '/accounts') {
        response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(await host.balances())); return;
      }
      if (request.url === '/cancel') {
        assert(pending.has(body.attemptId), 'No active bridge request');
        host.cancel(body.attemptId); response.end(JSON.stringify({ status: 'stopping' })); return;
      }
      assert(request.url === '/generate', 'Unknown browser bridge operation');
      assert(typeof body.attemptId === 'string' && body.attemptId.length <= 128 && typeof body.threadId === 'string'
        && body.threadId.length <= 128 && Array.isArray(body.messages) && body.messages.length > 0
        && body.messages.every(row => ['user', 'assistant', 'system'].includes(row.role) && typeof row.content === 'string'), 'Invalid conversation request');
      assert(pending.size < maxConcurrent && !seen.has(body.attemptId) && seen.size < 10000, 'Request already used or bridge limit reached');
      attemptId = body.attemptId; seen.add(attemptId); pending.set(attemptId, Promise.resolve());
      const state = await host.browserState();
      const model = state.models.find(row => row.id === body.model?.id && row.identity === body.model?.identity);
      assert(model && ['ready', 'busy'].includes(model.availability), 'No private computer is ready for this model');
      assert(body.poolIdentity === state.poolIdentity, 'Private computer enrollment changed; reconnect before sending');
      // Never accept a browser-supplied route, source, adapter, generation policy or provider.
      response.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      const emit = event => { if (!response.destroyed) response.write(JSON.stringify(event) + '\n'); };
      response.on('close', () => { if (pending.has(attemptId)) host.cancel(attemptId); });
      const operation = host.generate({ threadId: body.threadId, attemptId, model: { id: model.id, identity: model.identity }, messages: body.messages }, delta => emit({ delta }), disclosure => {
        const route = disclosure.route;
        emit({ execution: { provider: 'peer', placement: route ? 'ordered-layer-partition' : 'peer-whole-request',
          ...(route ? { identity: { schema: 'reploid.partition-attempt/v2', route, requesterId: state.requester.participantId, threadId: body.threadId, attemptId } }
            : { peerId: disclosure.recipientIdentity }),
          serviceCredit: { status: 'pending', id: `service:${state.requester.participantId}:${route ? attemptId : disclosure.requestId}` } } });
      });
      pending.set(attemptId, operation);
      try { emit({ result: await operation }); }
      catch (error) { emit({ error: error.message, serviceCredit: error.serviceCredit || null }); }
      finally { pending.delete(attemptId); response.end(); }
    } catch (error) {
      if (attemptId) pending.delete(attemptId);
      if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error.message }));
    }
  });
  server.requestTimeout = 30000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`,
    async close() { for (const id of pending.keys()) host.cancel(id); await Promise.allSettled([...pending.values()]);
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); } };
}
