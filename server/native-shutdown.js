

/** Attempt provider cleanup even when participant settlement reports failure. */
export function createNativeShutdown(participant, gpuHost) {
  let closing;
  return () => closing ||= (async () => {
    const failures = [];
    try { await participant.close(); } catch (error) { failures.push(error); }
    try { await gpuHost.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'Native host cleanup failed');
  })();
}
