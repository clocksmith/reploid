import { TEXT_GENERATION_CAPABILITY, requireGenerationCapability, boundedGeneration, tokenUsage } from './partition-generation-request.js';
import { createLayerPartitionRunner } from './partition-runner.js';
import { orderedPartitionDisclosure } from './partition-grants.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalRouteAttemptBinding, validatePartitionRoute } from './partition-contract.js';
import { validateOrderedPublicationContext, orderedPublicationAttempt, orderedGenerationBounds,
  orderedPublicationRecord } from './partition-ordered-publication.js';

/** Existing chat composition for an explicitly prepared, coordinator-mediated route.
 * With a requester publication port, every final-stage step is durably committed
 * by the requester's transaction owner before delivery or the next step. */
export function createOrderedPartitionChat({ runtime, authority, model, plan, planId, limits,
  grantTtlMs, ordered, authorizeRequester, now = Date.now }) {
  const route = structuredClone(ordered.route), policy = structuredClone(limits), stages = [...ordered.stages];
  // Distinguishes this coordinator incarnation's admissions in requester history.
  const coordinatorEpoch = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const local = stages[0], coordinatorId = route.stages[0].participantId;
  assert(local.id === coordinatorId && local.id === authority.participantId && typeof local.tokenize === 'function'
    && stages.every(stage => typeof stage.getState === 'function' && typeof stage.subscribe === 'function'),
  'Ordered chat requires the actual local coordinator and prepared stage ports');
  assert(model.id === route.modelId && model.identity === route.modelIdentity && planId === route.planId
    && Number.isSafeInteger(grantTtlMs) && grantTtlMs > 0, 'Ordered chat model, plan and grant lifetime required');
  const selection = { id: model.id, name: model.name, identity: model.identity, adapters: [],
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
    authorize: request => authority.verify(request.grant, request) });
  const models = () => [{ ...structuredClone(selection), textGeneration: TEXT_GENERATION_CAPABILITY,
    availability: !closed && validated && stages.every(stage => stage.getState().ready) ? 'ready' : 'unavailable',
    providerIds: stages.map(stage => stage.id), placement: 'ordered-layer-partition' }];
  const notify = () => { for (const listener of listeners) { try { listener(models()); } catch {} } };
  const unsubscribers = stages.map(stage => stage.subscribe(notify));
  async function refresh(options) { await preparation; await Promise.all(stages.slice(1).map(stage => stage.refresh(options))); notify(); return models(); }
  async function releaseOpening(identity) {
    await local.closeAttempt({ identity, partitionIndex: 0 }); openingDebt.delete(identity.attemptId);
  }
  async function generate(request, controls) {
    request = structuredClone(request);
    const requested = requireGenerationCapability(models()[0], request.generationRequest, request.canonical !== undefined);
      assert(!requested || requested.maxOutputTokens <= policy.maxTokens, 'Caller token limit exceeds route budget');
    const owner = controls.publication, published = owner !== undefined;
    assert(!closed && request.canonical === undefined && published === (request.publication !== undefined),
      'Ordered chat requires ordinary execution, an open owner and explicit requester publication context');
    const context = published ? validateOrderedPublicationContext(request.publication) : null;
    if (published) assert(owner?.requiresCommitEvidence === true && ['reconcile', 'admitAttempt', 'publish', 'cancel']
      .every(name => typeof owner[name] === 'function') && typeof runtime.metadataDigest === 'function' && context.deadlineAt > now(),
    'Ordered requester publication, digest contract or deadline unavailable');
    const signal = controls.signal ? AbortSignal.any([lifetime.signal, controls.signal]) : lifetime.signal;
    signal.throwIfAborted();
    assert(request.disclosureExpiresAt === undefined || Number.isSafeInteger(request.disclosureExpiresAt) && request.disclosureExpiresAt > now(),
      'Requester disclosure deadline expired or invalid');
    assert(request.meshId === authority.meshId && request.model.id === selection.id
      && request.model.identity === selection.identity && !(request.model.adapters || []).length
      && canonicalPartitionJson(request.model.partition) === canonicalPartitionJson(selection.partition), 'Ordered chat selection mismatch');
    const identity = canonicalRouteAttemptBinding({ schema: 'reploid.partition-attempt/v2', route,
      requesterId: request.participantId, threadId: request.threadId, attemptId: request.attemptId,
      placementGeneration: request.placementGeneration ?? 0 });
    assert(!pending.has(identity.attemptId) && !openingDebt.has(identity.attemptId), 'Ordered chat attempt already pending');
    const completion = Promise.withResolvers(); pending.set(identity.attemptId, completion.promise);
    let grant = null, delegatedToRunner = false, failure, admitted = null, cancellation = null;
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
      assert(models()[0].availability === 'ready', 'No ready contributors for this ordered route');
      const disclosure = orderedPartitionDisclosure(identity), expiresAt = Math.min(now() + grantTtlMs, request.disclosureExpiresAt ?? Infinity);
      assert(expiresAt > now(), 'Requester disclosure expired during preparation');
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: identity.threadId,
        attemptId: identity.attemptId, peerId: coordinatorId, recipientIdentity: coordinatorId,
        modelId: selection.id, modelIdentity: selection.identity, adapterIdentities: [],
        operation: 'generate-partition', ...structuredClone(selection.partition), disclosure,
        expiresAt, input: { messages: structuredClone(request.messages), ...(requested ? {generationRequest: requested} : {}),
          recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      signal.throwIfAborted(); assert(approved === true && !closed, 'Ordered disclosure declined or chat closed');
      assert(now() < expiresAt, 'Ordered disclosure expired');
      openingDebt.set(identity.attemptId, identity);
      const input = await local.tokenize({ messages: request.messages, identity, signal });
      signal.throwIfAborted();
      assert(input.modelIdentity === selection.identity && Number.isSafeInteger(input.generation?.maxTokens)
        && input.generation.maxTokens > 0 && input.generation.maxTokens <= policy.maxTokens, 'Doppler tokenization contract mismatch');
      const generation = boundedGeneration(input.generation, requested);
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
      let publisher = null;
      if (published) {
        // Admit before any reservation or input disclosure to stages.
        const attempt = orderedPublicationAttempt({ binding: identity, coordinatorEpoch,
          publisherEpoch: context.publisherEpoch, generationDigest });
        const bounds = orderedGenerationBounds({ maxTokens: generation.maxTokens, maxOutputCharacters: policy.maxOutputCharacters });
        const state = await owner.reconcile(); signal.throwIfAborted();
        assert(Array.isArray(state?.attempts) && !state.attempts.some(item => item.identity?.attemptId === attempt.attemptId),
          'Ordered attempt was already admitted; retries require a fresh identity');
        await owner.admitAttempt({ identity: attempt, generationPolicy: bounds, executionIdentity: generationDigest,
          vocabSize: plan.vocabSize, deadlineAt: context.deadlineAt });
        admitted = attempt; signal.addEventListener('abort', settlePublication, { once: true }); signal.throwIfAborted();
        publisher = { attempt, bounds, previous: state.head ?? null, base: null };
      }
      controls.onState?.({ threadId: identity.threadId, attemptId: identity.attemptId, status: 'executing',
        execution: { placement: 'ordered-layer-partition', identity } });
      let sequence = 0;
      const operation = runner.execute({ identity, tokenIds: input.tokenIds, generation,
        maxTokens: generation.maxTokens, signal,
        grants: { execution: stages.map(() => grant), tokenContext: stages.map(() => grant),
          activation: stages.slice(1).map(() => grant), output: grant },
        onActivity: activity => controls.onActivity?.({threadId: identity.threadId, attemptId: identity.attemptId, ...activity}),
        // Published text reaches the requester only as its own durable projection.
        ...(publisher ? { onStep: async step => {
          const record = orderedPublicationRecord({ attempt: publisher.attempt, bounds: publisher.bounds, vocabSize: plan.vocabSize,
            base: publisher.base, previousPublicationDigest: publisher.previous, metadataDigest: runtime.metadataDigest, step });
          const receipt = await owner.publish(record, { evidence: [] });
          assert(receipt?.attemptId === record.attemptId && receipt.coordinatorEpoch === record.coordinatorEpoch
            && receipt.sequence === record.sequence && receipt.publicationDigest === record.publicationDigest,
          'Durable ordered publication receipt mismatch');
          publisher.previous = record.publicationDigest; publisher.base = record.successor;
        } } : { onDelta: text => controls.onDelta?.({ threadId: identity.threadId, attemptId: identity.attemptId, sequence: sequence++, text }) }) });
      try {
        const result = await operation;
        assert(!publisher || publisher.base?.terminal === true, 'Ordered generation ended without its durable terminal publication');
        return { threadId: identity.threadId, attemptId: identity.attemptId, modelId: selection.id,
          modelIdentity: selection.identity, adapterIdentities: [], content: result.content,
          ...(requested ? {usage: tokenUsage(input.tokenIds.length, result.tokenIds.length, requested)} : {}),
          execution: { ...result.execution, provider: 'peer' } };
      } finally {
        // An accepted runner attempt owns cleanup, including failed cleanup and
        // retries. Pre-admission rejection leaves tokenizer ownership here.
        delegatedToRunner = runner.getState().attempts.some(item => item.identity.attemptId === identity.attemptId);
        if (delegatedToRunner) openingDebt.delete(identity.attemptId);
      }
    } catch (error) {
      failure = error;
      const cancellationError = await settlePublication();
      if (cancellationError) throw new AggregateError([error, cancellationError], 'Ordered execution and publication settlement failed');
      throw error;
    } finally {
      signal.removeEventListener('abort', settlePublication);
      if (grant) authority.revoke(grant);
      try { if (!delegatedToRunner && openingDebt.has(identity.attemptId)) await releaseOpening(identity); }
      catch (error) { throw new AggregateError(failure ? [failure, error] : [error], 'Ordered chat opening cleanup failed'); }
      finally { pending.delete(identity.attemptId); completion.resolve(); }
    }
  }
  return Object.freeze({ getModels: models,
    getState: () => ({ ...runner.getState(), pendingInputs: pending.size, unsettledInputs: openingDebt.size }),
    subscribe(listener) { listeners.add(listener); listener(models()); return () => listeners.delete(listener); }, refresh, generate,
    async close() {
      closed = true; lifetime.abort(new Error('Ordered chat closed')); unsubscribers.forEach(unsubscribe => unsubscribe());
      await Promise.allSettled([...pending.values()]);
      const results = await Promise.allSettled([runner.close(), ...[...openingDebt.values()].map(releaseOpening)]);
      listeners.clear();
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Ordered chat cleanup remains unsettled');
    }
  });
}
