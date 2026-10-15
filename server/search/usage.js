/**
 * @fileoverview Search usage and cost counters for quotes and service economics. The daily cap counts every
 * admitted query, billable or not, per UTC day. Costs are micro-USD as configured: per billable query, per GB
 * fetched and per review token; an unpriced deployment counts unpriced events instead of inventing a price.
 * Every row of the optional JSONL log names its cost category (retrieval, verification or fallback) and, when the
 * caller supplied one, the opaque answer key, so answerCostTotals can sum each answer's categories separately.
 * The log never holds query text, keys or tokens.
 */
import fs from 'node:fs';
import { SearchProviderError } from './errors.js';

export const SEARCH_USAGE_SCHEMA = 'reploid.server-search-usage/v1';
export const COST_CATEGORIES = Object.freeze(['retrieval', 'verification', 'fallback']);
const DAY_MS = 86400000;
const utcDay = time => new Date(time).toISOString().slice(0, 10);
const priced = value => Number.isSafeInteger(value) && value >= 0;

export function createSearchUsage({ now = Date.now, maxQueriesPerDay, logPath = null, appendFile = fs.promises.appendFile, log = console } = {}) {
  if (!Number.isSafeInteger(maxQueriesPerDay) || maxQueriesPerDay < 1) throw new Error('Search usage needs a positive daily query budget');
  const empty = () => ({ queries: 0, billableQueries: 0, costMicroUsd: 0, unpricedQueries: 0, fetches: 0, failedFetches: 0, fetchedBytes: 0,
    fetchCostMicroUsd: 0, unpricedFetches: 0, reviews: 0, reviewCostMicroUsd: 0, unpricedReviews: 0 });
  let day = utcDay(now()), today = empty(), lastRateLimit = null;
  const totals = empty();
  const roll = () => { const current = utcDay(now()); if (current !== day) { day = current; today = empty(); } };
  const add = (field, value = 1) => { today[field] += value; totals[field] += value; };
  const write = row => {
    if (!logPath) return;
    appendFile(logPath, JSON.stringify({ schema: SEARCH_USAGE_SCHEMA, ...row }) + '\n')
      .catch(error => log.warn?.(`[Search] Usage log append failed: ${error.message}`));
  };
  const api = Object.freeze({
    /** Admits one query against today's budget or throws budget-exhausted. */
    admit() {
      roll();
      if (today.queries >= maxQueriesPerDay) {
        const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + DAY_MS - now()) / 1000));
        throw new SearchProviderError('budget-exhausted', { status: 429, retryAfterSeconds, detail: 'The daily search budget is used up' });
      }
      add('queries');
    },
    /** One provider call: billable only when the provider accepted it. */
    record({ provider, billable, costMicroUsd = null, resultCount = 0, subject = null, rateLimit = null, outcome = 'ok', answer = null }) {
      roll();
      if (billable) {
        add('billableQueries');
        if (priced(costMicroUsd)) add('costMicroUsd', costMicroUsd); else add('unpricedQueries');
      }
      if (rateLimit) lastRateLimit = structuredClone(rateLimit);
      write({ kind: 'query', category: 'retrieval', at: now(), day, answer, provider, outcome, billable: Boolean(billable),
        costMicroUsd: billable && priced(costMicroUsd) ? costMicroUsd : null, resultCount, subject });
      return api.snapshot();
    },
    /** One page fetch; its cost is null when unpriced or when a failure leaves the transferred bytes unknown. */
    recordFetch({ bytes = 0, ok, answer = null, costMicroUsd = null }) {
      roll();
      add('fetches'); if (!ok) add('failedFetches');
      if (Number.isSafeInteger(bytes) && bytes > 0) add('fetchedBytes', bytes);
      const cost = ok && priced(costMicroUsd) ? costMicroUsd : null;
      if (cost === null) add('unpricedFetches'); else add('fetchCostMicroUsd', cost);
      write({ kind: 'fetch', category: 'retrieval', at: now(), day, answer, ok: Boolean(ok), bytes: Number.isSafeInteger(bytes) ? bytes : 0, costMicroUsd: cost });
    },
    /** One entailment review by the configured model reviewer: reported tokens and cost from its configured price. */
    recordReview({ answer = null, reviewer, inputTokens = null, outputTokens = null, costMicroUsd = null }) {
      roll();
      add('reviews');
      if (priced(costMicroUsd)) add('reviewCostMicroUsd', costMicroUsd); else add('unpricedReviews');
      write({ kind: 'review', category: 'verification', at: now(), day, answer, reviewer: String(reviewer ?? ''),
        inputTokens: priced(inputTokens) ? inputTokens : null, outputTokens: priced(outputTokens) ? outputTokens : null,
        costMicroUsd: priced(costMicroUsd) ? costMicroUsd : null });
    },
    snapshot() {
      roll();
      return structuredClone({ schema: SEARCH_USAGE_SCHEMA, day, maxQueriesPerDay, ...today, totals, lastRateLimit });
    }
  });
  return api;
}

/**
 * Per-answer sums of usage log rows: `{ [answer]: { retrieval, verification, fallback, total } }` in micro-USD.
 * A category with any unknown cost is null, as is the total; a category with no rows is 0 (nothing ran). Rows without
 * an answer key are not attributed to any answer.
 */
export function answerCostTotals(rows) {
  const answers = {};
  for (const row of rows) {
    if (row?.schema !== SEARCH_USAGE_SCHEMA || typeof row.answer !== 'string' || !COST_CATEGORIES.includes(row.category)) continue;
    const totals = answers[row.answer] ??= { retrieval: 0, verification: 0, fallback: 0, total: 0 };
    const cost = row.costMicroUsd;
    totals[row.category] = totals[row.category] === null || !priced(cost) ? null : totals[row.category] + cost;
  }
  for (const totals of Object.values(answers)) {
    totals.total = COST_CATEGORIES.some(name => totals[name] === null) ? null : COST_CATEGORIES.reduce((sum, name) => sum + totals[name], 0);
  }
  return answers;
}
