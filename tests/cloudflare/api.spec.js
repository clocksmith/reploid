import { exports } from 'cloudflare:workers';
import { runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { expect, it } from 'vitest';

const api = (path, init = {}) => exports.default.fetch(`https://reploid-api.test${path}`, init);
const fromPage = (path, init = {}) => api(path, { ...init, headers: { Origin: 'https://replo.id', ...(init.headers || {}) } });
const admin = (path, init = {}) => api(path, { ...init, headers: { Authorization: 'Bearer migration-test-token', ...(init.headers || {}) } });

it('serves the public discovery routes with the live config hash, and CORS for the page only', async () => {
  for (const path of ['/pool/policies', '/pool/config', '/pool/status', '/pool/research/campaign-queue', '/pool/peer/rooms/reploid-default/summary']) {
    const response = await fromPage(path);
    expect(response.status, path).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://replo.id');
  }
  expect((await (await fromPage('/pool/policies')).json()).configHash).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect((await fromPage('/pool/status', { headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  const scripted = await api('/pool/status');
  expect(scripted.status).toBe(200);
  expect(scripted.headers.get('Access-Control-Allow-Origin')).toBeNull();
  const preflight = await fromPage('/pool/jobs', { method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'POST' } });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('X-Reploid-Client-Id');
  expect((await fromPage('/elsewhere')).status).toBe(404);
});

it('keeps every protected route behind its own check', async () => {
  expect((await fromPage('/pool/metrics')).status).toBe(401);
  expect((await fromPage('/api/retrieval/status')).status).toBe(401);
  expect((await fromPage('/pool/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(401);
  expect((await fromPage('/pool/metrics', { headers: { Authorization: 'Bearer not-a-firebase-token' } })).status).toBe(401);
  const zero = await fromPage('/zero/gemini', { method: 'POST', headers: { Authorization: 'Bearer x' } });
  expect(zero.status).toBe(401);
  expect(zero.headers.get('Access-Control-Allow-Origin')).toBe('https://replo.id');
  expect((await (await fromPage('/pool/deployment/check')).json()).store.mode).toBe('durable-object-sqlite');
});

it('relays /pool/rtc-config to the one TURN issuer with the caller token', async () => {
  const response = await fromPage('/pool/rtc-config', { headers: { Authorization: 'Bearer caller-token' } });
  expect(response.status).toBe(200);
  expect((await response.json()).forwarded).toEqual({ url: 'https://reploid-swarm/rtc-config', origin: 'https://replo.id', authorization: 'Bearer caller-token' });
  expect((await fromPage('/pool/rtc-config')).status).toBe(401);
});

it('imports Firestore documents only with the migration token, and the routes read them', async () => {
  const documents = [
    { path: 'research_records/r1', data: { recordHash: 'r1', roomId: 'reploid-default', kind: 'note', createdAt: '2026-11-01T00:00:00.000Z' } },
    { path: 'rate_limits/stale', data: { expiresAt: '2026-01-01T00:00:00.000Z' } }
  ];
  expect((await api('/admin/import', { method: 'POST', body: JSON.stringify({ documents }) })).status).toBe(401);
  const imported = await admin('/admin/import', { method: 'POST', body: JSON.stringify({ documents }) });
  expect(await imported.json()).toEqual({ imported: 2 });
  // Earlier requests in this file left live rate-limit windows behind; count only what this test owns.
  const paths = async (parent) => (await (await admin(`/admin/export?parent=${parent}`)).json()).documents.map(entry => entry.path);
  expect((await (await admin('/admin/inventory')).json()).collections).toContainEqual({ parent: 'research_records', count: 1 });
  expect(await paths('rate_limits')).toContain('rate_limits/stale');
  const exported = await (await admin('/admin/export?parent=research_records')).json();
  expect(exported.documents[0]).toEqual(documents[0]);
  const stub = env.COORDINATOR.getByName('coordinator');
  await runInDurableObject(stub, async (instance) => { expect(instance.firestore.inventory().map(entry => entry.parent)).toContain('research_records'); });
  expect(await runDurableObjectAlarm(stub)).toBe(true);
  expect(await paths('rate_limits')).not.toContain('rate_limits/stale');
  expect(await paths('research_records')).toEqual(['research_records/r1']);
});

it('accepts a landing-attribution count from the page origin only', async () => {
  const send = (origin, site) => api('/api/landing-attribution', { method: 'POST', body: '{"v":"zAAz"}',
    headers: { Origin: origin, 'Sec-Fetch-Site': site, 'Content-Type': 'application/json' } });
  expect((await send('https://replo.id', 'cross-site')).status).toBe(204);
  expect((await send('https://reploid.web.app', 'cross-site')).status).toBe(403);
});
