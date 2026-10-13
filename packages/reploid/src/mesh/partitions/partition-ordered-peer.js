import { createPartitionDataChannel } from '../../transport/partition-data-channel.js';
import { createPartitionStepReceiver } from './partition-step-receiver.js';
import { assertPartition as assert, canonicalPartitionJson, canonicalRouteAttemptBinding,
  sameRouteAttemptIdentity, validatePartitionRoute, partitionFingerprint, matchingPartitionActivation } from './partition-contract.js';

const SCHEMA = 'reploid.partition-stage-rpc/v1';
const equal = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
const unique = values => [...new Set(values)];
/** Ordered mode of the existing peer. Binary outputs return to the explicitly disclosed coordinator. */
export function createOrderedPartitionPeer({ channel, localParticipantId, remoteParticipantId, runtime, plan,
  planId, modelIdentity, authority, contributor, limits, receiverLimits, ordered, canonical }) {
  assert(!canonical, 'Ordered canonical peer is unsupported');
  plan = structuredClone(plan); ordered = structuredClone(ordered); receiverLimits = structuredClone(receiverLimits); limits = structuredClone(limits);
  const { route, partitionIndex: index } = ordered, stage = route?.stages?.[index], coordinatorId = route?.stages?.[0]?.participantId;
  assert(Number.isSafeInteger(index) && index > 0 && stage && authority?.verify
    && planId === route.planId && modelIdentity === route.modelIdentity, 'Explicit ordered peer binding required');
  const serving = !!contributor;
  assert(serving ? contributor.id === localParticipantId && contributor.index === index && remoteParticipantId === coordinatorId
    && localParticipantId === stage.participantId && ['transportId', 'residentId', 'executionId'].every(key => contributor[key] === stage[key])
    : localParticipantId === coordinatorId && remoteParticipantId === stage.participantId, 'Ordered channel participant mismatch');
  const ready = validatePartitionRoute(runtime, plan, route); ready.catch(() => {});
  const active = new Map(), reservations = new Map(), settlements = new Map(), pendingOutputs = new Map(), outputCharacters = new Map(), listeners = new Set();
  let closed = false, retiring = false, closing = null, descriptor = null, outputBytes = 0;
  const outputKey = request => request.identity.attemptId + ':' + request.step;
  const binding = request => {
    const identity = canonicalRouteAttemptBinding(request.identity);
    assert(equal(identity.route, route) && request.partitionIndex === index && request.coordinatorId === coordinatorId,
      'Ordered peer route or stage mismatch');
    return identity;
  };
  const protocol = request => {
    assert(request?.schema === SCHEMA && ['reserve', 'step', 'stage-output', 'settle'].includes(request.operation), 'Ordered peer message version mismatch');
    return binding(request);
  };
  const scope = (request, action) => ({ identity: request.identity, coordinatorId, action,
    partitionIndex: index, step: request.step, inputTokenCount: request.inputTokenCount,
    generationDigest: request.generationDigest, activationBytes: request.frame?.byteLength });
  const permit = async (request, action, grant, extra = {}, settlement = false) => authority.verify(grant,
    { ...scope(request, action), ...extra }, { settlement });
  const execution = (request, settlement = false) => permit(request, 'mesh.execute_partition_stage', request.executionGrant, {}, settlement);
  const token = request => permit(request, 'mesh.transfer_token_context', request.tokenContextGrant,
    { recipients: unique([coordinatorId, stage.participantId]) });
  const activation = (request, outgoing) => {
    const fromStage = outgoing ? index : index - 1, toStage = fromStage + 1;
    return permit(request, 'mesh.transfer_intermediate_activation', outgoing ? request.outgoingActivationGrant : request.incomingActivationGrant,
      { fromStage, toStage, recipients: unique([route.stages[fromStage].participantId, coordinatorId, route.stages[toStage]?.participantId]) });
  };
  const output = request => index === route.stages.length - 1
    ? permit(request, 'mesh.transfer_partition_output', request.outputGrant,
      { recipients: unique([stage.participantId, coordinatorId, request.identity.requesterId]) }) : activation(request, true);
  const validStep = request => request.generation?.maxTokens === request.maxTokens && Number.isSafeInteger(request.step) && request.step >= 0
    && Number.isSafeInteger(request.maxTokens) && request.maxTokens > 0 && request.step < request.maxTokens
    && request.maxTokens <= request.executionGrant?.claim?.limits?.maxTokens
    && Number.isSafeInteger(request.tokenPosition) && request.tokenPosition >= 0
    && Number.isSafeInteger(request.inputTokenCount) && request.inputTokenCount > 0
    && Array.isArray(request.inputTokenIds) && request.inputTokenIds.length === request.inputTokenCount
    && request.inputTokenIds.every(id => Number.isSafeInteger(id) && id >= 0 && id < plan.vocabSize);
  const validFrame = (request, byteLength) => {
    const frame = request.frame, layout = route.activation;
    return validStep(request) && frame?.schema === layout.schema && matchingPartitionActivation(frame, layout, true)
      && equal(frame.shape, [1, request.inputTokenCount, layout.hiddenSize]) && frame.step === request.step
      && frame.seqOffset === request.tokenPosition && frame.byteLength === byteLength && byteLength > 0
      && byteLength === request.inputTokenCount * layout.hiddenSize * layout.elementStrideBytes
      && byteLength <= request.executionGrant?.claim?.limits?.maxActivationBytes
      && sameRouteAttemptIdentity(frame.metadata?.identity, request.identity)
      && frame.metadata.partitionIndex === index && frame.metadata.step === request.step
      && frame.metadata.tokenPosition === request.tokenPosition && frame.metadata.generationDigest === request.generationDigest;
  };
  const frameMetadata = request => ({ identity: request.identity, partitionIndex: index, step: request.step,
    tokenPosition: request.tokenPosition, generationDigest: request.generationDigest });
  const snapshotRequest = request => { const { signal, ...data } = request; return { ...structuredClone(data), signal }; };
  const control = (request, operation) => {
    const { signal: _signal, activation: _activation, ...data } = request;
    return { ...structuredClone(data), schema: SCHEMA, operation, coordinatorId, partitionIndex: index };
  };
  const receiver = createPartitionStepReceiver({ limits: receiverLimits, ordered: { stage },
    authorize: async request => await execution(request) && await token(request) && await activation(request, false) && await output(request),
    fingerprint: ({ payload, ...metadata }) => partitionFingerprint(metadata, payload),
    executeStep: async (request, { signal }) => {
      assert(serving && contributor.canAccept(request.identity), 'Ordered contributor unavailable');
      const frame = { ...request.frame, buffer: request.payload.slice().buffer };
      const decoded = runtime.validateActivationFrameForPlan(frame, plan);
      const result = await contributor.executeStage({ ...request, activation: decoded, signal });
      if (index === route.stages.length - 1) {
        assert(typeof result.delta === 'string', 'Ordered final delta required');
        const total = (outputCharacters.get(request.identity.attemptId) || 0) + result.delta.length;
        assert(total <= request.executionGrant.claim.limits.maxOutputCharacters, 'Ordered output budget exhausted');
        outputCharacters.set(request.identity.attemptId, total);
      }
      return result;
    },
    // The peer reservation owner closes the resident after receiver work settles,
    // including reserve-before-first-step attempts unknown to this receiver.
    settleAttempt: async () => {},
  });
  const settleLocal = identity => {
    const previous = settlements.get(identity.attemptId);
    if (previous) { assert(sameRouteAttemptIdentity(previous.identity, identity), 'Ordered settlement identity collision'); return previous.promise; }
    const record = { identity: canonicalRouteAttemptBinding(identity), promise: null };
    settlements.set(identity.attemptId, record);
    record.promise = (async () => {
      const failures = [];
      try { await receiver.closeAttempt(record.identity); } catch (error) { failures.push(error); }
      try { await contributor.closeAttempt({ identity: record.identity, partitionIndex: index }); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Ordered remote cleanup failed');
      reservations.delete(identity.attemptId); outputCharacters.delete(identity.attemptId);
    })().catch(error => { settlements.delete(identity.attemptId); throw error; });
    return record.promise;
  };
  const endpoint = createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId, limits,
    async authorize({ action, metadata, byteLength }) {
      await ready;
      if (closed || retiring && metadata.operation !== 'settle') return false;
      if (metadata.operation === 'describe') return byteLength === 0 && metadata.schema === SCHEMA;
      try { protocol(metadata); } catch { return false; }
      const returningOutput = metadata.operation === 'stage-output';
      const outbound = action === 'send' || action === 'accept';
      if (returningOutput ? outbound !== serving : outbound === serving) return false;
      if (metadata.operation === 'settle') return byteLength === 0 && execution(metadata, true);
      if (!await execution(metadata) || await runtime.hashPartitionGeneration(metadata.generation) !== metadata.generationDigest) return false;
      if (metadata.operation === 'reserve') return byteLength === 0
        && Number.isSafeInteger(metadata.maxTokens) && metadata.maxTokens > 0
        && metadata.maxTokens <= Math.min(receiverLimits.maxSteps, metadata.executionGrant.claim.limits.maxTokens)
        && metadata.generation?.maxTokens === metadata.maxTokens;
      if (!validFrame(metadata, byteLength)) return false;
      if (returningOutput) {
        if (index === route.stages.length - 1 || !await output(metadata)) return false;
        const pending = serving ? null : pendingOutputs.get(outputKey(metadata));
        return serving || !!pending && sameRouteAttemptIdentity(pending.request.identity, metadata.identity)
          && pending.request.generationDigest === metadata.generationDigest && pending.request.tokenPosition === metadata.tokenPosition
          && pending.request.inputTokenCount === metadata.inputTokenCount && pending.request.maxTokens === metadata.maxTokens;
      }
      return await token(metadata) && await activation(metadata, false) && await output(metadata)
        && (!serving || reservations.has(metadata.identity.attemptId));
    },
    async serve(metadata, payload, { signal }) {
      if (metadata.operation === 'describe') {
        const state = contributor?.getState();
        return { descriptor: state?.ready && typeof contributor.executeStage === 'function' ? state.descriptor : null,
          stage: state?.ready ? stage : null, capability: state?.ready ? 'ordered-stage' : null };
      }
      if (metadata.operation === 'stage-output') {
        const pending = pendingOutputs.get(outputKey(metadata));
        assert(pending && !serving, 'Unexpected ordered output');
        const digest = await partitionFingerprint(metadata.frame, payload);
        assert(digest === metadata.outputDigest, 'Ordered output payload digest mismatch');
        if (pending.output) assert(pending.output.digest === digest, 'Ordered output frame collision');
        else {
          assert(outputBytes + payload.byteLength <= limits.maxPendingBytes, 'Ordered pending output byte budget exhausted');
          pending.output = { digest, frame: { ...structuredClone(metadata.frame), buffer: payload.slice().buffer } };
          outputBytes += payload.byteLength;
        }
        return { outputDigest: digest };
      }
      if (metadata.operation === 'reserve') {
        assert(serving && !closed && !settlements.has(metadata.identity.attemptId)
          && (reservations.has(metadata.identity.attemptId) || reservations.size + settlements.size < receiverLimits.maxAttempts), 'Ordered reservation budget exhausted or retired');
        const previous = reservations.get(metadata.identity.attemptId);
        assert(!previous || sameRouteAttemptIdentity(previous.identity, metadata.identity), 'Ordered reservation identity collision');
        // May have been admitted even if the subsequent acknowledgment is lost.
        reservations.set(metadata.identity.attemptId, structuredClone(metadata));
        return contributor.reserve({ ...metadata, signal });
      }
      if (metadata.operation === 'settle') {
        const previous = reservations.get(metadata.identity.attemptId);
        assert(!previous || sameRouteAttemptIdentity(previous.identity, metadata.identity), 'Ordered settlement identity collision');
        await settleLocal(metadata.identity); return { settled: true };
      }
      const result = await receiver.receive({ ...metadata, payload }, { signal });
      assert(sameRouteAttemptIdentity(result.identity, metadata.identity) && result.partitionIndex === index
        && result.step === metadata.step && result.tokenPosition === metadata.tokenPosition, 'Ordered output identity mismatch');
      if (index === route.stages.length - 1) {
        assert(!result.activationTensor && Number.isSafeInteger(result.tokenId) && result.tokenId >= 0 && result.tokenId < plan.vocabSize
          && typeof result.delta === 'string' && result.delta.length <= metadata.executionGrant.claim.limits.maxOutputCharacters
          && typeof result.done === 'boolean', 'Ordered final output mismatch');
        const { logits: _logits, ...response } = result; return response;
      }
      assert(result.activationTensor && !('tokenId' in result) && !('delta' in result), 'Only final ordered stage may sample');
      const frame = runtime.serializeActivationFrame({ ...result.activationTensor, metadata: frameMetadata(metadata) });
      runtime.validateActivationFrameForPlan(frame, plan);
      const { buffer, ...header } = frame;
      const outputDigest = await partitionFingerprint(header, new Uint8Array(buffer));
      const response = await endpoint.request({ ...metadata, operation: 'stage-output', frame: header, outputDigest }, new Uint8Array(buffer), { signal });
      assert(response.outputDigest === outputDigest, 'Ordered output acknowledgment mismatch');
      const { activationTensor: _tensor, logits: _logits, ...rest } = result;
      return { ...rest, outputDigest };
    }
  });
  const getState = () => ({ ready: !closed && !retiring && channel.readyState === 'open' && descriptor?.ready === true,
    participantId: remoteParticipantId, descriptor: structuredClone(descriptor), receipt: endpoint.getReceipt(),
    retainedOutputBytes: outputBytes, unsettled: serving ? reservations.size : active.size });
  const notify = () => { for (const listener of listeners) { try { listener(getState()); } catch {} } };
  const closeAttempt = async ({ identity }) => {
    identity = canonicalRouteAttemptBinding(identity);
    await ready;
    const previous = active.get(identity.attemptId); if (!previous) return;
    assert(sameRouteAttemptIdentity(previous.identity, identity), 'Ordered settlement identity collision');
    const result = await endpoint.request({ ...previous, operation: 'settle' }, new Uint8Array());
    assert(result.settled === true, 'Ordered settlement not acknowledged'); active.delete(identity.attemptId); notify();
  };
  const close = () => {
    if (closing) return closing;
    retiring = true;
    closing = (async () => {
    // Attempt known cleanup while the channel remains usable. Channel closure alone is not remote settlement.
    const failures = [];
    if (!serving) for (const request of active.values()) {
      try { await closeAttempt({ identity: request.identity }); } catch (error) { failures.push(error); }
    }
    closed = true; descriptor = null;
    try { await receiver.close(); } catch (error) { failures.push(error); }
    if (serving) for (const request of reservations.values()) {
      try { await settleLocal(request.identity); }
      catch (error) { failures.push(error); }
    }
    endpoint.close(); pendingOutputs.clear(); outputBytes = 0; notify();
    if (failures.length) throw new AggregateError(failures, 'Ordered peer cleanup remains unknown');
    })().catch(error => { closing = null; throw error; });
    return closing;
  };
  channel.addEventListener('close', () => { closed = true; descriptor = null; notify(); close().catch(() => {}); }, { once: true });
  return Object.freeze({ id: remoteParticipantId, transportId: stage.transportId, residentId: stage.residentId, executionId: stage.executionId,
    getState, subscribe(listener) { listeners.add(listener); listener(getState()); return () => listeners.delete(listener); }, close, closeAttempt,
    async refresh({ signal } = {}) {
      await ready;
      const observed = await endpoint.request({ schema: SCHEMA, operation: 'describe' }, new Uint8Array(), { signal });
      const value = observed.descriptor;
      assert(!value || observed.capability === 'ordered-stage' && equal(observed.stage, stage)
        && value.schema === 'doppler.resident-partition/v2' && value.ready === true && value.index === index
        && value.stageCount === route.stages.length && value.modelId === route.modelId && value.modelIdentity === modelIdentity
        && value.planId === planId && equal(value.layerRange, plan.partitions[index].layerRange), 'Ordered remote descriptor mismatch');
      descriptor = value; notify(); return getState();
    },
    async reserve(request) {
      request = snapshotRequest(request);
      await ready; assert(!serving && !closed && !retiring && active.size < receiverLimits.maxAttempts, 'Ordered remote admission unavailable');
      const metadata = control({ ...request, step: 0 }, 'reserve'); protocol(metadata);
      const previous = active.get(request.identity.attemptId);
      assert(!previous || sameRouteAttemptIdentity(previous.identity, metadata.identity), 'Ordered reservation identity collision');
      active.set(metadata.identity.attemptId, metadata);
      const response = await endpoint.request(metadata, new Uint8Array(), { signal: request.signal });
      assert(sameRouteAttemptIdentity(response.identity, metadata.identity) && response.partitionIndex === index
        && response.status === 'reserved', 'Ordered reservation acknowledgment mismatch'); return response;
    },
    async executeStage(request) {
      request = snapshotRequest(request);
      await ready; assert(!serving && !closed && !retiring, 'Ordered remote execution unavailable');
      const previous = active.get(request.identity.attemptId);
      assert(previous && sameRouteAttemptIdentity(previous.identity, request.identity), 'Ordered remote attempt not reserved');
      const { tensorData, ...layout } = request.activation || {};
      const frame = runtime.serializeActivationFrame({ ...layout, data: tensorData, metadata: frameMetadata(request) });
      const { buffer, ...header } = frame;
      const metadata = control({ ...request, frame: header }, 'step'); protocol(metadata);
      const key = outputKey(metadata); assert(pendingOutputs.size < receiverLimits.maxAttempts
        && ![...pendingOutputs.values()].some(value => value.request.identity.attemptId === metadata.identity.attemptId), 'Ordered remote step already in flight');
      const pending = { request: metadata, output: null }; pendingOutputs.set(key, pending);
      try {
        const response = await endpoint.request(metadata, new Uint8Array(buffer), { signal: request.signal });
        assert(sameRouteAttemptIdentity(response.identity, metadata.identity) && response.partitionIndex === index
          && response.step === metadata.step && response.tokenPosition === metadata.tokenPosition, 'Ordered response binding mismatch');
        if (index === route.stages.length - 1) return response;
        assert(pending.output && pending.output.digest === response.outputDigest, 'Ordered binary output missing or unacknowledged');
        const decoded = runtime.validateActivationFrameForPlan(pending.output.frame, plan);
        const { tensorData: data, ...geometry } = decoded;
        return { ...response, activationTensor: { ...geometry, data } };
      } finally {
        if (pendingOutputs.get(key) === pending) { outputBytes -= pending.output?.frame.buffer.byteLength || 0; pendingOutputs.delete(key); }
      }
    }
  });
}
