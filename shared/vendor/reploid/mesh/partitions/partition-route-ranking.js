import { assertPartition as assert } from './partition-contract.js';

/** Expected-cost ranking of eligible prepared routes (DR-6; Launch 3, opt-in). It ranks complete
 * assignments of distinct prepared stages by expected cost per completed answer under an explicit,
 * versioned `reploid.route-cost-policy/v1`; nothing here grants, reserves or moves an attempt.
 * Peer identity is the deterministic tie-breaker, never the placement criterion.
 *
 * For a route, with workload P prompt tokens and T expected tokens, per stage i:
 *   latency   = prefill_i * P + decode_i * T           (stage execution; prices.latencyPerMs)
 *   transfer  = transfer_i * T                          (inbound activation transfer; prices.transferPerMs)
 *   queueing  = (active_i + queued_i) * (latency_i + transfer_i)   (advertised capacity; prices.queueingPerMs)
 *   opening   = 0 for a route already open or the local stage, else its measured channel opening
 *               (prices.preparationPerMs). Stage residents are always prepared: unprepared offers are
 *               not eligible, so routing never waits on stage preparation.
 *   refusal   r_i = (refusals_i + readiness.priorRefusals) / (admissions_i + readiness.priorAttempts)
 *   reserve   = max(0, reserve.spareSlots - (availableSlots_i - 1)) slots below the spare reserve
 * and per route f = (failures + failure.priorFailures) / (executions + failure.priorAttempts).
 * With a = prod(1 - r_i), retries on the same route give N = 1 / (a * (1 - f)) attempts per
 * completed answer, service S = latency + queueing + transfer costs and penalty F = refund + retry:
 *   readiness = N * (1 - a) * F      failure = N * a * f * (S + F)
 *   total     = S + preparation + readiness + failure + reserve
 * Unmeasured or stale latency/opening use the policy's declared priors and are labeled as such;
 * outcome probabilities always include the declared prior counts. Totals are compared in units of
 * `resolution`, so routes equal within it tie and fall back to participant ids. Answer quality is
 * route-independent under one model, plan and numerical tolerance and is not a ranking input. */
export const ROUTE_COST_POLICY_SCHEMA = 'reploid.route-cost-policy/v1';
export const ROUTE_SELECTION_SCHEMA = 'reploid.route-selection/v1';
export const ROUTE_RANKING_WORK_LIMIT = 'Route ranking work limit exceeded';
const RUNTIME = 'executionMs';
const POLICY_GROUPS = Object.freeze({
  prices: ['latencyPerMs', 'queueingPerMs', 'transferPerMs', 'preparationPerMs', 'refundPerFailure', 'retryPerFailure'],
  unknown: ['prefillMsPerToken', 'decodeMsPerToken', 'transferMsPerToken', 'openingMs', 'maxObservationAgeMs'],
  readiness: ['priorAttempts', 'priorRefusals'],
  failure: ['priorAttempts', 'priorFailures'],
  reserve: ['spareSlots', 'perMissingSlot']
});
const COMPONENTS = Object.freeze(['latency', 'queueing', 'transfer', 'preparation', 'readiness', 'failure', 'reserve']);
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const mean = row => row && row.count > 0 && finite(row.total) ? row.total / row.count : null;
const exact = (value, keys) => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const stageKey = stages => JSON.stringify(stages.map(({ participantId, transportId, residentId, executionId }) =>
  [participantId, transportId ?? null, residentId ?? null, executionId ?? null]));

/** Validates one complete cost policy and returns a frozen copy; a missing or unknown member fails. */
export function validateRouteCostPolicy(policy) {
  const fail = path => { throw new Error('Explicit route cost policy required: ' + path); };
  if (!exact(policy, ['schema', 'id', 'unit', 'resolution', ...Object.keys(POLICY_GROUPS)])) fail('members');
  if (policy.schema !== ROUTE_COST_POLICY_SCHEMA) fail('schema');
  for (const key of ['id', 'unit']) if (typeof policy[key] !== 'string' || !policy[key].length || policy[key].length > 128) fail(key);
  if (!finite(policy.resolution) || policy.resolution <= 0) fail('resolution');
  for (const [group, keys] of Object.entries(POLICY_GROUPS)) {
    if (!exact(policy[group], keys)) fail(group);
    for (const key of keys) if (!finite(policy[group][key])) fail(group + '.' + key);
  }
  const { unknown, readiness, failure, reserve } = policy;
  // Unmeasured computation is never free; transfer and opening priors may be zero only by declaration.
  if (unknown.prefillMsPerToken <= 0) fail('unknown.prefillMsPerToken');
  if (unknown.decodeMsPerToken <= 0) fail('unknown.decodeMsPerToken');
  if (!Number.isSafeInteger(unknown.maxObservationAgeMs) || unknown.maxObservationAgeMs <= 0) fail('unknown.maxObservationAgeMs');
  if (readiness.priorAttempts <= 0 || readiness.priorRefusals >= readiness.priorAttempts) fail('readiness');
  if (failure.priorAttempts <= 0 || failure.priorFailures >= failure.priorAttempts) fail('failure');
  if (!count(reserve.spareSlots)) fail('reserve.spareSlots');
  return freeze(structuredClone(policy));
}

/** Bounded per (plan, participant, stage) estimates and per-route execution outcomes, measured by this
 * coordinator. Latency and opening fold by exponential smoothing so a recovered or slowed contributor is
 * reflected without unbounded history; admission and execution outcomes are counts of distinct attempts. */
export function createRouteObservations({ maxEntries, smoothing }) {
  assert(Number.isSafeInteger(maxEntries) && maxEntries > 0 && finite(smoothing) && smoothing > 0 && smoothing <= 1,
    'Explicit observation limits required');
  const rows = new Map(), routes = new Map();
  const key = (planId, participantId, index) => JSON.stringify([planId, participantId, index]);
  const routeKey = (planId, participants) => JSON.stringify([planId, ...participants]);
  const fold = (previous, value) => value === null ? previous ?? null : previous == null ? value : previous + smoothing * (value - previous);
  const touch = (map, id, value) => { map.delete(id); map.set(id, value); while (map.size > maxEntries) map.delete(map.keys().next().value); };
  const row = (planId, stage) => rows.get(key(planId, stage.participantId, stage.index)) ?? { planId, participantId: stage.participantId,
    index: stage.index, at: null, samples: 0, decodeMs: null, transferMs: null, prefillMsPerToken: null,
    openingMs: null, openedAt: null, admissions: 0, refusals: 0 };
  const bound = (planId, route, at) => assert(typeof planId === 'string' && Array.isArray(route?.stages) && route.stages.length > 0
    && route.stages.every((stage, index) => stage?.index === index && typeof stage.participantId === 'string')
    && Number.isSafeInteger(at), 'Observation binding required');
  return Object.freeze({
    /** Folds one completed attempt's ordered phases (partition-summary.js) into per-stage latency. */
    record({ planId, route, phases, at }) {
      bound(planId, route, at);
      if (!phases?.prompt || !phases.decode) return 0;
      let recorded = 0;
      for (const stage of route.stages) {
        const prompt = phases.prompt.stages?.find(item => item.partitionIndex === stage.index);
        const decode = phases.decode.stages?.find(item => item.partitionIndex === stage.index);
        const decodeMs = mean(decode?.elapsedMs), executionMs = mean(decode?.runtime?.[RUNTIME]);
        const tokens = phases.prompt.inputTokens;
        const prefillMsPerToken = finite(prompt?.elapsedMs) && Number.isSafeInteger(tokens) && tokens > 0 ? prompt.elapsedMs / tokens : null;
        if (decodeMs === null && prefillMsPerToken === null) continue;
        const previous = row(planId, stage);
        touch(rows, key(planId, stage.participantId, stage.index), { ...previous, at, samples: previous.samples + 1,
          decodeMs: fold(previous.decodeMs, decodeMs),
          transferMs: fold(previous.transferMs, decodeMs !== null && executionMs !== null ? Math.max(decodeMs - executionMs, 0) : null),
          prefillMsPerToken: fold(previous.prefillMsPerToken, prefillMsPerToken) });
        recorded++;
      }
      return recorded;
    },
    /** One finished attempt: stages [0, admitted) admitted it; with `refused`, stage `admitted` refused it
     * (readiness). `execution` is the outcome after complete admission, or null when cancelled or never
     * fully admitted. Cancellation is never a refusal or failure. */
    recordOutcome({ planId, route, admitted, refused, execution, at }) {
      bound(planId, route, at);
      const all = route.stages.length;
      assert(Number.isSafeInteger(admitted) && admitted >= 0 && admitted <= all && typeof refused === 'boolean'
        && (!refused || admitted < all) && [null, 'completed', 'failed'].includes(execution)
        && (execution === null || admitted === all), 'Route outcome binding required');
      route.stages.slice(0, admitted + (refused ? 1 : 0)).forEach((stage, position) => {
        const previous = row(planId, stage);
        touch(rows, key(planId, stage.participantId, stage.index), { ...previous, admissions: previous.admissions + 1,
          refusals: previous.refusals + (position === admitted ? 1 : 0) });
      });
      if (execution === null) return;
      const participants = route.stages.map(stage => stage.participantId), id = routeKey(planId, participants);
      const previous = routes.get(id) ?? { planId, participants, at: null, executions: 0, failures: 0 };
      touch(routes, id, { ...previous, at, executions: previous.executions + 1, failures: previous.failures + (execution === 'failed' ? 1 : 0) });
    },
    /** Measured time to open this coordinator's channel to a stage for a new route. */
    recordOpening({ planId, stage, openingMs, at }) {
      assert(typeof planId === 'string' && typeof stage?.participantId === 'string' && Number.isSafeInteger(stage.index)
        && stage.index >= 0 && finite(openingMs) && Number.isSafeInteger(at), 'Opening observation required');
      const previous = row(planId, stage);
      touch(rows, key(planId, stage.participantId, stage.index), { ...previous, openingMs: fold(previous.openingMs, openingMs), openedAt: at });
    },
    get: (planId, participantId, index) => structuredClone(rows.get(key(planId, participantId, index)) ?? null),
    getRoute: (planId, participants) => structuredClone(routes.get(routeKey(planId, participants)) ?? null),
    snapshot: () => structuredClone([...rows.values()]),
    snapshotRoutes: () => structuredClone([...routes.values()])
  });
}

const fresh = (at, now, maxAge) => Number.isSafeInteger(at) && now - at <= maxAge;

/** Expected per-stage cost inputs for a new attempt on this candidate, each with its provenance. */
function stageInputs(candidate, observation, policy, workload, now) {
  const { unknown, readiness, reserve } = policy, maxAge = unknown.maxObservationAgeMs;
  const measuredLatency = observation?.samples > 0 && observation.decodeMs !== null && observation.prefillMsPerToken !== null;
  const latencySource = !measuredLatency ? 'prior' : fresh(observation.at, now, maxAge) ? 'measured' : 'stale';
  const measured = latencySource === 'measured';
  // Measured decode includes the stage's inbound transfer; split only where its execution time was reported.
  const split = measured && observation.transferMs !== null;
  const prefillMsPerToken = measured ? observation.prefillMsPerToken : unknown.prefillMsPerToken;
  const decodeMsPerToken = !measured ? unknown.decodeMsPerToken : split ? Math.max(observation.decodeMs - observation.transferMs, 0) : observation.decodeMs;
  const transferMsPerToken = !measured ? unknown.transferMsPerToken : split ? observation.transferMs : null;
  const latencyMs = prefillMsPerToken * workload.promptTokens + decodeMsPerToken * workload.expectedTokens;
  const transferMs = (transferMsPerToken ?? 0) * workload.expectedTokens;
  const { active, availableSlots } = candidate.capacity, queued = candidate.capacity.queued ?? 0;
  const openingSource = candidate.local ? 'local' : observation?.openingMs == null ? 'prior'
    : fresh(observation.openedAt, now, maxAge) ? 'measured' : 'stale';
  const openingMs = candidate.local ? 0 : openingSource === 'measured' ? observation.openingMs : unknown.openingMs;
  const admissions = observation?.admissions ?? 0, refusals = observation?.refusals ?? 0;
  return { latencyMs, transferMs, queueingMs: (active + queued) * (latencyMs + transferMs), openingMs,
    refusalProbability: (refusals + readiness.priorRefusals) / (admissions + readiness.priorAttempts),
    missingSlots: Math.max(0, reserve.spareSlots - (availableSlots - 1)),
    inputs: { index: candidate.index, participantId: candidate.participantId,
      latency: { source: latencySource, samples: observation?.samples ?? 0, observedAt: observation?.at ?? null,
        prefillMsPerToken, decodeMsPerToken, transfer: split ? 'measured' : measured ? 'within-decode' : latencySource, transferMsPerToken },
      capacity: { active, queued, availableSlots }, opening: { source: openingSource, ms: openingMs },
      admission: { admissions, refusals } } };
}

/** Ranks complete assignments of distinct participants to every stage by expected cost (see above).
 * Full, closed or memory-short candidates are inadmissible; a stage without an admissible candidate
 * yields no route, so a slow device is avoided only by another complete route, never by leaving
 * layers uncovered. `open` lists stage identities of routes this coordinator already opened. */
export function rankPartitionRoutes({ planId, candidates, observations, workload, limits, policy, now, open = [] }) {
  assert(typeof planId === 'string' && Array.isArray(candidates) && candidates.length > 0 && candidates.every(Array.isArray)
    && typeof observations?.get === 'function' && typeof observations.getRoute === 'function' && Array.isArray(open), 'Route ranking input required');
  const costs = validateRouteCostPolicy(policy);
  assert(Number.isSafeInteger(now) && now >= 0, 'Route ranking clock required');
  assert(Number.isSafeInteger(workload?.promptTokens) && workload.promptTokens > 0
    && Number.isSafeInteger(workload.expectedTokens) && workload.expectedTokens > 0
    && Number.isSafeInteger(workload.allocationBytes) && workload.allocationBytes >= 0, 'Explicit ranking workload required');
  assert(Number.isSafeInteger(limits?.maxParticipants) && Number.isSafeInteger(limits.maxRoutes) && limits.maxRoutes > 0
    && Number.isSafeInteger(limits.maxSelectionSteps) && limits.maxSelectionSteps > 0, 'Explicit ranking limits required');
  const admitted = candidate => candidate.capacity.availableSlots !== 0 && candidate.capacity.closed !== true
    && (candidate.memory == null || finite(candidate.memory.availableBytes) && candidate.memory.availableBytes >= workload.allocationBytes);
  const rows = candidates.map((stage, index) => stage.map(candidate => {
    assert(candidate.index === index && typeof candidate.participantId === 'string', 'Candidate stage mismatch');
    assert(count(candidate.capacity?.active) && count(candidate.capacity.availableSlots)
      && (candidate.capacity.queued === undefined || count(candidate.capacity.queued)), 'Candidate capacity required');
    return structuredClone(candidate);
  }).filter(admitted).map(candidate => ({ candidate, ...stageInputs(candidate, observations.get(planId, candidate.participantId, index), costs, workload, now) }))
    .sort((a, b) => a.candidate.participantId < b.candidate.participantId ? -1 : a.candidate.participantId > b.candidate.participantId ? 1 : 0));
  const participants = [...new Set(rows.flat().map(row => row.candidate.participantId))].sort();
  assert(participants.length <= limits.maxParticipants && participants.length <= 30, 'Route ranking participant limit exceeded');
  const bit = new Map(participants.map((id, index) => [id, 1 << index]));
  const opened = new Set(open.map(stageKey));
  const { prices } = costs, penalty = prices.refundPerFailure + prices.retryPerFailure;
  function price(chosen) {
    const stages = chosen.map(row => row.candidate), ids = stages.map(stage => stage.participantId);
    const prepared = opened.has(stageKey(stages));
    const sum = name => chosen.reduce((total, row) => total + row[name], 0);
    const latencyMs = sum('latencyMs'), queueingMs = sum('queueingMs'), transferMs = sum('transferMs');
    const preparationMs = prepared ? 0 : sum('openingMs'), reserveSlots = sum('missingSlots');
    const admit = chosen.reduce((product, row) => product * (1 - row.refusalProbability), 1);
    const outcome = observations.getRoute(planId, ids), executions = outcome?.executions ?? 0, failures = outcome?.failures ?? 0;
    const failureProbability = (failures + costs.failure.priorFailures) / (executions + costs.failure.priorAttempts);
    const attempts = 1 / (admit * (1 - failureProbability));
    const service = latencyMs * prices.latencyPerMs + queueingMs * prices.queueingPerMs + transferMs * prices.transferPerMs;
    const components = { latency: latencyMs * prices.latencyPerMs, queueing: queueingMs * prices.queueingPerMs,
      transfer: transferMs * prices.transferPerMs, preparation: preparationMs * prices.preparationPerMs,
      readiness: attempts * (1 - admit) * penalty, failure: attempts * admit * failureProbability * (service + penalty),
      reserve: reserveSlots * costs.reserve.perMissingSlot };
    const cost = COMPONENTS.reduce((total, name) => total + components[name], 0);
    return { stages, participants: ids, cost, units: Math.round(cost / costs.resolution), prepared,
      measured: chosen.every(row => row.inputs.latency.source === 'measured'), components,
      expected: { latencyMs, queueingMs, transferMs, preparationMs, reserveSlots, refusalProbability: 1 - admit,
        failureProbability, attemptsPerAnswer: attempts },
      inputs: { stages: chosen.map(row => row.inputs), execution: { executions, failures } } };
  }
  // Enumerate distinct assignments stage by stage in participant order; the bound keeps work explicit.
  const routes = [];
  let steps = 0;
  const walk = (index, used, chosen) => {
    assert(++steps <= limits.maxSelectionSteps, ROUTE_RANKING_WORK_LIMIT);
    if (index === rows.length) { routes.push(price(chosen)); return; }
    for (const row of rows[index]) {
      const mask = bit.get(row.candidate.participantId);
      if (used & mask) continue;
      walk(index + 1, used | mask, [...chosen, row]);
    }
  };
  walk(0, 0, []);
  // Ties compare participant ids stage by stage in code-unit order, like first-valid matching;
  // locale collation would ignore separators and differ between hosts.
  const byIds = (a, b) => { for (let i = 0; i < a.participants.length; i++) {
    const x = a.participants[i], y = b.participants[i];
    if (x !== y) return x < y ? -1 : 1;
  } return 0; };
  return freeze(routes.sort((a, b) => a.units - b.units || byIds(a, b)).slice(0, limits.maxRoutes));
}

/** New attempts move to a better-ranked route only when its expected cost is lower by the margin;
 * attempts already running are never moved, and the current route is kept while any attempt on it is
 * active. A current route that is no longer admissible (a full, closed or memory-short stage) takes no
 * new attempts, so they go to the best admissible route; its active attempts stay where they are. */
export function preferRoute({ current, ranked, active, margin }) {
  assert(finite(margin) && margin < 1 && Array.isArray(ranked), 'Explicit route preference margin required');
  const best = ranked[0] ?? null;
  if (!current || !best) return best ?? current ?? null;
  const ids = route => JSON.stringify(route.stages.map(stage => stage.participantId));
  const mine = ranked.find(route => ids(route) === ids(current));
  if (!mine) return best;
  if (active || ids(best) === ids(current)) return current;
  return best.cost <= mine.cost * (1 - margin) ? best : current;
}

/** The auditable record of one ranking decision: the full policy, workload, the chosen route's inputs
 * and cost breakdown, and the best `maxRoutes` alternatives. Unsigned coordinator observations. */
export function routeSelectionRecord({ policy, workload, ranked, chosen, reason, decidedAt, maxRoutes }) {
  assert(typeof reason === 'string' && Number.isSafeInteger(decidedAt) && Number.isSafeInteger(maxRoutes) && maxRoutes > 0
    && Array.isArray(ranked), 'Route selection record input required');
  const summary = route => ({ participants: [...route.participants], cost: route.cost, units: route.units, measured: route.measured,
    prepared: route.prepared, components: { ...route.components }, expected: { ...route.expected } });
  return freeze(structuredClone({ schema: ROUTE_SELECTION_SCHEMA, policy: validateRouteCostPolicy(policy), reason, decidedAt,
    workload: { promptTokens: workload.promptTokens, expectedTokens: workload.expectedTokens }, considered: ranked.length,
    chosen: chosen ? { ...summary(chosen), inputs: chosen.inputs } : null, alternatives: ranked.slice(0, maxRoutes).map(summary) }));
}
