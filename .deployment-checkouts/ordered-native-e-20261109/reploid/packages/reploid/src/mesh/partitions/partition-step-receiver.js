import canonicalPolicy from './partition-receiver-policy.json' with { type: 'json' };
import { canonicalPartitionBinding, samePartitionIdentity, canonicalRouteAttemptBinding, sameRouteAttemptIdentity, canonicalPartitionJson } from './partition-contract.js';

/** Receiver-side ordering/idempotency. Execution and verified identity remain host ports. */
export function createPartitionStepReceiver({ executeStep, authorize, fingerprint, settleAttempt, limits, canonical, ordered }) {
  for (const port of [executeStep, authorize, fingerprint, settleAttempt]) {
    if (typeof port !== 'function') throw new Error('Partition receiver requires execution, authorization, digest and settlement ports');
  }
  if (!Number.isSafeInteger(limits?.maxAttempts) || limits.maxAttempts <= 0
    || !Number.isSafeInteger(limits?.maxSteps) || limits.maxSteps <= 0) {
    throw new Error('Explicit receiver attempt and step limits required');
  }
  if (ordered && canonical) throw new Error('Ordered canonical receiver is unsupported');
  const orderedStage = ordered ? structuredClone(ordered.stage) : null;
  if (ordered && (!Number.isSafeInteger(orderedStage?.index) || orderedStage.index < 0
    || !['participantId', 'transportId', 'residentId', 'executionId'].every(key => typeof orderedStage[key] === 'string' && orderedStage[key]))) {
    throw new Error('Explicit ordered receiver stage required');
  }
  const snapshotIdentity = value => {
    if (!orderedStage) return canonicalPartitionBinding(value);
    const binding = canonicalRouteAttemptBinding(value);
    if (canonicalPartitionJson(binding.route.stages[orderedStage.index]) !== canonicalPartitionJson(orderedStage)) {
      throw new Error('Ordered receiver stage differs from route');
    }
    return binding;
  };
  const sameIdentity = orderedStage ? sameRouteAttemptIdentity : samePartitionIdentity;
  const { maxAttempts, maxSteps } = limits;
  const attempts = new Map();
  const operations = new Set();
  let closed = false;
  const canonicalAttempts = new Map();
  const canonicalStage = canonical ? structuredClone(canonical.stage) : null;
  const runtime = canonical?.runtime;
  if (canonical && (typeof canonical.execute !== 'function' || typeof canonical.verifyPublication !== 'function' || typeof canonical.now !== 'function'
    || !['metadataDigest', 'validateResidentAttemptIdentity', 'residentAttemptDigest'].every(name => typeof runtime?.[name] === 'function')
    || canonicalStage?.partitionIndex !== 1)) throw new Error('Explicit canonical output-stage receiver ports required');
  const canonicalError = (code, message) => Object.assign(new Error(message), { code });
  const expired = () => canonicalError('RESULT_EXPIRED', 'Canonical result expired; never reexecute');
  const controlBytes = value => {
    runtime.metadataDigest('reploid.partition-control/v1', value);
    const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
    if (size > canonicalPolicy.maxControlBytes) throw new Error('Canonical control message budget exceeded');
    return size;
  };
  const prune = state => {
    const completed = [...state.completed.keys()];
    while (completed.length) {
      const sequence = completed[0];
      if (completed.length <= canonicalPolicy.maxCompletedSequences
        && canonical.now() - state.completed.get(sequence) < canonicalPolicy.maxRetentionMs) break;
      completed.shift(); state.completed.delete(sequence);
      for (const [key, record] of state.records) if (record.sequence === sequence && !record.pending) {
        state.bytes -= record.bytes; state.records.delete(key);
      }
      state.retiredThrough = Math.max(state.retiredThrough, sequence);
    }
  };
  const registerCanonical = (identity, attempt, digest) => {
    if (attempts.has(identity.attemptId) || canonicalAttempts.size + attempts.size >= maxAttempts) {
      throw new Error('Partition receiver attempt budget exhausted or identity collision');
    }
    const state = { identity, attempt, digest, records: new Map(), completed: new Map(), nextSequence: 0,
      nextPosition: 0, admitted: false, terminal: false, awaitingPublication: null, retired: false, retiredThrough: -1,
      bytes: 0, controller: new AbortController(), pending: null, settlement: null, settled: false };
    canonicalAttempts.set(identity.attemptId, state); return state;
  };
  async function receiveCanonical(input, { signal } = {}) {
    if (!canonical || closed) throw new Error('Canonical receiver unavailable or closed');
    signal?.throwIfAborted();
    const { payload, ...metadata } = input;
    controlBytes(metadata);
    const request = structuredClone(input);
    request.identity = canonicalPartitionBinding(request.identity);
    const attempt = runtime.validateResidentAttemptIdentity(request.canonicalAttempt);
    if (attempt.routeKind !== 'two-stage-layer' || attempt.attemptId !== request.identity.attemptId
      || attempt.stages[0].participantId !== request.identity.participantA || attempt.stages[1].participantId !== request.identity.participantB
      || runtime.metadataDigest('reploid.partition-stage/v1', attempt.stages[1]) !== runtime.metadataDigest('reploid.partition-stage/v1', canonicalStage)
      || request.generationId !== attempt.generationId || !['admit', 'step', 'published'].includes(request.phase)
      || !Number.isSafeInteger(request.sequence) || request.sequence < 0 || request.sequence >= maxSteps
      || request.step !== request.sequence || !Number.isSafeInteger(request.tokenPosition) || request.tokenPosition < 0
      || !Number.isSafeInteger(request.inputTokenCount) || request.inputTokenCount <= 0
      || request.phase === 'admit' && (request.sequence !== 0 || request.tokenPosition !== 0)) {
      throw new Error('Invalid canonical receiver binding');
    }
    const attemptDigest = runtime.residentAttemptDigest(attempt);
    const operation = (async () => {
      await permit(request); signal?.throwIfAborted();
      const digest = await fingerprint(structuredClone(request));
      if (!/^sha256:[a-f0-9]{64}$/.test(digest)) throw new Error('Partition input fingerprint required');
      signal?.throwIfAborted();
      if (closed) throw new Error('Partition receiver closed');
      let state = canonicalAttempts.get(attempt.attemptId);
      if (!state) {
        if (request.phase !== 'admit') throw new Error('Canonical attempt must start with admission');
        state = registerCanonical(request.identity, attempt, attemptDigest);
      }
      if (state.digest !== attemptDigest || !samePartitionIdentity(state.identity, request.identity)) throw new Error('Canonical attempt identity collision');
      if (state.retired) throw new Error('Canonical attempt retired');
      prune(state);
      if (request.sequence <= state.retiredThrough) throw expired();
      const key = `${request.sequence}:${request.phase}`;
      let record = state.records.get(key);
      if (record) {
        if (record.digest !== digest) throw new Error('Canonical phase payload collision');
      } else {
        const publication = request.phase === 'published';
        if (!publication && (state.terminal || request.sequence < state.nextSequence)) throw expired();
        if (state.pending || (publication ? state.awaitingPublication !== request.sequence
          : state.awaitingPublication !== null || request.sequence !== state.nextSequence || request.tokenPosition !== state.nextPosition
            || request.phase === 'admit' && state.admitted || request.phase === 'step' && !state.admitted
            || request.sequence > 0 && request.inputTokenCount !== 1)) throw new Error('Out-of-order canonical phase');
        record = { sequence: request.sequence, digest, pending: true, bytes: 0, result: null };
        state.records.set(key, record);
        const combined = signal ? AbortSignal.any([signal, state.controller.signal]) : state.controller.signal;
        record.result = (async () => {
          try {
            await permit(request); combined.throwIfAborted();
            let result;
            if (publication) {
              const retained = state.records.get(`${request.sequence}:${state.terminal && state.nextSequence === 0 ? 'admit' : 'step'}`);
              const original = await retained.result;
              if (await canonical.verifyPublication(structuredClone(request), structuredClone(original)) !== true) {
                throw new Error('Canonical publication acknowledgment rejected');
              }
              result = structuredClone(request.receipt);
            } else result = structuredClone(await canonical.execute(structuredClone(request), { signal: combined }));
            combined.throwIfAborted(); record.bytes = controlBytes(result);
            if (state.bytes + record.bytes > canonicalPolicy.maxRetainedBytes) throw new Error('Canonical retained control budget exceeded');
            state.bytes += record.bytes;
            if (publication) {
              state.awaitingPublication = null; state.completed.set(request.sequence, canonical.now());
            } else if (request.phase === 'admit') {
              state.admitted = true; state.terminal = !Object.hasOwn(result, 'kind');
              if (state.terminal) state.awaitingPublication = request.sequence;
            } else {
              state.nextSequence++; state.nextPosition += request.inputTokenCount;
              state.terminal = result.transition?.successor?.terminal === true;
              state.awaitingPublication = request.sequence;
            }
            return result;
          } catch (error) { state.retired = true; throw error; }
          finally { record.pending = false; state.pending = null; prune(state); }
        })();
        state.pending = record.result;
      }
      const result = await record.result;
      signal?.throwIfAborted(); await permit(request);
      if (state.retired) throw new Error('Canonical attempt retired');
      prune(state);
      if (!state.records.has(key)) throw expired();
      return structuredClone(result);
    })();
    operations.add(operation);
    try { return await operation; } finally { operations.delete(operation); }
  }
  function closeCanonical(state) {
    if (state.settlement) return state.settlement;
    if (state.settled) return Promise.resolve();
    state.retired = true; state.controller.abort(new Error('Canonical attempt closed'));
    const operation = (async () => {
      await state.pending?.catch(() => {});
      await settleAttempt(structuredClone(state.identity));
      state.records.clear(); state.completed.clear(); state.bytes = 0; state.settled = true;
    })();
    state.settlement = operation;
    operation.finally(() => { if (state.settlement === operation) state.settlement = null; }).catch(() => {});
    return operation;
  }
  const registerAttempt = identity => {
    if (canonicalAttempts.has(identity.attemptId) || attempts.size + canonicalAttempts.size >= maxAttempts) throw new Error('Partition receiver attempt budget exhausted');
    const state = { identity: snapshotIdentity(identity), nextStep: 0, nextPosition: 0, maxTokens: null,
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
    request.identity = snapshotIdentity(request.identity);
    if (orderedStage && request.partitionIndex !== orderedStage.index) throw new Error('Ordered receiver stage mismatch');
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
      if (!sameIdentity(state.identity, request.identity)) throw new Error('Partition attempt identity collision');
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
    try { identity = snapshotIdentity(identity); }
    catch (error) { return Promise.reject(error); }
    const canonicalState = canonicalAttempts.get(identity.attemptId);
    if (canonicalState) {
      if (!samePartitionIdentity(canonicalState.identity, identity)) return Promise.reject(new Error('Partition settlement identity collision'));
      return closeCanonical(canonicalState);
    }
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
    if (!sameIdentity(state.identity, identity)) {
      return Promise.reject(new Error('Partition settlement identity collision'));
    }
    if (state.settlement) return state.settlement;
    state.retired = true;
    state.controller.abort(new Error('Partition attempt closed'));
    state.settlement = (async () => {
      await state.last?.result?.catch(() => {});
      try { await settleAttempt(structuredClone(state.identity)); }
      finally { state.last = null; }
    })().catch(error => { state.settlement = null; throw error; });
    return state.settlement;
  }

  return Object.freeze({ receive, receiveCanonical, closeAttempt,
    async close() {
      closed = true;
      const results = await Promise.allSettled([...attempts.values(), ...canonicalAttempts.values()].map(state => closeAttempt(state.identity)));
      await Promise.allSettled([...operations]);
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Partition receiver settlement failed');
    }
  });
}
