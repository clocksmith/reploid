/**
 * @fileoverview Search usage and cost counters for quotes and service economics. The daily cap counts every
 * admitted query, billable or not, per UTC day. Costs are micro-USD per billable query as configured; an
 * unpriced deployment counts unpriced queries instead of inventing a price. The optional JSONL log never
 * holds query text, keys or tokens.
 */
import fs from 'node:fs';
import { SearchProviderError } from './errors.js';

export const SEARCH_USAGE_SCHEMA = 'reploid.server-search-usage/v1';
const DAY_MS = 86400000;
const utcDay = time => new Date(time).toISOString().slice(0, 10);

export function createSearchUsage({ now = Date.now, maxQueriesPerDay, logPath = null, appendFile = fs.promises.appendFile, log = console } = {}) {
  if (!Number.isSafeInteger(maxQueriesPerDay) || maxQueriesPerDay < 1) throw new Error('Search usage needs a positive daily query budget');
  const empty = () => ({ queries: 0, billableQueries: 0, costMicroUsd: 0, unpricedQueries: 0, fetches: 0, failedFetches: 0, fetchedBytes: 0 });
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
    record({ provider, billable, costMicroUsd = null, resultCount = 0, subject = null, rateLimit = null, outcome = 'ok' }) {
      roll();
      if (billable) {
        add('billableQueries');
        if (Number.isSafeInteger(costMicroUsd)) add('costMicroUsd', costMicroUsd); else add('unpricedQueries');
      }
      if (rateLimit) lastRateLimit = structuredClone(rateLimit);
      write({ kind: 'query', at: now(), day, provider, outcome, billable: Boolean(billable),
        costMicroUsd: billable && Number.isSafeInteger(costMicroUsd) ? costMicroUsd : null, resultCount, subject });
      return api.snapshot();
    },
    recordFetch({ bytes = 0, ok }) {
      roll();
      add('fetches'); if (!ok) add('failedFetches');
      if (Number.isSafeInteger(bytes) && bytes > 0) add('fetchedBytes', bytes);
      write({ kind: 'fetch', at: now(), day, ok: Boolean(ok), bytes: Number.isSafeInteger(bytes) ? bytes : 0 });
    },
    snapshot() {
      roll();
      return structuredClone({ schema: SEARCH_USAGE_SCHEMA, day, maxQueriesPerDay, ...today, totals, lastRateLimit });
    }
  });
  return api;
}
