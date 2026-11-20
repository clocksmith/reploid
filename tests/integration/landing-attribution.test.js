// @vitest-environment node
import { createHash } from 'node:crypto';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountLandingAttribution } from '../../server/landing-attribution.js';

const endpoint = '/api/landing-attribution';
const code = 'K7pu';
const body = JSON.stringify({ v: code });
const origin = 'https://replo.id';
let server, base, time, write;
beforeEach(async () => {
  time = 0;
  write = vi.fn();
  const app = express();
  mountLandingAttribution(app, { write, now: () => time });
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise(resolve => server.close(resolve));
});
function send({ path = endpoint, method = 'POST', data = body, headers = {} } = {}) {
  return fetch(base + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: data } : {}) });
}

describe('landing attribution endpoint', () => {
  it('records one fixed-schema digest event and exposes no public read', async () => {
    const reply = await send({ headers: { 'Sec-Fetch-Site': 'same-origin',
      Cookie: 'never-log-cookie', 'User-Agent': 'never-log-UA', 'X-Forwarded-For': '192.0.2.1', Referer: 'https://replo.id/?v=' + code } });
    expect(reply.status).toBe(204);
    expect(reply.headers.get('cache-control')).toBe('no-store');
    expect(reply.headers.get('access-control-allow-origin')).toBeNull();
    expect(write).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'reploid_landing_attribution_v1',
      ref: createHash('sha256').update(code).digest('hex') }));
    expect((await send({ method: 'GET' })).status).toBe(405);
  });

  it('rejects other origins, metadata, ambiguous or oversized input and honors opt-outs', async () => {
    expect((await send({ headers: { Origin: 'https://example.test' } })).status).toBe(403);
    expect((await send({ headers: { 'Sec-Fetch-Site': 'cross-site' } })).status).toBe(403);
    expect((await send({ path: endpoint + '?v=' + code })).status).toBe(400);
    expect((await send({ data: '{"v":"' + code + '","v":"' + code + '"}' })).status).toBe(400);
    expect((await send({ data: JSON.stringify({ v: code, email: 'ignored@example.test' }) })).status).toBe(400);
    expect((await send({ data: JSON.stringify({ v: 'x'.repeat(100) }) })).status).toBe(413);
    expect((await send({ headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
    expect((await send({ headers: { 'Sec-GPC': '1' } })).status).toBe(204);
    expect((await send({ headers: { DNT: '1' } })).status).toBe(204);
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps valid leading-z tests out of the ordinary aggregate and rejects a bad checksum', async () => {
    const testTag = 'zAAz';
    expect((await send({ data: JSON.stringify({ v: testTag }) })).status).toBe(204);
    expect(write).toHaveBeenCalledExactlyOnceWith(JSON.stringify({ event: 'reploid_landing_attribution_test_v1',
      ref: createHash('sha256').update(testTag).digest('hex') }));
    expect((await send({ data: JSON.stringify({ v: 'K7pv' }) })).status).toBe(400);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('caps accepted logs in one minute across tokens, then resets', async () => {
    const result = await Promise.all(Array.from({ length: 32 }, () => send()));
    expect(result.filter(reply => reply.status === 204)).toHaveLength(30);
    expect(result.filter(reply => reply.status === 429)).toHaveLength(2);
    expect(write).toHaveBeenCalledTimes(30);
    time += 60_000;
    expect((await send()).status).toBe(204);
  });
});
