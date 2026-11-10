import { createPartitionDataChannel, partitionBinaryResult } from '../../transport/partition-data-channel.js';
import { createPartitionStepReceiver } from './partition-step-receiver.js';
import { assertPartition as assert, assertCapacity, partitionFailure, canonicalPartitionJson, canonicalRouteAttemptBinding,
  sameRouteAttemptIdentity, validatePartitionRoute, partitionFingerprint, matchingPartitionActivation } from './partition-contract.js';

const SCHEMA = 'reploid.partition-stage-rpc/v2';
const GRANT_REFERENCE = 'reploid.partition-grant-reference/v1';
const GRANT_FIELDS = ['executionGrant', 'tokenContextGrant', 'incomingActivationGrant', 'outgoingActivationGrant', 'outputGrant'];
const equal = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
const unique = values => [...new Set(values)];
const grantDigest = grant => partitionFingerprint({ schema: GRANT_REFERENCE, grant });
const isReference = value => value?.schema === GRANT_REFERENCE && Object.keys(value).length === 2
  && /^sha256:[a-f0-9]{64}$/.test(value.digest);
/** Ordered mode of the existing peer. Binary outputs return to the explicitly disclosed coordinator
 * on the reply to the step that produced them. A step names a signed grant already delivered for its
 * attempt by digest; the stage resolves it only from grants it verified for that attempt. */
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
  const confirmed = new Map(), retirementReceipts = new Map();
  let undeliveredRetirements = 0;
  const active = new Map(), reservations = new Map(), settlements = new Map(), inflight = new Set(), outputCharacters = new Map(), listeners = new Set();
  // Per attempt: the grants a coordinator sent or a stage verified, by digest; and, on the coordinator,
  // the digests its stage acknowledged receiving.
  const delivered = new Map(), verifiedGrants = new Map();
  let closed = false, retiring = false, remoteRetiring = false, closing = null, descriptor = null;
  let channelClosed;
  const remoteClose = new Promise(resolve => { channelClosed = resolve; });
  const binding = request => {
    const identity = canonicalRouteAttemptBinding(request.identity);
    assert(equal(identity.route, route) && request.partitionIndex === index && request.coordinatorId === coordinatorId,
      'Ordered peer route or stage mismatch');
    return identity;
  };
  const protocol = request => {
    assert(request?.schema === SCHEMA && ['reserve', 'step', 'settle', 'settle-accepted', 'retired'].includes(request.operation), 'Ordered peer message version mismatch');
    return binding(request);
  };
  const scope = (request, action) => ({ identity: request.identity, coordinatorId, action,
    partitionIndex: index, step: request.step, inputTokenCount: request.inputTokenCount,
    generationDigest: request.generationDigest, activationBytes: request.frame?.byteLength });
  const permit = async (request, action, grant, extra = {}, settlement = false) => {
    const input = { ...scope(request, action), ...extra };
    const { ok, reason } = authority.check ? await authority.check(grant, input, { settlement })
      : { ok: await authority.verify(grant, input, { settlement }) === true, reason: null };
    // The attempt's grant lifetime is its answer window: an expired grant reports the deadline.
    if (reason === 'expired') throw partitionFailure('ANSWER_DEADLINE_EXCEEDED');
    return ok;
  };
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
  const validFrame = (request, byteLength, frame = request.frame) => {
    const layout = route.activation;
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
  const activationBytes = request => request.inputTokenCount * route.activation.hiddenSize * route.activation.elementStrideBytes;
  // A step's grant references resolve only to grants this stage verified (or this coordinator sent) for that same attempt.
  const resolveGrants = metadata => {
    if (metadata?.operation !== 'step') return metadata;
    const known = verifiedGrants.get(metadata.identity?.attemptId);
    for (const field of GRANT_FIELDS) {
      if (!isReference(metadata[field])) continue;
      const grant = known?.get(metadata[field].digest);
      if (!grant) return null;
      metadata[field] = structuredClone(grant);
    }
    return metadata;
  };
  const rememberGrants = async metadata => {
    const attemptId = metadata.identity.attemptId;
    if (!reservations.has(attemptId) && metadata.operation !== 'reserve') return;
    const known = verifiedGrants.get(attemptId) ?? new Map();
    for (const field of GRANT_FIELDS) {
      if (metadata[field] && !isReference(metadata[field]) && known.size < GRANT_FIELDS.length) known.set(await grantDigest(metadata[field]), structuredClone(metadata[field]));
    }
    if (known.size) verifiedGrants.set(attemptId, known);
  };
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
    const record = { identity: canonicalRouteAttemptBinding(identity), promise: null, completed: false, acknowledged: false, request: null };
    settlements.set(identity.attemptId, record);
    record.promise = (async () => {
      const failures = [];
      try { await receiver.closeAttempt(record.identity); } catch (error) { failures.push(error); }
      try { await contributor.closeAttempt({ identity: record.identity, partitionIndex: index }); } catch (error) { failures.push(error); }
      if (failures.length) throw new AggregateError(failures, 'Ordered remote cleanup failed');
      record.completed = true;
      reservations.delete(identity.attemptId); outputCharacters.delete(identity.attemptId); verifiedGrants.delete(identity.attemptId);
    })().catch(error => { settlements.delete(identity.attemptId); throw error; });
    return record.promise;
  };
  const endpoint = createPartitionDataChannel({ channel, localParticipantId, remoteParticipantId, limits,
    async authorize({ action, metadata, byteLength }) {
      await ready;
      if (closed || retiring && !['settle', 'settle-accepted', 'retired'].includes(metadata.operation)) {
        // A retiring stage admits no new attempt: that is unavailable capacity, not a declined grant.
        if (metadata.operation === 'reserve') throw partitionFailure('CAPACITY_UNAVAILABLE');
        return false;
      }
      if (metadata.operation === 'describe') return byteLength === 0 && metadata.schema === SCHEMA;
      try { protocol(metadata); } catch { return false; }
      if (!resolveGrants(metadata)) return false;
      const returningOutput = metadata.operation === 'retired';
      const outbound = action === 'send' || action === 'accept';
      if (returningOutput ? outbound !== serving : outbound === serving) return false;
      if (metadata.operation === 'settle') return byteLength === 0 && execution(metadata, true);
      if (metadata.operation === 'settle-accepted') {
        const known = serving ? settlements.get(metadata.identity.attemptId)?.request : confirmed.get(metadata.identity.attemptId);
        return byteLength === 0 && !!known && sameRouteAttemptIdentity(known.identity, metadata.identity)
          && known.generationDigest === metadata.generationDigest && await execution(metadata, true);
      }
      if (metadata.operation === 'retired') {
        const known = serving ? retirementReceipts.get(metadata.identity.attemptId) : active.get(metadata.identity.attemptId) || confirmed.get(metadata.identity.attemptId);
        return byteLength === 0 && !!known && sameRouteAttemptIdentity(known.identity, metadata.identity)
          && known.generationDigest === metadata.generationDigest && await execution(metadata, true);
      }
      if (!await execution(metadata) || await runtime.hashPartitionGeneration(metadata.generation) !== metadata.generationDigest) return false;
      if (metadata.operation === 'reserve') {
        const allowed = byteLength === 0
          && Number.isSafeInteger(metadata.maxTokens) && metadata.maxTokens > 0
          && metadata.maxTokens <= Math.min(receiverLimits.maxSteps, metadata.executionGrant.claim.limits.maxTokens)
          && metadata.generation?.maxTokens === metadata.maxTokens;
        if (allowed && serving && action === 'receive') await rememberGrants(metadata);
        return allowed;
      }
      if (!validFrame(metadata, byteLength)) return false;
      const allowed = await token(metadata) && await activation(metadata, false) && await output(metadata)
        && (!serving || reservations.has(metadata.identity.attemptId));
      if (allowed && serving && action === 'receive') await rememberGrants(metadata);
      return allowed;
    },
    async serve(metadata, payload, { signal }) {
      if (metadata.operation === 'describe') {
        const state = contributor?.getState();
        return { descriptor: state?.ready && typeof contributor.executeStage === 'function' ? state.descriptor : null,
          stage: state?.ready ? stage : null, capability: state?.ready ? 'ordered-stage' : null };
      }
      if (metadata.operation === 'retired') {
        assert(!serving, 'Only coordinator accepts remote retirement');
        // This exact authenticated owner reports completed resident cleanup. A
        // channel close or unrelated receipt never clears another reservation.
        confirmed.set(metadata.identity.attemptId, structuredClone(metadata));
        active.delete(metadata.identity.attemptId); retiring = true; remoteRetiring = true; descriptor = null;
        // Do not notify a host that could close the channel before this reply.
        // The retiring supplier closes it after receiving this acknowledgment.
        return { settled: true, identity: metadata.identity, partitionIndex: index };
      }
      if (metadata.operation === 'reserve') {
        assert(serving && !settlements.has(metadata.identity.attemptId), 'Ordered reservation already settled');
        // A retiring stage or an exhausted receiver budget is unavailable capacity; the resident's own
        // slot refusal below carries the same code across the channel.
        assertCapacity(!closed && !retiring && (reservations.has(metadata.identity.attemptId)
          || reservations.size + settlements.size < receiverLimits.maxAttempts));
        const previous = reservations.get(metadata.identity.attemptId);
        assert(!previous || sameRouteAttemptIdentity(previous.identity, metadata.identity), 'Ordered reservation identity collision');
        // May have been admitted even if the subsequent acknowledgment is lost.
        reservations.set(metadata.identity.attemptId, structuredClone(metadata));
        return contributor.reserve({ ...metadata, signal });
      }
      if (metadata.operation === 'settle-accepted') {
        const record = settlements.get(metadata.identity.attemptId);
        assert(serving && record?.completed, 'Ordered cleanup is not complete');
        record.acknowledged = true;
        if (!retiring) retirementReceipts.delete(metadata.identity.attemptId);
        return { accepted: true };
      }
      if (metadata.operation === 'settle') {
        const previous = reservations.get(metadata.identity.attemptId);
        assert(!previous || sameRouteAttemptIdentity(previous.identity, metadata.identity), 'Ordered settlement identity collision');
        const pending = settleLocal(metadata.identity), record = settlements.get(metadata.identity.attemptId);
        record.request ||= structuredClone(metadata);
        assert(record.request.generationDigest === metadata.generationDigest, 'Ordered settlement generation collision');
        // Keep the request until its coordinator confirms receipt. Returning
        // from serve does not establish delivery of the ordinary settle reply.
        if (!record.acknowledged) retirementReceipts.set(metadata.identity.attemptId, record.request);
        await pending; return { settled: true };
      }
      assert(resolveGrants(metadata), 'Ordered grant reference is not verified for this attempt');
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
      const bytes = new Uint8Array(buffer);
      assert(validFrame(metadata, bytes.byteLength, header), 'Ordered output frame mismatch');
      const outputDigest = await partitionFingerprint(header, bytes);
      const { activationTensor: _tensor, logits: _logits, ...rest } = result;
      // The activation returns on this step's own reply, bound to its header by digest.
      return partitionBinaryResult({ ...rest, frame: header, outputDigest }, bytes);
    }
  });
  const getState = () => ({ ready: !closed && !retiring && channel.readyState === 'open' && descriptor?.ready === true,
    participantId: remoteParticipantId, descriptor: structuredClone(descriptor), receipt: endpoint.getReceipt(),
    unsettled: serving ? new Set([...reservations.keys(), ...retirementReceipts.keys()]).size : active.size,
    ...(serving ? { undeliveredRetirements } : {}) });
  const notify = () => { for (const listener of listeners) { try { listener(getState()); } catch {} } };
  const closeAttempt = async ({ identity }) => {
    identity = canonicalRouteAttemptBinding(identity);
    await ready;
    const previous = active.get(identity.attemptId); if (!previous) return;
    assert(sameRouteAttemptIdentity(previous.identity, identity), 'Ordered settlement identity collision');
    try {
      if (!confirmed.has(identity.attemptId)) {
        const result = await endpoint.request({ ...previous, operation: 'settle' }, new Uint8Array());
        assert(result.settled === true, 'Ordered settlement not acknowledged');
        confirmed.set(identity.attemptId, previous);
      }
      const receipt = await endpoint.request({ ...previous, operation: 'settle-accepted' }, new Uint8Array());
      assert(receipt.accepted === true, 'Ordered settlement receipt not acknowledged');
      active.delete(identity.attemptId); delivered.delete(identity.attemptId); verifiedGrants.delete(identity.attemptId); notify();
    } catch (error) {
      // Only an already authenticated cleanup result can survive channel loss.
      // Concurrent retirement also confirms this exact attempt; a closed
      // channel by itself never supplies that evidence.
      if ((!remoteRetiring && !closed) || !sameRouteAttemptIdentity(confirmed.get(identity.attemptId)?.identity, identity)) throw error;
      active.delete(identity.attemptId);
    }
  };
  const close = () => {
    if (closing) return closing;
    retiring = true;
    if (serving) for (const [id, request] of reservations) retirementReceipts.set(id, request);
    closing = (async () => {
    // Attempt known cleanup while the channel remains usable. Channel closure alone is not remote settlement.
    const failures = [];
    if (!serving) for (const request of active.values()) {
      try { await closeAttempt({ identity: request.identity }); }
      catch (error) {
        // After channel loss no retry can confirm this owner. It stays counted in
        // `unsettled` as unknown; it does not keep the dead port open forever.
        if (!closed || error?.code !== 'CONNECTION_LOST') failures.push(error);
      }
    }
    descriptor = null;
    try { await receiver.close(); } catch (error) { failures.push(error); }
    if (serving) {
      for (const [id, request] of retirementReceipts) {
        let settled = false;
        try {
          await settleLocal(request.identity); settled = true;
          const result = await endpoint.request({ ...request, operation: 'retired' }, new Uint8Array());
          assert(result.settled === true && result.partitionIndex === index
            && sameRouteAttemptIdentity(result.identity, request.identity), 'Ordered retirement acknowledgment mismatch');
          retirementReceipts.delete(id);
        } catch (error) {
          // This contributor released its own resident above. After its coordinator's channel is
          // lost, no acknowledgment can ever be delivered on it, so it must not keep the route
          // channel charged; the coordinator records that attempt's cleanup as unknown.
          if (settled && closed && error?.code === 'CONNECTION_LOST') { retirementReceipts.delete(id); undeliveredRetirements++; }
          else failures.push(error);
        }
      }
    }
    // A coordinator closing concurrently with a retirement response must not
    // destroy the acknowledgment before the supplier receives it. The supplier
    // owns channel closure once its exact receipts have all been acknowledged.
    if (!serving && remoteRetiring && !closed && !failures.length) {
      let timer;
      try { await Promise.race([remoteClose, new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Ordered retirement acknowledgment remains unsettled')), limits.timeoutMs);
      })]); } catch (error) { failures.push(error); } finally { clearTimeout(timer); }
    }
    if (failures.length) { notify(); throw new AggregateError(failures, 'Ordered peer cleanup remains unknown'); }
    closed = true; endpoint.close(); delivered.clear(); verifiedGrants.clear(); notify();
    })().catch(error => { closing = null; throw error; });
    return closing;
  };
  channel.addEventListener('close', () => { closed = true; channelClosed(); descriptor = null; notify(); close().catch(() => {}); }, { once: true });
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
      await ready; assert(!serving, 'Only the coordinator reserves a remote stage');
      assertCapacity(!closed && !retiring && active.size + confirmed.size < receiverLimits.maxAttempts);
      const metadata = control({ ...request, step: 0 }, 'reserve'); protocol(metadata);
      const previous = active.get(request.identity.attemptId);
      assert(!previous || sameRouteAttemptIdentity(previous.identity, metadata.identity), 'Ordered reservation identity collision');
      active.set(metadata.identity.attemptId, metadata);
      const response = await endpoint.request(metadata, new Uint8Array(), { signal: request.signal });
      assert(sameRouteAttemptIdentity(response.identity, metadata.identity) && response.partitionIndex === index
        && response.status === 'reserved', 'Ordered reservation acknowledgment mismatch');
      delivered.set(metadata.identity.attemptId, new Set([await grantDigest(metadata.executionGrant)]));
      return response;
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
      const attemptId = metadata.identity.attemptId, final = index === route.stages.length - 1;
      assert(inflight.size < receiverLimits.maxAttempts && !inflight.has(attemptId), 'Ordered remote step already in flight');
      inflight.add(attemptId);
      try {
        // Grants this stage already holds for the attempt travel as digests; new ones travel once.
        const known = delivered.get(attemptId) ?? new Set(), sent = [], wire = { ...metadata };
        const own = verifiedGrants.get(attemptId) ?? new Map();
        for (const field of GRANT_FIELDS) {
          if (!metadata[field]) continue;
          const digest = await grantDigest(metadata[field]);
          if (own.size < GRANT_FIELDS.length || own.has(digest)) own.set(digest, metadata[field]);
          if (known.has(digest)) wire[field] = { schema: GRANT_REFERENCE, digest };
          else sent.push(digest);
        }
        if (active.has(attemptId)) verifiedGrants.set(attemptId, own);
        const reply = await endpoint.request(wire, new Uint8Array(buffer), { signal: request.signal,
          ...(final ? {} : { maxResponseBytes: activationBytes(metadata) }) });
        const response = final ? reply : reply.result;
        assert(sameRouteAttemptIdentity(response.identity, metadata.identity) && response.partitionIndex === index
          && response.step === metadata.step && response.tokenPosition === metadata.tokenPosition, 'Ordered response binding mismatch');
        for (const digest of sent) known.add(digest);
        if (active.has(attemptId)) delivered.set(attemptId, known);
        if (final) return response;
        const { frame: output, outputDigest, ...rest } = response;
        assert(validFrame(metadata, reply.bytes.byteLength, output)
          && await partitionFingerprint(output, reply.bytes) === outputDigest, 'Ordered binary output missing or altered');
        const decoded = runtime.validateActivationFrameForPlan({ ...output, buffer: reply.bytes.slice().buffer }, plan);
        const { tensorData: data, ...geometry } = decoded;
        return { ...rest, outputDigest, activationTensor: { ...geometry, data } };
      } finally { inflight.delete(attemptId); }
    }
  });
}
