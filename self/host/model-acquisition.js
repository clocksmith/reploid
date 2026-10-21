/** Download consent and lifetime; Doppler owns acquisition, verification and resume. */
import { DOPPLER_MODULE_URL } from '../config/doppler-local-models.js';
import { announceModelCacheChange } from './work-model-cache.js';
import policy from '../config/chat-files.json' with { type: 'json' };

export const loadModelCache = () => import(new URL('./storage/model-cache.js',
  new URL(globalThis.REPLOID_DOPPLER_MODULE_URL || DOPPLER_MODULE_URL, location.href)).href);

export async function retainedModelSource(model, load = loadModelCache) {
  const source = await (await load()).loadPersistentModelSource(model.id);
  if (!source) return null;
  if (source.manifest?.modelId !== model.id || 'sha256:' + source.manifestHash !== model.identity) {
    await source.storageContext?.close?.(); return null;
  }
  return source;
}

// Imports and adapter discovery cannot be cancelled by their native APIs. Stop
// awaiting them on cancellation; neither operation starts a model transfer.
async function awaitSetup(pending, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([pending, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}

export function acquisitionProgress(value) {
  const received = Number.isFinite(value?.downloadedBytes) && value.downloadedBytes >= 0 ? value.downloadedBytes : null;
  const total = Number.isFinite(value?.totalBytes) && value.totalBytes > 0 ? value.totalBytes : null;
  const mb = bytes => (bytes / 1e6).toFixed(1) + ' MB';
  // Doppler also emits phase percentages. Only measured byte totals justify a download percentage.
  return { receivedBytes: received, totalBytes: total,
    message: value?.stage === 'downloading' ? 'Downloading ' + (received === null ? 'model files' : mb(received))
      + (total && received !== null ? ' of ' + mb(total) + ' (' + Math.min(100, Math.floor(received / total * 100)) + '%)' : '') + '.'
      : value?.stage === 'download-complete' ? 'Verifying downloaded model files.' : 'Checking and preparing model files.' };
}

export function createModelAcquisition({ onChange = () => {}, load = loadModelCache,
  capabilities = () => ({ gpu: !!navigator.gpu, storage: !!navigator.storage?.getDirectory, locks: navigator.locks, checkGpu: () => navigator.gpu.requestAdapter() }),
  idleMs = 90000, deadlineMs = 1800000 } = {}) {
  let state = { phase: 'idle', modelId: null, error: null, progress: null }, active = null, closed = false;
  const supportError = () => {
    const support = capabilities();
    return !support.gpu ? 'This browser cannot run models locally. Use a browser with WebGPU or reconnect to network capacity.'
      : !support.storage ? 'Browser model storage is unavailable. Allow site storage or reconnect to network capacity.'
      : !support.locks?.request ? 'This browser cannot safely coordinate model downloads. Use a browser with Web Locks.' : null;
  };
  const snapshot = () => structuredClone(state);
  const publish = update => { state = { ...state, ...update }; if (!closed) onChange(); };
  const start = (model, approved, sizeBytes) => {
    if (closed) return Promise.reject(Error('Model acquisition is closed'));
    if (approved !== true) return Promise.reject(Error('Approve the model download first'));
    if (active) return active.modelId === model.id ? active.promise : Promise.reject(Error('Another model is downloading'));
    const controller = new AbortController(), operation = { controller, modelId: model.id };
    active = operation;
    let idle;
    const abort = message => { if (!controller.signal.aborted) controller.abort(Error(message)); };
    const touch = () => { clearTimeout(idle); idle = setTimeout(() => abort('Model download stopped making progress. Retry to resume.'), idleMs); };
    const deadline = setTimeout(() => abort('Model download reached its time limit. Retry to resume.'), deadlineMs);
    touch();
    operation.promise = Promise.resolve().then(async () => {
      const support = capabilities();
      const unsupported = supportError(); if (unsupported) throw Error(unsupported);
      if (support.checkGpu && !await awaitSetup(support.checkGpu(), controller.signal)) throw Error('No WebGPU adapter is available. Reconnect to network capacity or try another browser.');
      controller.signal.throwIfAborted();
      if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > policy.maxStoredBytes) throw Error('Model exceeds this device’s approved storage limit. Choose a smaller model.');
      const run = async lock => {
        if (!lock) throw Error('Another tab is downloading a model. Wait for it to finish, then retry.');
        controller.signal.throwIfAborted();
        const cache = await awaitSetup(load(), controller.signal); controller.signal.throwIfAborted();
        let source;
        try {
          source = await cache.ensureModelCachedSource(model.id, model.source.baseUrl.replace(/\/+$/, ''), value => {
            if (active !== operation || controller.signal.aborted || closed) return;
            touch(); publish({ progress: acquisitionProgress(value) });
          }, { signal: controller.signal, expectedManifestHash: model.identity });
          controller.signal.throwIfAborted();
          if (source.manifest?.modelId !== model.id || 'sha256:' + source.manifestHash !== model.identity) throw Error('Downloaded model identity mismatch');
        } finally { await source?.storageContext?.close?.(); }
      };
      await support.locks.request('reploid:model-acquisition', { ifAvailable: true }, run);
      controller.signal.throwIfAborted();
      announceModelCacheChange();
      publish({ phase: 'complete', progress: { message: 'Model stored. Send prepares it on this device.' } });
      return { id: model.id, identity: model.identity };
    }).catch(cause => {
      const message = controller.signal.aborted ? controller.signal.reason?.message : cause?.message;
      publish({ phase: controller.signal.aborted && controller.signal.reason?.name === 'AbortError' ? 'cancelled' : 'failed',
        error: message || String(cause), progress: null });
      throw cause;
    }).finally(() => { clearTimeout(idle); clearTimeout(deadline); if (active === operation) active = null; });
    publish({ phase: 'downloading', modelId: model.id, error: null, progress: acquisitionProgress(null) });
    return operation.promise;
  };
  return { start, getState: snapshot, supportError,
    cancel() {
      if (!active || active.controller.signal.aborted) return;
      active.controller.abort(new DOMException('Download cancelled.', 'AbortError'));
      publish({ progress: { message: 'Stopping download. Waiting for storage to finish.' } });
    },
    async close() { closed = true; active?.controller.abort(new DOMException('Application closed', 'AbortError')); await active?.promise.catch(() => {}); }
  };
}
