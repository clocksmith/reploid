#!/usr/bin/env node
/**
 * Pilot reliability measurement for whole-model answers through the authenticated HTTP text API
 * (docs/fleet-service.md, "Authenticated HTTP text API").
 *
 * The rule is fixed here, before any run:
 *   - 100 ordinary requests or more, sent one at a time at a fixed spacing, from the prompt list below;
 *   - a request is completed only when it returns HTTP 200, streams at least one output token and ends with a
 *     finish reason. Everything else is a failure: no capacity, a refusal, a timeout, a dropped stream, an empty
 *     answer. Unavailable capacity is never excluded or retried;
 *   - first-token time runs from sending the request to the first streamed output text. A request with no first
 *     token counts as slower than any limit;
 *   - the run passes when at least 99% of the requests completed and the 95th percentile first-token time
 *     (nearest rank, over every request) is at most 5 s. A run of fewer than 100 requests gets no verdict.
 *
 *   node scripts/pilot/reliability.js --base-url http://127.0.0.1:18785 --token-file /absolute/secret \
 *     --model MODEL_ID [--requests 100] [--interval-ms 3000] [--timeout-ms 120000] [--max-tokens 64] \
 *     [--label TEXT] [--out FILE.json]
 *
 * The receipt never contains the bearer secret, the prompts' answers or the endpoint address. It measures one
 * requester on one network path; it says nothing about other users, other models or split routes.
 */
import fs from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const RULE = Object.freeze({ minimumRequests: 100, completedShare: 0.99, firstTokenPercentile: 95, firstTokenLimitMs: 5000 });

/** Ordinary requests: short everyday questions, cycled in order. Changing this list changes the measurement. */
export const PROMPTS = Object.freeze([
  'What is the capital of Australia?',
  'Give me three ideas for a quick weeknight dinner.',
  'Explain what a hash function is in two sentences.',
  'Rewrite this more politely: send me the file now.',
  'What is 17 times 23?',
  'Suggest a name for a small bakery.',
  'Summarize the plot of Romeo and Juliet in one sentence.',
  'How do I reverse a list in Python?',
  'What causes the seasons on Earth?',
  'Write a two-line poem about rain.',
  'Translate "good morning" into Spanish and French.',
  'What is the difference between a virus and a bacterium?',
  'Give me a packing list for a weekend hike.',
  'Why is the sky blue?',
  'Write a short thank-you note to a colleague.',
  'What does HTTP status 404 mean?',
  'How many minutes are in a week?',
  'Suggest a stretch for a stiff neck.',
  'What is a prime number?',
  'Explain compound interest to a ten-year-old.'
]);

/** Nearest-rank percentile: the smallest value with at least p% of the values at or below it. */
export function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)];
}

const failureOfStatus = (status, code) => {
  if (status === 402 || status === 409) return 'credit-refused';
  if (status === 429 || status === 503 || /unavailable|no_provider|capacity|busy|not_ready/i.test(code ?? '')) return 'unavailable';
  return `http-${status}`;
};

/**
 * Sends one streamed chat completion and times it. Never throws: every problem becomes a failure reason.
 * Returns { completed, failure, status, firstTokenMs, totalMs, outputChunks, finishReason, reservationId }.
 */
export async function measureRequest({ baseUrl, token, model, prompt, maxTokens, timeoutMs, fetchImpl = fetch, now = () => performance.now() }) {
  const started = now(), controller = new AbortController();
  const result = { completed: false, failure: null, status: null, firstTokenMs: null, totalMs: null, outputChunks: 0, finishReason: null, reservationId: null };
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const end = failure => { clearTimeout(timer); result.failure = failure; result.completed = failure === null; result.totalMs = Math.round(now() - started); return result; };
  let response;
  try {
    response = await fetchImpl(new URL('/v1/chat/completions', baseUrl), { method: 'POST', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ model, stream: true, max_completion_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }) });
  } catch (error) {
    return end(controller.signal.aborted ? 'timeout' : 'unreachable');
  }
  result.status = response.status;
  result.reservationId = response.headers.get('x-reploid-reservation-id');
  if (response.status !== 200) {
    let code = null;
    try { code = (await response.json())?.error?.code ?? null; } catch { /* a refusal without a JSON body */ }
    return end(failureOfStatus(response.status, code));
  }
  const decoder = new TextDecoder();
  let buffered = '', streamError = null, sawDone = false;
  const take = event => {
    for (const line of event.split('\n')) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') { sawDone = true; continue; }
      let parsed;
      try { parsed = JSON.parse(data); } catch { continue; }
      if (parsed?.error) { streamError = String(parsed.error.code ?? parsed.error.type ?? 'error'); continue; }
      const choice = parsed?.choices?.[0];
      if (typeof choice?.delta?.content === 'string' && choice.delta.content.length > 0) {
        result.outputChunks += 1;
        result.firstTokenMs ??= Math.round(now() - started);
      }
      if (choice?.finish_reason) result.finishReason = choice.finish_reason;
    }
  };
  try {
    for await (const chunk of response.body) {
      buffered += decoder.decode(chunk, { stream: true });
      let cut;
      while ((cut = buffered.indexOf('\n\n')) !== -1) { take(buffered.slice(0, cut)); buffered = buffered.slice(cut + 2); }
    }
    if (buffered.trim()) take(buffered);
  } catch (error) {
    return end(controller.signal.aborted ? 'timeout' : 'interrupted');
  }
  if (streamError) return end(`stream-error:${streamError}`);
  if (!result.finishReason) return end(sawDone ? 'no-finish-reason' : 'interrupted');
  if (result.outputChunks === 0) return end('empty');
  return end(null);
}

/** The verdict under RULE for a list of measureRequest results. */
export function summarize(results) {
  const completed = results.filter(row => row.completed).length;
  const failures = {};
  for (const row of results) if (!row.completed) failures[row.failure] = (failures[row.failure] ?? 0) + 1;
  const strict = results.map(row => row.firstTokenMs ?? Infinity);
  const p95 = percentile(strict, RULE.firstTokenPercentile);
  const answered = results.filter(row => row.firstTokenMs !== null).map(row => row.firstTokenMs);
  const enough = results.length >= RULE.minimumRequests;
  const completedEnough = completed >= Math.ceil(RULE.completedShare * results.length);
  const fastEnough = p95 !== null && p95 <= RULE.firstTokenLimitMs;
  return {
    requests: results.length, completed, failed: results.length - completed, failures,
    firstTokenMs: { p50: percentile(answered, 50), p95OverEveryRequest: Number.isFinite(p95) ? p95 : 'none: over 5% of the requests had no first token',
      p95OverRequestsWithAFirstToken: percentile(answered, 95), max: answered.length ? Math.max(...answered) : null },
    checks: { completedEnough, fastEnough },
    verdict: !enough ? `not evaluated: the rule needs ${RULE.minimumRequests} requests` : completedEnough && fastEnough ? 'pass' : 'fail'
  };
}

/** Runs the measurement: one request at a time, each started `intervalMs` after the previous one started. */
export async function runPilot({ baseUrl, token, model, requests = RULE.minimumRequests, intervalMs = 3000, timeoutMs = 120000, maxTokens = 64,
  fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onResult = () => {} }) {
  const results = [];
  for (let index = 0; index < requests; index++) {
    const startedAt = Date.now();
    const row = { index, prompt: index % PROMPTS.length, startedAt: new Date(startedAt).toISOString(),
      ...await measureRequest({ baseUrl, token, model, prompt: PROMPTS[index % PROMPTS.length], maxTokens, timeoutMs, fetchImpl }) };
    results.push(row);
    onResult(row);
    const wait = intervalMs - (Date.now() - startedAt);
    if (index < requests - 1 && wait > 0) await sleep(wait);
  }
  return results;
}

async function main() {
  const { values } = parseArgs({ options: { 'base-url': { type: 'string' }, 'token-file': { type: 'string' }, model: { type: 'string' },
    requests: { type: 'string', default: String(RULE.minimumRequests) }, 'interval-ms': { type: 'string', default: '3000' },
    'timeout-ms': { type: 'string', default: '120000' }, 'max-tokens': { type: 'string', default: '64' }, label: { type: 'string', default: '' },
    out: { type: 'string' } } });
  if (!values['base-url'] || !values['token-file'] || !values.model) throw Error('Give --base-url, --token-file and --model');
  const number = name => { const value = Number(values[name]); if (!Number.isSafeInteger(value) || value < 1) throw Error(`--${name} must be a positive integer`); return value; };
  const token = (await fs.readFile(values['token-file'], 'utf8')).trim();
  const settings = { model: values.model, requests: number('requests'), intervalMs: number('interval-ms'), timeoutMs: number('timeout-ms'), maxTokens: number('max-tokens') };
  const startedAt = new Date().toISOString();
  const results = await runPilot({ baseUrl: values['base-url'], token, ...settings,
    onResult: row => console.error(`${String(row.index + 1).padStart(3)} ${row.completed ? 'ok  ' : 'FAIL'} first token ${row.firstTokenMs ?? '-'} ms, total ${row.totalMs} ms${row.failure ? `, ${row.failure}` : ''}`) });
  const host = new URL(values['base-url']).hostname;
  const receipt = { schema: 'reploid.pilot-reliability/v1', startedAt, finishedAt: new Date().toISOString(), label: values.label, rule: RULE,
    endpoint: ['127.0.0.1', 'localhost', '[::1]'].includes(host) ? 'loopback text API' : 'remote text API (address not recorded)',
    settings, prompts: PROMPTS.length, node: process.version, summary: summarize(results), results };
  const text = JSON.stringify(receipt, null, 2);
  if (values.out) await fs.writeFile(values.out, `${text}\n`);
  console.log(JSON.stringify({ label: receipt.label, ...receipt.summary }, null, 2));
  process.exitCode = receipt.summary.verdict === 'pass' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
