/** Ordinary ordered-stage execution. Doppler owns every numerical operation. */
import { canonicalPartitionJson, partitionActivationContract,
  matchingPartitionActivation, validatePartitionRoute, canonicalRouteAttemptBinding,
  sameRouteAttemptIdentity, assertCapacity } from './partition-contract.js';
import failureMessages from '../../transport/partition-errors.json' with { type: 'json' };
import { MAX_UNACKNOWLEDGED_OUTPUTS, acknowledgmentOverdue } from './partition-attempt-evidence.js';

const assert = (ok, message) => { if (!ok) throw new Error(message); };
// A stage port reports CONNECTION_LOST only after its authenticated channel has
// closed. No later retry through this route can confirm that stage's cleanup.
const connectionLost = error => error?.code === 'CONNECTION_LOST';
const positive = value => Number.isSafeInteger(value) && value > 0;
const clone = value => structuredClone(value);
const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

/** Called only by the existing runner's explicitly selected ordered-route path. */
export function createOrderedPartitionExecution({ runtime, plan: suppliedPlan, route: suppliedRoute,
  stages, transport, authorize, limits, canonical = false }) {
  assert(!canonical, 'Ordered ordinary execution does not enable canonical replay');
  assert(typeof runtime?.serializeActivationFrame === 'function'
    && typeof runtime?.validateActivationFrameForPlan === 'function'
    && typeof runtime?.hashPartitionGeneration === 'function', 'Doppler ordered runtime required');
  assert(typeof authorize === 'function' && typeof transport?.transferActivation === 'function',
    'Ordered route authorization and activation transport required');
  assert(limits && ['maxTokens', 'maxPromptTokens', 'maxActivationBytes', 'maxOutputCharacters',
    'maxAttempts', 'maxConcurrentAttempts', 'maxStages'].every(key => positive(limits[key])),
  'Explicit ordered route allocation limits required');
  const policy = Object.freeze({ ...limits });
  const plan = freeze(clone(suppliedPlan));
  const route = freeze(clone(suppliedRoute));
  assert(Array.isArray(stages) && stages.length >= 2 && stages.length <= policy.maxStages
    && route.stages?.length === stages.length, 'Ordered route stage count mismatch');
  for (const [index, device] of stages.entries()) {
    const stage = route.stages[index];
    assert(stage.index === index && device?.id === stage.participantId
      && ['transportId', 'residentId', 'executionId'].every(key => device[key] === stage[key])
      && ['reserve', 'executeStage', 'closeAttempt'].every(key => typeof device[key] === 'function'),
    'Ordered stage identity, admission, execution and settlement ports required');
  }
  const devices = stages.map(device => Object.freeze({ id: device.id,
    transportId: device.transportId, residentId: device.residentId, executionId: device.executionId,
    reserve: device.reserve.bind(device), executeStage: device.executeStage.bind(device),
    closeAttempt: device.closeAttempt.bind(device) }));
  const tensorContract = partitionActivationContract(runtime, plan);
  const attempts = new Map();
  let closed = false;
  const tails = devices.map(() => Promise.resolve());
  // Serialize calls to each stage while allowing independent conversations to
  // occupy different stages. This does not schedule across separate runners.
  async function lease(stage, task) {
    const prior = tails[stage];
    let release;
    tails[stage] = new Promise(resolve => { release = resolve; });
    await prior;
    try { return await task(); } finally { release(); }
  }

  async function cleanup(item) {
    if (item.cleaning) return item.cleaning;
    item.cleaning = (async () => {
      item.receipt.phase = 'settling';
      // Acknowledgments already requested reach the stages with their closing request.
      await item.acknowledging;
      const acknowledged = item.acknowledged;
      const results = await Promise.allSettled([...item.owned].map(async index => {
        try {
          await devices[index].closeAttempt({ identity: item.binding, partitionIndex: index, ...(acknowledged ? { acknowledged } : {}) });
          item.owned.delete(index);
          item.receipt.cleanup[index] = { partitionIndex: index, status: 'settled', error: null };
        } catch (error) {
          // A lost stage stays unknown in this receipt; it is never reported as
          // settled. It stops being retryable debt because its channel is gone.
          const lost = connectionLost(error);
          if (lost) { item.owned.delete(index); item.lost.add(index); }
          item.receipt.cleanup[index] = { partitionIndex: index, status: 'unknown', error: String(error?.message || error),
            ...(lost ? { code: 'CONNECTION_LOST' } : {}) };
          throw error;
        }
      }));
      const unknown = item.owned.size + item.lost.size > 0;
      item.receipt.phase = unknown ? 'cleanup-failed' : item.outcome;
      item.receipt.cleanupSettledAt = unknown ? null : Date.now();
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw Object.assign(new AggregateError(errors, 'Ordered route cleanup remains unsettled'),
        { code: item.owned.size ? 'CLEANUP_FAILED' : 'CONNECTION_LOST' });
    })();
    try { return await item.cleaning; } finally { item.cleaning = null; }
  }

  /**
   * `charge` is the requester's signed binding of this attempt to its
   * reservation; stages that sign receipts receive it with their reservation.
   * `onOutput({ step, delta, done, receipt })` hands each final-stage output and
   * its signed receipt to the requester side, which may answer with its signed
   * acknowledgment pair. Acknowledgments are requested without holding the
   * next step; the latest one travels with later stage requests and closing.
   * A charged step s waits until acknowledgments cover s - K outputs (K from
   * the receiver policy), at most until `acknowledgmentDeadlineAt` (ms epoch,
   * the attempt's own deadline) and never past cancellation; then the attempt
   * ends as ACKNOWLEDGMENT_OVERDUE and its stages close.
   */
  async function execute({ identity, tokenIds, generation, grants, maxTokens, signal, onDelta = () => {}, onActivity = () => {}, onStep = null,
    charge = null, onOutput = null, acknowledgmentDeadlineAt = null }) {
    assert(!closed, 'Partition runner is closed');
    signal?.throwIfAborted();
    assert((charge === null || charge && typeof charge === 'object' && !Array.isArray(charge))
      && (onOutput === null || typeof onOutput === 'function' && charge !== null), 'Output acknowledgments need the attempt charge binding');
    assert(charge === null || Number.isFinite(acknowledgmentDeadlineAt), 'A charged attempt needs its acknowledgment deadline');
    // Freeze caller-owned request data before asynchronous plan validation.
    ({ identity, tokenIds, generation, grants, charge } = clone({ identity, tokenIds, generation, grants, charge }));
    await validatePartitionRoute(runtime, plan, route);
    assert(!closed, 'Partition runner is closed');
    signal?.throwIfAborted();
    const binding = canonicalRouteAttemptBinding(identity);
    assert(same(binding.route, route), 'Attempt does not bind this complete ordered route');
    assert(Array.isArray(tokenIds) && tokenIds.length > 0 && tokenIds.length <= policy.maxPromptTokens
      && tokenIds.every(id => Number.isSafeInteger(id) && id >= 0 && id < plan.vocabSize), 'Invalid ordered prompt allocation');
    assert(positive(maxTokens) && maxTokens <= policy.maxTokens && generation?.maxTokens === maxTokens,
      'Invalid ordered generation allocation');
    assert(typeof onDelta === 'function' && typeof onActivity === 'function'
      && (onStep === null || typeof onStep === 'function'), 'Output delivery callback required');
    assert(grants && ['execution', 'tokenContext'].every(key => Array.isArray(grants[key])
      && grants[key].length === devices.length && grants[key].every(value => value && typeof value === 'object'))
      && Array.isArray(grants.activation) && grants.activation.length === devices.length - 1
      && grants.activation.every(value => value && typeof value === 'object') && grants.output,
    'Grants for every stage, adjacent edge and final output required');
    assert(!attempts.has(binding.attemptId), 'Attempt already used; replacement requires a fresh authorized attempt');
    // The route's attempt history and concurrent slots (unsettled cleanup keeps its slot) are capacity.
    assertCapacity(attempts.size < policy.maxAttempts);
    assertCapacity([...attempts.values()].filter(item => item.running || item.owned.size).length < policy.maxConcurrentAttempts);
    const authority = freeze(clone(grants)), settings = freeze(clone(generation));
    const coordinatorId = route.stages[0].participantId;
    const recipients = (...ids) => [...new Set(ids)];
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const receipt = { identity: binding, phase: 'admitting', reservations: [], cleanup: [], cleanupSettledAt: null, failure: null };
    const completion = Promise.withResolvers();
    const item = { binding, controller, receipt, owned: new Set(), lost: new Set(), running: true, settled: completion.promise,
      outcome: 'completed', cleaning: null, acknowledging: Promise.resolve(), acknowledged: null, waiters: new Set() };
    if (charge) receipt.acknowledgments = { bound: MAX_UNACKNOWLEDGED_OUTPUTS, waits: 0, waitedMs: 0 };
    const acknowledgedCount = () => item.acknowledged?.acknowledgment.count ?? 0;
    // Keep only a newer acknowledgment of this attempt's outputs; stages and the service verify signatures.
    const accept = pair => {
      const ack = pair?.acknowledgment;
      if (ack?.attemptId === binding.attemptId && Number.isSafeInteger(ack.count) && ack.count > acknowledgedCount()
        && pair.receipt?.output?.count === ack.count) item.acknowledged = clone(pair);
      for (const waiter of item.waiters) if (acknowledgedCount() >= waiter.target) waiter.done(null);
    };
    // Backpressure: the next step waits for the requester, bounded by the deadline and cancellation.
    const awaitAcknowledged = target => new Promise((resolve, reject) => {
      if (acknowledgedCount() >= target) { resolve(); return; }
      const started = performance.now();
      const waiter = { target, done: error => {
        clearTimeout(timer); combined.removeEventListener('abort', aborted); item.waiters.delete(waiter);
        receipt.acknowledgments.waits += 1; receipt.acknowledgments.waitedMs += performance.now() - started;
        if (error) reject(error); else resolve();
      } };
      const aborted = () => waiter.done(combined.reason ?? new Error('Ordered attempt cancelled'));
      const timer = setTimeout(() => waiter.done(acknowledgmentOverdue()), Math.max(0, acknowledgmentDeadlineAt - Date.now()));
      item.waiters.add(waiter); combined.addEventListener('abort', aborted, { once: true });
      if (combined.aborted) aborted();
    });
    const requestAcknowledgment = record => {
      if (!onOutput) return;
      item.acknowledging = item.acknowledging.then(() => onOutput(clone(record))).then(accept, () => {});
    };
    attempts.set(binding.attemptId, item);
    let input = [...tokenIds], position = 0, content = '', logits = null, stopReason = 'length', activationBytes = 0;
    const continuations = devices.map(() => null), outputTokens = [], steps = [];
    const activityStages = devices.map((_, partitionIndex) => ({partitionIndex,steps:0,stepMs:{count:0,total:0}}));
    let failure;
    const permit = async (action, grant, extra) => {
      combined.throwIfAborted();
      assert(await authorize({ action, grant, identity: binding, plan, coordinatorId, ...extra, signal: combined }) === true,
        'Ordered route authorization declined: ' + action);
      combined.throwIfAborted();
    };
    async function permitRoute(step) {
      for (let index = 0; index < devices.length; index++) {
        await permit('mesh.execute_partition_stage', authority.execution[index], { ...step, partitionIndex: index });
        await permit('mesh.transfer_token_context', authority.tokenContext[index], { ...step, partitionIndex: index,
          recipients: recipients(coordinatorId, devices[index].id) });
        if (index) await permit('mesh.transfer_intermediate_activation', authority.activation[index - 1],
          { ...step, fromStage: index - 1, toStage: index,
            recipients: recipients(devices[index - 1].id, coordinatorId, devices[index].id) });
      }
      await permit('mesh.transfer_partition_output', authority.output, { ...step, partitionIndex: devices.length - 1,
        recipients: recipients(devices.at(-1).id, coordinatorId, binding.requesterId) });
    }
    try {
      const generationDigest = await runtime.hashPartitionGeneration(settings);
      assert(/^sha256:[a-f0-9]{64}$/.test(generationDigest), 'Doppler generation digest required');
      const initial = { step: 0, tokenPosition: 0, inputTokenCount: input.length, maxTokens, generationDigest };
      await permitRoute(initial);
      // Complete route admission before any model input is disclosed. Mark an
      // owner BEFORE calling reserve: a lost acknowledgment is not a release.
      for (let index = 0; index < devices.length; index++) {
        combined.throwIfAborted();
        await permit('mesh.execute_partition_stage', authority.execution[index], { ...initial, partitionIndex: index });
        item.owned.add(index);
        const admission = await devices[index].reserve({ identity: binding, partitionIndex: index,
          inputTokenCount: input.length, maxTokens, generationDigest, generation: settings, executionGrant: authority.execution[index],
          ...(charge ? { charge } : {}), signal: combined });
        assert(sameRouteAttemptIdentity(admission?.identity, binding) && admission.partitionIndex === index
          && admission.status === 'reserved', 'Ordered reservation acknowledgment mismatch');
        receipt.reservations.push(clone(admission));
      }
      receipt.phase = 'executing';
      for (let index = 0; index < maxTokens; index++) {
        if (charge) await awaitAcknowledged(index - MAX_UNACKNOWLEDGED_OUTPUTS);
        const delivery = await (async () => {
          combined.throwIfAborted();
          const step = { step: index, tokenPosition: position, inputTokenCount: input.length, maxTokens, generationDigest };
          await permitRoute(step);
          let activation, final;
          const stageMetrics = [];
          for (let stage = 0; stage < devices.length; stage++) {
            let elapsedMs;
            const result = await lease(stage, async () => {
              // Recheck authority after queueing, immediately before disclosure.
              await permit('mesh.execute_partition_stage', authority.execution[stage], { ...step, partitionIndex: stage });
              await permit('mesh.transfer_token_context', authority.tokenContext[stage], { ...step, partitionIndex: stage,
                recipients: recipients(coordinatorId, devices[stage].id) });
              const started = performance.now();
              const output = clone(await devices[stage].executeStage({ identity: binding, partitionIndex: stage, ...step,
                inputTokenIds: [...input], generation: settings, continuation: continuations[stage], activation,
                executionGrant: authority.execution[stage], tokenContextGrant: authority.tokenContext[stage],
                ...(stage > 0 ? { incomingActivationGrant: authority.activation[stage - 1] } : {}),
                ...(stage < devices.length - 1 ? { outgoingActivationGrant: authority.activation[stage] } : {}),
                ...(stage === devices.length - 1 ? { outputGrant: authority.output } : {}),
                ...(item.acknowledged ? { acknowledged: item.acknowledged } : {}),
                signal: combined }));
              elapsedMs = performance.now() - started;
              return output;
            });
            combined.throwIfAborted();
            assert(sameRouteAttemptIdentity(result?.identity, binding) && result.partitionIndex === stage
              && result.step === index && result.tokenPosition === position, 'Ordered stage result binding mismatch');
            continuations[stage] = result.continuation;
            stageMetrics.push({ partitionIndex: stage, elapsedMs, metrics: result.metrics ?? null });
            if (stage === devices.length - 1) { final = result; break; }
            assert(!('tokenId' in result) && !('delta' in result), 'Only final stage may sample or publish tokens');
            const tensor = result.activationTensor;
            assert(matchingPartitionActivation(tensor, tensorContract) && same(tensor.shape, [1, input.length, plan.hiddenSize])
              && tensor.seqOffset === position && tensor.step === index && tensor.data?.byteLength <= policy.maxActivationBytes,
            'Ordered activation shape or allocation mismatch');
            const metadata = { identity: binding, ...step, fromStage: stage, toStage: stage + 1,
              from: devices[stage].id, to: devices[stage + 1].id, coordinatorId,
              recipients: recipients(devices[stage].id, coordinatorId, devices[stage + 1].id) };
            const frame = runtime.serializeActivationFrame({ ...tensor, metadata });
            assert(frame.byteLength <= policy.maxActivationBytes, 'Ordered activation exceeds allocation');
            runtime.validateActivationFrameForPlan(frame, plan);
            const sent = clone(frame);
            await permit('mesh.transfer_intermediate_activation', authority.activation[stage], metadata);
            const received = clone(await transport.transferActivation(frame, { identity: binding, ...step,
              fromStage: stage, toStage: stage + 1, coordinatorId,
              recipients: metadata.recipients, signal: combined }));
            combined.throwIfAborted();
            assert(received && same(received.metadata, metadata) && received.buffer instanceof ArrayBuffer
              && received.byteLength === sent.byteLength && received.buffer.byteLength === sent.buffer.byteLength
              && same(received.shape, sent.shape) && received.step === sent.step && received.seqOffset === sent.seqOffset,
            'Ordered activation edge binding mismatch');
            const receivedBytes = new Uint8Array(received.buffer);
            assert(new Uint8Array(sent.buffer).every((byte, offset) => byte === receivedBytes[offset]),
              'Ordered activation bytes differ');
            activation = runtime.validateActivationFrameForPlan(received, plan);
            activationBytes += sent.byteLength;
          }
          assert(final && Number.isSafeInteger(final.tokenId) && final.tokenId >= 0 && final.tokenId < plan.vocabSize
            && typeof final.delta === 'string' && typeof final.done === 'boolean'
            && !('tokenIds' in final) && !('content' in final), 'Final stage must return one selected token');
          assert(content.length + final.delta.length <= policy.maxOutputCharacters, 'Ordered output allocation exceeded');
          assert(!final.done || typeof final.stopReason === 'string' && final.stopReason.length > 0,
            'Final stage stopping reason required');
          assert(index + 1 < maxTokens || final.done, 'Final stage must finalize decoding at token limit');
          await permit('mesh.transfer_partition_output', authority.output, { ...step, partitionIndex: devices.length - 1,
        recipients: recipients(devices.at(-1).id, coordinatorId, binding.requesterId) });
          content += final.delta;
          outputTokens.push(final.tokenId);
          logits = final.logits == null ? null : clone(final.logits);
          steps.push({ ...step, tokenId: final.tokenId, stages: stageMetrics });
          position += input.length;
          input = [final.tokenId];
          if (final.done) stopReason = final.stopReason;
          return { delta: final.delta, done: final.done, receipt: final.receipt ?? null, step: { sequence: index, tokenPosition: step.tokenPosition,
            inputTokenCount: step.inputTokenCount, tokenId: final.tokenId, delta: final.delta, done: final.done,
            stopReason: final.done ? final.stopReason : null } };
        })();
        combined.throwIfAborted();
        requestAcknowledgment({ step: index, delta: delivery.delta, done: delivery.done, receipt: delivery.receipt });
        // Durable requester publication precedes activity, delivery and the next
        // step; it holds no stage lease, so other conversations keep advancing.
        if (onStep) { await onStep(clone(delivery.step)); combined.throwIfAborted(); }
        for (const stage of steps.at(-1).stages) {
          const row = activityStages[stage.partitionIndex];
          row.steps++; row.stepMs.count++; row.stepMs.total += stage.elapsedMs;
        }
        await onActivity({ schema: 'reploid.partition-activity/v1', identity: clone(binding), sequence: index,
          stepSummary: {count:index + 1,stages:clone(activityStages)} });
        combined.throwIfAborted();
        if (delivery.delta) await onDelta(delivery.delta);
        combined.throwIfAborted();
        if (delivery.done) break;
      }
      return { content, tokenIds: outputTokens, logits, stopReason,
        execution: { schema: 'reploid.mesh.partition-execution/v3', identity: binding, activationBytes, steps, stopReason, settlement: receipt } };
    } catch (error) {
      failure = error;
      item.outcome = combined.aborted ? 'cancelled' : 'failed';
      receipt.failure = String(error?.message || error);
      throw error;
    } finally {
      try { await cleanup(item); }
      catch (error) {
        // Report a disconnected contributor as such when loss is the only reason
        // cleanup is unconfirmed; any retryable cleanup failure keeps CLEANUP_FAILED.
        const lost = error.code === 'CONNECTION_LOST';
        throw Object.assign(new AggregateError(failure ? [failure, error] : [error],
          lost ? failureMessages.CONNECTION_LOST : 'Ordered route cleanup remains unsettled'), { code: lost ? 'CONNECTION_LOST' : 'CLEANUP_FAILED' }); }
      finally { item.running = false; completion.resolve(); }
    }
  }
  return Object.freeze({ plan, route, execute,
    getState: () => ({ closed, active: [...attempts.values()].filter(item => item.running).length,
      unsettled: [...attempts.values()].filter(item => !item.running && item.owned.size).length,
      unknown: [...attempts.values()].filter(item => item.lost.size).length,
      attempts: clone([...attempts.values()].map(item => item.receipt)) }),
    async retryCleanup(attemptId) {
      const item = attempts.get(attemptId);
      assert(item && !item.running, 'Only a finished attempt may retry cleanup');
      await cleanup(item);
    },
    async close() {
      closed = true;
      const pending = [...attempts.values()].filter(item => item.running);
      for (const item of pending) item.controller.abort(new Error('Partition runner closed'));
      await Promise.all(pending.map(item => item.settled));
      const unsettled = [...attempts.values()].filter(item => item.owned.size);
      const results = await Promise.allSettled(unsettled.map(cleanup));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw Object.assign(new AggregateError(errors, 'Ordered route close remains unsettled'), { code: 'CLEANUP_FAILED' });
    }
  });
}
