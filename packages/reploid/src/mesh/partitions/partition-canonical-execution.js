import { createCanonicalPartitionContract } from './partition-canonical-contract.js';
import { verifyPartitionStageCommit } from './partition-stage-commit.js';
import { assertPartition as assert } from './partition-contract.js';

/** One ordinary canonical attempt, inside the existing runner's allocation,
 * FIFO lease and settlement owner. No scheduler, sampler or recovery loop. */
export async function executeCanonicalPartition({ runtime, plan, deviceA, deviceB, policy, binding, authority,
  canonical, tokenIds, signal, lease, permit, onDelta, receipt, ownDevice }) {
  assert(runtime.hashLayerPartitionPlan(plan) === binding.planId, 'Canonical selected plan identity mismatch');
  const publicationOwner = canonical.publication;
  assert(publicationOwner?.requiresCommitEvidence === true
    && ['admitAttempt', 'publish', 'reconcile', 'cancel'].every(name => typeof publicationOwner[name] === 'function'),
  'Canonical execution requires durable authenticated publication');
  const hash = (domain, value) => runtime.metadataDigest(domain, value);
  const same = (a, b) => hash('reploid.canonical-execution-value/v1', a) === hash('reploid.canonical-execution-value/v1', b);
  hash('reploid.canonical-execution-input/v1', { attempt: canonical.attempt, generation: canonical.generation,
    deadlineAt: canonical.deadlineAt });
  const { attempt: selected, generation: supplied, deadlineAt } = structuredClone({ attempt: canonical.attempt,
    generation: canonical.generation, deadlineAt: canonical.deadlineAt });
  const attempt = runtime.validateResidentAttemptIdentity(selected);
  const generation = runtime.canonicalGenerationIdentity(supplied.policy, supplied.executionIdentity, plan.vocabSize);
  assert(same(generation, supplied) && attempt.generationId === generation.generationId
    && attempt.attemptId === binding.attemptId && attempt.requesterId === binding.requesterId
    && attempt.routeKind === 'two-stage-layer' && attempt.stages.length === 2
    && attempt.inputDigest === runtime.tokenDigest(tokenIds, plan.vocabSize, policy.maxPromptTokens),
  'Canonical attempt or effective prompt mismatch');
  assert(generation.policy.maxGeneratedTokens <= policy.maxTokens
    && generation.policy.maxVisibleOutputUtf16 <= policy.maxOutputCharacters
    && Number.isSafeInteger(deadlineAt) && deadlineAt > Date.now(), 'Canonical allocation or deadline mismatch');
  for (const [index, device] of [deviceA, deviceB].entries()) {
    assert(same(device.getCanonicalGeneration(), generation) && same(device.getCanonicalStage(), attempt.stages[index])
      && device.id === attempt.stages[index].participantId, 'Canonical resident generation or stage changed');
  }
  const contract = createCanonicalPartitionContract({ runtime, plan, planId: binding.planId, modelIdentity: binding.modelIdentity });
  const expectedAdmission = runtime.admitResidentPrompt(tokenIds, generation.policy, plan.vocabSize, generation.generationId);
  let cursor = null, previous = null, continuationA = null, continuationB = null, admitted = false, cancellation = null;
  let content = '', activationBytes = 0, input = [...tokenIds], position = 0, stopReason = null;
  const tokens = [], steps = [], publications = [];
  const cancel = () => {
    if (!cancellation && admitted) cancellation = publicationOwner.cancel(attempt.attemptId, attempt.coordinatorEpoch)
      .then(() => null, error => error);
    return cancellation;
  };
  const wire = (sequence, phase = 'step') => ({ schema: contract.schema, operation: phase === 'admit' ? 'admit' : 'step', phase,
    identity: binding, canonicalAttempt: attempt, generationId: generation.generationId, sequence, step: sequence,
    tokenPosition: position, inputTokenCount: input.length, inputTokenIds: [...input], baseCursorId: cursor?.cursorId ?? null,
    baseCursor: cursor, grant: authority.executionB, continuation: continuationB });
  const authorize = async request => {
    for (const [action, name] of [['mesh.execute_partition_a', 'executionA'], ['mesh.execute_partition_b', 'executionB'],
      ['mesh.transfer_intermediate_activation', 'activation'], ['mesh.transfer_token_context', 'tokenContext'],
      ['mesh.transfer_partition_output', 'output']]) {
      await permit(action, authority[name], { step: request.step, sequence: request.sequence, phase: request.phase,
        tokenPosition: request.tokenPosition, inputTokenCount: request.inputTokenCount,
        maxTokens: generation.policy.maxGeneratedTokens, canonicalAttempt: attempt, generationId: generation.generationId });
    }
  };
  const publish = async (request, body, commits) => {
    const publication = { ...body, publicationDigest: hash(body.schema, body) };
    await authorize(request);
    const saved = await publicationOwner.publish(publication, { evidence: commits.map(c => c.evidence) });
    publications.push({ publication, receipt: saved, commits });
    // A transaction receipt is not an ephemeral peer acknowledgment. No next
    // step or UI delivery occurs until the retained B result accepts this one.
    await deviceB.acknowledgeCanonicalPublication({ ...request, publication, receipt: saved, commits, signal });
    previous = publication.publicationDigest;
    return saved;
  };
  try {
    signal.throwIfAborted();
    const request = wire(0, 'admit');
    contract.validateBinding(request);
    await authorize(request);
    const state = await publicationOwner.reconcile(); previous = state.head;
    assert(Array.isArray(state.attempts) && !state.attempts.some(item => item.identity.attemptId === attempt.attemptId
      && item.identity.coordinatorEpoch === attempt.coordinatorEpoch), 'Canonical attempt was already admitted; retries require a fresh identity');
    await publicationOwner.admitAttempt({ identity: attempt, generationPolicy: generation.policy,
      executionIdentity: generation.executionIdentity, vocabSize: plan.vocabSize, deadlineAt });
    admitted = true; signal.addEventListener('abort', cancel, { once: true }); signal.throwIfAborted();
    await authorize(request);
    ownDevice(deviceA.id);
    receipt.reservations.push(structuredClone(await deviceA.reserve(binding)));
    ownDevice(deviceB.id);
    const reserved = await deviceB.reserveCanonical({ ...request, signal });
    receipt.reservations.push(structuredClone(reserved.reservation));
    await lease(async () => {
      await authorize(request);
      const a = await deviceA.admitCanonicalPrompt({ identity: binding, tokenIds: [...tokenIds], generationId: generation.generationId, signal });
      const b = await deviceB.admitCanonicalPrompt({ ...request, signal });
      assert(same(a, expectedAdmission) && same(b, expectedAdmission), 'Canonical participant prompt admission differs');
    });
    if (!('kind' in expectedAdmission)) {
      await publish(request, { schema: 'doppler.admission-publication/v1', attemptId: attempt.attemptId,
        coordinatorEpoch: attempt.coordinatorEpoch, attemptDigest: runtime.residentAttemptDigest(attempt), sequence: 0,
        expectedRevision: null, previousPublicationDigest: previous, result: expectedAdmission }, []);
      stopReason = expectedAdmission.stopReason;
    } else {
      for (let sequence = 0; sequence < generation.policy.maxGeneratedTokens; sequence++) {
        const queuedAt = performance.now();
        const delivery = await lease(async () => {
          const started = performance.now(), request = wire(sequence);
          const leaseWaitMs = started - queuedAt;
          await authorize(request);
          const a = structuredClone(await deviceA.executeCanonicalGroup0({ identity: binding, canonicalAttempt: attempt,
            tokenIds: [...input], continuation: continuationA, generationId: generation.generationId,
            baseCursorId: request.baseCursorId, sequence, step: sequence, tokenPosition: position,
            inputTokenCount: input.length, executionGrant: authority.executionA, signal }));
          signal.throwIfAborted();
          const frame = await contract.serializeActivation({ ...request, activationTensor: a.activationTensor });
          assert(frame.byteLength <= policy.maxActivationBytes, 'Canonical activation exceeds allocation');
          await authorize(request);
          const b = structuredClone(await deviceB.executeCanonicalFrame({ ...request, frame, signal }));
          signal.throwIfAborted();
          assert(b && same(b.identity, binding) && b.step === sequence && b.tokenPosition === position
            && await verifyPartitionStageCommit({ runtime, attempt, stage: attempt.stages[1], ...b.commit,
              transition: b.transition, sequence, baseCursorId: request.baseCursorId }), 'Unauthenticated canonical output decision');
          await authorize(request);
          const committed = structuredClone(await deviceA.commitCanonicalTransition({ identity: binding, canonicalAttempt: attempt,
            generationId: generation.generationId, sequence, baseCursorId: request.baseCursorId,
            transition: b.transition, targetCommit: b.commit, signal }));
          assert(same(committed.transition, b.transition) && await verifyPartitionStageCommit({ runtime, attempt,
            stage: attempt.stages[0], ...committed.commit, transition: b.transition, sequence, baseCursorId: request.baseCursorId }),
          'Canonical input stage did not commit the authenticated decision');
          const transition = committed.transition;
          assert(transition.acceptedTokenIds.length === 1 && typeof transition.delta === 'string'
            && content.length + transition.delta.length <= policy.maxOutputCharacters, 'Canonical ordinary result exceeds allocation');
          const body = { schema: 'doppler.execution-publication/v2', attemptId: attempt.attemptId,
            coordinatorEpoch: attempt.coordinatorEpoch, attemptDigest: runtime.residentAttemptDigest(attempt), sequence,
            expectedRevision: cursor?.revision ?? null, previousPublicationDigest: previous, baseCursorId: request.baseCursorId,
            decisionId: committed.commit.acknowledgment.decisionId, acceptedTokenIds: transition.acceptedTokenIds,
            tokenRange: transition.tokenRange, successor: transition.successor,
            delta: { text: transition.delta, outputDigest: transition.outputDigest }, stoppingOutcome: transition.successor.stopReason,
            acknowledgments: [committed.commit.acknowledgment, b.commit.acknowledgment] };
          const value = { ...body, publicationDigest: hash(body.schema, body) };
          runtime.validateExecutionPublication(value, attempt, generation.policy, plan.vocabSize, cursor);
          return { request, body, commits: [committed.commit, b.commit], transition,
            continuationA: a.continuation, continuationB: b.continuation, bytes: frame.byteLength,
            leaseWaitMs, elapsedMs: performance.now() - started };
        });
        // Durable storage and remote acknowledgment retain this attempt's parent
        // barrier, but must not hold another conversation's numerical lease.
        await publish(delivery.request, delivery.body, delivery.commits);
        cursor = delivery.transition.successor;
        continuationA = delivery.continuationA; continuationB = delivery.continuationB;
        tokens.push(...delivery.transition.acceptedTokenIds); content += delivery.transition.delta;
        activationBytes += delivery.bytes;
        steps.push({ sequence, step: sequence, tokenPosition: position, inputTokenCount: input.length,
          tokenId: delivery.transition.acceptedTokenIds[0], activationBytes: delivery.bytes, leaseWaitMs: delivery.leaseWaitMs,
          elapsedMs: delivery.elapsedMs, outputDeliveryMs: 0 });
        position = cursor.materializedTokenCount; input = [cursor.pendingTokenId]; stopReason = cursor.stopReason;
        signal.throwIfAborted();
        if (delivery.transition.delta) {
          const started = performance.now();
          try { await onDelta(delivery.transition.delta); } finally { steps.at(-1).outputDeliveryMs = performance.now() - started; }
        }
        signal.throwIfAborted();
        if (cursor.terminal) break;
      }
      assert(cursor?.terminal, 'Canonical generation did not reach its declared stopping outcome');
    }
    return { content, tokenIds: tokens, logits: null, stopReason,
      execution: { schema: 'reploid.mesh.canonical-partition-execution/v1', ...binding, canonicalAttempt: attempt,
        placement: 'two-device-layer-partition', splitLayer: plan.splitLayer, activationBytes, steps, publications, settlement: receipt } };
  } catch (error) {
    const cancellationError = await cancel();
    if (cancellationError) throw new AggregateError([error, cancellationError], 'Canonical execution and publication settlement failed');
    throw error;
  } finally { signal.removeEventListener('abort', cancel); }
}
