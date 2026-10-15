import { canonicalRouteAttemptBinding, sameRouteAttemptIdentity } from './partition-contract.js';

// Doppler resident stage metrics (PartitionTiming plus execution, readback and
// sampling). Contributors report them; only finite non-negative numbers count.
const STAGE_RUNTIME_KEYS = Object.freeze(['executionMs', 'inputUploadMs', 'encodeMs', 'submitWaitMs',
  'activationReadbackMs', 'logitsMs', 'gpuKernelsMs', 'logitsReadbackMs', 'samplingMs']);
const measuredMs = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;

/** Step 0 carries the whole prompt (prefill and the first sampled token); later
 * steps decode one token each. Keep them apart so prompt length, prefill and
 * decode are never averaged together. */
function summarizeOrderedPhases(steps) {
  const aggregate = () => ({ count: 0, total: 0, min: null, max: null });
  const add = (row, value) => {
    if (value === null) return;
    row.count++; row.total += value;
    row.min = row.min === null ? value : Math.min(row.min, value); row.max = row.max === null ? value : Math.max(row.max, value);
  };
  const first = steps[0];
  const prompt = first ? { inputTokens: Number.isSafeInteger(first.inputTokenCount) ? first.inputTokenCount : null,
    stages: (first.stages || []).map(stage => ({ partitionIndex: stage.partitionIndex, elapsedMs: measuredMs(stage.elapsedMs),
      runtime: Object.fromEntries(STAGE_RUNTIME_KEYS.map(key => [key, measuredMs(stage.metrics?.[key])])) })) } : null;
  const decodeStages = new Map();
  for (const step of steps.slice(1)) for (const stage of step.stages || []) {
    const row = decodeStages.get(stage.partitionIndex) || { partitionIndex: stage.partitionIndex, elapsedMs: aggregate(),
      runtime: Object.fromEntries(STAGE_RUNTIME_KEYS.map(key => [key, aggregate()])) };
    add(row.elapsedMs, measuredMs(stage.elapsedMs));
    for (const key of STAGE_RUNTIME_KEYS) add(row.runtime[key], measuredMs(stage.metrics?.[key]));
    decodeStages.set(stage.partitionIndex, row);
  }
  return { prompt, decode: { steps: Math.max(steps.length - 1, 0), stages: [...decodeStages.values()] } };
}

/** Fixed-size timing projection for a completed requester response. Detailed
 * per-step observations belong to the executing runner, not its control frame. */
export function summarizePartitionExecution(execution) {
  if (execution.schema === 'reploid.mesh.partition-execution/v3') {
    const stages = new Map();
    for (const step of execution.steps || []) for (const stage of step.stages || []) {
      const row = stages.get(stage.partitionIndex) || { partitionIndex: stage.partitionIndex, steps: 0,
        stepMs: { count: 0, total: 0 } };
      if (Number.isFinite(stage.elapsedMs) && stage.elapsedMs >= 0) {
        row.stepMs.count++; row.stepMs.total += stage.elapsedMs;
      }
      row.steps++; stages.set(stage.partitionIndex, row);
    }
    return structuredClone({ schema: 'reploid.mesh.partition-summary/v2', identity: execution.identity,
      activationBytes: execution.activationBytes, stopReason: execution.stopReason, settlement: execution.settlement,
      stepSummary: { count: execution.steps?.length || 0, stages: [...stages.values()],
        phases: summarizeOrderedPhases(execution.steps || []), detail: 'aggregate; no per-step trace transferred' },
      // A ranking coordinator's unsigned record of the decision that chose this attempt's route.
      ...(execution.routeSelection ? { routeSelection: execution.routeSelection } : {}) });
  }
  if (execution.schema === 'reploid.mesh.canonical-partition-execution/v1') {
    // Signed records are already retained by the requester transaction owner.
    // Do not transfer the full history again in a bounded final control frame.
    const { publications: _publications, ...summary } = execution;
    execution = summary;
  }
  if (!Array.isArray(execution.steps)) return structuredClone(execution);
  const { steps, transport, ...binding } = execution;
  const metrics = {};
  const add = (name, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const row = metrics[name] ||= { count: 0, total: 0, min: value, max: value };
    row.count++; row.total += value; row.min = Math.min(row.min, value); row.max = Math.max(row.max, value);
  };
  for (const step of steps) {
    for (const key of ['leaseWaitMs', 'outputDeliveryMs', 'localStepMs', 'serializationMs',
      'transferMs', 'remoteStepMs', 'elapsedMs']) add(key, step[key]);
    for (const owner of ['computationA', 'computationB']) {
      for (const key of ['inputUploadMs', 'encodeMs', 'submitWaitMs', 'activationReadbackMs', 'logitsMs',
        'gpuKernelsMs', 'executionMs', 'logitsReadbackMs', 'samplingMs']) {
        add(`${owner}.${key}`, step[owner]?.[key]);
      }
    }
    for (const key of ['authorizationMs', 'readyWaitMs', 'payloadUploadMs', 'responseWaitMs', 'acceptanceMs', 'totalMs']) {
      add(`transportTiming.${key}`, step.transportTiming?.[key]);
    }
  }
  const { lastFailure: _localFailure, ...delivery } = transport || {};
  const memoryAtLastStep = {};
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  for (const owner of ['computationA', 'computationB']) {
    const memory = steps.at(-1)?.[owner]?.memory;
    if (memory) memoryAtLastStep[owner] = {
      maxBytes: number(memory.maxBytes), liveBytes: number(memory.liveBytes), peakBytes: number(memory.peakBytes),
      categories: Object.fromEntries(['weights', 'attention', 'recurrent', 'other'].map(key => [key, number(memory.categories?.[key])]))
    };
  }
  return { ...structuredClone(binding), schema: 'reploid.mesh.partition-summary/v1',
    stepSummary: { count: steps.length, metrics, detail: 'aggregate; no per-step trace transferred' },
    memoryAtLastStep, transport: delivery };
}

/** Bounded completed-token observations measured on the coordinator clock.
 * These describe execution only; they are never text or publication records. */
export function partitionActivity(value, identity, previous = null, coalesced = false) {
  const fail = () => { throw new Error('Invalid or out-of-order partition activity'); };
  const expected = canonicalRouteAttemptBinding(identity);
  if (!value || value.schema !== 'reploid.partition-activity/v1'
    || !sameRouteAttemptIdentity(value.identity, expected)
    || (coalesced ? value.sequence < (previous ? previous.sequence + 1 : 0)
      : value.sequence !== (previous ? previous.sequence + 1 : 0))) fail();
  const summary = value.stepSummary;
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 0
    || !Number.isSafeInteger(summary?.count) || summary.count !== value.sequence + 1 || !Array.isArray(summary.stages)
    || summary.stages.length !== expected.route.stages.length) fail();
  let measuredTotal = 0;
  const stages = summary.stages.map((row, index) => {
    if (row.partitionIndex !== index || row.steps !== summary.count
      || row.stepMs?.count !== summary.count || !Number.isFinite(row.stepMs.total) || row.stepMs.total < 0
      || previous && row.stepMs.total < previous.stepSummary.stages[index].stepMs.total) fail();
    measuredTotal += row.stepMs.total;
    if (!Number.isFinite(measuredTotal)) fail();
    return { partitionIndex: index, steps: row.steps, stepMs: { count: row.stepMs.count, total: row.stepMs.total } };
  });
  return { schema: 'reploid.partition-activity/v1', identity: expected, sequence: value.sequence,
    stepSummary: { count: summary.count, stages } };
}
