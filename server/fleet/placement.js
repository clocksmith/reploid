import { assert, digest, integer, text } from './contract.js';

const key = value => `${value.id}:${value.identity}`;
const fresh = (at, now, policy) => Number.isFinite(at) && at <= now && now - at <= policy.maxObservationAgeMs;
const positive = value => Number.isFinite(value) && value > 0;
const compare = (a, b) => a.costMs - b.costMs || a.computer.id.localeCompare(b.computer.id);

/** Deterministic policy over measured execution envelopes. Advertised GPU names never establish fit. */
export function planFleetPlacement({ computers, demand, models, links, policy, now }) {
  assert(integer(now) && integer(policy?.maxObservationAgeMs) && policy.maxObservationAgeMs > 0
    && integer(policy.maxMeasurementAgeMs) && policy.maxMeasurementAgeMs > 0
    && integer(policy.minResidencyMs) && positive(policy.maxRouteCandidates)
    && Number.isSafeInteger(policy.maxRouteCandidates) && positive(policy.queuedRequestsPerReplica), 'Explicit placement policy required');
  assert(Array.isArray(computers) && Array.isArray(demand) && Array.isArray(models) && Array.isArray(links), 'Fleet observations required');
  const machines = structuredClone(computers), catalog = structuredClone(models), decisions = [], routes = [], unavailable = [];
  assert(new Set(machines.map(row => row.id)).size === machines.length, 'Duplicate computer');
  const occupied = new Set();
  for (const computer of machines) {
    assert(text(computer.id) && text(computer.participantId) && Array.isArray(computer.measurements)
      && Array.isArray(computer.preferences?.models) && integer(computer.activeRequests), 'Invalid computer observation');
    const allowed = computer.preferences.enabled === true && (!computer.resident
      || computer.preferences.models.some(model => model.identity === computer.resident.modelIdentity));
    if (!allowed && computer.activeRequests === 0) {
      occupied.add(computer.id);
      decisions.push({ computerId: computer.id, action: 'stop', reason: 'owner-preferences', resident: computer.resident ?? null });
      continue;
    }
    if (computer.activeRequests > 0 || computer.resident && now - computer.resident.preparedAt < policy.minResidencyMs) {
      occupied.add(computer.id);
      decisions.push({ computerId: computer.id, action: 'retain', reason: computer.activeRequests ? 'active-requests' : 'minimum-residency',
        resident: computer.resident ?? null });
    }
  }
  function candidates(model, workload, mode, planId = null, stageIndex = null) {
    const results = [];
    for (const computer of machines) {
      const preferences = computer.preferences;
      if (preferences.enabled !== true || !fresh(computer.observedAt, now, policy)
        || !preferences.models.some(value => key(value) === key(model))) continue;
      for (const measurement of computer.measurements) {
        if (measurement.modelIdentity !== model.identity || measurement.mode !== mode
          || (measurement.planId ?? null) !== planId || (measurement.stageIndex ?? null) !== stageIndex
          || measurement.qualified !== true || !text(measurement.receipt)
          || !digest(computer.softwareIdentity) || measurement.softwareIdentity !== computer.softwareIdentity
          || !fresh(measurement.observedAt, now, { maxObservationAgeMs: policy.maxMeasurementAgeMs })
          || !positive(measurement.prefillTokensPerSecond) || !positive(measurement.decodeTokensPerSecond)
          || !integer(measurement.loadMs) || !integer(measurement.requiredGpuBytes) || !integer(measurement.requiredHostBytes)
          || !integer(measurement.maxPromptTokens) || workload.promptTokens > measurement.maxPromptTokens
          || !integer(measurement.maxOutputTokens) || workload.outputTokens > measurement.maxOutputTokens
          || !integer(measurement.largestBindingBytes)) continue;
        const sameResident = computer.resident?.modelIdentity === model.identity && computer.resident.mode === mode
          && (computer.resident.planId ?? null) === planId && (computer.resident.stageIndex ?? null) === stageIndex;
        // freeGpuBytes excludes this service's removable resident; explicitly reclaim only its accounted buffers.
        const reclaim = sameResident || computer.activeRequests === 0 ? computer.resident?.gpuBytes ?? 0 : 0;
        const gpuBudget = Math.min(preferences.maxGpuBytes, computer.freeGpuBytes + reclaim);
        const hostBudget = Math.min(preferences.maxHostBytes, computer.freeHostBytes + (sameResident || computer.activeRequests === 0 ? computer.resident?.hostBytes ?? 0 : 0));
        if (![gpuBudget, hostBudget, computer.maxStorageBufferBindingSize].every(integer)
          || measurement.requiredGpuBytes > gpuBudget || measurement.requiredHostBytes > hostBudget
          || measurement.largestBindingBytes > computer.maxStorageBufferBindingSize) continue;
        results.push({ computer, measurement, sameResident, mode, planId, stageIndex });
      }
    }
    return results;
  }
  function assign(candidate, model, reason) {
    occupied.add(candidate.computer.id);
    decisions.push({ computerId: candidate.computer.id, action: candidate.sameResident ? 'retain' : 'prepare', reason,
      modelId: model.id, modelIdentity: model.identity, mode: candidate.mode, planId: candidate.planId,
      stageIndex: candidate.stageIndex, evidence: candidate.measurement.receipt, estimatedMs: candidate.costMs });
  }
  const workloads = structuredClone(demand).sort((a, b) => b.queued - a.queued || a.since - b.since || a.id.localeCompare(b.id));
  for (const workload of workloads) {
    assert(text(workload.id) && digest(workload.identity) && integer(workload.queued) && integer(workload.promptTokens)
      && integer(workload.outputTokens) && integer(workload.since), 'Invalid measured demand');
    if (workload.queued === 0) continue;
    const model = catalog.find(value => key(value) === key(workload));
    if (!model) { unavailable.push({ modelId: workload.id, reason: 'unknown-exact-model' }); continue; }
    const cost = candidate => ({ ...candidate, costMs: (candidate.sameResident ? 0 : candidate.measurement.loadMs)
      + 1000 * (workload.promptTokens / candidate.measurement.prefillTokensPerSecond
      + workload.outputTokens / candidate.measurement.decodeTokensPerSecond) });
    const whole = candidates(model, workload, 'whole-model').map(cost).sort(compare);
    // The product contract prefers feasible whole-model service, including a busy provider's next slot.
    if (whole.length) {
      let count = 0;
      const wanted = Math.ceil(workload.queued / policy.queuedRequestsPerReplica);
      const considered = new Set();
      for (const candidate of whole) {
        // Several qualified envelopes describe one computer, not additional replicas.
        // Sorted order retains that computer's lowest estimated cost.
        if (considered.has(candidate.computer.id)) continue;
        considered.add(candidate.computer.id);
        if (occupied.has(candidate.computer.id)) {
          if (candidate.sameResident && count < wanted) {
            count++;
            routes.push({ modelId: model.id, modelIdentity: model.identity, mode: 'whole-model', computers: [candidate.computer.id],
              estimatedMs: candidate.costMs, busy: candidate.computer.activeRequests > 0 });
          }
          continue;
        }
        if (count >= wanted) break;
        assign(candidate, model, count ? 'queued-demand-replica' : 'fastest-feasible-whole-model'); count++;
        routes.push({ modelId: model.id, modelIdentity: model.identity, mode: 'whole-model', computers: [candidate.computer.id], estimatedMs: candidate.costMs });
      }
      if (!count) unavailable.push({ modelId: model.id, reason: 'eligible-computer-busy' });
      continue;
    }
    let best = null, visited = 0;
    for (const plan of model.plans || []) {
      assert(digest(plan.id) && integer(plan.stageCount) && plan.stageCount >= 2 && integer(plan.activationBytesPerToken), 'Invalid partition plan envelope');
      const stages = Array.from({ length: plan.stageCount }, (_, index) => candidates(model, workload, 'partition', plan.id, index)
        .filter(candidate => !occupied.has(candidate.computer.id) || candidate.sameResident).map(cost).sort(compare));
      const walk = (index, route, costMs) => {
        if (visited++ >= policy.maxRouteCandidates || best && costMs >= best.costMs) return;
        if (index === stages.length) { best = { route, costMs, planId: plan.id }; return; }
        for (const candidate of stages[index]) {
          if (route.some(value => value.computer.id === candidate.computer.id)) continue;
          let transfer = 0;
          if (index > 0) {
            const link = links.find(value => value.from === route[index - 1].computer.id && value.to === candidate.computer.id
              && fresh(value.observedAt, now, policy) && positive(value.bytesPerSecond) && Number.isFinite(value.latencyMs) && value.latencyMs >= 0);
            if (!link) continue;
            transfer = (workload.outputTokens + 1) * link.latencyMs
              + 1000 * plan.activationBytesPerToken * (workload.promptTokens + workload.outputTokens) / link.bytesPerSecond;
          }
          walk(index + 1, [...route, candidate], costMs + candidate.costMs + transfer);
        }
      };
      walk(0, [], 0);
    }
    if (!best) { unavailable.push({ modelId: model.id, reason: visited >= policy.maxRouteCandidates ? 'bounded-route-search-exhausted' : 'no-measured-complete-route' }); continue; }
    for (const candidate of best.route) if (!occupied.has(candidate.computer.id)) assign(candidate, model, 'complete-partition-route');
    routes.push({ modelId: model.id, modelIdentity: model.identity, mode: 'partition', planId: best.planId,
      computers: best.route.map(value => value.computer.id), estimatedMs: best.costMs });
  }
  for (const computer of machines) if (!occupied.has(computer.id)) decisions.push({ computerId: computer.id, action: 'retain', reason: 'no-uncovered-demand', resident: computer.resident ?? null });
  return { schema: 'reploid.fleet-placement/v1', at: now, decisions, routes, unavailable };
}
