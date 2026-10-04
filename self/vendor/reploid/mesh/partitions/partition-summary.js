/** Fixed-size timing projection for a completed requester response. Detailed
 * per-step observations belong to the executing runner, not its control frame. */
export function summarizePartitionExecution(execution) {
  if (!Array.isArray(execution.steps)) return structuredClone(execution);
  const { steps, transport, ...binding } = execution;
  const metrics = {};
  const add = (name, value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const row = metrics[name] ||= { count: 0, total: 0, min: value, max: value };
    row.count++; row.total += value; row.min = Math.min(row.min, value); row.max = Math.max(row.max, value);
  };
  for (const step of steps) {
    for (const key of ['localStepMs', 'serializationMs', 'transferMs', 'remoteStepMs', 'elapsedMs']) add(key, step[key]);
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
