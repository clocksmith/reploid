import { createCanonicalChatBinding } from './partition-chat-canonical.js';
import { createLayerPartitionRunner } from './partition-runner.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalPartitionBinding, partitionFingerprint } from './partition-contract.js';

/** Conversation adapter for a fixed, explicitly prepared local A and authenticated remote B. */
export function createPartitionChat({ runtime, local, remote, authority, model, plan, planId, limits, grantTtlMs, canonical = null, authorizeRequester = null, now = Date.now }) {
  assert(local.index === 0 && local.id === authority.participantId && remote.id !== local.id,
    'Partition chat requires the input owner at A and a distinct authenticated B');
  assert(Number.isSafeInteger(grantTtlMs) && grantTtlMs > 0, 'Explicit partition grant lifetime required');
  const selection = structuredClone({ ...model, adapters: [], selectionId: model.id + '/partition/' + planId,
    partition: { planId, participantA: local.id, participantB: remote.id } });
  const policy = structuredClone(limits);
  const canonicalBinding = canonical === null ? null : createCanonicalChatBinding({ runtime, local, remote, authority,
    model, plan, planId, limits: policy, coordinatorEpoch: canonical.coordinatorEpoch });
  const listeners = new Set();
  let closed = false;
  const models = () => {
    const description = canonicalBinding?.describe() ?? null;
    return [{ ...structuredClone(selection), ...(description ? { canonical: description } : {}),
    availability: closed || canonicalBinding && !description ? 'unavailable' : local.getState().ready && remote.getState().ready ? 'ready'
      : local.getState().phase === 'loading' ? 'loading' : 'unavailable',
    providerIds: [local.id, remote.id], placement: 'two-device-layer-partition' }];
  };
  const notify = () => { for (const listener of listeners) { try { listener(models()); } catch {} } };
  const unsubscribers = [local.subscribe(notify), remote.subscribe(notify)];
  const runner = createLayerPartitionRunner({ runtime, plan, deviceA: local, deviceB: remote, limits: policy, canonical: canonicalBinding !== null,
    authorize: request => (local.canAccept ? local.canAccept(request) : local.getState().ready)
      ? authority.verify(request.grant, canonicalBinding ? { identity: canonicalPartitionBinding(request), action: request.action,
        canonicalAttempt: request.canonicalAttempt, generationId: request.generationId, phase: request.phase,
        step: request.step, inputTokenCount: request.inputTokenCount } : { ...request, identity: request }) : Promise.resolve(false) });
  return Object.freeze({
    getModels: models,
    getState: () => runner.getState(),
    subscribe(listener) { listeners.add(listener); listener(models()); return () => listeners.delete(listener); },
    async refresh(options) { await remote.refresh(options); notify(); return models(); },
    async generate(request, controls) {
      // Keep caller-owned request metadata stable through approval and tokenization.
      request = structuredClone(request);
      const delegated = request.participantId !== local.id;
      assert(!!canonicalBinding === (request.canonical !== undefined), 'Explicit canonical chat context required');
      assert(!closed && request.meshId === authority.meshId && request.model.id === selection.id
        && request.model.identity === selection.identity && !(request.model.adapters || []).length
        && request.model.partition && canonicalPartitionJson(request.model.partition) === canonicalPartitionJson(selection.partition), 'Partition chat selection mismatch');
      if (delegated) assert(typeof authorizeRequester === 'function'
        && await authorizeRequester(request, controls.signal) === true
        && Number.isSafeInteger(request.placementGeneration) && request.placementGeneration >= 0,
      'Remote input owner must authorize this execution placement');
      assert(request.permissions?.sharingScope && request.permissions.sharingScope !== 'local', 'Partition disclosure is disabled');
      controls.signal.throwIfAborted();
      await remote.refresh({ signal: controls.signal });
      assert(models()[0].availability === 'ready', 'No ready contributors for this partition plan');
      const identity = { ...selection.partition, modelId: selection.id, modelIdentity: selection.identity,
        threadId: request.threadId, attemptId: request.attemptId,
        ...(delegated || canonicalBinding ? { requesterId: request.participantId, placementGeneration: request.placementGeneration ?? 0 } : {}) };
      const context = canonicalBinding?.check(request.canonical, identity, controls.publication);
      const approved = await controls.requestApproval({ id: crypto.randomUUID(), threadId: request.threadId,
        attemptId: request.attemptId, peerId: remote.id, recipientIdentity: remote.id,
        modelId: selection.id, modelIdentity: selection.identity, adapterIdentities: [],
        operation: 'generate-partition', disclosure: 'partition-activations-and-tokens', ...selection.partition,
        expiresAt: now() + grantTtlMs,
        input: { messages: structuredClone(request.messages),
          disclosure: 'Intermediate model activations and prompt token context are disclosed to the selected participant for sampling.' } });
      controls.signal.throwIfAborted();
      assert(approved === true, 'Partition disclosure was declined');
      assert(!closed, 'Partition chat closed during approval');
      let grant = null;
      let sequence = 0;
      try {
        const input = await local.tokenize({ messages: request.messages, identity, signal: controls.signal });
        controls.signal.throwIfAborted();
        assert(!closed, 'Partition chat closed during tokenization');
        assert(input.modelIdentity === selection.identity, 'Doppler tokenization model mismatch');
        if (!canonicalBinding) assert(input.generation
          && Number.isSafeInteger(input.generation.maxTokens) && input.generation.maxTokens > 0
          && input.generation.maxTokens <= policy.maxTokens, 'Doppler tokenization or generation contract mismatch');
        const attempt = canonicalBinding?.attempt({ context, binding: identity, publication: controls.publication, tokenIds: input.tokenIds });
        grant = canonicalBinding
          ? await authority.issueCanonical(identity, canonicalBinding.grantLimits, { approved: true, ttlMs: grantTtlMs,
            disclosure: 'partition-activations-and-tokens', generation: context.generation, canonicalAttempt: attempt, vocabSize: plan.vocabSize })
          : await authority.issue(identity, policy, { approved: true, ttlMs: grantTtlMs,
            disclosure: 'partition-activations-and-tokens', generationDigest: await partitionFingerprint(input.generation) });
        controls.onState({ threadId: request.threadId, attemptId: request.attemptId, status: 'executing',
          execution: { placement: 'two-device-layer-partition', ...selection.partition } });
        const run = { tokenIds: input.tokenIds, identity,
          grants: { executionA: grant, executionB: grant, activation: grant, tokenContext: grant, output: grant }, signal: controls.signal,
          onDelta: text => controls.onDelta({ threadId: request.threadId, attemptId: request.attemptId, sequence: sequence++, text }) };
        const result = canonicalBinding
          ? await runner.executeCanonical({ ...run, canonical: { attempt, generation: context.generation,
            publication: controls.publication, deadlineAt: context.deadlineAt } })
          : await runner.execute({ ...run, generation: input.generation, maxTokens: input.generation.maxTokens });
        return { threadId: request.threadId, attemptId: request.attemptId, modelId: result.execution.modelId,
          modelIdentity: result.execution.modelIdentity, adapterIdentities: [], content: result.content,
          execution: { ...result.execution, provider: 'peer', transport: remote.getState().receipt } };
      } finally {
        if (grant) authority.revoke(grant);
        // Also settles tokenization failure before the runner acquired an attempt.
        await local.closeAttempt({ identity });
      }
    },
    async close() { closed = true; unsubscribers.forEach(unsubscribe => unsubscribe()); await runner.close(); listeners.clear(); }
  });
}
