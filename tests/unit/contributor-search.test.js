import { afterEach, expect, it, vi } from 'vitest';
import { createWebAccessNetwork } from '../../packages/reploid/src/mesh/web-access-network.js';
import { createPublicWebWorker } from '../../server/public-web-worker.js';
import { createContributorSearch } from '../../self/host/contributor-search.js';
import { createRetrieval } from '../../packages/reploid/src/retrieval/index.js';
import { createSearchPermission, searchPermissionWording, validateSearchPermission } from '../../packages/reploid/src/chat/search-permission.js';

const owned = [];
afterEach(async () => { await Promise.all(owned.splice(0).map(owner => owner.close())); });
const page = (body, url = 'https://example.org/article', contentType = 'text/html') => ({
  body: new TextEncoder().encode(body), url, status: 200, contentType
});
function workerPorts() {
  const searchFetch = vi.fn(async () => page('<rss><channel><item><title>Bridge &amp; tower</title><link>https://example.org/article</link><description>Opened in 1889.</description></item></channel></rss>'));
  const pageFetch = vi.fn(async () => page('<html><head><title>Original title</title></head><body><main>The tower opened in 1889.</main></body></html>'));
  return { searchFetch, pageFetch };
}
function pair(worker, { enabled = () => true, verify = async peer => `identity:${peer}` } = {}) {
  const handlers = { a: new Map(), b: new Map() }, connected = new Set(['a', 'b']), messages = [];
  const transport = id => ({
    getConnectedPeers: () => [...connected].filter(peer => peer !== id).map(id => ({ id })),
    onMessage: (type, fn) => handlers[id].set(type, fn),
    sendToPeer(peer, type, payload) {
      if (!connected.has(peer)) return false;
      messages.push({ from: id, peer, type, payload: structuredClone(payload) });
      queueMicrotask(() => handlers[peer].get(type)?.(id, structuredClone(payload))); return true;
    }
  });
  const a = createWebAccessNetwork({ transport: transport('a'), verifyPeer: verify });
  const b = createWebAccessNetwork({ transport: transport('b'), verifyPeer: verify, worker, enabled });
  owned.push(a, b); b.refresh();
  return { a, b, handlers, connected, messages };
}

it('searches and extracts over the peer channel, retaining fetched-page provenance and contributor supply', async () => {
  const ports = workerPorts(), { a } = pair(createPublicWebWorker(ports));
  await vi.waitFor(() => expect(a.getOffers()).toHaveLength(1));
  const service = createContributorSearch({ network: () => a, service: 'bing' });
  const retrieval = createRetrieval(service), query = 'When did the tower open?';
  const record = await retrieval.retrieve(retrieval.pending(retrieval.request({}, query), Date.now()));
  expect(record.outcome).toBe('retrieved');
  expect(record.provider.supply).toBe('contributor');
  expect(record.sources[0]).toMatchObject({ title: 'Original title', url: 'https://example.org/article', passage: 'The tower opened in 1889.' });
  expect(ports.searchFetch).toHaveBeenCalledOnce(); expect(ports.pageFetch).toHaveBeenCalledOnce();
});

it('requires the named search contributor in the permission independently of execution recipients', () => {
  const grant = createSearchPermission({ id: 'grant', networkId: 'mesh', threadId: 'thread', searchProvider: 'contributor-bing',
    searchPeer: 'identity:b', query: 'query', recipients: ['model-provider'], wording: searchPermissionWording('contributor-bing'), grantedAt: 1 });
  expect(validateSearchPermission(grant)).toEqual(grant);
  expect(() => validateSearchPermission({ ...grant, searchPeer: null })).toThrow();
});

it('refuses a different contributor after retrieval is prepared, without sending the query', async () => {
  let enabled = true;
  const ports = workerPorts(), { a, b } = pair(createPublicWebWorker(ports), { enabled: () => enabled });
  await vi.waitFor(() => expect(a.getOffers()).toHaveLength(1));
  const service = createContributorSearch({ network: () => a, service: 'bing' }), retrieval = createRetrieval(service);
  const record = retrieval.pending(retrieval.request({}, 'Question'), Date.now());
  enabled = false; b.refresh();
  await vi.waitFor(() => expect(a.getOffers()).toHaveLength(0));
  const result = await retrieval.retrieve(record);
  expect(result.outcome).toBe('failed');
  expect(ports.searchFetch).not.toHaveBeenCalled();
});

it('binds extracted URLs, queries and requester identity to returned results; expired grants refuse', async () => {
  let now = 1000;
  const ports = workerPorts(), worker = createPublicWebWorker({ ...ports, now: () => now });
  const { results: [source] } = await worker.search({ query: 'tower', maxResults: 1 }, { requester: 'a' });
  for (const [changed, requester, query] of [[{ ...source, url: 'http://localhost/' }, 'a', 'tower'], [source, 'b', 'tower'], [source, 'a', 'different']]) {
    await expect(worker.extract({ source: changed, query, maxCharacters: 100 }, { requester })).rejects.toThrow('authorized');
  }
  now += 60001;
  await expect(worker.extract({ source, query: 'tower', maxCharacters: 100 }, { requester: 'a' })).rejects.toThrow('authorized');
  expect(ports.pageFetch).not.toHaveBeenCalled();
});

it('cancels the worker, refuses replay and never accepts another peer response', async () => {
  let entered, cancelled = false;
  const began = new Promise(resolve => { entered = resolve; });
  const worker = { service: 'bing', version: '1', search: vi.fn((args, { signal }) => new Promise((resolve, reject) => {
    entered(); signal.addEventListener('abort', () => { cancelled = true; reject(signal.reason); }, { once: true });
  })) };
  const { a, handlers, messages } = pair(worker);
  await vi.waitFor(() => expect(a.getOffers()).toHaveLength(1));
  const controller = new AbortController();
  const result = a.request(a.getOffers()[0], 'search', { query: 'question', maxResults: 1 }, controller.signal);
  const rejected = expect(result).rejects.toThrow(); await began;
  const request = messages.find(message => message.type === 'reploid:web-request').payload;
  handlers.a.get('reploid:web-response')('intruder', { requestId: request.requestId, result: 'forged' });
  controller.abort(new Error('Stopped')); await rejected;
  await vi.waitFor(() => expect(cancelled).toBe(true));
  handlers.b.get('reploid:web-request')('a', request);
  expect(worker.search).toHaveBeenCalledOnce();
});

it('routes browser Google results under the exact service and rejects a changed service from the same peer', async () => {
  const ports = workerPorts(), worker = createPublicWebWorker({ ...ports, service: 'google-browser' });
  const { a, handlers } = pair(worker);
  await vi.waitFor(() => expect(a.getOffers()).toHaveLength(1));
  const service = createContributorSearch({ network: () => a });
  expect(service.provider.searchProvider).toBe('contributor-google-browser');
  const offer = a.getOffers()[0], providerId = service.provider.id;
  const grant = createSearchPermission({ id: 'g', networkId: 'n', threadId: 't', searchProvider: service.provider.searchProvider,
    searchPeer: offer.participantId, query: 'tower', recipients: [], wording: searchPermissionWording(service.provider.searchProvider), grantedAt: 1 });
  expect(grant.searchPeer).toBe(offer.participantId);
  expect(() => validateSearchPermission({ ...grant, searchPeer: null })).toThrow();
  const retrieval = createRetrieval(service);
  expect((await retrieval.retrieve(retrieval.pending(retrieval.request({}, 'tower'), Date.now()))).outcome).toBe('retrieved');
  handlers.a.get('reploid:web-offer')('b', { service: 'bing', version: '1' });
  await vi.waitFor(() => expect(a.getOffers()[0].service).toBe('bing'));
  await expect(a.request(offer, 'search', { query: 'tower', maxResults: 1 })).rejects.toThrow('changed');
  await expect(service.provider.search('tower', { maxResults: 1 }, undefined, { providerId })).rejects.toThrow('changed');
});

it('waits for the selected browser service after reload instead of silently using legacy RSS', () => {
  let offers = [{ service: 'bing', version: '1', participantId: 'legacy' }];
  const service = createContributorSearch({ network: () => ({ getOffers: () => offers }) });
  expect(service.available()).toBe(false);
  offers.push({ service: 'google-browser', version: '1', participantId: 'browser' });
  expect(service.available()).toBe(true); expect(service.provider.searchPeer).toBe('browser');
  offers = [offers[0]]; expect(service.available()).toBe(false);
});
