/**
 * @fileoverview Operator-configured stronger-model entailment reviewer (packages/reploid/src/retrieval/model-reviewer.js)
 * over an OpenAI-compatible chat completions endpoint. Off unless REPLOID_SUPPORT_REVIEWER_ENDPOINT, _PROVIDER, _MODEL,
 * _STRONGER_THAN and a key (_API_KEY, or _API_KEY_FILE outside the repository) are all set. Reviewing a packet sends
 * its question, answer and cited passages to that provider. That is a separate disclosure from search and from
 * execution contributors, so it serves evaluation material the operator may send there, never live conversations.
 * No HTTP route exposes it; evaluation tooling calls it.
 * Its price comes only from REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_INPUT_TOKENS and _OUTPUT_TOKENS (both or
 * neither); unpriced, each review's cost is null. Token counts come from the endpoint's reported usage. Given a
 * usage ledger (usage.js), every review appends a verification row keyed by the caller's answer key or packet id.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelSupportReviewer } from '../../packages/reploid/src/retrieval/model-reviewer.js';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const KEYS = ['REPLOID_SUPPORT_REVIEWER_ENDPOINT', 'REPLOID_SUPPORT_REVIEWER_PROVIDER', 'REPLOID_SUPPORT_REVIEWER_MODEL',
  'REPLOID_SUPPORT_REVIEWER_STRONGER_THAN'];
const PRICE_KEYS = ['REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_INPUT_TOKENS', 'REPLOID_SUPPORT_REVIEWER_USD_PER_MILLION_OUTPUT_TOKENS'];
const text = value => String(value ?? '').trim();
const inside = (root, file) => { const relative = path.relative(path.resolve(root), path.resolve(file)); return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)); };

/** `{ enabled: false, reason }` unless every setting is present and safe. */
export function readSupportReviewerConfig(env = {}, { repoRoot = REPOSITORY_ROOT, readFileSync = fs.readFileSync } = {}) {
  if (!KEYS.some(key => text(env[key])) && !text(env.REPLOID_SUPPORT_REVIEWER_API_KEY) && !text(env.REPLOID_SUPPORT_REVIEWER_API_KEY_FILE)) {
    return { enabled: false, reason: 'No support reviewer is configured' };
  }
  const missing = KEYS.filter(key => !text(env[key]));
  if (missing.length) return { enabled: false, reason: `The support reviewer needs ${missing.join(', ')}` };
  let endpoint;
  try { endpoint = new URL(text(env.REPLOID_SUPPORT_REVIEWER_ENDPOINT)); } catch { return { enabled: false, reason: 'REPLOID_SUPPORT_REVIEWER_ENDPOINT is not a URL' }; }
  if (!(endpoint.protocol === 'https:' || endpoint.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname))) {
    return { enabled: false, reason: 'REPLOID_SUPPORT_REVIEWER_ENDPOINT must be https (http only on loopback)' };
  }
  let apiKey = text(env.REPLOID_SUPPORT_REVIEWER_API_KEY);
  const keyFile = text(env.REPLOID_SUPPORT_REVIEWER_API_KEY_FILE);
  if (!apiKey && keyFile) {
    if (inside(repoRoot, keyFile)) return { enabled: false, reason: 'REPLOID_SUPPORT_REVIEWER_API_KEY_FILE must be outside the repository' };
    apiKey = text(readFileSync(keyFile, 'utf8'));
  }
  if (!apiKey) return { enabled: false, reason: 'The support reviewer needs REPLOID_SUPPORT_REVIEWER_API_KEY or REPLOID_SUPPORT_REVIEWER_API_KEY_FILE' };
  const prices = PRICE_KEYS.map(key => text(env[key]));
  if (prices.some(Boolean) && !prices.every(value => /^\d+(?:\.\d+)?$/.test(value))) {
    return { enabled: false, reason: `Set both ${PRICE_KEYS.join(' and ')} as decimal numbers, or neither` };
  }
  const strongerThan = text(env.REPLOID_SUPPORT_REVIEWER_STRONGER_THAN).split(',').map(text).filter(Boolean);
  return { enabled: true, reason: null, endpoint: endpoint.href, provider: text(env.REPLOID_SUPPORT_REVIEWER_PROVIDER),
    model: text(env.REPLOID_SUPPORT_REVIEWER_MODEL), version: text(env.REPLOID_SUPPORT_REVIEWER_VERSION) || undefined, strongerThan, apiKey,
    // Micro-USD per million tokens: $3 per million is 3000000. Null means reviews are unpriced.
    price: prices.every(Boolean) ? { inputMicroUsdPerMillionTokens: Math.round(Number(prices[0]) * 1e6),
      outputMicroUsdPerMillionTokens: Math.round(Number(prices[1]) * 1e6) } : null };
}

const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** The configured reviewer, or null when it is off. Errors never include the key. `usage`: an optional ledger with recordReview. */
export function createConfiguredSupportReviewer({ env = process.env, fetch = globalThis.fetch, timeoutMs = 120000, usage = null, ...options } = {}) {
  const config = readSupportReviewerConfig(env, options);
  if (!config.enabled) return null;
  const reviewer = createModelSupportReviewer({ identity: { provider: config.provider, model: config.model, version: config.version },
    strongerThan: config.strongerThan, price: config.price,
    async complete({ system, prompt, signal }) {
      const deadline = AbortSignal.timeout(timeoutMs);
      const response = await fetch(config.endpoint, { method: 'POST', signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, temperature: 0,
          messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }] }) });
      if (!response.ok) throw new Error(`The support reviewer returned HTTP ${response.status}`);
      const payload = await response.json();
      const reply = payload?.choices?.[0]?.message?.content;
      if (typeof reply !== 'string') throw new Error('The support reviewer returned no message');
      // OpenAI-compatible endpoints report prompt and completion tokens; absent counts stay unknown.
      return { text: reply, usage: { inputTokens: tokenCount(payload.usage?.prompt_tokens), outputTokens: tokenCount(payload.usage?.completion_tokens) } };
    } });
  if (!usage) return reviewer;
  if (typeof usage.recordReview !== 'function') throw new Error('The support reviewer usage ledger needs recordReview');
  return Object.freeze({ ...reviewer,
    async review(packet, context = {}) {
      const judgments = await reviewer.review(packet, context);
      usage.recordReview({ answer: context.answer ?? packet.id, reviewer: judgments.reviewer.id, ...judgments.usage });
      return judgments;
    } });
}
