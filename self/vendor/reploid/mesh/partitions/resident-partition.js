import residentErrorCodes from './resident-error-codes.json' with { type: 'json' };
import failureMessages from '../../transport/partition-errors.json' with { type: 'json' };
import { createPartitionReservations } from './partition-reservations.js';
import { assertPartition as assert, canonicalPartitionJson } from './partition-contract.js';
import { verifyPartitionStageCommit } from './partition-stage-commit.js';

/** Owns an explicitly contributed runtime session; never implements model computation. */
export function createResidentPartition({ runtime, model, plan, planId, index, participantId, limits,
  canonicalGeneration, canonicalRuntime, canonicalCommitAuthority, onChange = () => {} }) {
  assert(typeof runtime?.openResidentPartition === 'function', 'Doppler resident partition API is unavailable');
  assert([0, 1].includes(index) && plan?.partitions?.[index] && model?.id === plan.modelId
    && /^sha256:[a-f0-9]{64}$/.test(model.identity) && typeof planId === 'string' && planId
    && typeof participantId === 'string' && participantId, 'Explicit resident partition allocation required');
  assert(canonicalGeneration === undefined || typeof canonicalRuntime?.canonicalGenerationIdentity === 'function',
    'Explicit canonical Doppler capability required');
  const canonical = canonicalGeneration === undefined ? null : canonicalRuntime.canonicalGenerationIdentity(
    canonicalGeneration.policy, canonicalGeneration.executionIdentity, plan.vocabSize);
  const allocation = structuredClone({ model, plan, planId, index, participantId, limits,
    ...(canonicalGeneration === undefined ? {} : { canonicalGeneration }) });
  const canonicalStage = canonicalCommitAuthority?.getStage();
  if (canonicalCommitAuthority !== undefined) {
    assert(canonical && typeof canonicalCommitAuthority?.sign === 'function'
      && ['metadataDigest', 'validateResidentAttemptIdentity', 'residentAttemptDigest', 'residentPublicationDecisionDigest']
        .every(method => typeof canonicalRuntime?.[method] === 'function')
      && canonicalStage?.participantId === participantId && canonicalStage.partitionIndex === index
      && canonicalStage.executionId === canonical.executionIdentity, 'Canonical signing stage differs from allocation');
  }
  const lifetime = new AbortController(), operations = new Set(), listeners = new Set([onChange]);
  const attempts = new Set();
  const reservations = createPartitionReservations({ limits, participantId, index });
  let draining = null, finishDrain = null;
  let phase = 'idle', error = null, session = null, preparing = null, closing = null, disposal = null, descriptor = null;
  let tail = Promise.resolve(), generationDigest = null, recovery = null;
  const state = () => ({ phase, ready: phase === 'ready' && !lifetime.signal.aborted,
    activeAttempts: attempts.size, reservations: reservations.getState(),
    error, descriptor: structuredClone(descriptor), recovery: structuredClone(recovery), index, participantId,
    modelId: allocation.model.id, modelIdentity: allocation.model.identity, planId });
  const notify = () => { for (const listener of listeners) { try { listener(state()); } catch {} } };
  const dispose = () => disposal ||= Promise.resolve().then(() => session?.close()).then(() => {
    reservations.close(); reservations.settleAll(); attempts.clear(); finishDrain?.();
  }).catch(cause => {
    // A rejection is not settlement. Retain the session and charged attempts,
    // but allow the owner to explicitly retry a transient cleanup failure.
    disposal = null; throw cause;
  });
  const check = () => {
    const actual = session?.getDescriptor();
    assert(actual?.schema === 'doppler.resident-partition/v1' && actual.ready === true
      && actual.modelId === allocation.model.id && actual.modelIdentity === allocation.model.identity
      && actual.generationDigest === generationDigest
      && (actual.canonicalGenerationId ?? null) === (canonical?.generationId ?? null)
      && actual.planId === allocation.planId && actual.index === allocation.index
      && canonicalPartitionJson(actual.layerRange) === canonicalPartitionJson(allocation.plan.partitions[index].layerRange)
      && Number.isSafeInteger(actual.residentWeightBytes) && actual.residentWeightBytes > 0,
    'Doppler resident partition identity or readiness mismatch');
    return structuredClone(actual);
  };
  const reserve = identity => {
    assert((phase === 'ready' || phase === 'draining' && attempts.has(identity?.attemptId))
      && !lifetime.signal.aborted, 'Partition contributor is not ready');
    const record = reservations.reserve(identity);
    attempts.add(identity.attemptId); notify(); return record;
  };
  const invoke = (method, request, finish = result => result) => {
    reserve(request.identity);
    const { signal, ...input } = request;
    const snapshot = structuredClone(input);
    const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
    const operation = tail.then(async () => {
      combined.throwIfAborted(); check();
      const result = await session[method]({ ...snapshot, signal: combined });
      combined.throwIfAborted(); check();
      const finished = await finish(result, snapshot);
      combined.throwIfAborted(); check();
      return structuredClone(finished);
    }).catch(async cause => {
      reservations.fail(request.identity, cause);
      if (!combined.aborted) {
        try {
          check();
          reservations.settling(snapshot.identity);
          await session.closeAttempt({ identity: snapshot.identity });
          reservations.settled(snapshot.identity);
          attempts.delete(snapshot.identity.attemptId);
          if (!attempts.size) finishDrain?.();
        } catch {
          phase = 'failed'; error = String(cause.message || cause);
          lifetime.abort(cause); notify(); await dispose();
        }
      }
      // The pinned 0.6.27 resident emits this exact untyped allocation error.
      // This local compatibility allowlist never forwards exception text.
      const code = Object.hasOwn(residentErrorCodes.codes, cause?.code) ? residentErrorCodes.codes[cause.code]
        : !cause?.code && Object.hasOwn(residentErrorCodes.legacyMessages, cause?.message)
          ? residentErrorCodes.legacyMessages[cause.message] : null;
      if (code) {
        throw Object.assign(new Error(failureMessages[code], { cause }), { code });
      }
      throw cause;
    });
    tail = operation.catch(() => {}); operations.add(operation);
    operation.finally(() => operations.delete(operation)).catch(() => {});
    return operation;
  };
  const canonicalInvoke = (method, request) => {
    assert(canonical, 'Canonical resident execution was not allocated');
    return invoke(method, request);
  };
  const committed = (method, request) => {
    assert(canonical, 'Canonical resident execution was not allocated');
    if (!canonicalCommitAuthority) return canonicalInvoke(method, request);
    const { signal, ...data } = request;
    const input = { ...structuredClone(data), signal };
    const attempt = canonicalRuntime.validateResidentAttemptIdentity(input.canonicalAttempt);
    assert(attempt.attemptId === input.identity.attemptId && attempt.generationId === canonical.generationId
      && attempt.routeKind === 'two-stage-layer' && attempt.stages[0].participantId === input.identity.participantA
      && attempt.stages[1].participantId === input.identity.participantB
      && canonicalPartitionJson(attempt.stages[index]) === canonicalPartitionJson(canonicalStage),
    'Canonical attempt differs from contributor binding');
    assert(Number.isSafeInteger(input.sequence) && input.sequence >= 0
      && (index === 1 ? input.sequence === input.step : input.sequence === input.transition.successor.revision),
    'Canonical sequence differs from actual ordinary step');
    return invoke(method, input, async result => {
      const transition = index === 1 ? result.transition : result;
      const commit = await canonicalCommitAuthority.sign({ attempt, sequence: input.sequence,
        baseCursorId: input.baseCursorId, transition });
      return index === 1 ? { ...result, commit } : { transition: result, commit };
    });
  };
  return Object.freeze({
    id: participantId, index, getState: state, reserve,
    getCanonicalGeneration: () => structuredClone(canonical),
    getCanonicalStage: () => structuredClone(canonicalStage ?? null),
    canAccept(identity) { return !lifetime.signal.aborted && ((phase === 'ready' || phase === 'draining')
      && attempts.has(identity?.attemptId) || phase === 'ready' && reservations.getState().availableSlots > 0); },
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
          const bytes = new TextEncoder().encode(canonicalPartitionJson(allocation.model.generation));
          generationDigest = 'sha256:' + [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
            .map(byte => byte.toString(16).padStart(2, '0')).join('');
          combined.throwIfAborted();
          session = await runtime.openResidentPartition({ ...structuredClone(allocation), signal: combined });
          assert(['getDescriptor', 'getRecoveryCapabilities', 'tokenize', 'executeGroup0', 'executeGroup1',
            'closeAttempt', 'close'].every(method => typeof session?.[method] === 'function'),
          'Incomplete Doppler resident partition API');
          if (canonical) {
            assert(['getCanonicalGeneration', 'admitCanonicalPrompt', 'executeCanonicalGroup0',
              'executeCanonicalGroup1', 'commitCanonicalTransition'].every(method => typeof session?.[method] === 'function'),
            'Incomplete canonical Doppler resident capability');
            assert(canonicalPartitionJson(session.getCanonicalGeneration()) === canonicalPartitionJson(canonical),
              'Canonical Doppler generation differs from admitted allocation');
          }
          const capabilities = session.getRecoveryCapabilities();
          assert(capabilities?.schema === 'doppler.resident-recovery/v1'
            && ['inputReplay', 'checkpointExport', 'checkpointImport'].every(key => capabilities[key] === false),
          'Unsupported Doppler resident recovery contract');
          recovery = structuredClone(capabilities);
          combined.throwIfAborted(); descriptor = check(); phase = 'ready'; notify(); return state();
        } catch (cause) {
          phase = 'failed'; error = String(cause.message || cause);
          await dispose(); notify(); throw cause;
        }
      })();
      return preparing;
    },
    tokenize(request) { assert(index === 0, 'Only partition A tokenizes'); return invoke('tokenize', request); },
    executeGroup0(request) { assert(!canonical, 'Canonical resident requires canonical execution'); assert(index === 0, 'This contributor is partition B'); return invoke('executeGroup0', request); },
    executeGroup1(request) { assert(!canonical, 'Canonical resident requires canonical execution'); assert(index === 1, 'This contributor is partition A'); return invoke('executeGroup1', request); },
    admitCanonicalPrompt(request) { return canonicalInvoke('admitCanonicalPrompt', request); },
    executeCanonicalGroup0(request) { assert(index === 0, 'This contributor is partition B'); return canonicalInvoke('executeCanonicalGroup0', request); },
    executeCanonicalGroup1(request) { assert(index === 1, 'This contributor is partition A'); return committed('executeCanonicalGroup1', request); },
    async commitCanonicalTransition(request) {
      assert(index === 0, 'Only partition A commits the remote transition');
      const { signal, ...data } = request;
      request = { ...structuredClone(data), signal };
      if (canonicalCommitAuthority) {
        const attempt = canonicalRuntime.validateResidentAttemptIdentity(request.canonicalAttempt);
        assert(await verifyPartitionStageCommit({ runtime: canonicalRuntime, attempt, stage: attempt.stages[1],
          acknowledgment: request.targetCommit?.acknowledgment, evidence: request.targetCommit?.evidence,
          transition: request.transition, sequence: request.sequence, baseCursorId: request.baseCursorId }),
        'Target commitment is not authenticated');
      }
      return committed('commitCanonicalTransition', request);
    },
    async closeAttempt({ identity }) {
      // Never free admission capacity before the runtime confirms cleanup.
      reservations.settling(identity);
      try {
        if (session) await session.closeAttempt({ identity: structuredClone(identity) });
        reservations.settled(identity); attempts.delete(identity.attemptId);
        if (!attempts.size) finishDrain?.(); notify();
      } catch (cause) {
        reservations.fail(identity, cause);
        throw Object.assign(new Error(failureMessages.CLEANUP_FAILED, { cause }), { code: 'CLEANUP_FAILED' });
      }
    },
    drain() {
      if (draining) return draining;
      assert(phase === 'ready', 'Only a ready contributor can drain');
      phase = 'draining'; notify();
      draining = (async () => {
        if (attempts.size) await new Promise(resolve => { finishDrain = resolve; });
        await Promise.allSettled([...operations]);
        await dispose(); phase = 'closed'; notify();
      })();
      return draining;
    },
    close() {
      if (closing) return closing;
      reservations.close();
      lifetime.abort(new Error('Partition contribution stopped')); phase = 'stopping'; notify();
      closing = (async () => {
        await preparing?.catch(() => {});
        await Promise.allSettled([...operations]);
        try { await dispose(); phase = 'closed'; error = null; } catch (cause) { phase = 'failed'; error = String(cause.message || cause); throw cause; }
        finally { finishDrain?.(); notify(); }
      })().catch(cause => { closing = null; throw cause; });
      return closing;
    }
  });
}
