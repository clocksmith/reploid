/** One prepared model, reusable across requests until explicitly retired. */
import { openWorkProvider } from './work-provider.js';
import { withWorkDevice } from './work-device.js';

export function createWorkResidentProvider({ service, model, generation, maxOutcomeCharacters,
  onChange = () => {}, scope = 'work-resident:' + crypto.randomUUID() }) {
  model = structuredClone(model);
  generation = structuredClone(generation);
  const lifetime = new AbortController(), operations = new Set();
  let adapter = null, identity = null, preparing = null, closing = null, cleanup = null;
  let closed = false, phase = 'idle', error = null, progress = null, completed = 0;
  const getState = () => ({ phase, error, progress: structuredClone(progress), completed,
    modelId: model.id, modelIdentity: identity?.modelIdentity || null,
    ready: !closed && !!adapter && adapter.isReady() && ['ready', 'executing'].includes(phase) });
  const notify = () => {
    try { onChange(getState()); } catch (cause) { console.error('[Resident] state observer failed', cause); }
  };
  const dispose = () => {
    adapter = null;
    cleanup ||= Promise.resolve().then(() => service.close(scope));
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
    preparing = Promise.resolve().then(() => withWorkDevice(service, lifetime.signal, async () => {
      const loaded = await openWorkProvider({ model, service, scope, signal: lifetime.signal,
        generation, maxOutcomeCharacters, onProgress(value) {
          if (!closed) { progress = structuredClone(value); notify(); }
        } });
      lifetime.signal.throwIfAborted();
      await loaded.reset();
      lifetime.signal.throwIfAborted();
      identity = loaded.getIdentity(); adapter = loaded; phase = 'ready'; notify();
      return getState();
    })).catch(async cause => {
      await fail(cause); throw cause;
    }).finally(() => { preparing = null; });
    notify();
    return preparing;
  };
  const generate = (messages, onUpdate, { signal }) => {
    if (!getState().ready) return Promise.reject(new Error('Contributor model is not ready'));
    const input = structuredClone(messages);
    const current = adapter, combined = AbortSignal.any([lifetime.signal, signal]);
    const operation = withWorkDevice(service, combined, async () => {
      combined.throwIfAborted();
      if (adapter !== current || error) throw new Error('Resident session was retired before execution');
      phase = 'executing'; notify();
      try {
        const result = await current.generate(input, onUpdate, { signal: combined });
        combined.throwIfAborted(); completed++;
        return result;
      } catch (cause) {
        // Cancellation may reuse a clean session; runtime or reset failures may not.
        if (!combined.aborted || !current.isReady()) await fail(cause);
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
  const close = () => {
    if (closing) return closing;
    closed = true; phase = 'stopping'; lifetime.abort(new Error('Contribution stopped'));
    closing = (async () => {
      await preparing?.catch(() => {});
      await Promise.allSettled([...operations]);
      try { await dispose(); phase = 'idle'; }
      catch (cause) { phase = 'failed'; error = cause?.message || String(cause); throw cause; }
      finally { notify(); }
    })();
    notify();
    return closing;
  };
  return Object.freeze({ getState, prepare, generate, close });
}
