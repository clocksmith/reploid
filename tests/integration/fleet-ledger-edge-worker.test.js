// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { openFleetCredits } from '../../server/fleet/credits.js';
import { createFleetClient, startFleetService } from '../../server/fleet/service.js';
import worker, { MAX_BODY_BYTES } from '../../server/fleet/ledger-edge-worker.js';

const EDGE = 'https://reploid-ledger.reploid.workers.dev';
const model = { id: 'test-model', identity: 'sha256:' + 'a'.repeat(64) };
const placementPolicy = { maxMeasurementAgeMs: 60000, maxObservationAgeMs: 10000, minResidencyMs: 1000, maxRouteCandidates: 100, queuedRequestsPerReplica: 2 };
let root, credits, service, keys, calls;

function limiter(limit) {
  const counts = new Map();
  return { async limit({ key }) { const next = (counts.get(key) || 0) + 1; counts.set(key, next); return { success: next <= limit }; } };
}
/** A stand-in for the Workers VPC binding: forwards to `target` (a loopback ledger) and records what arrived. */
function binding(target) {
  return {
    async fetch(request) {
      const url = new URL(request.url);
      calls.push({ method: request.method, path: url.pathname, search: url.search, headers: Object.fromEntries(request.headers) });
      return fetch(new URL(url.pathname, target), { method: request.method, headers: request.headers,
        ...(request.method === 'POST' ? { body: await request.arrayBuffer() } : {}) });
    }
  };
}
function environment(overrides = {}) {
  return { LEDGER_ROUTE: 'enabled', LEDGER: binding(service.url.replace(/\/v1\/fleet$/, '')),
    LEDGER_ADDRESS_LIMIT: limiter(1000), LEDGER_PARTICIPANT_LIMIT: limiter(1000), LEDGER_TOTAL_LIMIT: limiter(1000), ...overrides };
}
const edgeClient = (identity, env) => createFleetClient({ url: `${EDGE}/v1/fleet`, identity,
  fetchImpl: (url, init) => worker.fetch(new Request(url, { ...init, headers: { ...init.headers, 'cf-connecting-ip': '203.0.113.7' } }), env) });
const call = (env, pathname, init = {}) => worker.fetch(new Request(EDGE + pathname, init), env);
const envelope = (participantId = keys[0].peerId) => JSON.stringify({ schema: 'reploid.fleet-service-request/v1', participantId,
  operation: 'snapshot', payload: {}, at: Date.now(), nonce: 'n-1', signature: 'not-a-signature' });

beforeEach(async () => {
  calls = [];
  root = await mkdtemp(path.join(os.tmpdir(), 'ledger-edge-'));
  keys = await Promise.all([0, 1].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
  credits = await openFleetCredits({ file: path.join(root, 'credits.sqlite'),
    computers: keys.map((key, index) => ({ id: `machine-${index}`, name: `Machine ${index}`, ownerId: `owner-${index}`,
      providers: [{ participantId: key.peerId, publicJwk: key.publicJwk }] })),
    policy: { schema: 'reploid.service-credit-policy/v1', version: 'test/1', unit: 'noncash-service-credit',
      creditsPerOutputToken: 1, maxDebt: 100, maxOutputTokens: 20, maxPendingPerComputer: 2,
      maxClockSkewMs: 10000, maxRequestMs: 60000, allowSameOwner: false, wholeModelTerminalCharge: 0 } });
  service = await startFleetService({ credits, models: [model], placementPolicy });
});
afterEach(async () => { await service?.close(); credits?.close(); await rm(root, { recursive: true, force: true }); });

describe('ledger edge Worker', () => {
  it('is off by default in its deploy config, and off answers 404 without touching the binding', async () => {
    const source = await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../deploy/cloudflare/wrangler.ledger.jsonc'), 'utf8');
    expect(source).toMatch(/"LEDGER_ROUTE": "disabled"/);
    expect(source).not.toMatch(/^\s*"vpc_services"/m);
    for (const env of [environment({ LEDGER_ROUTE: 'disabled' }), environment({ LEDGER_ROUTE: undefined }), {}]) {
      const response = await call(env, '/v1/fleet/coordinator');
      expect(response.status).toBe(404);
    }
    expect(calls).toEqual([]);
  });

  it('passes the ledger routes and the ledger itself decides: enrolled callers answered, unenrolled refused', async () => {
    const env = environment();
    const coordinator = await call(env, '/v1/fleet/coordinator');
    expect(coordinator.status).toBe(404);
    expect(await coordinator.json()).toEqual({ error: 'This ledger signs no settlement statements: it has no coordinator key' });

    const snapshot = await edgeClient(keys[0], env).call('snapshot', {});
    expect(snapshot.accounts.map(account => account.id)).toEqual(expect.arrayContaining(['owner-0', 'owner-1']));

    const stranger = await createSigningIdentity({ algorithm: 'Ed25519' });
    await expect(edgeClient(stranger, env).call('snapshot', {})).rejects.toMatchObject({ message: 'Invalid fleet request signature', code: 'FLEET_REJECTED' });
    // A real key that signs someone else's participantId is refused by the ledger too.
    const forged = await call(env, '/v1/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: envelope() });
    expect(forged.status).toBe(400);
    expect((await forged.json()).error).toMatch(/Invalid or stale fleet request|Invalid fleet request signature/);
    expect(calls.map(row => `${row.method} ${row.path}`)).toEqual(['GET /v1/fleet/coordinator', 'POST /v1/fleet', 'POST /v1/fleet', 'POST /v1/fleet']);
  });

  it('forwards the body byte for byte and none of the caller\'s other headers', async () => {
    const seen = [];
    const env = environment({ LEDGER: { async fetch(request) { seen.push({ headers: Object.fromEntries(request.headers), body: await request.text() });
      return new Response('{"result":1}', { headers: { 'content-type': 'application/json' } }); } } });
    const body = envelope().replace('{', '{ ');
    const response = await call(env, '/v1/fleet', { method: 'POST', body, headers: { 'content-type': 'application/json',
      authorization: 'Bearer caller', cookie: 'a=b', 'cf-access-client-id': 'x', 'cf-access-client-secret': 'y', 'x-forwarded-for': '10.0.0.1', origin: 'https://replo.id' } });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"result":1}');
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0].body).toBe(body);
    expect(Object.keys(seen[0].headers).sort()).toEqual(['accept', 'content-type']);
  });

  it('refuses everything outside the two routes without reaching the binding', async () => {
    const env = environment();
    const refused = [
      ['/', 'GET', 404], ['/v1', 'GET', 404], ['/v1/fleet/', 'POST', 404], ['/v1/fleetx', 'POST', 404], ['/v1/fleet/x', 'GET', 404],
      ['/v1/fleet?x=1', 'POST', 404], ['/v1/fleet/coordinator?x=1', 'GET', 404], ['/v1/fleet/coordinator/', 'GET', 404],
      ['/v1/fleet/../api', 'GET', 404], ['/v1/fleet/%2e%2e/api', 'GET', 404], ['/v1/fleet/account', 'GET', 404], ['/v1/fleet/join', 'POST', 404],
      ['/v1/fleet', 'GET', 405], ['/v1/fleet', 'PUT', 405], ['/v1/fleet', 'DELETE', 405], ['/v1/fleet', 'OPTIONS', 405],
      ['/v1/fleet/coordinator', 'POST', 405], ['/v1/fleet/coordinator', 'OPTIONS', 405]
    ];
    for (const [pathname, method, status] of refused) {
      const response = await call(env, pathname, { method, ...(['POST', 'PUT'].includes(method) ? { body: envelope(), headers: { 'content-type': 'application/json' } } : {}) });
      expect([pathname, method, response.status]).toEqual([pathname, method, status]);
      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    }
    const badBodies = [
      [{ 'content-type': 'text/plain' }, envelope(), 415],
      [{}, envelope(), 415],
      [{ 'content-type': 'application/json' }, 'not json', 400],
      [{ 'content-type': 'application/json' }, '[]', 400],
      [{ 'content-type': 'application/json' }, '{"schema":"other","participantId":"p"}', 400],
      [{ 'content-type': 'application/json' }, JSON.stringify({ schema: 'reploid.fleet-service-request/v1' }), 400],
      [{ 'content-type': 'application/json' }, JSON.stringify({ schema: 'reploid.fleet-service-request/v1', participantId: 'p', pad: 'x'.repeat(MAX_BODY_BYTES) }), 413]
    ];
    for (const [headers, body, status] of badBodies) {
      expect((await call(env, '/v1/fleet', { method: 'POST', headers, body })).status).toBe(status);
    }
    // An oversize body sent without a length is counted as it streams.
    const chunk = new TextEncoder().encode('x'.repeat(65536));
    let sent = 0;
    const stream = new ReadableStream({ pull(controller) { if (sent++ < 8) controller.enqueue(chunk); else controller.close(); } });
    expect((await call(env, '/v1/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' })).status).toBe(413);
    expect(calls).toEqual([]);
  });

  it('rate limits per address, per participant and in total, and fails closed without limiters', async () => {
    const byAddress = environment({ LEDGER_ADDRESS_LIMIT: limiter(2) });
    const statuses = [];
    for (let index = 0; index < 3; index++) {
      statuses.push((await call(byAddress, '/v1/fleet/coordinator', { headers: { 'cf-connecting-ip': '198.51.100.1' } })).status);
    }
    expect(statuses).toEqual([404, 404, 429]);
    expect((await call(byAddress, '/v1/fleet/coordinator', { headers: { 'cf-connecting-ip': '198.51.100.2' } })).status).toBe(404);

    const byParticipant = environment({ LEDGER_PARTICIPANT_LIMIT: limiter(1) });
    const post = (env, id) => call(env, '/v1/fleet', { method: 'POST', headers: { 'content-type': 'application/json' }, body: envelope(id) });
    expect((await post(byParticipant, 'peer:a')).status).toBe(400);
    expect((await post(byParticipant, 'peer:a')).status).toBe(429);
    expect((await post(byParticipant, 'peer:b')).status).toBe(400);

    const total = environment({ LEDGER_TOTAL_LIMIT: limiter(1) });
    expect((await call(total, '/v1/fleet/coordinator')).status).toBe(404);
    expect((await call(total, '/v1/fleet/coordinator')).status).toBe(429);

    const before = calls.length;
    for (const name of ['LEDGER_ADDRESS_LIMIT', 'LEDGER_PARTICIPANT_LIMIT', 'LEDGER_TOTAL_LIMIT']) {
      const missing = environment({ [name]: undefined });
      expect((await post(missing, 'peer:c')).status).toBe(429);
      const failing = environment({ [name]: { limit: async () => { throw Error('limiter down'); } } });
      expect((await post(failing, 'peer:c')).status).toBe(429);
    }
    expect(calls.length).toBe(before);
  });

  it('answers a plain 503 naming no upstream when the ledger is down, locked or answers anything but its JSON', async () => {
    const stopped = service.url.replace(/\/v1\/fleet$/, ''); await service.close(); service = { url: stopped + '/v1/fleet', close: async () => {} };
    const html = '<html>Bad gateway: 127.0.0.1:18443 ledger.internal</html>';
    const upstreams = [
      environment(),
      environment({ LEDGER: undefined }),
      environment({ LEDGER: { fetch: async () => new Response(html, { status: 502, headers: { 'content-type': 'text/html' } }) } }),
      environment({ LEDGER: { fetch: async () => new Response(html, { status: 200, headers: { 'content-type': 'text/html' } }) } }),
      environment({ LEDGER: { fetch: async () => new Response('{"error":"x"}', { status: 500, headers: { 'content-type': 'application/json' } }) } }),
      environment({ LEDGER: { fetch: async () => new Response('{not json', { status: 200, headers: { 'content-type': 'application/json' } }) } }),
      environment({ LEDGER: { fetch: async () => new Response(null, { status: 302, headers: { location: 'https://login.example/' } }) } }),
      environment({ LEDGER: { fetch: async () => new Response(`{"a":"${'x'.repeat(1048576)}"}`, { headers: { 'content-type': 'application/json' } }) } })
    ];
    for (const env of upstreams) {
      const response = await call(env, '/v1/fleet/coordinator');
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(JSON.parse(text)).toEqual({ error: 'The ledger is not reachable right now (it may be stopped or locked). Try again later.' });
      expect(text).not.toMatch(/127\.0\.0\.1|18443|internal|html|login/);
    }
  });
});
