import { createLayerPartitionRunner } from './partition-runner.js';
import { orderedPartitionDisclosure } from './partition-grants.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalRouteAttemptBinding, validatePartitionRoute } from './partition-contract.js';

/** Existing chat composition for an explicitly prepared, coordinator-mediated route. */
export function createOrderedPartitionChat({ runtime, authority, model, plan, planId, limits,
  grantTtlMs, ordered, authorizeRequester, now = Date.now }) {
  const route = structuredClone(ordered.route), policy = structuredClone(limits), stages = [...ordered.stages];
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
  const models = () => [{ ...structuredClone(selection),
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
    assert(!closed && request.canonical === undefined && controls.publication === undefined,
      'Ordered chat requires ordinary execution and an open owner');
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
    let grant = null, delegatedToRunner = false, failure;
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
        expiresAt, input: { messages: structuredClone(request.messages),
          recipients: [...new Set([...disclosure.tokenRecipients, ...disclosure.outputRecipients])] } });
      signal.throwIfAborted(); assert(approved === true && !closed, 'Ordered disclosure declined or chat closed');
      assert(now() < expiresAt, 'Ordered disclosure expired');
      openingDebt.set(identity.attemptId, identity);
      const input = await local.tokenize({ messages: request.messages, identity, signal });
      signal.throwIfAborted();
      assert(input.modelIdentity === selection.identity && Number.isSafeInteger(input.generation?.maxTokens)
        && input.generation.maxTokens > 0 && input.generation.maxTokens <= policy.maxTokens, 'Doppler tokenization contract mismatch');
      const generationDigest = await runtime.hashPartitionGeneration(input.generation);
      const remainingMs = Math.floor(expiresAt - now());
      assert(remainingMs > 0, 'Ordered disclosure expired during preparation');
      grant = await authority.issueOrdered(identity, policy, { approved: true, ttlMs: Math.min(grantTtlMs, remainingMs), disclosure, generationDigest, expiresAt });
      signal.throwIfAborted();
      assert(now() < expiresAt && grant.claim.expiresAt <= expiresAt, 'Ordered disclosure expired during grant signing');
      controls.onState?.({ threadId: identity.threadId, attemptId: identity.attemptId, status: 'executing',
        execution: { placement: 'ordered-layer-partition', identity } });
      let sequence = 0;
      const operation = runner.execute({ identity, tokenIds: input.tokenIds, generation: input.generation,
        maxTokens: input.generation.maxTokens, signal,
        grants: { execution: stages.map(() => grant), tokenContext: stages.map(() => grant),
          activation: stages.slice(1).map(() => grant), output: grant },
        onDelta: text => controls.onDelta?.({ threadId: identity.threadId, attemptId: identity.attemptId, sequence: sequence++, text }) });
      try {
        const result = await operation;
        return { threadId: identity.threadId, attemptId: identity.attemptId, modelId: selection.id,
          modelIdentity: selection.identity, adapterIdentities: [], content: result.content,
          execution: { ...result.execution, provider: 'peer' } };
      } finally {
        // An accepted runner attempt owns cleanup, including failed cleanup and
        // retries. Pre-admission rejection leaves tokenizer ownership here.
        delegatedToRunner = runner.getState().attempts.some(item => item.identity.attemptId === identity.attemptId);
        if (delegatedToRunner) openingDebt.delete(identity.attemptId);
      }
    } catch (error) { failure = error; throw error; }
    finally {
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
