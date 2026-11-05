/** One public preparation projection for setup, production and sharing controls. */
import { publicPreparationProgress } from '../../../shared/vendor/reploid/mesh/preparation-progress.js';

export function preparationStatus(progress) {
  const normalized = progress && typeof progress === 'object' ? { ...progress,
    receivedBytes: progress.receivedBytes ?? progress.loadedBytes ?? progress.downloadedBytes,
    ...(progress.stage === 'downloading' && !progress.kind ? { kind: 'downloading' } : {}) } : progress;
  const step = publicPreparationProgress(normalized);
  if (!step) return { status: 'Preparing', detail: 'Preparing the model; this computer has not reported the current step.' };
  const count = step.totalBytes ? ` ${Math.floor(step.receivedBytes / step.totalBytes * 100)}% of the current file.` : '';
  const labels = {
    downloading: ['Downloading', 'Downloading model files.' + count],
    receiving: ['Receiving files', 'Receiving model files from another computer.' + count],
    cached: ['Loading cache', 'Loading model files already stored on this computer.'],
    pipelines: ['Preparing GPU', 'Preparing GPU pipelines' + (step.total ? `: ${step.prepared} of ${step.total}.` : '.')],
    loading: ['Preparing', 'Loading the model into memory.']
  };
  const [status, detail] = labels[step.kind];
  const maximum = step.totalBytes || step.total || null;
  return { status, detail, progress: maximum ? { value: step.receivedBytes ?? step.prepared ?? 0, max: maximum, workId: step.workId || null, sequence: step.sequence ?? null } : null };
}
