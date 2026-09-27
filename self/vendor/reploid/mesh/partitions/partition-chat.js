import { createLayerPartitionRunner } from './partition-runner.js';
import { assertPartition as assert, canonicalPartitionJson } from './partition-contract.js';

/** Conversation adapter for a fixed, explicitly prepared local A and authenticated remote B. */
export function createPartitionChat({ runtime, local, remote, authority, model, plan, planId, limits, grantTtlMs, now = Date.now }) {
  assert(local.index === 0 && local.id === authority.participantId && remote.id !== local.id,
    'Partition chat requires the input owner at A and a distinct authenticated B');
  assert(Number.isSafeInteger(grantTtlMs) && grantTtlMs > 0, 'Explicit partition grant lifetime required');
  const selection = structuredClone({ ...model, adapters: [], selectionId: model.id + '/partition/' + planId,
    partition: { planId, participantA: local.id, participantB: remote.id } });
  const policy = structuredClone(limits);
  const listeners = new Set();
  let closed = false;
  const models = () => [{ ...structuredClone(selection),
    availability: closed ? 'unavailable' : local.getState().ready && remote.getState().ready ? 'ready'
      : local.getState().phase === 'loading' ? 'loading' : 'unavailable',
    providerIds: [local.id, remote.id], placement: 'two-device-layer-partition' }];
  const notify = () => { for (const listener of listeners) { try { listener(models()); } catch {} } };
  const unsubscribers = [local.subscribe(notify), remote.subscribe(notify)];
  const runner = createLayerPartitionRunner({ runtime, plan, deviceA: local, deviceB: remote, limits: policy,
    authorize: request => local.getState().ready && remote.getState().ready
      ? authority.verify(request.grant, { ...request, identity: request }) : Promise.resolve(false) });
  return Object.freeze({
    getModels: models,
    subscribe(listener) { listeners.add(listener); listener(models()); return () => listeners.delete(listener); },
    async refresh(options) { await remote.refresh(options); notify(); return models(); },
    async generate(request, controls) {
      assert(!closed && request.meshId === authority.meshId && request.participantId === local.id && request.model.id === selection.id
        && request.model.identity === selection.identity && !(request.model.adapters || []).length
        && request.model.partition && canonicalPartitionJson(request.model.partition) === canonicalPartitionJson(selection.partition), 'Partition chat selection mismatch');
      assert(request.permissions?.sharingScope && request.permissions.sharingScope !== 'local', 'Partition disclosure is disabled');
      controls.signal.throwIfAborted();
      await remote.refresh({ signal: controls.signal });
      assert(models()[0].availability === 'ready', 'No ready contributors for this partition plan');
      const identity = { ...selection.partition, modelId: selection.id, modelIdentity: selection.identity,
        threadId: request.threadId, attemptId: request.attemptId };
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId,
        attemptId: request.attemptId, peerId: remote.id, recipientIdentity: remote.id,
        modelId: selection.id, modelIdentity: selection.identity, adapterIdentities: [],
        operation: 'generate-partition', disclosure: 'partition-activations', ...selection.partition,
        expiresAt: now() + grantTtlMs,
        input: { messages: structuredClone(request.messages), disclosure: 'Intermediate model activations are disclosed to the selected participant.' } });
      controls.signal.throwIfAborted();
      assert(approved === true, 'Partition disclosure was declined');
      const grant = await authority.issue(identity, policy, { approved: true, ttlMs: grantTtlMs });
      let sequence = 0;
      try {
        const input = await local.tokenize({ messages: request.messages, identity, signal: controls.signal });
        assert(input.modelIdentity === selection.identity, 'Doppler tokenization model identity mismatch');
        controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing',
          execution: { placement: 'two-device-layer-partition', ...selection.partition } });
        const result = await runner.execute({ tokenIds: input.tokenIds, identity, maxTokens: policy.maxTokens,
          grants: { executionA: grant, executionB: grant, activation: grant, output: grant }, signal: controls.signal,
          onDelta: text => controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: sequence++, text }) });
        return { threadId: request.threadId, attemptId: request.attemptId, modelId: result.execution.modelId,
          modelIdentity: result.execution.modelIdentity, adapterIdentities: [], content: result.content,
          execution: { ...result.execution, provider: 'peer', transport: remote.getState().receipt } };
      } finally {
        authority.revoke(grant);
        // Also settles tokenization failure before the runner acquired an attempt.
        await local.closeAttempt({ identity });
      }
    },
    async close() { closed = true; unsubscribers.forEach(unsubscribe => unsubscribe()); await runner.close(); listeners.clear(); }
  });
}
