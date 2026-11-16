/** Observers never control execution or settlement. Report synchronous and async
 * failures without preventing later observers from receiving independent snapshots. */
export function reportObserverError(error) {
  console.error('[Reploid] observer failed', error);
}
export function notifyObservers(listeners, snapshot, onError = reportObserverError) {
  const report = error => {
    try {
      Promise.resolve(onError(error)).catch(reportObserverError);
    } catch (reportingError) { reportObserverError(reportingError); }
  };
  for (const listener of listeners) {
    try {
      const result = listener(snapshot());
      if (result?.then) Promise.resolve(result).catch(report);
    } catch (error) { report(error); }
  }
}
