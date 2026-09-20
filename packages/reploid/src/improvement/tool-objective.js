const assert = (condition, message) => { if (!condition) throw new Error(message); };
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function toolMeasurementIdentity() {
  return { measure: measureToolLatency.toString(), median: median.toString() };
}

/** Policy is selected by the host before candidate generation, never by candidate code. */
export function validateToolObjective(objective, maxSamples) {
  if (objective === undefined) return;
  assert(objective?.kind === 'repair-or-latency' && typeof objective.id === 'string' && objective.id.trim()
    && Number.isSafeInteger(objective.version) && objective.version > 0, 'Invalid versioned tool objective');
  assert(Number.isSafeInteger(maxSamples) && maxSamples > 0 && Number.isSafeInteger(objective.samples)
    && objective.samples >= 4 && objective.samples <= maxSamples, 'Invalid objective sample budget');
  assert(Array.isArray(objective.cases) && objective.cases.length > 0 && objective.cases.length <= objective.samples
    && objective.cases.every(item => item && Object.hasOwn(item, 'input')
      && (Object.hasOwn(item, 'expected') !== (item.throws === true))), 'Objective requires declared validation cases');
  assert(Number.isFinite(objective.minimumAbsoluteGainMs) && objective.minimumAbsoluteGainMs > 0
    && Number.isFinite(objective.minimumRelativeGain) && objective.minimumRelativeGain > 0 && objective.minimumRelativeGain < 1
    && Number.isInteger(objective.minimumFasterPairs) && objective.minimumFasterPairs > objective.samples / 2
    && objective.minimumFasterPairs <= objective.samples, 'Invalid objective improvement thresholds');
}

/** Measure outside candidate isolation. Alternating order includes sandbox startup and returned-value validation. */
export async function measureToolLatency({ objective, baseline, candidate, runCase, now, signal }) {
  const observations = [];
  const measure = async (code, test) => {
    signal?.throwIfAborted();
    const start = now(), result = await runCase(code, test, signal), end = now();
    assert(Number.isFinite(start) && Number.isFinite(end) && end >= start, 'Invalid host measurement clock');
    return { ...result, elapsedMs: end - start };
  };
  for (let index = 0; index < objective.samples; index++) {
    const testIndex = index % objective.cases.length, test = objective.cases[testIndex];
    const order = index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    const pair = { index, testIndex, order };
    for (const role of order) pair[role] = await measure(role === 'baseline' ? baseline : candidate, test);
    observations.push(pair);
  }
  const baselineMedianMs = median(observations.map(row => row.baseline.elapsedMs));
  const candidateMedianMs = median(observations.map(row => row.candidate.elapsedMs));
  const medianGainMs = median(observations.map(row => row.baseline.elapsedMs - row.candidate.elapsedMs));
  const medianRelativeGain = median(observations.map(row => row.baseline.elapsedMs > 0
    ? (row.baseline.elapsedMs - row.candidate.elapsedMs) / row.baseline.elapsedMs : 0));
  const fasterPairs = observations.filter(row => row.candidate.elapsedMs < row.baseline.elapsedMs).length;
  const valid = observations.every(row => row.baseline.passed && row.candidate.passed);
  return { objectiveId: objective.id, objectiveVersion: objective.version, observations, valid,
    candidateValid: observations.every(row => row.candidate.passed),
    baselineMedianMs, candidateMedianMs, medianGainMs, medianRelativeGain, fasterPairs,
    improved: valid && medianGainMs >= objective.minimumAbsoluteGainMs
      && medianRelativeGain >= objective.minimumRelativeGain && fasterPairs >= objective.minimumFasterPairs };
}
