/** Bounded public loading telemetry. Never publish file paths, prompts or raw errors. */
export function publicPreparationProgress(progress) {
  if (!progress || typeof progress !== 'object') return null;
  let kind = progress.kind;
  if (!['downloading', 'receiving', 'cached', 'pipelines', 'loading'].includes(kind)) {
    if (progress.stage === 'acquiring') kind = /^Downloading/.test(progress.message) ? 'downloading'
      : /^Receiving/.test(progress.message) ? 'receiving' : /^Reusing/.test(progress.message) ? 'cached' : 'loading';
    else kind = progress.phase === 'pipelines' || progress.stage === 'preparing' && Number.isSafeInteger(progress.prepared)
      ? 'pipelines' : 'loading';
  }
  const result = { kind };
  if (typeof progress.workId === 'string' && progress.workId.length <= 96) result.workId = progress.workId;
  if (Number.isSafeInteger(progress.sequence) && progress.sequence >= 0) result.sequence = progress.sequence;
  if (['preparing', 'prepared', 'cancelling', 'cancelled', 'timed-out', 'failed'].includes(progress.status)) result.status = progress.status;
  if (typeof progress.outstanding === 'boolean') result.outstanding = progress.outstanding;
  if (Number.isSafeInteger(progress.receivedBytes) && Number.isSafeInteger(progress.totalBytes)
    && progress.totalBytes > 0 && progress.receivedBytes >= 0 && progress.receivedBytes <= progress.totalBytes) {
    result.receivedBytes = progress.receivedBytes; result.totalBytes = progress.totalBytes;
  }
  if (kind === 'pipelines' && Number.isSafeInteger(progress.prepared) && Number.isSafeInteger(progress.total)
    && progress.total > 0 && progress.prepared >= 0 && progress.prepared <= progress.total) {
    result.prepared = progress.prepared; result.total = progress.total;
  }
  return result;
}


/** Observation-only high-water counters per preparation and file/pipeline work item.
 * Paths stay local; opaque work IDs distinguish a new file from regressing progress.
 */
export function createPreparationProgressObserver() {
  const operation = crypto.randomUUID(), work = new Map();
  let sequence = 0;
  return value => {
    const step = publicPreparationProgress(value);
    if (!step) return value;
    const key = JSON.stringify([step.kind, value.path || '', step.totalBytes ?? step.total ?? null]);
    const previous = work.get(key);
    const next = { ...value, ...step, workId: previous?.workId || `${operation}:${work.size}`, sequence: ++sequence };
    for (const field of ['receivedBytes', 'prepared']) if (previous?.[field] !== undefined) {
      next[field] = Math.max(previous[field], next[field] ?? 0);
    }
    work.set(key, next);
    return next;
  };
}
