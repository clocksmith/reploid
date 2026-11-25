// @vitest-environment node
// The pilot reliability rule (scripts/pilot/reliability.js) against a local mock of the streamed text API.
// Proves how the harness counts and times requests; it does not prove anything about a real provider.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import http from 'node:http';

import { PROMPTS, RULE, measureRequest, percentile, runPilot, summarize } from '../../scripts/pilot/reliability.js';

const chunk = (content, finish = null) => `data: ${JSON.stringify({ choices: [{ delta: content === null ? {} : { content }, finish_reason: finish }] })}\n\n`;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Each request's `model` names the behaviour the mock plays. */
const BEHAVIOURS = {
  async ok(res) { res.writeHead(200, { 'content-type': 'text/event-stream', 'x-reploid-reservation-id': 'reservation-1' }); res.write(chunk('Hi')); res.write(chunk(' there')); res.write(chunk(null, 'stop')); res.end('data: [DONE]\n\n'); },
  async slow(res) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunk('')); await wait(120); res.write(chunk('Late')); res.write(chunk(null, 'length')); res.end('data: [DONE]\n\n'); },
  async split(res) { res.writeHead(200, { 'content-type': 'text/event-stream' }); const text = chunk('A') + chunk(null, 'stop'); res.write(text.slice(0, 9)); await wait(5); res.end(text.slice(9)); },
  async unavailable(res) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'provider_unavailable' } })); },
  async refused(res) { res.writeHead(402, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'service_credit_insufficient' } })); },
  async broken(res) { res.writeHead(500); res.end('not json'); },
  async dropped(res) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunk('Half')); await wait(5); res.destroy(); },
  async unfinished(res) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunk('Half')); res.end(); },
  async lost(res) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunk('Half')); res.end(`data: ${JSON.stringify({ error: { code: 'connection_lost' } })}\n\n`); },
  async empty(res) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunk(null, 'stop')); res.end('data: [DONE]\n\n'); },
  async hang(res) { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(chunk('Start')); }
};

let server, baseUrl;
const seen = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', part => { body += part; });
    req.on('end', () => {
      const parsed = JSON.parse(body);
      seen.push({ path: req.url, authorization: req.headers.authorization, ...parsed });
      BEHAVIOURS[parsed.model](res);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => { server.closeAllConnections(); server.close(); });

const measure = (model, extra = {}) => measureRequest({ baseUrl, token: 'secret', model, prompt: 'Hello', maxTokens: 8, timeoutMs: 2000, ...extra });

describe('pilot reliability measurement', () => {
  it('times a completed streamed answer and sends the documented request', async () => {
    const row = await measure('ok');
    expect(row).toMatchObject({ completed: true, failure: null, status: 200, outputChunks: 2, finishReason: 'stop', reservationId: 'reservation-1' });
    expect(row.firstTokenMs).toBeGreaterThanOrEqual(0);
    expect(row.totalMs).toBeGreaterThanOrEqual(row.firstTokenMs);
    expect(seen.at(-1)).toMatchObject({ path: '/v1/chat/completions', authorization: 'Bearer secret', stream: true, max_completion_tokens: 8,
      messages: [{ role: 'user', content: 'Hello' }] });
  });

  it('starts the first-token clock at the first output text, not at the first event', async () => {
    const row = await measure('slow');
    expect(row.completed).toBe(true);
    expect(row.firstTokenMs).toBeGreaterThanOrEqual(100);
    expect(row.finishReason).toBe('length');
  });

  it('reads an event that arrives in two pieces', async () => {
    expect(await measure('split')).toMatchObject({ completed: true, outputChunks: 1, finishReason: 'stop' });
  });

  it('counts every other ending as a failure and names it', async () => {
    expect(await measure('unavailable')).toMatchObject({ completed: false, failure: 'unavailable', status: 503, firstTokenMs: null });
    expect(await measure('refused')).toMatchObject({ completed: false, failure: 'credit-refused', status: 402 });
    expect(await measure('broken')).toMatchObject({ completed: false, failure: 'http-500' });
    expect(await measure('dropped')).toMatchObject({ completed: false, failure: 'interrupted', outputChunks: 1 });
    expect(await measure('unfinished')).toMatchObject({ completed: false, failure: 'interrupted' });
    expect(await measure('lost')).toMatchObject({ completed: false, failure: 'stream-error:connection_lost' });
    expect(await measure('empty')).toMatchObject({ completed: false, failure: 'empty' });
    expect(await measure('hang', { timeoutMs: 150 })).toMatchObject({ completed: false, failure: 'timeout', outputChunks: 1 });
    expect(await measureRequest({ baseUrl: 'http://127.0.0.1:1', token: 'secret', model: 'ok', prompt: 'Hello', maxTokens: 8, timeoutMs: 2000 }))
      .toMatchObject({ completed: false, failure: 'unreachable', status: null });
  });

  it('uses the nearest-rank percentile', () => {
    const hundred = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(hundred, 95)).toBe(95);
    expect(percentile(hundred, 50)).toBe(50);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 95)).toBe(null);
  });

  const row = (firstTokenMs, failure = null) => ({ completed: failure === null, failure, firstTokenMs });
  const run = (...groups) => groups.flatMap(([count, firstTokenMs, failure]) => Array.from({ length: count }, () => row(firstTokenMs, failure)));

  it('passes at exactly 99 of 100 with the 95th percentile at the limit', () => {
    const summary = summarize(run([94, 1000], [5, RULE.firstTokenLimitMs], [1, null, 'unavailable']));
    expect(summary).toMatchObject({ requests: 100, completed: 99, failed: 1, failures: { unavailable: 1 }, verdict: 'pass' });
    expect(summary.firstTokenMs.p95OverEveryRequest).toBe(5000);
  });

  it('fails at 98 of 100, however fast the answers were', () => {
    expect(summarize(run([98, 200], [1, null, 'unavailable'], [1, null, 'timeout']))).toMatchObject({ completed: 98, verdict: 'fail',
      failures: { unavailable: 1, timeout: 1 }, checks: { completedEnough: false, fastEnough: true } });
  });

  it('fails when the 95th percentile is one millisecond over the limit', () => {
    expect(summarize(run([94, 1000], [6, RULE.firstTokenLimitMs + 1]))).toMatchObject({ completed: 100, verdict: 'fail',
      checks: { completedEnough: true, fastEnough: false } });
  });

  it('counts a request with no first token as slower than the limit', () => {
    const summary = summarize(run([94, 1000], [6, null, 'unavailable']));
    expect(summary.checks.fastEnough).toBe(false);
    expect(summary.firstTokenMs.p95OverRequestsWithAFirstToken).toBe(1000);
  });

  it('gives no verdict for fewer than 100 requests', () => {
    expect(summarize(run([99, 100])).verdict).toMatch(/^not evaluated/);
  });

  it('sends the requests one at a time, cycling the prompt list, and never retries a failure', async () => {
    const before = seen.length, models = ['ok', 'unavailable', 'ok'];
    let call = 0;
    const results = await runPilot({ baseUrl, token: 'secret', model: 'ok', requests: 3, intervalMs: 0, timeoutMs: 2000,
      fetchImpl: (url, init) => fetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), model: models[call++] }) }) });
    expect(results.map(item => item.completed)).toEqual([true, false, true]);
    expect(seen.length - before).toBe(3);
    expect(seen.slice(before).map(item => item.messages[0].content)).toEqual(PROMPTS.slice(0, 3));
    expect(summarize(results)).toMatchObject({ requests: 3, completed: 2, failures: { unavailable: 1 } });
  });
});
