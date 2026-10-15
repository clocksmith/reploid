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
