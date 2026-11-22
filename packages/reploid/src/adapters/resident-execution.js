/** Prepared execution owner shared by browser and native hosts. */
import { createExecutionPolicy, requestExecutionPolicy, assertAvailableExecutionPolicy, bindExecutionRoute, sameExecutionBinding } from '../chat/execution-policy.js';
import { hashJson } from '../artifacts/signatures.js';
import { createPreparationProgressObserver } from '../mesh/preparation-progress.js';
import { withDevice, getDeviceQueue } from './device-lane.js';

export function createResidentExecution({ service, model, generation, maxOutcomeCharacters,
  onChange = () => {}, onComplete = () => {}, scope = 'work-resident:' + crypto.randomUUID(), resolveAdapter, resolveSource, source, loadOptions, openProvider, acquireStorage }) {
  if (typeof openProvider !== 'function' || typeof acquireStorage !== 'function' || typeof service?.close !== 'function') {
    throw new TypeError('Resident execution requires provider, storage and service lifetime ports');
  }
  model = structuredClone(model);
  generation = structuredClone(generation);
  const lifetime = new AbortController(), operations = new Set();
  let adapter = null, identity = null, preparing = null, closing = null, cleanup = null, releaseStorage = null;
  let closed = false, phase = 'idle', error = null, progress = null, completed = 0;
  const production = { outputTokens: 0, missingTokenCounts: 0 };
  let adapterIdentities = [];
  const getState = () => ({ phase, error, progress: structuredClone(progress), completed, production: { ...production },
    modelId: model.id, modelIdentity: identity?.modelIdentity || null,
    adapterIdentities: [...adapterIdentities],
    hardware: adapter?.getHardware() || null,
    deviceQueue: getDeviceQueue(service),
    contextCache: adapter?.getContextCacheStats?.() || null,
    ready: !closed && !!adapter && adapter.isReady() && ['ready', 'executing'].includes(phase) });
  const notify = () => {
    try { onChange(getState()); } catch (cause) { console.error('[Resident] state observer failed', cause); }
  };
  const dispose = () => {
    adapter?.close();
    adapter = null;
    cleanup ||= Promise.resolve().then(() => service.close(scope)).then(async () => { await releaseStorage?.(); releaseStorage = null; }).catch(cause => { cleanup = null; throw cause; });
    return cleanup;
  };
  const fail = async cause => {
    error = cause?.message || String(cause); phase = 'failed';
    try { await dispose(); }
    catch (cleanupError) { error = new AggregateError([cause, cleanupError], 'Execution and cleanup failed').message; }
    notify();
  };
  const prepare = () => {
    if (closed) return Promise.reject(new Error('Contribution stopped'));
    if (preparing) return preparing;
    if (adapter) return Promise.resolve(getState());
    if (error) return Promise.reject(new Error(error));
    phase = 'loading';
    const observeProgress = createPreparationProgressObserver();
    let observingPreparation = true;
    preparing = Promise.resolve().then(() => withDevice(service, lifetime.signal, async () => {
      const reportProgress = value => { if (observingPreparation) { progress = observeProgress(structuredClone(value)); notify(); } };
      releaseStorage = await acquireStorage({ signal: lifetime.signal });
      const resolvedSource = resolveSource ? await resolveSource(model, { signal: lifetime.signal, onProgress: reportProgress }) : source;
      const loaded = await openProvider({ model, service, scope, signal: lifetime.signal,
        generation, maxOutcomeCharacters, resolveAdapter, source: resolvedSource, loadOptions, onProgress: reportProgress });
      lifetime.signal.throwIfAborted();
      await loaded.reset();
      if (model.adapters?.length) adapterIdentities = await loaded.prepareAdapters(model.adapters);
      lifetime.signal.throwIfAborted();
      identity = loaded.getIdentity(); adapter = loaded; phase = 'ready'; notify();
      return getState();
    })).catch(async cause => {
      await fail(cause); throw cause;
    }).finally(() => { observingPreparation = false; preparing = null; });
    notify();
    return preparing;
  };
  const generate = (messages, onUpdate, { signal, adapters = [], maxOutputTokens, contextOwner, contextId, privacy, privacyBinding, settings, onUsage }) => {
    if (!getState().ready) return Promise.reject(new Error('Contributor model is not ready'));
    const policy = assertAvailableExecutionPolicy(privacy === undefined && !privacyBinding ? createExecutionPolicy() : requestExecutionPolicy({ privacy }));
    const boundPrivacy = privacyBinding ? structuredClone(privacyBinding) : null;
    // Namespace retained KV state by the complete policy and authenticated tenant. Ordinary weights remain shared.
    const contextNamespace = contextId ? hashJson([contextId, model.identity, contextOwner ?? null, policy, boundPrivacy?.route ?? null]) : null;
    const input = structuredClone(messages);
    const selectedAdapters = structuredClone(adapters);
    // Canonical generation settings of this request, for the provider to apply (tools, tool choice).
    const requestSettings = settings === undefined ? undefined : structuredClone(settings);
    const current = adapter, combined = AbortSignal.any([lifetime.signal, signal]);
    const operation = withDevice(service, combined, async () => {
      combined.throwIfAborted();
      if (adapter !== current || error) throw new Error('Resident session was retired before execution');
      if (boundPrivacy) {
        const checked = await bindExecutionRoute({ privacy: policy, model: { ...model, adapters: selectedAdapters } }, boundPrivacy.route);
        if (!sameExecutionBinding(checked, boundPrivacy)) throw Error('Resident privacy binding changed');
      }
      const scopedContextId = contextNamespace ? await contextNamespace : null;
      combined.throwIfAborted();
      phase = 'executing'; notify();
      try {
        const result = await current.generate(input, onUpdate, { signal: combined, adapters: selectedAdapters,
          maxOutputTokens, contextOwner, contextId: scopedContextId,
          ...(requestSettings === undefined ? {} : { settings: requestSettings }),
          // The provider's own prompt token count, reported before its first token when it has one.
          ...(typeof onUsage === 'function' ? { onUsage } : {}) });
        combined.throwIfAborted(); completed++;
        // Count runtime-reported tokens, never text deltas or estimated words.
        const tokens = result.completion?.generatedTokenCount ?? result.timing?.generatedTokenCount;
        if (Number.isSafeInteger(tokens) && tokens >= 0) production.outputTokens += tokens;
        else production.missingTokenCounts++;
        // Retain only completed, identity-checked execution metadata. Reporting
        // failure must not turn a completed answer into an inference failure.
        try { onComplete({ modelId: model.id, modelIdentity: identity.modelIdentity,
          outputTokens: Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null }); }
        catch (cause) { console.error('[Resident] completion observer failed', cause); }
        return result;
      } catch (cause) {
        // Cancellation or pre-execution admission rejection may reuse a clean session; runtime or reset failures may not.
        if ((!combined.aborted && cause?.recoverableSession !== true) || !current.isReady()) await fail(cause);
        throw cause;
      } finally {
        if (!closed && adapter) phase = 'ready';
        notify();
      }
    });
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  };
  const scoreTarget = ({ messages, target, signal }) => {
    if (!getState().ready) return Promise.reject(new Error('Contributor model is not ready'));
    const current = adapter;
    if (typeof current?.scoreTarget !== 'function') return Promise.reject(new Error('This runtime cannot score a target sequence'));
    const combined = AbortSignal.any([lifetime.signal, signal]), input = structuredClone(messages);
    const operation = withDevice(service, combined, async () => {
      combined.throwIfAborted();
      if (adapter !== current || error) throw new Error('Resident session was retired before scoring');
      phase = 'executing'; notify();
      try { return await current.scoreTarget({ messages: input, target, signal: combined }); }
      catch (cause) { if (!current.isReady()) await fail(cause); throw cause; }
      finally { if (!closed && adapter) phase = 'ready'; notify(); }
    });
    operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  };
  const close = () => {
    if (closing) return closing;
    closed = true; phase = 'stopping'; lifetime.abort(new Error('Contribution stopped'));
    closing = (async () => {
      await preparing?.catch(() => {});
      await Promise.allSettled([...operations]);
      try { await dispose(); phase = 'idle'; }
      catch (cause) { phase = 'failed'; error = cause?.message || String(cause); throw cause; }
      finally { notify(); }
    })().catch(cause => { closing = null; throw cause; });
    notify();
    return closing;
  };
  return Object.freeze({ getState, prepare, generate, scoreTarget, close });
}
