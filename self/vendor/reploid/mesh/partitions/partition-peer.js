import { createPartitionDataChannel } from '../../transport/partition-data-channel.js';
import { createPartitionStepReceiver } from './partition-step-receiver.js';
import { assertPartition as assert, samePartitionIdentity, partitionFingerprint } from './partition-contract.js';

/** Authenticated A-to-B partition RPC. Hosts establish channel identities before constructing it. */
export function createPartitionPeer({ channel, localParticipantId, remoteParticipantId, runtime, plan, planId,
  modelIdentity, authority, contributor = null, limits, receiverLimits }) {
  plan = structuredClone(plan); receiverLimits = structuredClone(receiverLimits);
  assert(runtime?.deserializeActivationFrame && authority?.verify, 'Partition codecs and grant verifier required');
  assert(!contributor || contributor.index === 1 && contributor.id === localParticipantId, 'Remote serving requires the local B contributor');
  const active = new Map(), outputCharacters = new Map(), listeners = new Set();
  const reservations = new Map();
  let remoteDescriptor = null, closing = null;
  const binding = identity => identity?.modelId === plan.modelId && identity.modelIdentity === modelIdentity
    && identity.planId === planId;
  const validFrame = metadata => {
    const frame = metadata.frame;
    return Number.isSafeInteger(metadata.maxTokens) && metadata.maxTokens > 0
      && metadata.maxTokens <= metadata.grant?.claim?.limits?.maxTokens && metadata.step < metadata.maxTokens
      && frame?.schema === runtime.ACTIVATION_TENSOR_SCHEMA && frame.dtype === plan.activationDtype
      && frame.step === metadata.step && frame.seqOffset === metadata.tokenPosition
      && Array.isArray(frame.shape) && frame.shape.length === 3 && frame.shape[0] === 1
      && frame.shape[1] === metadata.inputTokenCount && frame.shape[2] === plan.hiddenSize
      && Number.isSafeInteger(frame.byteLength) && frame.byteLength > 0
      && frame.byteLength === frame.shape[1] * frame.shape[2] * (frame.dtype === 'f16' ? 2 : 4)
      && samePartitionIdentity(frame.metadata, metadata.identity)
      && frame.metadata.maxTokens === metadata.maxTokens
      && frame.metadata.generationDigest === metadata.generationDigest
      && metadata.generation?.maxTokens === metadata.maxTokens
      && Array.isArray(metadata.inputTokenIds) && metadata.inputTokenIds.length === metadata.inputTokenCount
      && metadata.inputTokenIds.every(id => Number.isSafeInteger(id) && id >= 0 && id < plan.vocabSize)
      && frame.metadata.from === metadata.identity.participantA && frame.metadata.to === metadata.identity.participantB;
  };
  const verify = async (metadata, action, settlement = false) => {
    if (!settlement && (!metadata.generation || await partitionFingerprint(metadata.generation) !== metadata.generationDigest)) return false;
    const request = { identity: metadata.identity, step: metadata.step, inputTokenCount: metadata.inputTokenCount,
      generationDigest: metadata.generationDigest, activationBytes: metadata.frame?.byteLength };
    if (!await authority.verify(metadata.grant, { ...request, action }, { settlement })) return false;
    return settlement || authority.verify(metadata.grant, { ...request, action: 'mesh.transfer_token_context' });
  };
  const receiver = createPartitionStepReceiver({ limits: receiverLimits,
    authorize: request => verify(request, 'mesh.execute_partition_b'),
    fingerprint: request => {
      const { payload, ...metadata } = request;
      return partitionFingerprint(metadata, payload);
    },
    executeStep: async (request, { signal }) => {
      assert(contributor?.canAccept ? contributor.canAccept(request.identity) : contributor?.getState().ready, 'Partition B is not ready');
      const frame = { ...request.frame, buffer: request.payload.slice().buffer };
      const result = await contributor.executeGroup1({ identity: request.identity,
        step: request.step, tokenPosition: request.tokenPosition, inputTokenCount: request.inputTokenCount,
        maxTokens: request.maxTokens,
        generation: request.generation, inputTokenIds: request.inputTokenIds,
        activation: runtime.deserializeActivationFrame(frame), continuation: request.continuation, signal,
        executionGrant: request.grant, outputGrant: request.grant });
      assert(samePartitionIdentity(result?.identity, request.identity) && result.step === request.step
        && result.tokenPosition === request.tokenPosition && Number.isSafeInteger(result.tokenId)
        && result.tokenId >= 0 && result.tokenId < plan.vocabSize && typeof result.done === 'boolean'
        && typeof result.delta === 'string' && result.delta.length <= request.grant.claim.limits.maxOutputCharacters,
      'Doppler partition response identity or token mismatch');
      const total = (outputCharacters.get(request.identity.attemptId) || 0) + result.delta.length;
      assert(total <= request.grant.claim.limits.maxOutputCharacters, 'Partition output budget exhausted');
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
      if (metadata.operation === 'settle') return byteLength === 0 && verify(metadata, 'mesh.execute_partition_b', true);
      if (metadata.operation === 'reserve') return byteLength === 0 && verify(metadata, 'mesh.execute_partition_b');
      if (metadata.operation !== 'step' || !validFrame(metadata) || metadata.frame.byteLength !== byteLength) return false;
      if (!outbound && !(contributor?.canAccept ? contributor.canAccept(metadata.identity) : contributor?.getState().ready)) return false;
      return verify(metadata, action === 'respond' || action === 'accept'
        ? 'mesh.transfer_partition_output' : 'mesh.transfer_intermediate_activation');
    },
    async serve(metadata, payload, { signal }) {
      if (metadata.operation === 'describe') return { descriptor: contributor?.getState().ready ? contributor.getState().descriptor : null };
      if (metadata.operation === 'reserve') {
        assert(!closing, 'Partition peer closed');
        assert(reservations.has(metadata.identity.attemptId) || reservations.size < receiverLimits.maxAttempts,
          'Remote reservation budget exhausted');
        signal.throwIfAborted();
        let reservation;
        try { reservation = contributor.reserve(metadata.identity); }
        catch (cause) {
          if (['Contributor reservation capacity exhausted', 'Contributor reservation history exhausted',
            'Partition contributor is not ready'].includes(cause.message)) return { accepted: false, reason: cause.message };
          throw cause;
        }
        reservations.set(metadata.identity.attemptId, structuredClone(metadata.identity));
        return { accepted: true, reservation };
      }
      if (metadata.operation === 'settle') {
        await receiver.closeAttempt(metadata.identity);
        await contributor.closeAttempt({ identity: metadata.identity });
        reservations.delete(metadata.identity.attemptId);
        return { settled: true };
      }
      return receiver.receive({ ...metadata, payload }, { signal });
    },
  });
  const getState = () => ({ ready: channel.readyState === 'open' && remoteDescriptor?.ready === true,
    descriptor: structuredClone(remoteDescriptor), participantId: remoteParticipantId, receipt: endpoint.getReceipt() });
  const close = () => {
    if (closing) return closing;
    closing = (async () => {
      const results = await Promise.allSettled([receiver.close(), ...[...reservations.values()]
        .map(identity => Promise.resolve().then(() => contributor.closeAttempt({ identity })))]);
      reservations.clear();
      const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failures.length) throw new AggregateError(failures, 'Partition peer settlement failed');
    })();
    endpoint.close(); remoteDescriptor = null; active.clear();
    notify(); return closing;
  };
  const disconnected = () => { close().catch(() => {}); };
  channel.addEventListener('close', disconnected, { once: true });
  return Object.freeze({
    id: remoteParticipantId, getState,
    async reserve({ identity, grant, generation, generationDigest, inputTokenCount, signal }) {
      assert(!active.has(identity.attemptId), 'Remote attempt already reserved');
      assert(active.size < receiverLimits.maxAttempts, 'Remote attempt budget exhausted');
      const metadata = { operation: 'reserve', identity, grant, generation, generationDigest, inputTokenCount, step: 0 };
      active.set(identity.attemptId, structuredClone(metadata));
      const result = await endpoint.request(metadata, new Uint8Array(), { signal });
      assert(result.accepted === true, result.reason || 'Partition reservation declined');
      assert(samePartitionIdentity(result.reservation?.identity, identity)
        && result.reservation.participantId === remoteParticipantId && result.reservation.index === 1
        && result.reservation.phase === 'reserved' && result.reservation.resources?.attemptSlots === 1,
      'Remote partition reservation identity mismatch');
      return { reservation: result.reservation };
    },
    subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); },
    async refresh({ signal } = {}) {
      const { descriptor } = await endpoint.request({ operation: 'describe' }, new Uint8Array(), { signal });
      assert(!descriptor || descriptor.schema === 'doppler.resident-partition/v1' && descriptor.ready === true
        && descriptor.index === 1 && descriptor.modelId === plan.modelId && descriptor.modelIdentity === modelIdentity
        && descriptor.planId === planId && JSON.stringify(descriptor.layerRange) === JSON.stringify(plan.partitions[1].layerRange),
      'Remote partition descriptor mismatch');
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
      const result = await endpoint.request({ operation: 'settle', identity, grant: metadata.grant }, new Uint8Array());
      assert(result.settled === true, 'Remote partition settlement not acknowledged');
      active.delete(identity.attemptId);
    },
    close,
  });
}
