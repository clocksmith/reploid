import { assertPackSession } from './executable-pack.js';
import { validateOperationModel } from './operation-model.js';
import { runPackOperation, snapshotPackOperationData } from './pack-operation.js';
import { DopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';

/** Application-selected local sessions do not admit a model to the public peer catalog. */
export function createLocalPackExecutor({ service = DopplerRuntimeService, scope = 'reploid:documents' } = {}) {
  let disposed = false;
  let active = false;
  let epoch = 0;
  let controller = null;
  let settlement = Promise.resolve();
  return {
    async run({ model: modelInput, input, options = {}, limits, signal = null, onPartial = null }) {
      if (disposed || active) throw new Error(disposed ? 'Document executor is closed' : 'A document operation is already running');
      const model = snapshotPackOperationData(modelInput);
      const validation = validateOperationModel(model);
      if (!validation.ok) throw new Error(validation.reasons.join('; '));
      if (typeof model.runtimeVersion !== 'string' || !model.runtimeVersion) throw new Error('Exact runtime version required');
      const source = new URL(model.packSource);
      if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) throw new Error('Pack source must be an HTTP(S) URL without credentials');
      if (!model.packOpenOptions?.trustedSigners || !Object.keys(model.packOpenOptions.trustedSigners).length) throw new Error('Application-selected trusted signers required');
      const request = snapshotPackOperationData({ schema: 'doppler.pack-operation-request/v1',
        operation: { name: model.executablePack.requiredOperation, version: 1 }, input, options,
        assignment: null, limits });
      const remaining = limits?.deadlineAt - Date.now();
      if (!Number.isSafeInteger(limits?.deadlineAt) || remaining <= 0 || remaining > 2147483647) throw new Error('Document operation requires a future bounded deadline');
      const currentEpoch = ++epoch;
      active = true;
      controller = new AbortController();
      const localController = controller;
      const timer = setTimeout(() => localController.abort(new Error('Document operation deadline exceeded')), remaining);
      const abort = () => localController.abort(signal.reason);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const assertCurrent = () => {
        localController.signal.throwIfAborted();
        if (Date.now() >= limits.deadlineAt) throw new Error('Document operation deadline exceeded');
        if (disposed || currentEpoch !== epoch) throw new Error('Document operation is no longer current');
      };
      let rejectCancellation;
      const cancelled = new Promise((_resolve, reject) => { rejectCancellation = reject; });
      const onCancel = () => rejectCancellation(localController.signal.reason || new Error('Document operation cancelled'));
      localController.signal.addEventListener('abort', onCancel, { once: true });
      if (localController.signal.aborted) onCancel();
      const operation = (async () => {
        let execution;
        try {
          assertCurrent();
          const prepared = await service.prepare();
          assertCurrent();
          if (prepared.version !== model.runtimeVersion) throw new Error('Document Pack requires a different Doppler release');
          const session = await service.openPack({ scope, source: source.href,
            options: { ...model.packOpenOptions, acceptedTargetPlanDigests: model.executablePack.acceptedTargetPlanDigests } });
          assertCurrent();
          await assertPackSession(model.executablePack, session);
          if (session.modelId !== model.modelId) throw new Error('Loaded Pack model id mismatch');
          execution = await runPackOperation({ binding: model.executablePack, session, request,
            runtimeVersion: model.runtimeVersion, signal: localController.signal, onPartial, assertCurrent });
        } finally {
          try { await service.close(scope); } finally {
            signal?.removeEventListener('abort', abort);
            active = false;
            controller = null;
          }
        }
        assertCurrent();
        return execution;
      })();
      settlement = operation.catch(() => null);
      // Return cancellation/deadline promptly, while retaining the physical
      // execution slot until the underlying runtime and its cleanup settle.
      return Promise.race([operation, cancelled]).finally(() => {
        clearTimeout(timer);
        localController.signal.removeEventListener('abort', onCancel);
      });
    },
    getState() { return { active, draining: active && (controller?.signal.aborted === true || disposed), disposed }; },
    cancel() { ++epoch; controller?.abort(new Error('Document operation cancelled')); },
    async close() {
      disposed = true;
      ++epoch;
      controller?.abort(new Error('Document executor closed'));
      await settlement;
      await service.close(scope);
    }
  };
}
