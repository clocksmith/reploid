import { canonicalPartitionBinding, samePartitionIdentity } from './partition-contract.js';

/** Receiver-side ordering/idempotency. Execution and verified identity remain host ports. */
export function createPartitionStepReceiver({ executeStep, authorize, fingerprint, settleAttempt, limits }) {
  for (const port of [executeStep, authorize, fingerprint, settleAttempt]) {
    if (typeof port !== 'function') throw new Error('Partition receiver requires execution, authorization, digest and settlement ports');
  }
  if (!Number.isSafeInteger(limits?.maxAttempts) || limits.maxAttempts <= 0
    || !Number.isSafeInteger(limits?.maxSteps) || limits.maxSteps <= 0) {
    throw new Error('Explicit receiver attempt and step limits required');
  }
  const { maxAttempts, maxSteps } = limits;
  const attempts = new Map();
  const operations = new Set();
  let closed = false;
  const registerAttempt = identity => {
    if (attempts.size >= maxAttempts) throw new Error('Partition receiver attempt budget exhausted');
    const state = { identity: canonicalPartitionBinding(identity), nextStep: 0, nextPosition: 0, maxTokens: null,
      last: null, retired: false, controller: new AbortController(), settlement: null };
    attempts.set(identity.attemptId, state);
    return state;
  };
  const permit = async request => {
    if (closed || await authorize(structuredClone(request)) !== true) throw new Error('Partition receiver authorization declined');
    if (closed) throw new Error('Partition receiver closed');
  };

  async function receive(input, { signal } = {}) {
    signal?.throwIfAborted();
    if (closed) throw new Error('Partition receiver closed');
    // Host ingress validates payload shape/byte budgets before this copy or hashing.
    const request = structuredClone(input);
    request.identity = canonicalPartitionBinding(request.identity);
    if (!Number.isSafeInteger(request.step) || request.step < 0 || request.step >= maxSteps
      || !Number.isSafeInteger(request.maxTokens) || request.maxTokens <= 0 || request.step >= request.maxTokens
      || !Number.isSafeInteger(request.tokenPosition) || request.tokenPosition < 0
      || !Number.isSafeInteger(request.inputTokenCount) || request.inputTokenCount <= 0) {
      throw new Error('Invalid partition step binding');
    }
    const operation = (async () => {
      await permit(request);
      signal?.throwIfAborted();
      const digest = await fingerprint(structuredClone(request));
      if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Partition input fingerprint required');
      signal?.throwIfAborted();
      if (closed) throw new Error('Partition receiver closed');
      const key = request.identity.attemptId;
      let state = attempts.get(key);
      if (!state) {
        if (request.step !== 0 || request.tokenPosition !== 0) throw new Error('Partition attempt must start with prefill');
        state = registerAttempt(request.identity);
        state.maxTokens = request.maxTokens;
      }
      if (!samePartitionIdentity(state.identity, request.identity)) throw new Error('Partition attempt identity collision');
      if (state.retired) throw new Error('Partition attempt retired; start a new attempt');
      if (state.maxTokens !== request.maxTokens) throw new Error('Partition request token limit changed');
      if (state.last?.step === request.step) {
        if (state.last.digest !== digest) throw new Error('Partition step payload collision');
      } else {
        if (state.last?.pending || request.step !== state.nextStep || request.tokenPosition !== state.nextPosition) {
          throw new Error('Out-of-order partition step');
        }
        if (request.step > 0 && request.inputTokenCount !== 1) throw new Error('Decode consumes one token');
        const current = { step: request.step, digest, pending: true, result: null };
        state.last = current;
        const combined = signal ? AbortSignal.any([signal, state.controller.signal]) : state.controller.signal;
        current.result = (async () => {
          try {
            await permit(request);
            combined.throwIfAborted();
            const result = await executeStep(structuredClone(request), { signal: combined });
            combined.throwIfAborted();
            state.nextStep++;
            state.nextPosition += request.inputTokenCount;
            return structuredClone(result);
          } catch (error) {
            // A failed compute may already have mutated KV state. Never run it again.
            state.retired = true;
            throw error;
          } finally { current.pending = false; }
        })();
      }
      const result = await state.last.result;
      signal?.throwIfAborted();
      // A replay still requires current disclosure permission.
      await permit(request);
      if (state.retired) throw new Error('Partition attempt retired');
      return structuredClone(result);
    })();
    operations.add(operation);
    try { return await operation; } finally { operations.delete(operation); }
  }

  function closeAttempt(identity) {
    try { identity = canonicalPartitionBinding(identity); }
    catch (error) { return Promise.reject(error); }
    let state = attempts.get(identity.attemptId);
    if (!state) {
      if (closed) return Promise.resolve();
      try { state = registerAttempt(identity); }
      catch (error) { return Promise.reject(error); }
      // Cancellation may overtake the first step's authorization or hashing.
      // Keep a bounded tombstone so that delayed ingress cannot acquire state.
      state.retired = true;
      state.settlement = Promise.resolve();
      return state.settlement;
    }
    if (!samePartitionIdentity(state.identity, identity)) {
      return Promise.reject(new Error('Partition settlement identity collision'));
    }
    if (state.settlement) return state.settlement;
    state.retired = true;
    state.controller.abort(new Error('Partition attempt closed'));
    state.settlement = (async () => {
      await state.last?.result?.catch(() => {});
      try { await settleAttempt(structuredClone(state.identity)); }
      finally { state.last = null; }
    })();
    return state.settlement;
  }

  return Object.freeze({ receive, closeAttempt,
    async close() {
      closed = true;
      const results = await Promise.allSettled([...attempts.values()].map(state => closeAttempt(state.identity)));
      await Promise.allSettled([...operations]);
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Partition receiver settlement failed');
    }
  });
}
