import { assertPartition as assert, canonicalPartitionJson } from './partition-contract.js';

/** Owns an explicitly contributed runtime session; never implements model computation. */
export function createResidentPartition({ runtime, model, plan, planId, index, participantId, limits, onChange = () => {} }) {
  assert(typeof runtime?.openResidentPartition === 'function', 'Doppler resident partition API is unavailable');
  assert([0, 1].includes(index) && plan?.partitions?.[index] && model?.id === plan.modelId
    && /^sha256:[a-f0-9]{64}$/.test(model.identity) && typeof planId === 'string' && planId
    && typeof participantId === 'string' && participantId, 'Explicit resident partition allocation required');
  const allocation = structuredClone({ model, plan, planId, index, participantId, limits });
  const lifetime = new AbortController(), operations = new Set(), listeners = new Set([onChange]);
  let phase = 'idle', error = null, session = null, preparing = null, closing = null, disposal = null, descriptor = null;
  let tail = Promise.resolve();
  const state = () => ({ phase, ready: phase === 'ready' && !lifetime.signal.aborted,
    error, descriptor: structuredClone(descriptor), index, participantId,
    modelId: allocation.model.id, modelIdentity: allocation.model.identity, planId });
  const notify = () => { for (const listener of listeners) { try { listener(state()); } catch {} } };
  const dispose = () => disposal ||= Promise.resolve().then(() => session?.close());
  const check = () => {
    const actual = session?.getDescriptor();
    assert(actual?.schema === 'doppler.resident-partition/v1' && actual.ready === true
      && actual.modelId === allocation.model.id && actual.modelIdentity === allocation.model.identity
      && actual.planId === allocation.planId && actual.index === allocation.index
      && canonicalPartitionJson(actual.layerRange) === canonicalPartitionJson(allocation.plan.partitions[index].layerRange)
      && Number.isSafeInteger(actual.residentWeightBytes) && actual.residentWeightBytes > 0,
    'Doppler resident partition identity or readiness mismatch');
    return structuredClone(actual);
  };
  const invoke = (method, request) => {
    assert(phase === 'ready' && !lifetime.signal.aborted, 'Partition contributor is not ready');
    const { signal, ...input } = request;
    const snapshot = structuredClone(input);
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const operation = tail.then(async () => {
      combined.throwIfAborted(); check();
      const result = await session[method]({ ...snapshot, signal: combined });
      combined.throwIfAborted(); check();
      return structuredClone(result);
    }).catch(async cause => {
      if (!combined.aborted) {
        phase = 'failed'; error = String(cause.message || cause);
        lifetime.abort(cause); notify(); await dispose();
      }
      throw cause;
    });
    tail = operation.catch(() => {}); operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  };
  return Object.freeze({
    id: participantId, index, getState: state,
    subscribe(listener) { listeners.add(listener); listener(state()); return () => listeners.delete(listener); },
    prepare({ approved, signal } = {}) {
      assert(approved === true, 'Explicit partition contribution approval required');
      assert(!lifetime.signal.aborted, 'Partition contribution closed');
      if (preparing) return preparing;
      if (phase === 'ready') return Promise.resolve(state());
      assert(phase === 'idle', 'Retired partition contribution requires a new owner');
      phase = 'loading'; notify();
      const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
      preparing = (async () => {
        try {
          combined.throwIfAborted();
          session = await runtime.openResidentPartition({ ...structuredClone(allocation), signal: combined });
          assert(typeof session?.close === 'function' && typeof session.closeAttempt === 'function'
            && typeof session[index === 0 ? 'executeGroup0' : 'executeGroup1'] === 'function'
            && (index !== 0 || typeof session.tokenize === 'function'), 'Incomplete Doppler resident partition API');
          combined.throwIfAborted(); descriptor = check(); phase = 'ready'; notify(); return state();
        } catch (cause) {
          phase = 'failed'; error = String(cause.message || cause);
          await dispose(); notify(); throw cause;
        }
      })();
      return preparing;
    },
    tokenize(request) { assert(index === 0, 'Only partition A tokenizes'); return invoke('tokenize', request); },
    executeGroup0(request) { assert(index === 0, 'This contributor is partition B'); return invoke('executeGroup0', request); },
    executeGroup1(request) { assert(index === 1, 'This contributor is partition A'); return invoke('executeGroup1', request); },
    async closeAttempt({ identity }) {
      // Runtime settlement must await its submitted work without unloading shared weights.
      if (session) await session.closeAttempt({ identity: structuredClone(identity) });
    },
    close() {
      if (closing) return closing;
      lifetime.abort(new Error('Partition contribution stopped')); phase = 'stopping'; notify();
      closing = (async () => {
        await preparing?.catch(() => {});
        await Promise.allSettled([...operations]);
        try { await dispose(); phase = 'closed'; } catch (cause) { phase = 'failed'; error = String(cause.message || cause); throw cause; }
        finally { notify(); }
      })();
      return closing;
    }
  });
}
