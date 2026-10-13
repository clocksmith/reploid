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
      stepSummary: { count: execution.steps?.length || 0, stages: [...stages.values()], detail: 'aggregate; no per-step trace transferred' } });
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
