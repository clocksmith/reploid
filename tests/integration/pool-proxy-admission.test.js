// @vitest-environment node
import http from 'node:http';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import { createPoolRouter } from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';

const servers = [];
async function listen(handler) {
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
  for (const server of servers.splice(0).reverse()) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
async function host({ trustProxy = false, allowUnauthenticatedLocal = false } = {}) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use(express.json());
  const store = createPoolStore(), keys = [], consume = store.consumeRateLimit;
  store.consumeRateLimit = input => {
    keys.push(JSON.parse(input.key));
    return consume.call(store, input);
  };
  app.use('/pool', createPoolRouter({ store, allowUnauthenticatedLocal, verifyAuthToken: async () => ({ uid: 'alice' }) }));
  return { url: await listen(app), keys };
}
const post = (url, headers) => fetch(`${url}/pool/jobs`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}'
});

describe('Pool HTTP trusted-address admission', () => {
  it('ignores spoofed forwarding and client labels when no proxy is trusted', async () => {
    const { url, keys } = await host();
    for (const address of ['203.0.113.1', '198.51.100.2']) {
      const response = await fetch(`${url}/pool/status`, { headers: {
        'x-forwarded-for': address, forwarded: `for=${address}`, 'x-reploid-client-id': address
      } });
      expect(response.status).toBe(200);
    }
    expect(keys[0]).toEqual(keys[1]);
    expect(keys[0][1]).toMatch(/127\.0\.0\.1$/);
  });

  it('uses the nearest forwarded address for one trusted hop, not a forged earlier hop', async () => {
    const { url, keys } = await host({ trustProxy: 1, allowUnauthenticatedLocal: true });
    for (const forged of ['127.0.0.1', '198.51.100.9']) {
      expect((await post(url, { 'x-forwarded-for': `${forged}, 203.0.113.8` })).status).toBe(401);
    }
    expect(keys[0]).toEqual(['address', '203.0.113.8', 'control']);
    expect(keys[1]).toEqual(keys[0]);
  });

  it('handles the configured two-hop path without trusting the caller prefix', async () => {
    const { url, keys } = await host({ trustProxy: 2 });
    await fetch(`${url}/pool/status`, { headers: { 'x-forwarded-for': '127.0.0.1, 203.0.113.8, 192.0.2.5' } });
    expect(keys[0]).toEqual(['address', '203.0.113.8', 'control']);
  });

  it('uses a real proxy that overwrites client forwarding headers', async () => {
    const backend = await host({ trustProxy: 1 });
    const proxy = await listen((req, res) => {
      const upstream = http.request(`${backend.url}${req.url}`, {
        method: req.method,
        headers: { ...req.headers, 'x-forwarded-for': req.socket.remoteAddress }
      }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
      upstream.on('error', () => { res.writeHead(502); res.end(); });
      req.pipe(upstream);
    });
    expect((await fetch(`${proxy}/pool/status`, { headers: { 'x-forwarded-for': '203.0.113.99' } })).status).toBe(200);
    expect(backend.keys[0][1]).toMatch(/127\.0\.0\.1$/);
  });

  it('makes the numeric-hop deployment assumption explicit: a direct bypass can supply the trusted address', async () => {
    // Numeric trust is safe only when ingress prevents shorter/direct paths and
    // the trusted proxy overwrites forwarding headers. This is not attestation.
    const { url, keys } = await host({ trustProxy: 1 });
    await fetch(`${url}/pool/status`, { headers: { 'x-forwarded-for': '203.0.113.99' } });
    expect(keys[0]).toEqual(['address', '203.0.113.99', 'control']);
    // Even a spoofed loopback does not bypass authentication unless the operator
    // explicitly enabled the separate local-development exception.
    expect((await post(url, { 'x-forwarded-for': '127.0.0.1' })).status).toBe(401);
  });
});
