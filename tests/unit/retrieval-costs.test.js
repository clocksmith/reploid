// @vitest-environment node
// REP-8 per-answer costs: retrieval (search queries and page fetches), verification (support checks and entailment
// reviews) and fallback stay separate entries in the retrieval record, priced only from explicit configuration, and the
// server usage log keys each row by answer and category so economics can sum them. The Brave adapter, page fetches and
// the reviewer endpoint are injected; the /api/retrieval router is served on loopback in this process. No network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { createRetrieval, createFixedSearchProvider, createModelSupportReviewer, createSupportReviewPacket, renderSourceContext,
  retrievalCostRecord, withReviewCosts, withVerification } from '../../packages/reploid/src/retrieval/index.js';
import { createChatWorkspace } from '../../packages/reploid/src/chat/workspace.js';
import { createSearchRouter } from '../../server/search/router.js';
import { answerCostTotals, createSearchUsage } from '../../server/search/usage.js';
import { readSearchConfig } from '../../server/search/config.js';
import { createConfiguredSupportReviewer, readSupportReviewerConfig } from '../../server/search/support-reviewer.js';
import { createServerSearch } from '../../self/host/server-search.js';

const SECRET = 'cost-test-secret-0123456789abcdef', AT = 1760500000000;
const PAGES = {
  'https://www.example.org/eiffel': '<html><head><title>Eiffel Tower</title></head><body><main><p>The Eiffel Tower was completed in 1889.</p></main></body></html>',
  'https://encyclopedia.example.net/louvre': '<html><head><title>Louvre</title></head><body><main><p>The Louvre is the most visited art museum.</p></main></body></html>'
};
const QUESTION = 'When was the Eiffel Tower completed and which museum is most visited?';
const ANSWER = 'The Eiffel Tower was completed in 1889 [1]. The Louvre is the most visited art museum [2].';
const GENERATOR = { modelId: 'qwen3.5-0.8b', modelIdentity: 'sha256:' + 'a'.repeat(64) };
const REVIEWER_ENV = { REPLOID_SUPPORT_REVIEWER_ENDPOINT: 'https://models.example/v1/chat/completions', REPLOID_SUPPORT_REVIEWER_PROVIDER: 'example',
  REPLOID_SUPPORT_REVIEWER_MODEL: 'reviewer-large', REPLOID_SUPPORT_REVIEWER_STRONGER_THAN: 'qwen3.5-0.8b', REPLOID_SUPPORT_REVIEWER_API_KEY: 'reviewer-key' };
const JUDGMENTS = '{"judgments":[{"claim":"claim-1","verdict":"supported","basis":"States the year.","spans":[{"source":1,"quote":"completed in 1889"}]},'
  + '{"claim":"claim-2","verdict":"supported","basis":"States it.","spans":[{"source":2,"quote":"most visited art museum"}]}]}';

const servers = [];
afterEach(async () => { for (const server of servers.splice(0)) await new Promise(resolve => server.close(resolve)); });

/** The real /api/retrieval router on loopback, a stand-in Brave adapter and page fetcher, and the usage log rows it writes. */
async function serverRoute({ costMicroUsd = 5000, fetchMicroUsdPerGb = null, failUrl = null } = {}) {
  const rows = [];
  const usage = createSearchUsage({ now: () => AT, maxQueriesPerDay: 10, logPath: 'usage.jsonl',
    appendFile: async (path, line) => { rows.push(JSON.parse(line)); } });
  const search = { kind: 'brave', search: vi.fn(async ({ count }) => ({ results: Object.keys(PAGES).slice(0, count)
    .map(url => ({ url, title: 'Search title', excerpt: 'Search snippet' })),
  usage: { provider: 'brave', requests: 1, billable: true, costMicroUsd, rateLimit: null } })) };
  const fetcher = { timeoutMs: 1000, fetchPage: async url => {
    if (url === failUrl) throw Object.assign(new Error('http-error'), { code: 'http-error', status: 404 });
    const body = Buffer.from(PAGES[url]);
    return { url, status: 200, contentType: 'text/html; charset=utf-8', charset: 'utf-8', bytes: body.length, byteSha256: 'sha256:' + 'b'.repeat(64), body };
  } };
  const app = express();
  app.use('/api/retrieval', createSearchRouter({ search, fetcher, usage, fetchSecret: SECRET, now: () => AT, fetchMicroUsdPerGb }));
  const server = app.listen(0, '127.0.0.1'); servers.push(server);
  await new Promise(resolve => server.once('listening', resolve));
  const port = createServerSearch({ baseUrl: `http://127.0.0.1:${server.address().port}`, fetch: (url, init) => globalThis.fetch(url, init) });
  return { port, rows, usage, search };
}
async function retrieveThrough(port, answer) {
  const retrieval = createRetrieval({ provider: port.provider, extractor: port.extractor, now: () => AT });
  const record = await retrieval.retrieve(retrieval.pending(retrieval.request({ limits: { maxResults: 2 } }, QUESTION), AT), null, { answer });
  return { retrieval, record };
}
async function packetFor(retrieval, record) {
  const verification = await retrieval.verify(ANSWER, record, null);
  return createSupportReviewPacket({ id: 'support-001', question: QUESTION, answer: ANSWER, record, claimSupport: verification.claimSupport });
}

describe('separate per-answer cost entries', () => {
  it('records Brave queries and priced fetches, a priced stronger-model review and no fallback, each separately', async () => {
    const { port, rows } = await serverRoute({ costMicroUsd: 5000, fetchMicroUsdPerGb: 90_000_000 });
    const { retrieval, record } = await retrieveThrough(port, 'attempt-1');
    expect(record.outcome).toBe('retrieved');
    const bytes = Object.values(PAGES).map(html => Buffer.byteLength(html)), fetchCosts = bytes.map(size => Math.round(size * 90_000_000 / 1e9));
    expect(record.costs.retrieval).toEqual({ bearer: 'operator', search: { service: 'brave', requests: 1, costMicroUsd: 5000 },
      extraction: { attempted: 2, documents: 2, failed: 0, bytes: bytes[0] + bytes[1], costMicroUsd: fetchCosts[0] + fetchCosts[1] },
      costMicroUsd: 5000 + fetchCosts[0] + fetchCosts[1] });
    expect(record.costs.verification).toEqual({ checker: null, reviews: [], costMicroUsd: 0 });
    expect(record.costs.fallback).toEqual({ path: 'none', costMicroUsd: 0 });

    // Deterministic verification adds no priced work; the configured reviewer adds its tokens at its configured price.
    const verified = withVerification(record, await retrieval.verify(ANSWER, record, null));
    expect(verified.costs.verification).toEqual({ checker: null, reviews: [], costMicroUsd: 0 });
    const usage = createSearchUsage({ now: () => AT, maxQueriesPerDay: 1, logPath: 'usage.jsonl', appendFile: async (path, line) => { rows.push(JSON.parse(line)); } });
    const reviewer = createConfiguredSupportReviewer({ usage, env: { ...REVIEWER_ENV, REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_INPUT_TOKENS: '3',
      REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_OUTPUT_TOKENS: '15' },
    fetch: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JUDGMENTS } }], usage: { prompt_tokens: 1200, completion_tokens: 300 } }) }) });
    const judgments = await reviewer.review(await packetFor(retrieval, record), { generator: GENERATOR, answer: 'attempt-1' });
    const price = { inputMicroUsdPerMillionTokens: 3_000_000, outputMicroUsdPerMillionTokens: 15_000_000 };
    expect(judgments.usage).toEqual({ inputTokens: 1200, outputTokens: 300, price, costMicroUsd: 3600 + 4500 });
    const reviewed = withReviewCosts(verified, [judgments]);
    expect(reviewed.costs.verification).toEqual({ checker: null, costMicroUsd: 8100,
      reviews: [{ kind: 'model', packet: 'support-001', reviewer: 'example/reviewer-large', inputTokens: 1200, outputTokens: 300, price, costMicroUsd: 8100 }] });
    expect(reviewed.costs).toMatchObject({ schema: 'reploid.retrieval-costs/v1', unit: 'micro-usd', fallback: { path: 'none', costMicroUsd: 0 },
      totalMicroUsd: record.costs.retrieval.costMicroUsd + 8100, unknown: [] });
    // A reviewer's later file for the same packet replaces its earlier entry rather than double counting.
    expect(withReviewCosts(reviewed, [judgments]).costs.verification.reviews).toHaveLength(1);

    // The usage log keys every row by answer and category, so per-answer sums match the record.
    expect(rows.map(row => [row.kind, row.category, row.answer, row.costMicroUsd])).toEqual([
      ['query', 'retrieval', 'attempt-1', 5000], ['fetch', 'retrieval', 'attempt-1', fetchCosts[0]], ['fetch', 'retrieval', 'attempt-1', fetchCosts[1]],
      ['review', 'verification', 'attempt-1', 8100]]);
    expect(rows.at(-1)).toMatchObject({ reviewer: 'example/reviewer-large', inputTokens: 1200, outputTokens: 300 });
    expect(answerCostTotals(rows)).toEqual({ 'attempt-1': { retrieval: record.costs.retrieval.costMicroUsd, verification: 8100, fallback: 0,
      total: reviewed.costs.totalMicroUsd } });
    expect(JSON.stringify(rows)).not.toContain(QUESTION);
  });

  it('keeps unknown prices and unmeasured work unknown, never zero', async () => {
    const { port, rows } = await serverRoute({ costMicroUsd: null, fetchMicroUsdPerGb: null });
    const { retrieval, record } = await retrieveThrough(port, 'attempt-2');
    expect(record.costs.retrieval).toMatchObject({ search: { service: 'brave', requests: 1, costMicroUsd: null },
      extraction: { attempted: 2, documents: 2, failed: 0, costMicroUsd: null }, costMicroUsd: null });
    expect(record.costs).toMatchObject({ totalMicroUsd: null, unknown: ['retrieval.search', 'retrieval.extraction'] });
    expect(answerCostTotals(rows)['attempt-2']).toEqual({ retrieval: null, verification: 0, fallback: 0, total: null });

    // A failed fetch may have transferred bytes, so extraction stays unknown even when fetches are priced.
    const failing = await serverRoute({ fetchMicroUsdPerGb: 90_000_000, failUrl: 'https://encyclopedia.example.net/louvre' });
    const partial = (await retrieveThrough(failing.port, 'attempt-3')).record;
    expect(partial.costs.retrieval.extraction).toMatchObject({ attempted: 2, documents: 1, failed: 1, costMicroUsd: null });
    expect(answerCostTotals(failing.rows)['attempt-3'].retrieval).toBeNull();

    // An unpriced reviewer records its tokens and an unknown cost; human reviews are unpriced unless a cost is declared.
    const unpriced = createModelSupportReviewer({ identity: { provider: 'example', model: 'reviewer-large' }, strongerThan: ['qwen3.5-0.8b'],
      complete: async () => ({ text: JUDGMENTS, usage: { inputTokens: 1200, outputTokens: 300 } }) });
    const packet = await packetFor(retrieval, record);
    const modelReview = await unpriced.review(packet, { generator: GENERATOR });
    expect(modelReview.usage).toEqual({ inputTokens: 1200, outputTokens: 300, price: null, costMicroUsd: null });
    const human = (id, extra = {}) => ({ schema: 'reploid.claim-support-judgments/v1', packet: modelReview.packet, reviewer: { kind: 'human', id }, judgments: [], ...extra });
    const reviewed = withReviewCosts(record, [modelReview, human('reviewer-a'), human('reviewer-b', { declaredCostMicroUsd: 250000 })]);
    expect(reviewed.costs.verification.reviews.map(review => [review.kind, review.pricing ?? 'tokens', review.costMicroUsd]))
      .toEqual([['model', 'tokens', null], ['human', 'unpriced', null], ['human', 'declared', 250000]]);
    expect(reviewed.costs.verification.costMicroUsd).toBeNull();
    expect(reviewed.costs.unknown).toEqual(expect.arrayContaining(['verification.review:model:example/reviewer-large', 'verification.review:human:reviewer-a']));
    // A reply without token counts leaves the cost unknown even at a configured price.
    const tokenless = createModelSupportReviewer({ identity: { provider: 'example', model: 'reviewer-large' }, strongerThan: ['qwen3.5-0.8b'],
      price: { inputMicroUsdPerMillionTokens: 3_000_000, outputMicroUsdPerMillionTokens: 15_000_000 }, complete: async () => JUDGMENTS });
    expect((await tokenless.review(packet, { generator: GENERATOR })).usage).toMatchObject({ inputTokens: null, costMicroUsd: null });
    expect(() => createModelSupportReviewer({ identity: { provider: 'p', model: 'm' }, strongerThan: ['x'], complete: async () => '',
      price: { inputMicroUsdPerMillionTokens: 3 } })).toThrow('price is null or both token prices');

    // A search that threw may have been billed: unknown. A search never started cost nothing.
    const throwing = { id: 'test.search', version: '1', searchProvider: 'brave', costBearer: 'operator', search: async () => { throw new Error('HTTP 503'); } };
    const port2 = createRetrieval({ provider: throwing });
    const thrown = await port2.retrieve(port2.pending(port2.request({}, 'q'), AT), null);
    expect(thrown.costs.retrieval).toMatchObject({ search: { service: 'brave', requests: null, costMicroUsd: null }, costMicroUsd: null });
    const stopped = new AbortController(); stopped.abort();
    const never = await port2.retrieve(port2.pending(port2.request({}, 'q'), AT), stopped.signal);
    expect(never).toMatchObject({ outcome: 'cancelled', costs: { retrieval: { search: { requests: 0, costMicroUsd: 0 }, costMicroUsd: 0 }, totalMicroUsd: 0 } });
    expect(answerCostTotals([{ schema: 'reploid.server-search-usage/v1', category: 'fallback', answer: 'a', costMicroUsd: null }]).a)
      .toEqual({ retrieval: 0, verification: 0, fallback: null, total: null });
  });

  it('reads prices only from explicit configuration', () => {
    const search = { REPLOID_BRAVE_SEARCH_API_KEY: 'brave-cost-test-key', REPLOID_SEARCH_MAX_QUERIES_PER_DAY: '10' };
    expect(readSearchConfig(search)).toMatchObject({ enabled: true, fetchMicroUsdPerGb: null, brave: { costMicroUsdPerQuery: null } });
    expect(readSearchConfig({ ...search, REPLOID_SEARCH_FETCH_USD_PER_GB: '0.09' })).toMatchObject({ fetchMicroUsdPerGb: 90000 });
    expect(readSearchConfig({ ...search, REPLOID_SEARCH_FETCH_USD_PER_GB: 'cheap' })).toMatchObject({ enabled: false,
      reason: 'REPLOID_SEARCH_FETCH_USD_PER_GB must be a decimal number up to 1000' });
    expect(readSupportReviewerConfig(REVIEWER_ENV)).toMatchObject({ enabled: true, price: null });
    expect(readSupportReviewerConfig({ ...REVIEWER_ENV, REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_INPUT_TOKENS: '3' })).toMatchObject({ enabled: false,
      reason: expect.stringContaining('or neither') });
    expect(readSupportReviewerConfig({ ...REVIEWER_ENV, REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_INPUT_TOKENS: '0.15',
      REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_OUTPUT_TOKENS: '0.6' }).price).toEqual({ inputMicroUsdPerMillionTokens: 150000, outputMicroUsdPerMillionTokens: 600000 });
  });
});

describe('costs in conversations', () => {
  it('keys provider calls by the attempt and keeps costs in the record, out of the conversation text', async () => {
    const fixed = createFixedSearchProvider({ documents: [{ id: 'fixed:eiffel', url: 'https://fixed.example/eiffel', title: 'Eiffel Tower',
      text: 'The Eiffel Tower was completed in 1889.' }], now: () => AT });
    const contexts = [];
    const provider = { id: 'test.search', version: '1', costBearer: 'operator', async search(query, limits, signal, context) {
      contexts.push(context); return { results: await fixed.search(query, limits, signal), usage: { provider: 'brave', requests: 1, costMicroUsd: 5000 } };
    } };
    const extractor = { id: 'test.extract', version: '1', async extract(input) { contexts.push({ answer: input.answer }); return { ...await fixed.extract(input), costMicroUsd: 7 }; } };
    let data; const executed = [];
    const app = createChatWorkspace({ meshId: 'mesh', participantId: 'alice', store: { load: () => data, save: value => { data = structuredClone(value); } },
      retrieval: { provider, extractor }, execute: async request => { executed.push(structuredClone(request));
        return { threadId: request.threadId, attemptId: request.attemptId, modelId: request.model.id, modelIdentity: request.model.identity,
          adapterIdentities: [], content: 'It was completed in 1889 [1].' }; } });
    const thread = app.createThread({ model: { id: 'm', name: 'M', identity: 'sha256:' + 'a'.repeat(64) } });
    const attempt = await app.send(thread, 'When was the Eiffel Tower completed?', { retrieval: {} });
    expect(attempt.status).toBe('completed');
    expect(contexts).toEqual([{ answer: attempt.id }, { answer: attempt.id }]);
    expect(attempt.retrieval.costs).toMatchObject({ retrieval: { bearer: 'operator', search: { costMicroUsd: 5000 }, extraction: { costMicroUsd: 7 } },
      verification: { checker: null, reviews: [], costMicroUsd: 0 }, fallback: { path: 'none', costMicroUsd: 0 }, totalMicroUsd: 5007 });
    // The executor receives the numbered sources and the question only.
    expect(executed[0].messages).toEqual([{ role: 'user', content: `${renderSourceContext(attempt.retrieval.sources)}\n\nQuestion: When was the Eiffel Tower completed?` }]);
    expect(JSON.stringify(executed)).not.toMatch(/costMicroUsd|micro-usd|5007/);
    expect(JSON.stringify(app.getState().threads[0].messages)).not.toMatch(/costMicroUsd|micro-usd/);
    await app.close();
  });

  it('sends the answer key to the server route only, and builds records without costs as unknown', async () => {
    const calls = [];
    const port = createServerSearch({ fetch: async (url, init) => { calls.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => url.endsWith('/search')
      ? { schema: 'reploid.server-search-results/v1', provider: { kind: 'brave' }, results: [] } : {} }; } });
    await port.provider.search('tower', { maxResults: 2 }, null, { answer: 'attempt-9' });
    expect(calls[0]).toEqual({ query: 'tower', count: 2, expectProvider: 'brave', answer: 'attempt-9' });
    // A record saved before costs existed gains an unknown retrieval entry rather than a zero one.
    const legacy = { schema: 'reploid.retrieval-record/v1', outcome: 'retrieved', sources: [], verification: null };
    expect(withVerification(legacy, { checker: null, usage: { checks: 0, costMicroUsd: 0 } }).costs).toMatchObject({ totalMicroUsd: null,
      retrieval: { search: { costMicroUsd: null } }, unknown: ['retrieval.search', 'retrieval.extraction'] });
    expect(retrievalCostRecord({ retrieval: { bearer: null, search: { service: null, requests: 0, costMicroUsd: 0 },
      extraction: { attempted: 0, documents: 0, failed: 0, bytes: 0, costMicroUsd: 0 }, costMicroUsd: 0 } }).totalMicroUsd).toBe(0);
  });
});
