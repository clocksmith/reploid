import { generationRequest, requireGenerationCapability, tokenUsage } from './partition-generation-request.js';
import { createPartitionDataChannel } from '../../transport/partition-data-channel.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalRouteAttemptBinding, sameRouteAttemptIdentity } from './partition-contract.js';
import { partitionActivity, summarizePartitionExecution } from './partition-summary.js';
import { createEntryPublicationScope, entryPublicationEnvelope, entryPublicationPort, matchingEntryPublication,
  validateEntryPublicationContext } from './partition-entry-publication.js';
import { validateOrderedPublicationContext } from './partition-ordered-publication.js';

/** Requester-to-A channel. This module imports no tokenizer, tensor codec or GPU runtime.
 * The host authenticates the channel and grants input disclosure to both stages.
 * A's chat port owns the A-to-B execution channel; activation bytes never enter here.
 */
export function createPartitionEntry({ channel, localParticipantId, remoteParticipantId,
  service = null, canonical = false, ordered = false, authorize, limits, inputLimits, now = Date.now }) {
  assert(typeof authorize === 'function' && ['maxInputCharacters', 'maxOutputCharacters', 'maxAttempts',
    'maxConcurrentAttempts', 'descriptorTtlMs'].every(key => Number.isSafeInteger(inputLimits?.[key]) && inputLimits[key] > 0),
  'Entry authorization and input budgets required');
  assert(typeof ordered === 'boolean' && !(ordered && canonical), 'Explicit distinct ordinary ordered entry capability required');
  assert(typeof canonical === 'boolean', 'Explicit canonical entry capability required');
  const policy = structuredClone(inputLimits), active = new Map(), retired = new Set();
  const deliveries = new Map(), unsettledPublications = new Set();
  let draining = false, closed = false, descriptor = null, observedAt = 0;
  const orderedInput = m => m?.schema === 'reploid.partition-input/v3';
  const coordinator = m => orderedInput(m) ? m.coordinatorId : m.participantA;
  const attempt = m => canonicalRouteAttemptBinding({ schema: 'reploid.partition-attempt/v2',
    route: m.route, threadId: m.threadId, attemptId: m.attemptId,
    requesterId: m.requesterId, placementGeneration: m.placementGeneration });
  function validGeneration(m) {
    try { return !generationRequest(m.generationRequest) || m.schema !== 'reploid.partition-input/v2'; } catch { return false; }
  }
  function validMode(m) {
    if (m.activity !== undefined && (!orderedInput(m) || m.activity !== 'reploid.partition-activity/v1')) return false;
    if (orderedInput(m)) {
      try {
        return ordered && (m.disclosureExpiresAt === undefined || Number.isSafeInteger(m.disclosureExpiresAt) && m.disclosureExpiresAt > now()) && m.canonical === undefined && m.participantA === undefined && m.participantB === undefined
          && (m.publication === undefined || !!validateOrderedPublicationContext(m.publication))
          && attempt(m).route.stages[0].participantId === m.coordinatorId
          && m.route.modelId === m.modelId && m.route.modelIdentity === m.modelIdentity && m.route.planId === m.planId;
      } catch { return false; }
    }
    return (m?.schema === 'reploid.partition-input/v1' && m.canonical === undefined && m.route === undefined
      || canonical && m?.schema === 'reploid.partition-input/v2' && !!validateEntryPublicationContext(m.canonical, m))
      && m.participantA !== m.participantB;
  }
  const valid = m => m?.operation === 'generate' && validMode(m) && validGeneration(m) && m.requesterId !== coordinator(m)
    && typeof m.attemptId === 'string' && m.attemptId.length <= 128
    && typeof m.threadId === 'string' && m.threadId.length <= 128
    && Number.isSafeInteger(m.placementGeneration) && m.placementGeneration >= 0
    && Array.isArray(m.messages) && m.messages.length > 0
    && m.messages.every(row => ['system', 'user', 'assistant'].includes(row.role) && typeof row.content === 'string')
    && JSON.stringify(m.messages).length <= policy.maxInputCharacters;
  const endpoint = createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId, limits,
    async authorize({ action, metadata, byteLength }) {
      if (byteLength !== 0) return false;
      if (metadata.operation === 'describe') return true;
      if (metadata.operation === 'publication') {
        const sending = action === 'send' || action === 'accept';
        const request = (sending ? active : deliveries).get(metadata.attemptId)?.request;
        return (canonical || ordered) && !!request && matchingEntryPublication(metadata, request)
          && request.requesterId === (sending ? remoteParticipantId : localParticipantId)
          && await authorize(structuredClone(request), { action }) === true;
      }
      if (metadata.operation === 'delta' || metadata.operation === 'usage') {
        const sending = action === 'send' || action === 'accept';
        const request = sending ? active.get(metadata.attemptId)?.request : deliveries.get(metadata.attemptId)?.request;
        return !!request && request.schema !== 'reploid.partition-input/v2'
          && (!orderedInput(request) || request.disclosureExpiresAt === undefined || request.disclosureExpiresAt > now()) && metadata.requesterId === request.requesterId
          && (orderedInput(request) ? metadata.coordinatorId === request.coordinatorId
            && sameRouteAttemptIdentity(metadata.identity, attempt(request)) : metadata.participantA === request.participantA) && metadata.threadId === request.threadId
          && metadata.requesterId === (sending ? remoteParticipantId : localParticipantId)
          && (metadata.activity === undefined || request.activity === 'reploid.partition-activity/v1'
            && orderedInput(request) && sameRouteAttemptIdentity(metadata.activity?.identity, attempt(request)))
          && (metadata.operation === 'usage' ? !!request.generationRequest
            && canonicalPartitionJson(metadata.generationRequest) === canonicalPartitionJson(request.generationRequest)
            && metadata.usage?.outputTokens === 0
            && canonicalPartitionJson(metadata.usage) === canonicalPartitionJson(tokenUsage(metadata.usage?.inputTokens, 0, request.generationRequest))
            : Number.isSafeInteger(metadata.sequence) && metadata.sequence >= 0
              && typeof metadata.text === 'string' && metadata.text.length <= policy.maxOutputCharacters);
      }
      const outgoing = action === 'send' || action === 'accept';
      if (!valid(metadata) || metadata.requesterId !== (outgoing ? localParticipantId : remoteParticipantId)
        || coordinator(metadata) !== (outgoing ? remoteParticipantId : localParticipantId)) return false;
      // Recheck input permission before transfer and output disclosure, not readiness
      // after completion: draining must still let admitted work finish.
      return await authorize(structuredClone(metadata), { action }) === true;
    },
    async serve(m, _bytes, { signal }) {
      if (m.operation === 'publication') {
        const scope = deliveries.get(m.attemptId)?.publication;
        assert(scope, 'Requester publication owner unavailable');
        return scope.call(m.method, m.body);
      }
      if (m.operation === 'usage') {
        const delivery = deliveries.get(m.attemptId);
        assert(delivery && !delivery.usage && delivery.sequence === 0, 'Unexpected or duplicate input token usage');
        delivery.usage = structuredClone(m.usage);
        await delivery.onUsage?.(structuredClone(m.usage)); return {received: true};
      }
      if (m.operation === 'delta') {
        const delivery = deliveries.get(m.attemptId);
        assert(delivery && (!delivery.request.generationRequest || delivery.usage) && m.sequence === delivery.sequence, 'Stream delta is stale or out of order');
        if (m.activity) {
          const activity = partitionActivity(m.activity, attempt(delivery.request), delivery.activity, true);
          delivery.activity = activity;
          await delivery.onActivity?.(structuredClone(activity));
        }
        delivery.characters += m.text.length;
        assert(delivery.characters <= policy.maxOutputCharacters, 'Stream output budget exhausted');
        delivery.sequence++; if (orderedInput(delivery.request)) delivery.content += m.text; delivery.onDelta?.(m.text); return { received: true };
      }
      if (m.operation === 'describe') {
        if (service && !draining && !closed) await service.refresh({ signal });
        const models = service?.getModels() || [];
        return { models: structuredClone(models), accepting: !!service && !draining && !closed,
          slots: draining || closed ? 0 : policy.maxConcurrentAttempts - active.size };
      }
      assert(service && !draining && !closed && active.size < policy.maxConcurrentAttempts, 'Entry is unavailable or draining');
      assert(!retired.has(m.attemptId) && retired.size < policy.maxAttempts, 'Entry attempt already used or budget exhausted');
      const model = service.getModels().find(model => model.id === m.modelId && model.identity === m.modelIdentity
        && model.partition?.planId === m.planId && (orderedInput(m)
          ? model.partition.schema === 'reploid.partition-selection/v2' && model.partition.coordinatorId === m.coordinatorId
            && canonicalPartitionJson(model.partition.route) === canonicalPartitionJson(m.route)
          : model.partition.participantA === m.participantA && model.partition.participantB === m.participantB)
        && model.availability === 'ready');
      assert(model, 'Requested placement is not ready');
      const requested = requireGenerationCapability(model, m.generationRequest, m.schema === 'reploid.partition-input/v2');
      const isCanonical = m.schema === 'reploid.partition-input/v2';
      if (isCanonical) {
        assert(model.canonical && ['coordinatorEpoch', 'routeId', 'generation', 'stages', 'vocabSize'].every(key =>
          canonicalPartitionJson(model.canonical[key]) === canonicalPartitionJson(m.canonical[key])),
        'Canonical entry placement changed');
      }
      // Ordered inputs carrying a requester context publish through the same requester-owned RPC.
      const orderedPublished = orderedInput(m) && m.publication !== undefined;
      const publicationCall = (method, body) => endpoint.request(entryPublicationEnvelope(m, method, body),
        new Uint8Array(), { signal });
      const publication = isCanonical || orderedPublished ? entryPublicationPort(publicationCall) : undefined;
      retired.add(m.attemptId);
      const admission = { request: structuredClone(m), operation: null };
      active.set(m.attemptId, admission);
      let delivery = Promise.resolve(), sequence = 0, activity = null, acceptingCallbacks = true;
      const operation = Promise.resolve().then(() => service.generate({ meshId: m.meshId, participantId: m.requesterId,
        threadId: m.threadId, attemptId: m.attemptId, placementGeneration: m.placementGeneration,
        model, ...(requested ? {generationRequest: requested} : {}), ...(orderedInput(m) && m.disclosureExpiresAt !== undefined ? {disclosureExpiresAt:m.disclosureExpiresAt} : {}), ...(isCanonical ? { canonical: structuredClone(m.canonical) } : {}),
        ...(orderedPublished ? { publication: structuredClone(m.publication) } : {}), messages: structuredClone(m.messages), permissions: { sharingScope: 'approved-partition-path' } },
      { signal, publication, requestApproval: async () => authorize(structuredClone(m), { action: 'execute' }),
        onState() {}, onActivity(value) {
          if (m.activity === undefined) return; // Older requesters did not opt in to this event.
          assert(acceptingCallbacks && orderedInput(m) && value.threadId === m.threadId && value.attemptId === m.attemptId, 'Unbound or late partition activity');
          activity = partitionActivity(value, attempt(m), activity);
        }, onUsage(value) {
          assert(requested && value.threadId === m.threadId && value.attemptId === m.attemptId, 'Unbound provider usage');
          const usage = tokenUsage(value.inputTokens, value.outputTokens, requested);
          assert(value.outputTokens === 0 && value.schema === usage.schema, 'Initial usage must precede sampling');
          const metadata = {operation:'usage', requesterId:m.requesterId,
            ...(orderedInput(m) ? {coordinatorId:m.coordinatorId, identity:attempt(m)} : {participantA:m.participantA}),
            threadId:m.threadId, attemptId:m.attemptId, generationRequest:requested, usage};
          delivery = delivery.then(() => endpoint.request(metadata, new Uint8Array(), {signal}));
          delivery.catch(() => {}); return delivery;
        }, onDelta({ text }) {
          if (isCanonical || orderedPublished) return; // Requester projects the durable publication RPC, never this raw callback.
          const delta = { operation: 'delta', requesterId: m.requesterId,
            ...(orderedInput(m) ? { coordinatorId: m.coordinatorId, identity: attempt(m) } : { participantA: m.participantA }),
            threadId: m.threadId, attemptId: m.attemptId, sequence: sequence++, text,
            ...(activity ? {activity:structuredClone(activity)} : {}) };
          delivery = delivery.then(() => endpoint.request(delta, new Uint8Array(), { signal }));
          delivery.catch(() => {});
        } }));
      admission.operation = operation;
      try {
        const result = await operation;
        acceptingCallbacks = false;
        await delivery;
        assert(typeof result.content === 'string' && result.content.length <= policy.maxOutputCharacters
          && (orderedInput(m) ? sameRouteAttemptIdentity(result.execution?.identity, attempt(m))
            : result.execution?.requesterId === m.requesterId && result.execution.attemptId === m.attemptId
              && result.execution.placementGeneration === m.placementGeneration), 'Execution returned an unbound result');
        return { content: result.content, ...(activity ? {activity:structuredClone(activity)} : {}), ...(requested ? {usage: result.usage} : {}), execution: summarizePartitionExecution(result.execution) };
      } finally { acceptingCallbacks = false; active.delete(m.attemptId); }
    },
  });
  return Object.freeze({
    id: remoteParticipantId,
    getState() { return { ready: !closed && unsettledPublications.size === 0 && now() - observedAt < policy.descriptorTtlMs
      && descriptor?.accepting === true && descriptor.slots > 0,
    descriptor: structuredClone(descriptor), observedAt, receipt: endpoint.getReceipt() }; },
    async refresh({ signal } = {}) {
      descriptor = await endpoint.request({ operation: 'describe' }, new Uint8Array(), { signal });
      assert(Array.isArray(descriptor.models) && Number.isSafeInteger(descriptor.slots) && descriptor.slots >= 0,
        'Invalid entry descriptor');
      observedAt = now(); return this.getState();
    },
    async generate(request, { signal, onDelta, onUsage, onActivity, publication, onPublished } = {}) {
      assert(!closed && this.getState().ready, 'Refresh an available entry before requesting execution');
      const isCanonical = request.canonical !== undefined, isOrdered = request.route !== undefined;
      assert(!isOrdered || ordered && !isCanonical, 'Ordered entry capability unavailable');
      assert(!isCanonical || canonical, 'Canonical entry capability unavailable');
      assert((publication !== undefined) === (isCanonical || isOrdered && request.publication !== undefined),
        'Publication owner requires its explicit canonical or ordered requester context');
      const metadata = { ...structuredClone(request), operation: 'generate',
        schema: isOrdered ? 'reploid.partition-input/v3' : isCanonical ? 'reploid.partition-input/v2' : 'reploid.partition-input/v1',
        ...(isOrdered && typeof onActivity === 'function' ? {activity:'reploid.partition-activity/v1'} : {}),
        requesterId: localParticipantId, ...(isOrdered ? { coordinatorId: remoteParticipantId } : { participantA: remoteParticipantId }) };
      assert(!deliveries.has(metadata.attemptId), 'Entry attempt already streaming');
      assert(valid(metadata), 'Invalid partition entry input');
      const scope = publication !== undefined ? createEntryPublicationScope({ request: metadata, owner: publication, onPublished,
        authorize: () => authorize(structuredClone(metadata), { action: 'publish' }),
        maxControlBytes: limits.maxControlBytes, maxOutputCharacters: policy.maxOutputCharacters }) : null;
      deliveries.set(metadata.attemptId, { request: metadata, sequence: 0, characters: 0, content: '', onDelta, onUsage, onActivity, activity:null, usage:null, publication: scope });
      let result;
      let failure = null;
      try {
        result = await endpoint.request(metadata, new Uint8Array(), { signal });
      assert(typeof result.content === 'string' && result.content.length <= policy.maxOutputCharacters
        && (isOrdered ? sameRouteAttemptIdentity(result.execution?.identity, attempt(metadata))
          : ['requesterId', 'participantA', 'participantB', 'modelId', 'modelIdentity', 'planId', 'threadId',
            'attemptId', 'placementGeneration'].every(key => result.execution?.[key] === metadata[key])),
      'Entry response identity mismatch');
      const currentDelivery = deliveries.get(metadata.attemptId);
      let finalActivityNotification = null;
      if (result.activity) {
        assert(metadata.activity === 'reploid.partition-activity/v1', 'Unrequested execution activity');
        if (currentDelivery.activity?.sequence === result.activity.sequence) {
          assert(canonicalPartitionJson(currentDelivery.activity) === canonicalPartitionJson(result.activity), 'Final activity changed an observed sample');
        } else {
          const finalActivity = partitionActivity(result.activity, attempt(metadata), currentDelivery.activity, true);
          finalActivityNotification = finalActivity;
        }
      }
      const observedActivity = finalActivityNotification ?? currentDelivery.activity;
      if (observedActivity) assert(canonicalPartitionJson(result.execution.stepSummary.stages) === canonicalPartitionJson(observedActivity.stepSummary.stages)
        && result.execution.stepSummary.count === observedActivity.stepSummary.count, 'Final execution differs from observed activity');
      if (metadata.generationRequest) {
        const observed = deliveries.get(metadata.attemptId).usage;
        assert(observed && result.usage?.inputTokens === observed.inputTokens
          && result.usage.outputTokens === result.execution?.stepSummary?.count
          && canonicalPartitionJson(result.usage) === canonicalPartitionJson(tokenUsage(result.usage.inputTokens, result.usage.outputTokens, metadata.generationRequest)),
        'Final token usage differs from admitted observed input');
      }
      if (isOrdered && !scope) assert(result.content === deliveries.get(metadata.attemptId).content, 'Ordered result differs from delivered text');
      if (scope) {
        const projection = scope.getProjection();
        assert(projection.count > 0 && projection.terminal && result.content === projection.content, 'Entry result differs from durable publication');
      }
      if (finalActivityNotification) {
        currentDelivery.activity = finalActivityNotification;
        await onActivity?.(structuredClone(finalActivityNotification));
      }
      }
      catch (error) { failure = error; }
      finally {
        try { await scope?.close({ cancel: failure !== null }); }
        catch (error) {
          unsettledPublications.add(scope);
          failure = failure ? new AggregateError([failure, error], 'Entry execution and publication cancellation failed') : error;
        }
        deliveries.delete(metadata.attemptId);
      }
      if (failure) throw failure;
      return result;
    },
    async drain() { draining = true; await Promise.allSettled([...active.values()].map(item => item.operation)); },
    async close() {
      closed = true; endpoint.close();
      const scopes = [...new Set([...unsettledPublications, ...[...deliveries.values()].map(item => item.publication).filter(Boolean)])];
      const closing = await Promise.allSettled(scopes.map(async scope => {
        unsettledPublications.add(scope);
        await scope.close({ cancel: true }); unsettledPublications.delete(scope);
      }));
      await Promise.allSettled([...active.values()].map(item => item.operation));
      const failures = closing.filter(item => item.status === 'rejected').map(item => item.reason);
      if (failures.length) throw new AggregateError(failures, 'Entry publication cancellation did not settle');
      deliveries.clear();
    },
  });
}

/** Bounded retry starts a new generation attempt on an explicitly authorized path.
 * No partial generation state is fabricated or merged across owners.
 */
export function createPartitionRequester({ entries, requesterId, meshId, modelId, modelIdentity, planId,
  maxPlacements, ordered = false, authorize, onAttempt = () => {}, newId = () => crypto.randomUUID(), now = () => performance.now() }) {
  assert(typeof ordered === 'boolean' && typeof entries === 'function' && typeof authorize === 'function'
    && Number.isSafeInteger(maxPlacements) && maxPlacements > 0, 'Explicit requester placement policy required');
  return Object.freeze({
    async generate({ messages, threadId, disclosureExpiresAt, generationRequest: requested }, { signal, onDelta, onUsage, onActivity } = {}) {
      assert(disclosureExpiresAt === undefined || ordered && Number.isSafeInteger(disclosureExpiresAt) && disclosureExpiresAt > Date.now(),
        'Requester disclosure deadline expired or invalid');
      messages = structuredClone(messages);
      requested = generationRequest(requested);
      const attempted = new Set(), failures = [], started = now();
      for (let generation = 0; generation < maxPlacements; generation++) {
        signal?.throwIfAborted();
        let selected = null;
        for (const entry of entries()) {
          if (attempted.has(entry.id)) continue;
          try {
            const state = await entry.refresh({ signal });
            const model = state.descriptor?.models.find(m => m.id === modelId && m.identity === modelIdentity
              && m.partition?.planId === planId && m.availability === 'ready'
              && (ordered ? m.partition.schema === 'reploid.partition-selection/v2' && m.partition.coordinatorId === entry.id
                : m.partition.route === undefined));
            if (!state.ready || !model) continue;
            requireGenerationCapability(model, requested);
            const placement = { requesterId, modelId, modelIdentity, planId,
              ...(requested ? {generationRequest: requested} : {}),
              ...(disclosureExpiresAt !== undefined ? {disclosureExpiresAt} : {}),
              ...(ordered ? {coordinatorId: entry.id, route: structuredClone(model.partition.route)}
                : {participantA: entry.id, participantB: model.partition.participantB}) };
            if (ordered) {
              const binding = canonicalRouteAttemptBinding({schema:'reploid.partition-attempt/v2', threadId,
                attemptId:'placement-validation', requesterId, placementGeneration:generation, route:placement.route});
              assert(binding.route.stages[0].participantId === entry.id && binding.route.modelId === modelId
                && binding.route.modelIdentity === modelIdentity && binding.route.planId === planId, 'Requester route model or coordinator mismatch');
            }
            if (await authorize(structuredClone(placement)) === true) { selected = { entry, placement }; break; }
          } catch (error) { signal?.throwIfAborted(); failures.push({ ...(ordered ? {coordinatorId:entry.id} : {participantA:entry.id}), error: String(error.message) }); }
        }
        assert(selected, 'No authorized prepared partition path is available');
        attempted.add(selected.entry.id);
        const request = { ...selected.placement, meshId, threadId, messages: structuredClone(messages),
          attemptId: newId(), placementGeneration: generation };
        onAttempt({ ...structuredClone(request), messages: undefined, phase: generation ? 'restarting' : 'executing' });
        let published = false;
        try {
          const result = await selected.entry.generate(request, { signal,
            ...(onActivity ? {onActivity: activity => { published = true; return onActivity({threadId,attemptId:request.attemptId,...activity}); }} : {}),
            onUsage: usage => { published = true; return onUsage?.(usage); },
            onDelta: text => { published = true; return onDelta?.({text,threadId,attemptId:request.attemptId,placementGeneration:generation}); } });
          return { ...result, recovery: { attempts: generation + 1, failures, elapsedMs: now() - started,
            stateTransfer: 'new-attempt-from-authorized-input' } };
        } catch (error) {
          if (published) throw error;
          signal?.throwIfAborted(); failures.push({ ...(ordered ? {coordinatorId:selected.entry.id} : {participantA:selected.entry.id}), attemptId: request.attemptId, error: String(error.message) });
          onAttempt({ attemptId: request.attemptId, placementGeneration: generation, phase: 'failed', error: String(error.message) });
        }
      }
      throw new AggregateError(failures.map(f => new Error(f.error)), 'Prepared partition attempts exhausted');
    },
  });
}
