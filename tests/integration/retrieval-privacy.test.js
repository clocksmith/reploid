// @vitest-environment node
import http from 'node:http';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { createServerSearch } from '../../apps/poolday/host/server-search.js';
import { createBraveSearch } from '../../server/search/brave.js';
import { createPageFetcher } from '../../server/search/page-fetch.js';
import { createSearchRouter } from '../../server/search/router.js';
import { createSearchUsage } from '../../server/search/usage.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createExecutionPolicy } from '../../packages/reploid/src/chat/execution-policy.js';
const cleanup = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function listen(handler) {
  const server = http.createServer(handler); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
async function fixture({ qualified = true, authorize = () => null } = {}) {
  const apiQueries = [], pageRequests = [], forbiddenRequests = [], browserRequests = [];
  const forbidden = await listen((req, res) => { forbiddenRequests.push(req.url); res.end('<p>Must not receive a request.</p>'); });
  const pages = await listen((req, res) => {
    pageRequests.push(req.url);
    if (req.url.startsWith('/redirect')) { res.writeHead(302, { location: forbidden + '/blocked' }); res.end(); return; }
    if (req.url === '/same-origin') { res.writeHead(302, { location: '/document' }); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html><title>Evidence</title><p>The Eiffel Tower was completed in 1889.</p></html>');
  });
  let resultPath = '/document';
  const upstream = await listen((req, res) => { apiQueries.push(new URL(req.url, 'http://fixture').searchParams.get('q'));
    if (req.url.startsWith('/redirect-api')) { res.writeHead(307, { location: forbidden + '/api' }); res.end(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ web: { results: [{ url: pages + resultPath, title: 'Evidence', description: 'Tower completed in 1889.' }] } }));
  });
  const app = express(), baseUrl = await listen(app);
  const search = createBraveSearch({ apiKey: 'synthetic-local-fixture-key', endpoint: upstream + '/search', qps: 1000 });
  app.use('/api/retrieval', createSearchRouter({ search, fetcher: createPageFetcher({ allowPrivateAddresses: true }),
    usage: createSearchUsage({ maxQueriesPerDay: 50 }), fetchSecret: 'synthetic-fetch-token-key-0123456789', publicOrigin: qualified ? baseUrl : null }));
  const fetchImpl = async (url, init) => { browserRequests.push({ url, ...(init.body ? { body: JSON.parse(init.body) } : {}) }); return fetch(url, init); };
  const ports = createServerSearch({ baseUrl, upstreamOrigin: upstream, fetch: fetchImpl, authorization: authorize });
  await ports.refresh();
  const execute = vi.fn(async request => ({ threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id,
    modelIdentity: request.model.identity, adapterIdentities: [], content: 'The Eiffel Tower was completed in 1889 [1].' }));
  function workspace(privacy) {
    const store = { load() {}, save() {} };
    const app = createChatWorkspace({ meshId: 'fixture', participantId: 'local', store, execute, retrieval: { provider: ports.provider, extractor: ports.extractor } });
    cleanup.push(() => app.close());
    const thread = app.createThread({ model: { id: 'fixture', name: 'Fixture', identity: 'sha256:' + 'a'.repeat(64) }, ...(privacy ? { privacy } : {}) });
    return { app, thread, send: () => app.send(thread, 'private fixture query', { retrieval: {} }) };
  }
  return { baseUrl, upstream, pages, forbidden, ports, execute, apiQueries, pageRequests, forbiddenRequests, browserRequests, workspace,
    resultPath(value) { resultPath = value; } };
}
it.each(['provider-visible', 'restricted'])('completes %s retrieval through actual HTTP ports with every recipient bound', async profile => {
  const f = await fixture();
  const privacy = createExecutionPolicy(profile, profile === 'restricted' ? { placement: 'network-allowed', allowedRecipients: [f.baseUrl, f.upstream, f.pages] } : {});
  const result = await f.workspace(privacy).send();
  expect(result.status, result.error).toBe('completed'); expect(f.execute).toHaveBeenCalledOnce();
  expect(f.apiQueries).toEqual(['private fixture query']); expect(f.pageRequests).toEqual(['/document']);
  expect(result.auxiliaryBindings.map(row => row.path.operation).sort()).toEqual(['extract', 'search']);
  expect(result.auxiliaryBindings.every(row => row.path.complete && row.path.requestId === result.id)).toBe(true);
  expect(new Set(result.auxiliaryBindings.flatMap(row => row.path.hops.map(hop => hop.recipient)))).toEqual(new Set([f.baseUrl, f.upstream, f.pages]));
  expect(JSON.stringify(result.auxiliaryBindings)).not.toContain('private fixture query');
  for (const request of f.browserRequests.filter(row => row.body?.query)) expect(request.body.auxiliaryBinding.policy).toEqual(privacy);
});
it('rejects a missing search recipient or local-only policy before sending a query', async () => {
  const f = await fixture();
  for (const privacy of [createExecutionPolicy('restricted'), createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [f.baseUrl] })]) {
    expect((await f.workspace(privacy).send()).status).toBe('failed');
  }
  expect(f.apiQueries).toEqual([]); expect(f.browserRequests.filter(row => row.body?.query)).toEqual([]);
});
it('checks each result origin before extraction and prevents cross-origin redirect disclosure', async () => {
  const f = await fixture();
  const searchOnly = createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [f.baseUrl, f.upstream] });
  expect((await f.workspace(searchOnly).send()).status).toBe('failed');
  expect(f.pageRequests).toEqual([]); expect(f.browserRequests.filter(row => row.url.endsWith('/extract'))).toEqual([]);
  f.resultPath('/redirect');
  const complete = createExecutionPolicy('restricted', { placement: 'network-allowed', allowedRecipients: [f.baseUrl, f.upstream, f.pages] });
  expect((await f.workspace(complete).send()).status).toBe('failed');
  expect(f.pageRequests).toEqual(['/redirect']); expect(f.forbiddenRequests).toEqual([]);
  f.resultPath('/same-origin');
  expect((await f.workspace(complete).send()).status).toBe('completed');
});
it('does not qualify legacy status, while preserving legacy unrestricted search', async () => {
  const f = await fixture({ qualified: false });
  expect((await f.workspace(createExecutionPolicy()).send()).status).toBe('failed'); expect(f.apiQueries).toEqual([]);
  expect((await f.workspace(null).send()).status).toBe('completed'); expect(f.apiQueries).toHaveLength(1);
  expect(f.browserRequests.filter(row => row.body?.query).every(row => row.body.auxiliaryBinding === undefined)).toBe(true);
});
it('rechecks cancellation after async credentials and refuses altered server bindings before upstream work', async () => {
  let gate = null, entered;
  const f = await fixture({ authorize: () => { if (gate) { entered(); return gate.promise; } return null; } });
  const w = f.workspace(createExecutionPolicy()), awaiting = Promise.withResolvers();
  gate = Promise.withResolvers(); entered = awaiting.resolve;
  const pending = w.send(); await awaiting.promise; await w.app.cancel(w.thread); gate.resolve(null);
  expect((await pending).status).toBe('cancelled'); expect(f.apiQueries).toEqual([]);
  gate = null;
  const valid = await f.workspace(createExecutionPolicy()).send(); expect(valid.status).toBe('completed');
  const original = f.browserRequests.find(row => row.url.endsWith('/search') && row.body?.auxiliaryBinding).body;
  for (const change of [body => { body.auxiliaryBinding.path.hops.pop(); }, body => { body.auxiliaryBinding.policy.publication = true; },
    body => { body.answer = 'another-attempt'; }, body => { body.auxiliaryBinding.policyId = 'sha256:' + 'f'.repeat(64); }]) {
    const body = structuredClone(original); change(body);
    const response = await fetch(f.baseUrl + '/api/retrieval/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(403);
  }
  expect(f.apiQueries).toHaveLength(1);
});
it('does not follow a search API redirect with the query or subscription credential', async () => {
  const f = await fixture();
  const search = createBraveSearch({ apiKey: 'synthetic-local-fixture-key', endpoint: f.upstream + '/redirect-api', qps: 1000 });
  await expect(search.search({ query: 'private query', count: 1 })).rejects.toThrow();
  expect(f.forbiddenRequests).toEqual([]);
});

it('snapshots installed endpoint objects instead of allowing a later URL mutation to reroute queries', async () => {
  const f = await fixture(), endpoint = new URL(f.upstream + '/search');
  const search = createBraveSearch({ apiKey: 'synthetic-local-fixture-key', endpoint, qps: 1000 });
  endpoint.href = f.forbidden + '/rerouted';
  await search.search({ query: 'immutable endpoint', count: 1 });
  expect(search.disclosureOrigin).toBe(f.upstream); expect(f.apiQueries).toEqual(['immutable endpoint']); expect(f.forbiddenRequests).toEqual([]);
});
