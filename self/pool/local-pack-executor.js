import { assertPackSession, hashDopplerEvidence } from './executable-pack.js';
import { validateOperationModel } from './operation-model.js';
import { runPackOperation, snapshotPackOperationData } from './pack-operation.js';
import { DopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import { prepareLocalPackRelease } from './pack-release-policy.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';

/** Application-selected sessions do not admit a model to the public peer catalog.
 * Remote callers must validate delegation before supplying an assignment. */
export function createLocalPackExecutor({ service = DopplerRuntimeService, scope = `reploid:documents:${crypto.randomUUID()}`,
  prepareRelease = prepareLocalPackRelease, registry = createPackOperationRegistry() } = {}) {
  let disposed = false;
  let active = false;
  let epoch = 0;
  let controller = null;
  let settlement = Promise.resolve();
  let retained = null;
  let ownsScope = false;
  let releasing = false;
  const releaseSession = async () => {
    retained = null;
    if (!ownsScope) return;
    releasing = true;
    try { await service.close(scope); ownsScope = false; }
    catch (error) { disposed = true; throw error; }
    finally { releasing = false; }
  };
  return {
    async run({ model: modelInput, input, options = {}, assignment = null, limits, signal = null, onPartial = null }) {
      if (disposed || active) throw new Error(disposed ? 'Document executor is closed' : 'A document operation is already running');
      const model = snapshotPackOperationData(modelInput);
      const validation = validateOperationModel(model, registry);
      if (!validation.ok) throw new Error(validation.reasons.join('; '));
      if (typeof model.runtimeVersion !== 'string' || !model.runtimeVersion) throw new Error('Exact runtime version required');
      const source = new URL(model.packSource);
      if (!['https:', 'http:'].includes(source.protocol) || source.username || source.password) throw new Error('Pack source must be an HTTP(S) URL without credentials');
      if (!model.packOpenOptions?.trustedSigners || !Object.keys(model.packOpenOptions.trustedSigners).length) throw new Error('Application-selected trusted signers required');
      const request = snapshotPackOperationData({ schema: 'doppler.pack-operation-request/v1',
        operation: { name: model.executablePack.requiredOperation, version: registry[model.executablePack.requiredOperation].version }, input, options,
        assignment, limits });
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
        if (retained) releasePolicy?.checkTime?.(retained.session);
      };
      let releasePolicy;
      let rejectCancellation;
      const cancelled = new Promise((_resolve, reject) => { rejectCancellation = reject; });
      const onCancel = () => rejectCancellation(localController.signal.reason || new Error('Document operation cancelled'));
      localController.signal.addEventListener('abort', onCancel, { once: true });
      if (localController.signal.aborted) onCancel();
      const operation = (async () => {
        let execution;
        let completed = false;
        try {
          assertCurrent();
          const modelKey = await hashDopplerEvidence(model);
          assertCurrent();
          if (retained && retained.modelKey !== modelKey) await releaseSession();
          assertCurrent();
          const prepared = await service.prepare();
          assertCurrent();
          if (prepared.version !== model.runtimeVersion) throw new Error('Document Pack requires a different Doppler release');
          releasePolicy = await prepareRelease({ model });
          assertCurrent();
          if (!retained) {
            ownsScope = true;
            const session = await service.openPack({ scope, source: source.href,
              options: { ...releasePolicy.options, acceptedTargetPlanDigests: model.executablePack.acceptedTargetPlanDigests } });
            retained = { session, modelKey, modelId: model.modelId };
          }
          const { session } = retained;
          assertCurrent();
          await assertPackSession(model.executablePack, session);
          if (session.modelId !== model.modelId) throw new Error('Loaded Pack model id mismatch');
          await releasePolicy.assertCurrent(session);
          execution = await runPackOperation({ binding: model.executablePack, session, request,
            runtimeVersion: model.runtimeVersion, signal: localController.signal, onPartial, assertCurrent, registry });
          assertCurrent();
          await releasePolicy.assertCurrent(session);
          assertCurrent();
          completed = true;
        } finally {
          try { if (!completed) await releaseSession(); } finally {
            try { releasePolicy?.close(); } finally {
              signal?.removeEventListener('abort', abort);
              active = false;
              controller = null;
            }
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
    getState() { return { active, draining: active && (controller?.signal.aborted === true || disposed || releasing),
      disposed, retainedModelId: retained?.modelId ?? null }; },
    cancel() {
      ++epoch;
      if (controller) controller.abort(new Error('Document operation cancelled'));
      else if (!active && ownsScope) {
        active = true;
        settlement = releaseSession().finally(() => { active = false; });
        // A failed release poisons this executor. It may never reuse that scope.
        settlement.catch(() => {});
      }
    },
    async close() {
      disposed = true;
      ++epoch;
      controller?.abort(new Error('Document executor closed'));
      await settlement;
      await releaseSession();
    }
  };
}
