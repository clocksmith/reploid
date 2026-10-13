import failureMessages from '../../transport/partition-errors.json' with { type: 'json' };
import { createPartitionDataChannel } from '../../transport/partition-data-channel.js';
import { createCanonicalPartitionContract } from './partition-canonical-contract.js';
import { createPartitionStepReceiver } from './partition-step-receiver.js';
import { assertPartition as assert, samePartitionIdentity, partitionFingerprint,
  partitionActivationContract, matchingPartitionActivation } from './partition-contract.js';

/** Authenticated A-to-B partition RPC. Hosts establish channel identities before constructing it. */
export function createPartitionPeer({ channel, localParticipantId, remoteParticipantId, runtime, plan, planId,
  modelIdentity, authority, contributor = null, limits, receiverLimits, canonical = false }) {
  plan = structuredClone(plan); receiverLimits = structuredClone(receiverLimits);
  assert(runtime?.deserializeActivationFrame && authority?.verify, 'Partition codecs and grant verifier required');
  const activationContract = partitionActivationContract(runtime, plan);
  assert(!contributor || contributor.index === 1 && contributor.id === localParticipantId, 'Remote serving requires the local B contributor');
  assert(typeof canonical === 'boolean', 'Explicit canonical peer capability flag required');
  const canonicalContract = canonical ? createCanonicalPartitionContract({ runtime, plan, planId, modelIdentity }) : null;
  const canonicalStage = canonical && contributor ? contributor.getCanonicalStage() : null;
  assert(!canonical || !contributor || canonicalStage?.participantId === localParticipantId && canonicalStage.partitionIndex === 1,
    'Canonical serving requires the bound stage signing authority');
  const active = new Map(), outputCharacters = new Map(), listeners = new Set();
  const reservations = new Map();
  let remoteDescriptor = null, remoteCanonical = null, closing = null;
  const canonicalRequest = metadata => canonicalContract !== null && metadata.schema === canonicalContract.schema;
  const binding = identity => identity?.modelId === plan.modelId && identity.modelIdentity === modelIdentity
    && identity.planId === planId;
  const validFrame = metadata => {
    const frame = metadata.frame;
    return Number.isSafeInteger(metadata.maxTokens) && metadata.maxTokens > 0
      && metadata.maxTokens <= metadata.grant?.claim?.limits?.maxTokens && metadata.step < metadata.maxTokens
      && frame?.schema === activationContract.schema && matchingPartitionActivation(frame, activationContract, true)
      && frame.step === metadata.step && frame.seqOffset === metadata.tokenPosition
      && Array.isArray(frame.shape) && frame.shape.length === 3 && frame.shape[0] === 1
      && frame.shape[1] === metadata.inputTokenCount && frame.shape[2] === plan.hiddenSize
      && Number.isSafeInteger(frame.byteLength) && frame.byteLength > 0
      && frame.byteLength === frame.shape[1] * frame.shape[2] * activationContract.elementStrideBytes
      && samePartitionIdentity(frame.metadata, metadata.identity)
      && frame.metadata.maxTokens === metadata.maxTokens
      && frame.metadata.generationDigest === metadata.generationDigest
      && metadata.generation?.maxTokens === metadata.maxTokens
      && Array.isArray(metadata.inputTokenIds) && metadata.inputTokenIds.length === metadata.inputTokenCount
      && metadata.inputTokenIds.every(id => Number.isSafeInteger(id) && id >= 0 && id < plan.vocabSize)
      && frame.metadata.from === metadata.identity.participantA && frame.metadata.to === metadata.identity.participantB;
  };
  const verify = async (metadata, action, settlement = false) => {
    if (metadata.schema !== undefined) {
      if (!canonicalRequest(metadata)) return false;
      try {
        const attempt = canonicalContract.validateBinding(metadata);
        const observed = contributor ? { stage: canonicalStage, generation: contributor.getCanonicalGeneration() } : remoteCanonical;
        if (!observed || runtime.metadataDigest('reploid.canonical-stage/v1', attempt.stages[1])
          !== runtime.metadataDigest('reploid.canonical-stage/v1', observed.stage)
          || runtime.metadataDigest('reploid.canonical-generation/v1', metadata.grant.claim.generation)
            !== runtime.metadataDigest('reploid.canonical-generation/v1', observed.generation)) return false;
      } catch { return false; }
      const phase = metadata.operation === 'reserve' || metadata.operation === 'admit'
        || metadata.publication?.schema === 'doppler.admission-publication/v1' ? 'admit' : 'step';
      const request = { identity: metadata.identity, canonicalAttempt: metadata.canonicalAttempt,
        generationId: metadata.generationId, phase, step: metadata.step,
        ...(metadata.inputTokenCount === undefined ? {} : { inputTokenCount: metadata.inputTokenCount }),
        ...(metadata.frame ? { activationBytes: metadata.frame.byteLength } : {}) };
      if (!await authority.verify(metadata.grant, { ...request, action }, { settlement })) return false;
      return settlement || authority.verify(metadata.grant, { ...request, action: 'mesh.transfer_token_context' });
    }
    if (!settlement && (!metadata.generation || await partitionFingerprint(metadata.generation) !== metadata.generationDigest)) return false;
    const request = { identity: metadata.identity, step: metadata.step, inputTokenCount: metadata.inputTokenCount,
      generationDigest: metadata.generationDigest, activationBytes: metadata.frame?.byteLength };
    if (!await authority.verify(metadata.grant, { ...request, action }, { settlement })) return false;
    return settlement || authority.verify(metadata.grant, { ...request, action: 'mesh.transfer_token_context' });
  };
  const receiver = createPartitionStepReceiver({ limits: receiverLimits,
    canonical: canonicalStage ? { runtime, stage: canonicalStage, now: () => performance.now(),
      verifyPublication: (request, retained) => canonicalContract.verifyPublication(request, retained),
      execute: async (request, { signal }) => {
        assert(contributor.canAccept(request.identity), 'Canonical output contributor is not ready');
        if (request.phase === 'admit') return contributor.admitCanonicalPrompt({ identity: request.identity,
          tokenIds: request.inputTokenIds, generationId: request.generationId, signal });
        const activation = canonicalContract.validatePayload(request, request.payload);
        const result = await contributor.executeCanonicalGroup1({ identity: request.identity, canonicalAttempt: request.canonicalAttempt,
          sequence: request.sequence, generationId: request.generationId, baseCursorId: request.baseCursorId,
          step: request.step, tokenPosition: request.tokenPosition, inputTokenCount: request.inputTokenCount,
          inputTokenIds: request.inputTokenIds, activation, continuation: request.continuation, signal,
          executionGrant: request.grant, outputGrant: request.grant });
        assert(result?.commit && result.transition, 'Canonical output stage did not return its authenticated transition');
        const { logits: _logits, ...output } = result;
        return output;
      } } : undefined,
    authorize: request => verify(request, 'mesh.execute_partition_b'),
    fingerprint: request => {
      if (canonicalRequest(request)) return canonicalContract.fingerprint(request);
      const { payload, ...metadata } = request;
      return partitionFingerprint(metadata, payload);
    },
    executeStep: async (request, { signal }) => {
      assert(contributor?.canAccept ? contributor.canAccept(request.identity) : contributor?.getState().ready, 'Partition B is not ready');
      const frame = { ...request.frame, buffer: request.payload.slice().buffer };
      const activation = runtime.validateActivationFrameForPlan
        ? runtime.validateActivationFrameForPlan(frame, plan) : runtime.deserializeActivationFrame(frame);
      const result = await contributor.executeGroup1({ identity: request.identity,
        step: request.step, tokenPosition: request.tokenPosition, inputTokenCount: request.inputTokenCount,
        maxTokens: request.maxTokens,
        generation: request.generation, inputTokenIds: request.inputTokenIds,
        activation, continuation: request.continuation, signal,
        executionGrant: request.grant, outputGrant: request.grant });
      assert(samePartitionIdentity(result?.identity, request.identity) && result.step === request.step
        && result.tokenPosition === request.tokenPosition && Number.isSafeInteger(result.tokenId)
        && result.tokenId >= 0 && result.tokenId < plan.vocabSize && typeof result.done === 'boolean'
        && typeof result.delta === 'string' && result.delta.length <= request.grant.claim.limits.maxOutputCharacters,
      'Doppler partition response identity or token mismatch');
      const total = (outputCharacters.get(request.identity.attemptId) || 0) + result.delta.length;
      if (total > request.grant.claim.limits.maxOutputCharacters) {
        throw Object.assign(new Error('Partition output budget exhausted'), { code: 'OUTPUT_LIMIT_EXCEEDED' });
      }
      outputCharacters.set(request.identity.attemptId, total);
      // Large diagnostic logits stay at B; the peer protocol returns one token and bounded continuation.
      const { logits: _logits, ...output } = result;
      return output;
    },
    settleAttempt: async identity => {
      try { await contributor?.closeAttempt({ identity }); }
      finally { outputCharacters.delete(identity.attemptId); }
    },
  });
  const notify = () => { for (const listener of listeners) { try { listener(getState()); } catch {} } };
  const endpoint = createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId, limits,
    async authorize({ action, metadata, byteLength }) {
      if (metadata.operation === 'describe') return byteLength === 0;
      if (!binding(metadata.identity)) return false;
      const outbound = action === 'send' || action === 'accept';
      if (metadata.identity.participantA !== (outbound ? localParticipantId : remoteParticipantId)
        || metadata.identity.participantB !== (outbound ? remoteParticipantId : localParticipantId)) return false;
      if (metadata.schema !== undefined) {
        if (!canonicalRequest(metadata) || metadata.operation !== 'step' && !canonicalContract.validateControl(metadata)) return false;
        if (metadata.operation === 'settle') return byteLength === 0 && verify(metadata, 'mesh.execute_partition_b', true);
        if (!['reserve', 'admit', 'step', 'published'].includes(metadata.operation)) return false;
        if (metadata.operation === 'step') {
          if (!canonicalContract.validateHeader(metadata, byteLength)) return false;
        } else if (byteLength !== 0) return false;
        if (metadata.operation === 'admit') {
          try {
            if (metadata.phase !== 'admit' || metadata.sequence !== 0 || metadata.tokenPosition !== 0
              || metadata.inputTokenIds?.length !== metadata.inputTokenCount
              || runtime.tokenDigest(metadata.inputTokenIds, plan.vocabSize, metadata.grant.claim.limits.maxPromptTokens)
                !== metadata.canonicalAttempt.inputDigest) return false;
          } catch { return false; }
        }
        if (!outbound && metadata.operation !== 'reserve' && !reservations.has(metadata.identity.attemptId)) return false;
        return verify(metadata, action === 'respond' || action === 'accept' ? 'mesh.transfer_partition_output'
          : metadata.operation === 'step' ? 'mesh.transfer_intermediate_activation' : 'mesh.execute_partition_b');
      }
      if (metadata.operation === 'settle') return byteLength === 0 && verify(metadata, 'mesh.execute_partition_b', true);
      if (metadata.operation === 'reserve') return byteLength === 0 && verify(metadata, 'mesh.execute_partition_b');
      if (metadata.operation !== 'step' || !validFrame(metadata) || metadata.frame.byteLength !== byteLength) return false;
      const allowed = await verify(metadata, action === 'respond' || action === 'accept'
        ? 'mesh.transfer_partition_output' : 'mesh.transfer_intermediate_activation');
      if (!allowed) return false;
      if (!outbound && !(contributor?.canAccept ? contributor.canAccept(metadata.identity) : contributor?.getState().ready)) {
        throw Object.assign(new Error(failureMessages.CAPACITY_UNAVAILABLE), { code: 'CAPACITY_UNAVAILABLE' });
      }
      return true;
    },
    async serve(metadata, payload, { signal }) {
      if (metadata.operation === 'describe') return { descriptor: contributor?.getState().ready ? contributor.getState().descriptor : null,
        ...(canonical ? { canonical: contributor?.getState().ready ? { stage: canonicalStage,
          generation: contributor.getCanonicalGeneration() } : null } : {}) };
      if (metadata.operation === 'reserve') {
        assert(!closing, 'Partition peer closed');
        assert(reservations.has(metadata.identity.attemptId) || reservations.size < receiverLimits.maxAttempts,
          'Remote reservation budget exhausted');
        signal.throwIfAborted();
        let reservation;
        try { reservation = contributor.reserve(metadata.identity); }
        catch (cause) {
          if (['Contributor reservation capacity exhausted', 'Contributor reservation history exhausted',
            'Partition contributor is not ready'].includes(cause.message)) return { accepted: false, code: 'CAPACITY_UNAVAILABLE' };
          throw cause;
        }
        reservations.set(metadata.identity.attemptId, structuredClone(metadata.identity));
        return { accepted: true, reservation };
      }
      if (metadata.operation === 'settle') {
        try {
          await receiver.closeAttempt(metadata.identity);
          await contributor.closeAttempt({ identity: metadata.identity });
        } catch (cause) {
          throw Object.assign(new Error(failureMessages.CLEANUP_FAILED, { cause }), { code: 'CLEANUP_FAILED' });
        }
        reservations.delete(metadata.identity.attemptId);
        return { settled: true };
      }
      return canonicalRequest(metadata) ? receiver.receiveCanonical(metadata.operation === 'step' ? { ...metadata, payload } : metadata, { signal })
        : receiver.receive({ ...metadata, payload }, { signal });
    },
  });
  const getState = () => ({ ready: channel.readyState === 'open' && remoteDescriptor?.ready === true && (!canonical || remoteCanonical !== null),
    descriptor: structuredClone(remoteDescriptor), participantId: remoteParticipantId, receipt: endpoint.getReceipt() });
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      const results = await Promise.allSettled([receiver.close(), ...[...reservations.values()]
        .map(identity => Promise.resolve().then(async () => {
          await contributor.closeAttempt({ identity }); reservations.delete(identity.attemptId);
        }))]);
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Partition peer settlement failed');
    })();
    const operation = closing;
    operation.catch(() => { if (closing === operation) closing = null; });
    endpoint.close(); remoteDescriptor = null; remoteCanonical = null; active.clear();
    notify(); return operation;
  };
  const disconnected = () => { close().catch(() => {}); };
  channel.addEventListener('close', disconnected, { once: true });
  return Object.freeze({
    id: remoteParticipantId, getState,
    getCanonicalGeneration: () => structuredClone(remoteCanonical?.generation ?? null),
    getCanonicalStage: () => structuredClone(remoteCanonical?.stage ?? null),
    async reserveCanonical(request) {
      assert(canonical && remoteCanonical && !active.has(request.identity.attemptId) && active.size < receiverLimits.maxAttempts,
        'Canonical remote reservation unavailable');
      const { signal, ...input } = request;
      const metadata = { ...structuredClone(input), schema: canonicalContract.schema, operation: 'reserve', phase: 'admit' };
      canonicalContract.validateBinding(metadata);
      active.set(request.identity.attemptId, structuredClone(metadata));
      const result = await endpoint.request(metadata, new Uint8Array(), { signal });
      assert(result.accepted === true && samePartitionIdentity(result.reservation?.identity, request.identity)
        && result.reservation.participantId === remoteParticipantId && result.reservation.index === 1
        && result.reservation.phase === 'reserved' && result.reservation.resources?.attemptSlots === 1,
      'Canonical remote reservation rejected');
      return { reservation: result.reservation };
    },
    async admitCanonicalPrompt(request) {
      const { signal, ...input } = request;
      assert(canonical && active.has(input.identity.attemptId), 'Canonical remote attempt is not reserved');
      const metadata = { ...structuredClone(input), schema: canonicalContract.schema, operation: 'admit', phase: 'admit' };
      return endpoint.request(metadata, new Uint8Array(), { signal });
    },
    async executeCanonicalFrame({ frame, signal, ...input }) {
      assert(canonical && active.has(input.identity.attemptId), 'Canonical remote attempt is not reserved');
      const { buffer, ...header } = frame;
      const metadata = { ...structuredClone(input), schema: canonicalContract.schema, operation: 'step', phase: 'step', frame: header };
      assert(canonicalContract.validateHeader(metadata, buffer.byteLength), 'Canonical outgoing activation rejected');
      return endpoint.request(metadata, new Uint8Array(buffer), { signal });
    },
    async acknowledgeCanonicalPublication(request) {
      const { signal, ...input } = request;
      assert(canonical && active.has(input.identity.attemptId), 'Canonical remote attempt is not reserved');
      const metadata = { ...structuredClone(input), schema: canonicalContract.schema, operation: 'published', phase: 'published' };
      const receipt = await endpoint.request(metadata, new Uint8Array(), { signal });
      assert(runtime.metadataDigest('reploid.publication-ack/v1', receipt)
        === runtime.metadataDigest('reploid.publication-ack/v1', metadata.receipt), 'Canonical publication acknowledgment mismatch');
      return receipt;
    },
    async reserve({ identity, grant, generation, generationDigest, inputTokenCount, signal }) {
      assert(!active.has(identity.attemptId), 'Remote attempt already reserved');
      assert(active.size < receiverLimits.maxAttempts, 'Remote attempt budget exhausted');
      const metadata = { operation: 'reserve', identity, grant, generation, generationDigest, inputTokenCount, step: 0 };
      active.set(identity.attemptId, structuredClone(metadata));
      const result = await endpoint.request(metadata, new Uint8Array(), { signal });
      if (result.accepted !== true) {
        // Old peers may return a reason string; never expose remote exception text.
        const code = result.code === 'CAPACITY_UNAVAILABLE' ? result.code : 'EXECUTION_FAILED';
        throw Object.assign(new Error(failureMessages[code]), { code });
      }
      assert(samePartitionIdentity(result.reservation?.identity, identity)
        && result.reservation.participantId === remoteParticipantId && result.reservation.index === 1
        && result.reservation.phase === 'reserved' && result.reservation.resources?.attemptSlots === 1,
      'Remote partition reservation identity mismatch');
      return { reservation: result.reservation };
    },
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    async refresh({ signal } = {}) {
      const { descriptor, canonical: observedCanonical } = await endpoint.request({ operation: 'describe' }, new Uint8Array(), { signal });
      assert(!descriptor || descriptor.schema === 'doppler.resident-partition/v1' && descriptor.ready === true
        && descriptor.index === 1 && descriptor.modelId === plan.modelId && descriptor.modelIdentity === modelIdentity
        && descriptor.planId === planId && JSON.stringify(descriptor.layerRange) === JSON.stringify(plan.partitions[1].layerRange),
      'Remote partition descriptor mismatch');
      if (canonical && descriptor) {
        assert(observedCanonical?.stage?.participantId === remoteParticipantId && observedCanonical.stage.partitionIndex === 1
          && observedCanonical.generation?.generationId === descriptor.canonicalGenerationId,
        'Remote canonical capability is unavailable or changed');
        remoteCanonical = structuredClone(observedCanonical);
      } else remoteCanonical = null;
      remoteDescriptor = descriptor; notify(); return getState();
    },
    async executeFrame({ frame, signal, executionGrant, outputGrant, ...request }) {
      assert(outputGrant?.claim?.id === executionGrant?.claim?.id, 'Partition output grant differs from execution grant');
      const { buffer, ...header } = frame;
      const metadata = { ...request, operation: 'step', frame: header, grant: executionGrant };
      const prior = active.get(request.identity.attemptId);
      assert(!prior || samePartitionIdentity(prior.identity, request.identity), 'Partition attempt identity collision');
      assert(prior || active.size < receiverLimits.maxAttempts, 'Remote attempt budget exhausted');
      active.set(request.identity.attemptId, structuredClone(metadata));
      let transportTiming = null;
      const result = await endpoint.request(metadata, new Uint8Array(buffer), {
        signal, onTiming: value => { transportTiming = value; }
      });
      return { ...result, transportTiming };
    },
    async closeAttempt({ identity }) {
      const metadata = active.get(identity.attemptId);
      if (!metadata) return;
      assert(samePartitionIdentity(metadata.identity, identity), 'Partition settlement identity collision');
      const settlement = canonicalRequest(metadata) ? { schema: canonicalContract.schema, operation: 'settle', identity,
        grant: metadata.grant, canonicalAttempt: metadata.canonicalAttempt, generationId: metadata.generationId,
        sequence: metadata.sequence, step: metadata.step } : { operation: 'settle', identity, grant: metadata.grant };
      const result = await endpoint.request(settlement, new Uint8Array());
      assert(result.settled === true, 'Remote partition settlement not acknowledged');
      active.delete(identity.attemptId);
    },
    close,
  });
}
