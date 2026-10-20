import { partitionAdapterIdentities, samePartitionAdapters } from './partition-contract.js';
import { TEXT_GENERATION_CAPABILITY, requireGenerationCapability, boundedGeneration, tokenUsage } from './partition-generation-request.js';
import { createLayerPartitionRunner } from './partition-runner.js';
import { orderedPartitionDisclosure } from './partition-grants.js';
import { assertPartition as assert, assertCapacity, partitionFailure, canonicalPartitionJson, canonicalRouteAttemptBinding,
  validatePartitionRoute } from './partition-contract.js';
import { validateOrderedPublicationContext, orderedPublicationAttempt, orderedGenerationBounds,
  orderedPublicationRecord } from './partition-ordered-publication.js';
import { ATTEMPT_QUEUE_POLICY, createPartitionAttemptQueue } from './partition-attempt-queue.js';
import { ROUTE_ENVELOPE_POLICY, createRouteEnvelope } from './partition-route-envelope.js';

/** Existing chat composition for an explicitly prepared, coordinator-mediated route.
 * With a requester publication port, final-stage steps are durably committed by the
 * requester's transaction owner before delivery, in batches bounded by the window the
 * requester declares when it admits the attempt (none declared: every step, before the next).
 * Requests are checked against the route's declared envelope (`ordered.envelope`, otherwise the
 * partitions component's policy) after tokenization and before any stage reservation or grant.
 * The attempt's answer deadline is its grant lifetime less the declared clock allowance.
 * An authorized attempt that finds the route's slots or this coordinator's own stage full waits
 * in `ordered.queue` (shared by a coordinator's routes; otherwise this route's own queue under the
 * partitions component's policy) and reports `queued`. Waiting tokenizes, reserves, grants and
 * discloses nothing; admission happens before the disclosure window is applied, so waiting never
 * extends it, and the route an attempt waits for is the route it runs on. */
export function createOrderedPartitionChat({ runtime, authority, model, plan, planId, limits,
  grantTtlMs, ordered, authorizeRequester, now = Date.now }) {
  const route = structuredClone(ordered.route), policy = structuredClone(limits), stages = [...ordered.stages];
  const queue = ordered.queue ?? createPartitionAttemptQueue({ policy: ATTEMPT_QUEUE_POLICY });
  const envelope = createRouteEnvelope({ policy: ordered.envelope ?? ROUTE_ENVELOPE_POLICY, route });
  assert(Number.isSafeInteger(authority.maxClockSkewMs) && authority.maxClockSkewMs >= 0, 'Ordered chat requires the declared clock allowance');
  assert(['admit', 'pump'].every(method => typeof queue?.[method] === 'function'), 'Ordered admission queue required');
  // Distinguishes this coordinator incarnation's admissions in requester history.
  const coordinatorEpoch = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const local = stages[0], coordinatorId = route.stages[0].participantId;
  assert(local.id === coordinatorId && local.id === authority.participantId && typeof local.tokenize === 'function'
    && stages.every(stage => typeof stage.getState === 'function' && typeof stage.subscribe === 'function'),
  'Ordered chat requires the actual local coordinator and prepared stage ports');
  assert(model.id === route.modelId && model.identity === route.modelIdentity && planId === route.planId
    && Number.isSafeInteger(grantTtlMs) && grantTtlMs > 0, 'Ordered chat model, plan and grant lifetime required');
  assert(canonicalPartitionJson(plan.adapterIdentities || []) === canonicalPartitionJson(partitionAdapterIdentities(model)), 'Partition plan adapter binding mismatch');
  const selection = { id: model.id, name: model.name, identity: model.identity, adapters: structuredClone(model.adapters || []),
    selectionId: model.id + '/partition/' + planId,
    partition: { schema: 'reploid.partition-selection/v2', planId, coordinatorId, route } };
  for (const key of ['provider', 'contextLength', 'quantization', 'size', 'recommended']) {
    if (model[key] !== undefined) selection[key] = structuredClone(model[key]);
  }
  let closed = false, validated = false;
  const preparation = validatePartitionRoute(runtime, plan, route).then(() => { validated = true; });
  preparation.catch(() => {});
  const listeners = new Set(), pending = new Map(), openingDebt = new Map();
  const lifetime = new AbortController();
  const runner = createLayerPartitionRunner({ runtime, plan, route, stages, limits: policy,
    // The coordinator holds this frame between stage ports. The authenticated
    // peer owns its actual outgoing binary transfer in executeStage.
    transport: { transferActivation: async frame => structuredClone(frame) },
    // A grant expires with its attempt's answer window: expiry is the deadline, not a refusal.
    authorize: async request => {
      const { ok, reason } = await authority.check(request.grant, request);
      if (reason === 'expired') throw partitionFailure('ANSWER_DEADLINE_EXCEEDED');
      return ok;
    } });
  const models = () => [{ ...structuredClone(selection), textGeneration: TEXT_GENERATION_CAPABILITY,
    availability: !closed && validated && stages.every(stage => stage.getState().ready) ? 'ready' : 'unavailable',
    providerIds: stages.map(stage => stage.id), placement: 'ordered-layer-partition' }];
  // Stage state changes (a settled reservation, a lost stage) may admit or refuse waiting attempts.
  const notify = () => { for (const listener of listeners) { try { listener(models()); } catch {} } queue.pump(); };
  const unsubscribers = stages.map(stage => stage.subscribe(notify));
  // The route's occupied slots: live admission tickets plus finished attempts whose cleanup has
  // not settled (the runner still counts them). The coordinator's own stage is shared by its
  // routes; tickets not yet holding its reservation are subtracted from what it advertises.
  const queueKey = Symbol('ordered-route');
  const admissible = ({ admitted, opening }) => {
    assertCapacity(!closed && models()[0].availability === 'ready');
    const runnerState = runner.getState();
    const unsettledOpenings = [...openingDebt.keys()].filter(id => !pending.has(id)).length;
    const slots = local.getState().reservations?.availableSlots;
    return admitted + runnerState.unsettled + unsettledOpenings < policy.maxConcurrentAttempts
      && (!Number.isSafeInteger(slots) || slots - opening > 0);
  };
  async function refresh(options) { await preparation; await Promise.all(stages.slice(1).map(stage => stage.refresh(options))); notify(); return models(); }
  async function releaseOpening(identity) {
    await local.closeAttempt({ identity, partitionIndex: 0 }); openingDebt.delete(identity.attemptId);
  }
  // The requester's declared persistence window, or none: then each step commits before the next.
  const persistenceWindow = value => {
    if (value === undefined || value === null) return null;
    assert(value && Number.isSafeInteger(value.maxUnsavedSteps) && value.maxUnsavedSteps > 0
      && Number.isSafeInteger(value.maxUnsavedMs) && value.maxUnsavedMs >= 0 && value.maxUnsavedMs <= 2147483647,
    'Invalid requester persistence window');
    return { maxUnsavedSteps: value.maxUnsavedSteps, maxUnsavedMs: value.maxUnsavedMs };
  };
  /** Chains each step's record to the conversation head as it is computed and commits records in
   * order off the step path: a commit starts `maxUnsavedMs` after the first uncommitted step, and
   * steps computed during a commit form the next batch. The terminal step waits for its commit, and
   * a step that would leave more than `maxUnsavedSteps` uncommitted waits for the commit before it. */
  function createPublisher({ owner, attempt, bounds, head, window }) {
    let previous = head, base = null, durable = null, error = null, timer = null, uncommitted = 0, draining = null;
    let unsaved = [];
    const commit = async batch => {
      const receipts = batch.length > 1 && typeof owner.publishBatch === 'function'
        ? await owner.publishBatch(batch, { evidence: batch.map(() => []) })
        : await batch.reduce((chain, record) => chain.then(async list => [...list, await owner.publish(record, { evidence: [] })]), Promise.resolve([]));
      assert(Array.isArray(receipts) && receipts.length === batch.length && batch.every((record, index) => {
        const receipt = receipts[index];
        return receipt?.attemptId === record.attemptId && receipt.coordinatorEpoch === record.coordinatorEpoch
          && receipt.sequence === record.sequence && receipt.publicationDigest === record.publicationDigest;
      }), 'Durable ordered publication receipt mismatch');
      durable = batch.at(-1).successor; uncommitted -= batch.length;
    };
    const flush = () => {
      clearTimeout(timer); timer = null;
      draining ??= (async () => {
        try {
          while (unsaved.length) {
            if (error) throw error;
            const batch = unsaved; unsaved = [];
            await commit(batch);
          }
        } catch (cause) { error ??= cause; throw error; }
        finally { draining = null; }
      })();
      return draining;
    };
    return {
      durable: () => durable,
      flush: () => error ? Promise.reject(error) : flush(),
      async step(step) {
        if (error) throw error;
        const record = orderedPublicationRecord({ attempt, bounds, vocabSize: plan.vocabSize, base,
          previousPublicationDigest: previous, metadataDigest: runtime.metadataDigest, step });
        previous = record.publicationDigest; base = record.successor;
        unsaved.push(record); uncommitted++;
        if (step.done || !window || uncommitted > window.maxUnsavedSteps) await flush();
        else if (!draining && !timer) timer = setTimeout(() => { flush().catch(() => {}); }, window.maxUnsavedMs);
      }
    };
  }
  async function generate(request, controls) {
    request = structuredClone(request);
    const requested = requireGenerationCapability(models()[0], request.generationRequest, request.canonical !== undefined);
      assert(!requested || requested.maxOutputTokens <= policy.maxTokens, 'Caller token limit exceeds route budget');
    const owner = controls.publication, published = owner !== undefined;
    assertCapacity(!closed);
    assert(request.canonical === undefined && published === (request.publication !== undefined),
      'Ordered chat requires ordinary execution and explicit requester publication context');
    const context = published ? validateOrderedPublicationContext(request.publication) : null;
    if (published) assert(owner?.requiresCommitEvidence === true && ['reconcile', 'admitAttempt', 'publish', 'cancel']
      .every(name => typeof owner[name] === 'function') && typeof runtime.metadataDigest === 'function' && context.deadlineAt > now(),
    'Ordered requester publication, digest contract or deadline unavailable');
    const signal = controls.signal ? AbortSignal.any([lifetime.signal, controls.signal]) : lifetime.signal;
    signal.throwIfAborted();
    assert(request.disclosureExpiresAt === undefined || Number.isSafeInteger(request.disclosureExpiresAt) && request.disclosureExpiresAt > now(),
      'Requester disclosure deadline expired or invalid');
    assert(request.meshId === authority.meshId && request.model.id === selection.id
      && request.model.identity === selection.identity && samePartitionAdapters(request.model, selection)
      && canonicalPartitionJson(request.model.partition) === canonicalPartitionJson(selection.partition), 'Ordered chat selection mismatch');
    const identity = canonicalRouteAttemptBinding({ schema: 'reploid.partition-attempt/v2', route,
      requesterId: request.participantId, threadId: request.threadId, attemptId: request.attemptId,
      placementGeneration: request.placementGeneration ?? 0 });
    assert(!pending.has(identity.attemptId) && !openingDebt.has(identity.attemptId), 'Ordered chat attempt already pending');
    const completion = Promise.withResolvers(); pending.set(identity.attemptId, completion.promise);
    let grant = null, delegatedToRunner = false, failure, admitted = null, cancellation = null, ticket = null, workload = null, publisher = null;
    // The requester's writer records cancellation of an admitted attempt; a
    // committed terminal record stays completed (the writer never rewrites it).
    const settlePublication = () => {
      if (admitted && !cancellation) cancellation = Promise.resolve()
        .then(() => owner.cancel(admitted.attemptId, admitted.coordinatorEpoch)).then(() => null, error => error);
      return cancellation;
    };
    try {
      if (identity.requesterId !== coordinatorId) assert(typeof authorizeRequester === 'function'
        && await authorizeRequester(request, signal) === true, 'Requester has not authorized this route');
      assert(request.permissions?.sharingScope && request.permissions.sharingScope !== 'local', 'Partition disclosure is disabled');
      await refresh({ signal }); signal.throwIfAborted();
      assertCapacity(models()[0].availability === 'ready');
      // Wait for a slot on this exact route, bounded by policy and by the attempt's own disclosure and
      // publication deadlines. Closing this chat or losing a stage refuses the wait with
      // CAPACITY_UNAVAILABLE; the requester's cancellation removes it with nothing held.
      ticket = await queue.admit({ key: queueKey, attemptId: identity.attemptId, requesterId: identity.requesterId,
        deadlineAt: Math.min(request.disclosureExpiresAt ?? Infinity, context?.deadlineAt ?? Infinity),
        signal: controls.signal, check: admissible,
        onQueued: () => controls.onState?.({ threadId: identity.threadId, attemptId: identity.attemptId, status: 'queued',
          execution: { placement: 'ordered-layer-partition', identity } }) });
      signal.throwIfAborted();
      const disclosure = orderedPartitionDisclosure(identity), expiresAt = Math.min(now() + grantTtlMs, request.disclosureExpiresAt ?? Infinity);
      assert(expiresAt > now(), 'Requester disclosure expired during preparation');
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: identity.threadId,
        attemptId: identity.attemptId, peerId: coordinatorId, recipientIdentity: coordinatorId,
        modelId: selection.id, modelIdentity: selection.identity, adapterIdentities: partitionAdapterIdentities(selection),
        operation: 'generate-partition', ...structuredClone(selection.partition), disclosure,
        expiresAt, input: { messages: structuredClone(request.messages), ...(requested ? {generationRequest: requested} : {}),
          recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      signal.throwIfAborted(); assert(approved === true && !closed, 'Ordered disclosure declined or chat closed');
      assert(now() < expiresAt, 'Ordered disclosure expired');
      openingDebt.set(identity.attemptId, identity);
      let input;
      // Tokenizing takes this coordinator stage's reservation; from here it counts in the stage's own slots.
      try { input = await local.tokenize({ messages: request.messages, identity, signal }); } finally { ticket.opened(); }
      signal.throwIfAborted();
      assert(input.modelIdentity === selection.identity && Number.isSafeInteger(input.generation?.maxTokens)
        && input.generation.maxTokens > 0 && input.generation.maxTokens <= policy.maxTokens, 'Doppler tokenization contract mismatch');
      let generation = boundedGeneration(input.generation, requested);
      // Outside the route's declared envelope nothing is reserved, granted or sent to another stage.
      workload = envelope.admit({ attemptId: identity.attemptId, promptTokens: input.tokenIds.length,
        answerTokens: generation.maxTokens, explicit: !!requested });
      if (workload.answerTokens !== generation.maxTokens) generation = { ...generation, maxTokens: workload.answerTokens };
      if (requested) {
        await controls.onUsage?.({threadId: identity.threadId, attemptId: identity.attemptId, ...tokenUsage(input.tokenIds.length, 0, requested)});
        signal.throwIfAborted();
      }
      const generationDigest = await runtime.hashPartitionGeneration(generation);
      const remainingMs = Math.floor(expiresAt - now());
      assert(remainingMs > 0, 'Ordered disclosure expired during preparation');
      grant = await authority.issueOrdered(identity, policy, { approved: true, ttlMs: Math.min(grantTtlMs, remainingMs), disclosure, generationDigest, expiresAt });
      signal.throwIfAborted();
      assert(now() < expiresAt && grant.claim.expiresAt <= expiresAt, 'Ordered disclosure expired during grant signing');
      if (published) {
        // Admit before any reservation or input disclosure to stages.
        const attempt = orderedPublicationAttempt({ binding: identity, coordinatorEpoch,
          publisherEpoch: context.publisherEpoch, generationDigest });
        const bounds = orderedGenerationBounds({ maxTokens: generation.maxTokens, maxOutputCharacters: policy.maxOutputCharacters });
        const state = await owner.reconcile(); signal.throwIfAborted();
        assert(Array.isArray(state?.attempts) && !state.attempts.some(item => item.identity?.attemptId === attempt.attemptId),
          'Ordered attempt was already admitted; retries require a fresh identity');
        const record = await owner.admitAttempt({ identity: attempt, generationPolicy: bounds, executionIdentity: generationDigest,
          vocabSize: plan.vocabSize, deadlineAt: context.deadlineAt });
        admitted = attempt; signal.addEventListener('abort', settlePublication, { once: true }); signal.throwIfAborted();
        publisher = createPublisher({ owner, attempt, bounds, head: state.head ?? null, window: persistenceWindow(record?.persistence) });
      }
      controls.onState?.({ threadId: identity.threadId, attemptId: identity.attemptId, status: 'executing',
        execution: { placement: 'ordered-layer-partition', identity } });
      let sequence = 0;
      // A charged attempt's signed binding reaches every stage; outputs return for acknowledgment.
      const operation = runner.execute({ identity, tokenIds: input.tokenIds, generation,
        maxTokens: generation.maxTokens, signal,
        ...(request.charge ? { charge: request.charge, acknowledgmentDeadlineAt: expiresAt,
          ...(typeof controls.onOutput === 'function' ? { onOutput: controls.onOutput } : {}) } : {}),
        // Fail at the deadline before any participant within the declared clock allowance sees the grant expire.
        deadlineAt: grant.claim.expiresAt - authority.maxClockSkewMs,
        grants: { execution: stages.map(() => grant), tokenContext: stages.map(() => grant),
          activation: stages.slice(1).map(() => grant), output: grant },
        onActivity: activity => controls.onActivity?.({threadId: identity.threadId, attemptId: identity.attemptId, ...activity}),
        // Published text reaches the requester only as its own durable projection.
        ...(publisher ? { onStep: step => publisher.step(step) }
          : { onDelta: text => controls.onDelta?.({ threadId: identity.threadId, attemptId: identity.attemptId, sequence: sequence++, text }) }) });
      try {
        const result = await operation;
        assert(!publisher || publisher.durable()?.terminal === true, 'Ordered generation ended without its durable terminal publication');
        return { threadId: identity.threadId, attemptId: identity.attemptId, modelId: selection.id,
          modelIdentity: selection.identity, adapterIdentities: partitionAdapterIdentities(selection), content: result.content,
          ...(requested ? {usage: tokenUsage(input.tokenIds.length, result.tokenIds.length, requested)} : {}),
          // Coordinator admission wait for this attempt (0 when a slot was free on arrival).
          execution: { ...result.execution, provider: 'peer', admission: { queuedMs: ticket.queuedMs },
            ...(workload.envelope ? { envelope: workload.envelope } : {}) } };
      } finally {
        // An accepted runner attempt owns cleanup, including failed cleanup and
        // retries. Pre-admission rejection leaves tokenizer ownership here.
        delegatedToRunner = runner.getState().attempts.some(item => item.identity.attemptId === identity.attemptId);
        if (delegatedToRunner) openingDebt.delete(identity.attemptId);
      }
    } catch (error) {
      failure = error;
      // A failed attempt keeps every step it computed: the unsaved window is committed before the
      // writer records the attempt's end. A requester that stopped refuses further publication.
      await publisher?.flush().catch(() => {});
      const cancellationError = await settlePublication();
      if (cancellationError) throw new AggregateError([error, cancellationError], 'Ordered execution and publication settlement failed');
      throw error;
    } finally {
      signal.removeEventListener('abort', settlePublication);
      if (grant) authority.revoke(grant);
      try { if (!delegatedToRunner && openingDebt.has(identity.attemptId)) await releaseOpening(identity); }
      catch (error) { throw new AggregateError(failure ? [failure, error] : [error], 'Ordered chat opening cleanup failed'); }
      finally { pending.delete(identity.attemptId); completion.resolve(); ticket?.release(); if (workload) envelope.release(identity.attemptId); }
    }
  }
  return Object.freeze({ getModels: models,
    // pendingInputs includes attempts waiting for admission: a route with waiting attempts is not idle.
    getState: () => ({ ...runner.getState(), pendingInputs: pending.size, unsettledInputs: openingDebt.size }),
    subscribe(listener) { listeners.add(listener); listener(models()); return () => listeners.delete(listener); }, refresh, generate,
    async close() {
      // Attempts still waiting for this route fail as unavailable capacity; they never move to another route.
      closed = true; queue.pump(); lifetime.abort(new Error('Ordered chat closed')); unsubscribers.forEach(unsubscribe => unsubscribe());
      await Promise.allSettled([...pending.values()]);
      const results = await Promise.allSettled([runner.close(), ...[...openingDebt.values()].map(releaseOpening)]);
      listeners.clear();
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Ordered chat cleanup remains unsettled');
    }
  });
}
