import express from 'express';
import nodeFetch from 'node-fetch';
import { afterEach, describe, expect, it } from 'vitest';
import { installJsonBodyMiddleware } from '../../server/json-body-middleware.js';
import createPoolRouter from '../../server/pool/routes.js';
import { createPoolStore } from '../../server/pool/store.js';
import production from '../../deploy/env.production.json' with { type: 'json' };

const servers = [];
async function start(options = {}) {
  const app = express();
  installJsonBodyMiddleware(app, { poolBackendOnly: true, ...options });
  app.use('/pool', createPoolRouter({ store: createPoolStore(), allowUnauthenticatedLocal: true }));
  app.post('/other', (req, res) => res.json({ parsed: true }));
  app.post('/change-control/github/webhooks', (req, res) => res.json({ raw: req.rawBody.toString() }));
  app.use((error, req, res, next) => res.status(error.status || 500).json({ error: error.message }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  servers.push(server);
  return `http://127.0.0.1:${server.address().port}`;
}
const post = (url, body) => nodeFetch(url, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body
});
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))));
});

describe('hosted JSON ingress and research record admission', () => {
  it('delivers a quorum-sized request to signature validation while retaining the general Pool limit', async () => {
    const base = await start({
      poolJsonLimit: production.runtimeEnv.POOL_JSON_LIMIT,
      poolResearchJsonLimit: production.runtimeEnv.POOL_RESEARCH_JSON_LIMIT
    });
    const body = JSON.stringify({ record: { evidence: 'x'.repeat(620_000) } });
    const research = await post(`${base}/pool/research/records`, body);
    expect(research.status).toBe(400);
    expect((await research.json()).error).toBe('invalid research record');
    expect((await post(`${base}/other`, body)).status).toBe(413);
  });

  it('retains the research record bound and bounds the whole HTTP envelope', async () => {
    const base = await start();
    const tooLarge = await post(`${base}/pool/research/records`, JSON.stringify({ record: { evidence: 'x'.repeat(1_000_000) } }));
    expect(tooLarge.status).toBe(413);
    expect((await tooLarge.json()).error).toBe('research record exceeds the maximum size');
    const envelope = await post(`${base}/pool/research/records`, JSON.stringify({ padding: 'x'.repeat(1_100_000), record: {} }));
    expect(envelope.status).toBe(413);
  });

  it('preserves explicit ingress limits and exact GitHub webhook bytes', async () => {
    const base = await start({ poolJsonLimit: '64kb' });
    expect((await post(`${base}/pool/research/records`, JSON.stringify({ record: 'x'.repeat(100_000) }))).status).toBe(413);
    const body = '{ "event": "push", "number": 1 }';
    const webhook = await post(`${base}/change-control/github/webhooks`, body);
    expect(webhook.status).toBe(200);
    expect((await webhook.json()).raw).toBe(body);
  });
});
