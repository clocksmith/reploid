/**
 * What the person wants from an automatically chosen computer. It only orders computers that have already met
 * the conversation's privacy and recipient rules: it cannot add one, and it never changes who may read a prompt.
 *
 * Evidence is what this device saw its own answers do. Nothing here is advertised by a peer, so a computer cannot
 * rank itself up. Speed is compared only for the model being asked for, since one computer runs different models at
 * different rates. No offer carries a price, so there is no cost preference to choose yet.
 */
export const ROUTE_PREFERENCES = Object.freeze([
  Object.freeze({ id: 'balanced', label: 'Balanced' }),
  Object.freeze({ id: 'faster', label: 'Faster' }),
  Object.freeze({ id: 'more-reliable', label: 'More reliable' })
]);
export const DEFAULT_ROUTE_PREFERENCE = 'balanced';

const STORAGE_KEY = 'REPLOID_ROUTE_PREFERENCE';
const KNOWN = new Set(ROUTE_PREFERENCES.map(preference => preference.id));
const DROPPED = /disconnect|peer.*lost|contributor.*lost|no longer ready|Failed to send swarm|connection to this computer changed/i;
const WEIGHTS = Object.freeze({
  balanced: { speed: 0.4, reliability: 0.4, capacity: 0.2 },
  faster: { speed: 1, reliability: 0, capacity: 0 },
  'more-reliable': { speed: 0, reliability: 1, capacity: 0 }
});
const MAX_COUNTED_SLOTS = 4;
const UNKNOWN_SCORE = 0.5;

export const normalizeRoutePreference = value => (KNOWN.has(value) ? value : DEFAULT_ROUTE_PREFERENCE);

export function createRoutePreference({ storage = globalThis.localStorage } = {}) {
  const read = () => { try { return storage?.getItem(STORAGE_KEY) ?? null; } catch { return null; } };
  let current = normalizeRoutePreference(read());
  return {
    get: () => current,
    set(value) {
      if (!KNOWN.has(value)) throw new Error('Unknown answer preference');
      current = value;
      try { storage?.setItem(STORAGE_KEY, value); } catch { /* The choice still applies until this page closes. */ }
      return current;
    }
  };
}

const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const milliseconds = value => (typeof value === 'number' ? value : Date.parse(value));

/**
 * Per signing identity: answers finished and answers lost to that computer going away, across models, and the
 * median output rate for `modelIdentity` alone. Without a model identity no rate is reported.
 */
export function routeObservations(threads = [], modelIdentity = null) {
  const rows = new Map();
  for (const thread of threads || []) {
    for (const attempt of thread?.attempts || []) {
      // The recipients the attempt's execution binding admitted before disclosure.
      const recipients = attempt?.privacyBinding?.route?.hops?.filter(hop => hop.placement === 'remote').map(hop => hop.recipient);
      // An answer that crossed several computers says nothing about any one of them.
      if (!Array.isArray(recipients) || recipients.length !== 1) continue;
      const row = rows.get(recipients[0]) ?? { completed: 0, dropped: 0, rates: [] };
      if (attempt.status === 'completed') {
        row.completed += 1;
        const characters = thread.messages?.find(message => message.id === attempt.responseId)?.content?.length ?? 0;
        const elapsed = milliseconds(attempt.finishedAt) - milliseconds(attempt.createdAt);
        if (modelIdentity && attempt.request?.model?.identity === modelIdentity && characters > 0 && elapsed > 0) {
          row.rates.push(characters / (elapsed / 1000));
        }
      } else if (attempt.status === 'failed' && DROPPED.test(String(attempt.error || ''))) row.dropped += 1;
      else continue;
      rows.set(recipients[0], row);
    }
  }
  return new Map([...rows].map(([id, { completed, dropped, rates }]) => [id,
    { completed, dropped, charactersPerSecond: rates.length ? median(rates) : null }]));
}

/**
 * Peer ids, best first, or null to keep the default order. Candidates arrive already eligible and in default
 * order, which breaks every tie. With nothing observed about any of them there is nothing to prefer. An unknown
 * rate, record or capacity scores in the middle: it is neither evidence for a computer nor against it.
 */
export function rankRoutes(candidates = [], preference = DEFAULT_ROUTE_PREFERENCE, observations = new Map()) {
  const seen = candidate => observations.get(candidate.verifiedIdentity) ?? null;
  if (candidates.length < 2 || !candidates.some(seen)) return null;
  const weights = WEIGHTS[normalizeRoutePreference(preference)];
  const fastest = Math.max(0, ...candidates.map(candidate => seen(candidate)?.charactersPerSecond ?? 0));
  const score = candidate => {
    const row = seen(candidate);
    const speed = row?.charactersPerSecond != null && fastest > 0 ? row.charactersPerSecond / fastest : UNKNOWN_SCORE;
    // One prior success and one prior failure, so a single result cannot decide a computer's standing.
    const reliability = row ? (row.completed + 1) / (row.completed + row.dropped + 2) : UNKNOWN_SCORE;
    const slots = candidate.availableSlots;
    const capacity = Number.isFinite(slots) ? Math.min(Math.max(slots, 0), MAX_COUNTED_SLOTS) / MAX_COUNTED_SLOTS : UNKNOWN_SCORE;
    return weights.speed * speed + weights.reliability * reliability + weights.capacity * capacity;
  };
  return candidates.map((candidate, index) => ({ id: candidate.peerId, index, value: score(candidate) }))
    .sort((a, b) => b.value - a.value || a.index - b.index).map(row => row.id);
}
