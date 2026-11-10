import envelopePolicy from './partition-route-envelope-policy.json' with { type: 'json' };
import { assertPartition as assert, partitionFailure } from './partition-contract.js';

export const ROUTE_ENVELOPE_POLICY_SCHEMA = 'reploid.route-envelope-policy/v1';
const digest = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** Every member is required and nothing is defaulted in JavaScript. A route entry declares the
 * workloads its measurement supports: each cell bounds prompt and answer tokens (sampled tokens,
 * the end token included) while at most `maxConcurrency` attempts run on the route.
 * `undeclaredRoutes` states what applies to a route without an entry. */
export function validateRouteEnvelopePolicy(policy) {
  assert(exact(policy, ['schema', 'undeclaredRoutes', 'routes']) && policy.schema === ROUTE_ENVELOPE_POLICY_SCHEMA
    && ['existing-limits', 'refuse'].includes(policy.undeclaredRoutes) && Array.isArray(policy.routes),
  `Explicit ${ROUTE_ENVELOPE_POLICY_SCHEMA} required: schema, undeclaredRoutes, routes`);
  const seen = new Set();
  for (const entry of policy.routes) {
    assert(exact(entry, ['modelIdentity', 'planId', 'evidence', 'cells']) && digest(entry.modelIdentity) && digest(entry.planId)
      && typeof entry.evidence === 'string' && entry.evidence.length > 0 && Array.isArray(entry.cells) && entry.cells.length > 0
      && entry.cells.every(cell => exact(cell, ['maxConcurrency', 'maxPromptTokens', 'maxAnswerTokens'])
        && positive(cell.maxConcurrency) && positive(cell.maxPromptTokens) && positive(cell.maxAnswerTokens)),
    'Invalid route envelope entry');
    const key = entry.modelIdentity + '/' + entry.planId;
    assert(!seen.has(key), 'Duplicate route envelope entry'); seen.add(key);
  }
  return Object.freeze(structuredClone(policy));
}

/** The partitions component's own declared envelopes, checked when this module loads. */
export const ROUTE_ENVELOPE_POLICY = validateRouteEnvelopePolicy(envelopePolicy);

/**
 * Admission against one route's declared envelope, before anything reaches its stages. An attempt
 * is inside when some cell covering the route's concurrency with it admitted bounds its prompt,
 * and admitting it keeps every attempt already running on the route inside a cell at that
 * concurrency. Its answer allowance is the largest such cell's answer bound: a caller limit above
 * it, a prompt above every cell, or a concurrency no cell covers refuses with
 * WORKLOAD_OUTSIDE_ENVELOPE. An attempt without a caller limit receives the allowance as its
 * generation bound, so an answer reaching it ends explicitly at the declared length.
 */
export function createRouteEnvelope({ policy, route }) {
  const declared = validateRouteEnvelopePolicy(policy);
  const entry = declared.routes.find(row => row.modelIdentity === route?.modelIdentity && row.planId === route?.planId) ?? null;
  const running = new Map();
  const fitting = (concurrency, promptTokens, answerTokens = 1) => (entry?.cells ?? []).filter(cell => concurrency <= cell.maxConcurrency
    && promptTokens <= cell.maxPromptTokens && answerTokens <= cell.maxAnswerTokens);
  return Object.freeze({
    declared: entry !== null,
    /** `answerTokens` is the attempt's generation bound; `explicit` marks a caller's own limit. */
    admit({ attemptId, promptTokens, answerTokens, explicit }) {
      assert(typeof attemptId === 'string' && !running.has(attemptId) && positive(promptTokens) && positive(answerTokens)
        && typeof explicit === 'boolean', 'Invalid route envelope admission');
      if (!entry) {
        if (declared.undeclaredRoutes === 'refuse') throw partitionFailure('WORKLOAD_OUTSIDE_ENVELOPE', { envelope: null });
        running.set(attemptId, null);
        return { answerTokens, envelope: null };
      }
      const concurrency = running.size + 1;
      const cells = fitting(concurrency, promptTokens, explicit ? answerTokens : 1);
      const others = [...running.values()].every(load => fitting(concurrency, load.promptTokens, load.answerTokens).length > 0);
      if (!cells.length || !others) {
        throw partitionFailure('WORKLOAD_OUTSIDE_ENVELOPE', { envelope: { concurrency, promptTokens, answerTokens, explicit } });
      }
      const allowance = Math.min(answerTokens, Math.max(...cells.map(cell => cell.maxAnswerTokens)));
      const load = { promptTokens, answerTokens: allowance };
      running.set(attemptId, load);
      return { answerTokens: allowance, envelope: { concurrency, promptTokens, maxAnswerTokens: allowance, evidence: entry.evidence } };
    },
    release(attemptId) { running.delete(attemptId); },
    getState: () => ({ declared: entry !== null, running: running.size })
  });
}
