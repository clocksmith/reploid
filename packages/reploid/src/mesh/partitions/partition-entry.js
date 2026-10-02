import { createPartitionDataChannel } from '../../transport/partition-data-channel.js';
import { assertPartition as assert } from './partition-contract.js';

/** Requester-to-A channel. This module imports no tokenizer, tensor codec or GPU runtime.
 * The host authenticates the channel and grants input disclosure to both stages.
 * A's chat port owns the A-to-B execution channel; activation bytes never enter here.
 */
export function createPartitionEntry({ channel, localParticipantId, remoteParticipantId,
  service = null, authorize, limits, inputLimits, now = Date.now }) {
  assert(typeof authorize === 'function' && ['maxInputCharacters', 'maxOutputCharacters', 'maxAttempts',
    'maxConcurrentAttempts', 'descriptorTtlMs'].every(key => Number.isSafeInteger(inputLimits?.[key]) && inputLimits[key] > 0),
  'Entry authorization and input budgets required');
  const policy = structuredClone(inputLimits), active = new Map(), retired = new Set();
  const deliveries = new Map();
  let draining = false, closed = false, descriptor = null, observedAt = 0;
  const valid = m => m?.operation === 'generate' && m?.schema === 'reploid.partition-input/v1' && m.requesterId !== m.participantA
    && m.participantA !== m.participantB && typeof m.attemptId === 'string' && m.attemptId.length <= 128
    && typeof m.threadId === 'string' && m.threadId.length <= 128
    && Number.isSafeInteger(m.placementGeneration) && m.placementGeneration >= 0
    && Array.isArray(m.messages) && m.messages.length > 0
    && m.messages.every(row => ['system', 'user', 'assistant'].includes(row.role) && typeof row.content === 'string')
    && JSON.stringify(m.messages).length <= policy.maxInputCharacters;
  const endpoint = createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId, limits,
    async authorize({ action, metadata, byteLength }) {
      if (byteLength !== 0) return false;
      if (metadata.operation === 'describe') return true;
      if (metadata.operation === 'delta') {
        const sending = action === 'send' || action === 'accept';
        const request = sending ? active.get(metadata.attemptId)?.request : deliveries.get(metadata.attemptId)?.request;
        return !!request && metadata.requesterId === request.requesterId
          && metadata.participantA === request.participantA && metadata.threadId === request.threadId
          && metadata.requesterId === (sending ? remoteParticipantId : localParticipantId)
          && Number.isSafeInteger(metadata.sequence) && metadata.sequence >= 0
          && typeof metadata.text === 'string' && metadata.text.length <= policy.maxOutputCharacters;
      }
      const outgoing = action === 'send' || action === 'accept';
      if (!valid(metadata) || metadata.requesterId !== (outgoing ? localParticipantId : remoteParticipantId)
        || metadata.participantA !== (outgoing ? remoteParticipantId : localParticipantId)) return false;
      // Recheck input permission before transfer and output disclosure, not readiness
      // after completion: draining must still let admitted work finish.
      return await authorize(structuredClone(metadata), { action }) === true;
    },
    async serve(m, _bytes, { signal }) {
      if (m.operation === 'delta') {
        const delivery = deliveries.get(m.attemptId);
        assert(delivery && m.sequence === delivery.sequence, 'Stream delta is stale or out of order');
        delivery.characters += m.text.length;
        assert(delivery.characters <= policy.maxOutputCharacters, 'Stream output budget exhausted');
        delivery.sequence++; delivery.onDelta?.(m.text); return { received: true };
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
        && model.partition?.planId === m.planId && model.partition.participantA === m.participantA
        && model.partition.participantB === m.participantB && model.availability === 'ready');
      assert(model, 'Requested placement is not ready');
      retired.add(m.attemptId);
      const admission = { request: structuredClone(m), operation: null };
      active.set(m.attemptId, admission);
      let delivery = Promise.resolve(), sequence = 0;
      const operation = Promise.resolve().then(() => service.generate({ meshId: m.meshId, participantId: m.requesterId,
        threadId: m.threadId, attemptId: m.attemptId, placementGeneration: m.placementGeneration,
        model, messages: structuredClone(m.messages), permissions: { sharingScope: 'approved-partition-path' } },
      { signal, requestApproval: async () => authorize(structuredClone(m), { action: 'execute' }),
        onState() {}, onDelta({ text }) {
          const delta = { operation: 'delta', requesterId: m.requesterId, participantA: m.participantA,
            threadId: m.threadId, attemptId: m.attemptId, sequence: sequence++, text };
          delivery = delivery.then(() => endpoint.request(delta, new Uint8Array(), { signal }));
          delivery.catch(() => {});
        } }));
      admission.operation = operation;
      try {
        const result = await operation;
        await delivery;
        assert(typeof result.content === 'string' && result.content.length <= policy.maxOutputCharacters
          && result.execution?.requesterId === m.requesterId
          && result.execution.attemptId === m.attemptId
          && result.execution.placementGeneration === m.placementGeneration, 'Execution returned an unbound result');
        return { content: result.content, execution: result.execution };
      } finally { active.delete(m.attemptId); }
    },
  });
  return Object.freeze({
    id: remoteParticipantId,
    getState() { return { ready: !closed && now() - observedAt < policy.descriptorTtlMs
      && descriptor?.accepting === true && descriptor.slots > 0,
    descriptor: structuredClone(descriptor), observedAt, receipt: endpoint.getReceipt() }; },
    async refresh({ signal } = {}) {
      descriptor = await endpoint.request({ operation: 'describe' }, new Uint8Array(), { signal });
      assert(Array.isArray(descriptor.models) && Number.isSafeInteger(descriptor.slots) && descriptor.slots >= 0,
        'Invalid entry descriptor');
      observedAt = now(); return this.getState();
    },
    async generate(request, { signal, onDelta } = {}) {
      assert(!closed && this.getState().ready, 'Refresh an available entry before requesting execution');
      const metadata = { ...structuredClone(request), operation: 'generate', schema: 'reploid.partition-input/v1',
        requesterId: localParticipantId, participantA: remoteParticipantId };
      assert(!deliveries.has(metadata.attemptId), 'Entry attempt already streaming');
      deliveries.set(metadata.attemptId, { request: metadata, sequence: 0, characters: 0, onDelta });
      let result;
      try { result = await endpoint.request(metadata, new Uint8Array(), { signal }); }
      finally { deliveries.delete(metadata.attemptId); }
      assert(typeof result.content === 'string' && result.content.length <= policy.maxOutputCharacters
        && ['requesterId', 'participantA', 'participantB', 'modelId', 'modelIdentity', 'planId', 'threadId',
          'attemptId', 'placementGeneration'].every(key => result.execution?.[key] === metadata[key]),
      'Entry response identity mismatch');
      return result;
    },
    async drain() { draining = true; await Promise.allSettled([...active.values()].map(item => item.operation)); },
    async close() { closed = true; endpoint.close(); await Promise.allSettled([...active.values()].map(item => item.operation)); deliveries.clear(); },
  });
}

/** Bounded retry starts a new generation attempt on an explicitly authorized path.
 * No partial generation state is fabricated or merged across owners.
 */
export function createPartitionRequester({ entries, requesterId, meshId, modelId, modelIdentity, planId,
  maxPlacements, authorize, onAttempt = () => {}, newId = () => crypto.randomUUID(), now = () => performance.now() }) {
  assert(typeof entries === 'function' && typeof authorize === 'function'
    && Number.isSafeInteger(maxPlacements) && maxPlacements > 0, 'Explicit requester placement policy required');
  return Object.freeze({
    async generate({ messages, threadId }, { signal } = {}) {
      const attempted = new Set(), failures = [], started = now();
      for (let generation = 0; generation < maxPlacements; generation++) {
        signal?.throwIfAborted();
        let selected = null;
        for (const entry of entries()) {
          if (attempted.has(entry.id)) continue;
          try {
            const state = await entry.refresh({ signal });
            const model = state.descriptor?.models.find(m => m.id === modelId && m.identity === modelIdentity
              && m.partition?.planId === planId && m.availability === 'ready');
            if (!state.ready || !model) continue;
            const placement = { requesterId, participantA: entry.id, participantB: model.partition.participantB,
              modelId, modelIdentity, planId };
            if (await authorize(placement) === true) { selected = { entry, placement }; break; }
          } catch (error) { signal?.throwIfAborted(); failures.push({ participantA: entry.id, error: String(error.message) }); }
        }
        assert(selected, 'No authorized prepared partition path is available');
        attempted.add(selected.entry.id);
        const request = { ...selected.placement, meshId, threadId, messages: structuredClone(messages),
          attemptId: newId(), placementGeneration: generation };
        onAttempt({ ...request, messages: undefined, phase: generation ? 'restarting' : 'executing' });
        try {
          const result = await selected.entry.generate(request, { signal });
          return { ...result, recovery: { attempts: generation + 1, failures, elapsedMs: now() - started,
            stateTransfer: 'new-attempt-from-authorized-input' } };
        } catch (error) {
          signal?.throwIfAborted(); failures.push({ participantA: selected.entry.id, attemptId: request.attemptId, error: String(error.message) });
          onAttempt({ attemptId: request.attemptId, placementGeneration: generation, phase: 'failed', error: String(error.message) });
        }
      }
      throw new AggregateError(failures.map(f => new Error(f.error)), 'Prepared partition attempts exhausted');
    },
  });
}
