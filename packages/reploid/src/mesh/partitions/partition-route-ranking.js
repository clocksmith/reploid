import { assertPartition as assert } from './partition-contract.js';

/** Measured ranking of eligible prepared routes (Launch 3). Costs come only from completed
 * attempts this coordinator executed; nothing here grants, reserves or moves an attempt.
 * Peer identity is a deterministic tie-breaker, never the placement criterion. */
const RUNTIME = 'executionMs';
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const mean = row => row && row.count > 0 && finite(row.total) ? row.total / row.count : null;

/** Bounded per (plan, participant, stage) cost estimates, folded from ordered summaries
 * (partition-summary.js stepSummary.phases). Each completed attempt updates an estimate by
 * exponential smoothing so a recovered or slowed contributor is reflected without unbounded history. */
export function createRouteObservations({ maxEntries, smoothing }) {
  assert(Number.isSafeInteger(maxEntries) && maxEntries > 0 && finite(smoothing) && smoothing > 0 && smoothing <= 1,
    'Explicit observation limits required');
  const rows = new Map();
  const key = (planId, participantId, index) => JSON.stringify([planId, participantId, index]);
  const fold = (previous, value) => value === null ? previous ?? null : previous == null ? value : previous + smoothing * (value - previous);
  return Object.freeze({
    record({ planId, route, phases, at }) {
      assert(typeof planId === 'string' && Array.isArray(route?.stages) && Number.isSafeInteger(at), 'Observation binding required');
      if (!phases?.prompt || !phases.decode) return 0;
      let recorded = 0;
      for (const stage of route.stages) {
        const prompt = phases.prompt.stages?.find(row => row.partitionIndex === stage.index);
        const decode = phases.decode.stages?.find(row => row.partitionIndex === stage.index);
        const decodeMs = mean(decode?.elapsedMs), executionMs = mean(decode?.runtime?.[RUNTIME]);
        const tokens = phases.prompt.inputTokens;
        const prefillMsPerToken = finite(prompt?.elapsedMs) && Number.isSafeInteger(tokens) && tokens > 0 ? prompt.elapsedMs / tokens : null;
        if (decodeMs === null && prefillMsPerToken === null) continue;
        const id = key(planId, stage.participantId, stage.index), previous = rows.get(id);
        rows.delete(id);
        rows.set(id, { planId, participantId: stage.participantId, index: stage.index, at,
          samples: (previous?.samples ?? 0) + 1, decodeMs: fold(previous?.decodeMs, decodeMs),
          transferMs: fold(previous?.transferMs, decodeMs !== null && executionMs !== null ? Math.max(decodeMs - executionMs, 0) : null),
          prefillMsPerToken: fold(previous?.prefillMsPerToken, prefillMsPerToken) });
        while (rows.size > maxEntries) rows.delete(rows.keys().next().value);
        recorded++;
      }
      return recorded;
    },
    get: (planId, participantId, index) => structuredClone(rows.get(key(planId, participantId, index)) ?? null),
    snapshot: () => structuredClone([...rows.values()])
  });
}

/** Expected completion time of one stage for a new request on this candidate, or null if unmeasured.
 * Queueing: a stage already running `active` attempts shares its device, so its cost scales by active+1. */
function stageCost(observation, candidate, workload) {
  if (!observation || observation.decodeMs === null || observation.prefillMsPerToken === null) return null;
  const queue = 1 + (candidate.capacity?.active ?? 0);
  return queue * (observation.prefillMsPerToken * workload.promptTokens + observation.decodeMs * workload.expectedTokens);
}

/** Ranks complete assignments of distinct participants to every stage. Fully measured routes come
 * first by expected completion time; routes with unmeasured stages follow, unranked by cost, because
 * an unmeasured placement needs its own bounded measurement before it can be preferred. Candidates
 * whose admitted memory cannot hold the request's allocation are excluded. */
export function rankPartitionRoutes({ planId, candidates, observations, workload, limits }) {
  assert(typeof planId === 'string' && Array.isArray(candidates) && candidates.length > 0
    && candidates.every(Array.isArray) && typeof observations?.get === 'function', 'Route ranking input required');
  assert(Number.isSafeInteger(workload?.promptTokens) && workload.promptTokens > 0
    && Number.isSafeInteger(workload.expectedTokens) && workload.expectedTokens > 0
    && Number.isSafeInteger(workload.allocationBytes) && workload.allocationBytes >= 0, 'Explicit ranking workload required');
  assert(Number.isSafeInteger(limits?.maxParticipants) && Number.isSafeInteger(limits.maxRoutes) && limits.maxRoutes > 0
    && Number.isSafeInteger(limits.maxSelectionSteps) && limits.maxSelectionSteps > 0, 'Explicit ranking limits required');
  const admitted = candidate => candidate.capacity?.availableSlots !== 0 && candidate.capacity?.closed !== true
    && (candidate.memory == null || finite(candidate.memory.availableBytes) && candidate.memory.availableBytes >= workload.allocationBytes);
  const rows = candidates.map((stage, index) => stage.filter(admitted).map(candidate => {
    assert(candidate.index === index && typeof candidate.participantId === 'string', 'Candidate stage mismatch');
    return { candidate, cost: stageCost(observations.get(planId, candidate.participantId, index), candidate, workload) };
  }).sort((a, b) => a.candidate.participantId < b.candidate.participantId ? -1 : a.candidate.participantId > b.candidate.participantId ? 1 : 0));
  const participants = [...new Set(rows.flat().map(row => row.candidate.participantId))].sort();
  assert(participants.length <= limits.maxParticipants && participants.length <= 30, 'Route ranking participant limit exceeded');
  const bit = new Map(participants.map((id, index) => [id, 1 << index]));
  // Enumerate distinct assignments stage by stage in participant order; the bound keeps work explicit.
  const routes = [];
  let steps = 0;
  const walk = (index, used, chosen, cost) => {
    assert(++steps <= limits.maxSelectionSteps, 'Route ranking work limit exceeded');
    if (index === rows.length) { routes.push({ stages: chosen.map(row => row.candidate), cost, measured: cost !== null,
      stageCosts: chosen.map(row => row.cost) }); return; }
    for (const row of rows[index]) {
      const mask = bit.get(row.candidate.participantId);
      if (used & mask) continue;
      walk(index + 1, used | mask, [...chosen, row], cost === null || row.cost === null ? null : cost + row.cost);
    }
  };
  walk(0, 0, [], 0);
  const order = (a, b) => (a.measured === b.measured ? 0 : a.measured ? -1 : 1)
    || (a.measured ? a.cost - b.cost : 0)
    || a.stages.map(stage => stage.participantId).join('\u0000').localeCompare(b.stages.map(stage => stage.participantId).join('\u0000'));
  return Object.freeze(routes.sort(order).slice(0, limits.maxRoutes).map(Object.freeze));
}

/** New attempts move to a better-ranked route only when it is cheaper by the margin; attempts already
 * running are never moved, and the current route is kept while any attempt on it is active. */
export function preferRoute({ current, ranked, active, margin }) {
  assert(finite(margin) && margin < 1 && Array.isArray(ranked), 'Explicit route preference margin required');
  const best = ranked[0] ?? null;
  if (!current || !best) return best ?? current ?? null;
  const same = route => route.stages.map(stage => stage.participantId).join() === current.stages.map(stage => stage.participantId).join();
  if (active || same(best)) return current;
  const mine = ranked.find(same);
  if (!best.measured || !mine?.measured) return mine ? current : best;
  return best.cost <= mine.cost * (1 - margin) ? best : current;
}
