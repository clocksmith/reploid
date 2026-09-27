/** Coordinates one Doppler token step through both partitions. No model math lives here. */
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const positive = value => Number.isSafeInteger(value) && value > 0;
const snapshot = value => structuredClone(value);

function freezeRecord(value) {
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object') freezeRecord(child);
  }
  return Object.freeze(value);
}

function checkTokens(tokens, vocabSize) {
  assert(Array.isArray(tokens) && tokens.length > 0
    && tokens.every(token => Number.isSafeInteger(token) && token >= 0 && token < vocabSize),
  'tokenIds must contain valid Doppler vocabulary IDs');
}

function sameBinding(actual, expected) {
  return actual && Object.entries(expected).every(([key, value]) => actual[key] === value);
}

/**
 * Device ports are authenticated local/remote Doppler session facades. Each call
 * performs exactly one prefill/decode step, never an independent generation.
 * The host authorizer verifies grants against live identities/revocation state.
 * This coordinator cannot verify physical execution or manufacture that proof.
 */
export function createLayerPartitionRunner({ runtime, plan: suppliedPlan, deviceA, deviceB,
  transport, authorize, limits }) {
  assert(runtime && typeof runtime.LAYER_PARTITION_SCHEMA === 'string'
    && typeof runtime.ACTIVATION_TENSOR_SCHEMA === 'string'
    && typeof runtime.serializeActivationFrame === 'function'
    && typeof runtime.deserializeActivationFrame === 'function', 'Doppler partition runtime required');
  assert(suppliedPlan?.schema === runtime.LAYER_PARTITION_SCHEMA, 'Valid Doppler layer partition plan required');
  const plan = freezeRecord(snapshot(suppliedPlan));
  assert(identifier(plan.modelId) && positive(plan.vocabSize) && positive(plan.hiddenSize) && positive(plan.totalLayers)
    && positive(plan.splitLayer) && plan.splitLayer < plan.totalLayers
    && ['f16', 'f32'].includes(plan.activationDtype), 'Invalid Doppler partition dimensions');
  assert(typeof authorize === 'function', 'A verifying host authorization port is required');
  for (const [device, method] of [[deviceA, 'executeGroup0'], [deviceB, typeof deviceB?.executeFrame === 'function' ? 'executeFrame' : 'executeGroup1']]) {
    assert(identifier(device?.id) && typeof device[method] === 'function'
      && typeof device.closeAttempt === 'function', 'Partition device identity, execution and settlement ports required');
  }
  assert(deviceA.id !== deviceB.id, 'Partition participants must be distinct');
  assert(typeof deviceB.executeFrame === 'function' || typeof transport?.transferActivation === 'function', 'Activation transport required');
  assert(limits && ['maxTokens', 'maxPromptTokens', 'maxActivationBytes', 'maxOutputCharacters', 'maxAttempts', 'maxConcurrentAttempts']
    .every(key => positive(limits[key])), 'Explicit positive partition allocation limits required');
  const policy = Object.freeze({ ...limits });
  const participants = Object.freeze([deviceA.id, deviceB.id]);
  const usedAttempts = new Set();
  const active = new Map();
  let closed = false;
  // FIFO token leases let two conversations share resident weights fairly.
  let tail = Promise.resolve();
  const lease = async task => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await task(); } finally { release(); }
  };

  async function execute({ tokenIds, identity, grants, maxTokens, signal, onDelta = () => {} }) {
    assert(!closed, 'Partition runner is closed');
    signal?.throwIfAborted();
    checkTokens(tokenIds, plan.vocabSize);
    assert(tokenIds.length <= policy.maxPromptTokens, 'Prompt exceeds partition allocation');
    assert(positive(maxTokens) && maxTokens <= policy.maxTokens, 'Invalid partition output allocation');
    assert(identity && ['modelIdentity', 'planId', 'threadId', 'attemptId'].every(key => identifier(identity[key])),
      'Exact model, plan, thread and attempt identities required');
    assert(/^sha256:[a-f0-9]{64}$/.test(identity.modelIdentity), 'Pinned model digest required');
    assert(grants?.executionA && grants?.executionB && grants?.activation && grants?.output,
      'Execution, intermediate disclosure and output grants are required');
    assert(typeof onDelta === 'function', 'onDelta must be a function');
    const binding = Object.freeze({ modelId: plan.modelId, modelIdentity: identity.modelIdentity,
      planId: identity.planId, threadId: identity.threadId, attemptId: identity.attemptId,
      participantA: participants[0], participantB: participants[1] });
    const authority = freezeRecord(snapshot(grants));
    assert(!usedAttempts.has(binding.attemptId), 'Attempt already used; resume requires a supported checkpoint');
    assert(usedAttempts.size < policy.maxAttempts, 'Partition runner attempt budget exhausted');
    assert(active.size < policy.maxConcurrentAttempts, 'Partition concurrency budget exhausted');
    usedAttempts.add(binding.attemptId);
    const controller = new AbortController();
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let settle;
    const settled = new Promise(resolve => { settle = resolve; });
    active.set(binding.attemptId, { controller, settled });
    let input = [...tokenIds], continuationA = null, continuationB = null;
    let content = '', activationBytes = 0, position = 0, logits = null;
    let stopReason = 'length', failure = null;
    const outputTokens = [];
    const steps = [];
    const permit = async (action, grant, step) => {
      combined.throwIfAborted();
      assert(await authorize({ action, grant, plan, ...binding, ...step, signal: combined }) === true,
        'Partition authorization declined: ' + action);
      combined.throwIfAborted();
    };
    try {
      for (let index = 0; index < maxTokens; index++) {
        const terminal = await lease(async () => {
          combined.throwIfAborted();
          const step = Object.freeze({ step: index, tokenPosition: position, inputTokenCount: input.length, maxTokens });
          const started = performance.now();
          // Both execution recipients must be eligible before exposing any input.
          await permit('mesh.execute_partition_a', authority.executionA, step);
          await permit('mesh.execute_partition_b', authority.executionB, step);
          await permit('mesh.transfer_intermediate_activation', authority.activation, step);
          await permit('mesh.transfer_partition_output', authority.output, step);
          const resultA = snapshot(await deviceA.executeGroup0({ tokenIds: [...input], continuation: continuationA,
            identity: binding, executionGrant: authority.executionA, ...step, signal: combined }));
          combined.throwIfAborted();
          const tensor = resultA?.activationTensor;
          assert(tensor && tensor.dtype === plan.activationDtype && tensor.shape?.length === 3
            && tensor.shape[0] === 1 && tensor.shape[1] === input.length && tensor.shape[2] === plan.hiddenSize
            && tensor.seqOffset === position && tensor.step === index, 'Partition A activation contract mismatch');
          assert(tensor.data?.byteLength <= policy.maxActivationBytes, 'Activation exceeds transfer allocation');
          const metadata = { ...binding, ...step, from: participants[0], to: participants[1] };
          const frame = runtime.serializeActivationFrame({ ...tensor, metadata });
          assert(frame.byteLength <= policy.maxActivationBytes, 'Activation exceeds transfer allocation');
          // Retain bytes separately: a transport cannot mutate the comparison baseline.
          const sent = snapshot(frame);
          await permit('mesh.transfer_intermediate_activation', authority.activation, step);
          const transferStarted = performance.now();
          let resultB, transferMs = null, remoteStepMs = null;
          if (typeof deviceB.executeFrame === 'function') {
            await permit('mesh.execute_partition_b', authority.executionB, step);
            resultB = snapshot(await deviceB.executeFrame({ frame, continuation: continuationB,
              identity: binding, executionGrant: authority.executionB, outputGrant: authority.output,
              ...step, signal: combined }));
            // Includes remote compute and disclosure; never label this as network-only latency.
            remoteStepMs = performance.now() - transferStarted;
          } else {
            const received = snapshot(await transport.transferActivation(frame, { identity: binding, ...step, signal: combined }));
            combined.throwIfAborted();
            transferMs = performance.now() - transferStarted;
            assert(received?.schema === runtime.ACTIVATION_TENSOR_SCHEMA
              && sameBinding(received.metadata, metadata) && received.seqOffset === position
              && received.step === index && received.dtype === sent.dtype
              && JSON.stringify(received.shape) === JSON.stringify(sent.shape)
              && received.byteLength === sent.byteLength && received.buffer instanceof ArrayBuffer
              && received.buffer.byteLength === sent.byteLength, 'Received activation identity or shape mismatch');
            const before = new Uint8Array(sent.buffer), after = new Uint8Array(received.buffer);
            assert(before.every((byte, offset) => byte === after[offset]), 'Received activation bytes differ');
            await permit('mesh.execute_partition_b', authority.executionB, step);
            resultB = snapshot(await deviceB.executeGroup1({ activation: runtime.deserializeActivationFrame(received),
              continuation: continuationB, identity: binding, executionGrant: authority.executionB,
              outputGrant: authority.output, ...step, signal: combined }));
          }
          combined.throwIfAborted();
          // B owns sampling, decoding and stop semantics. It must return ONE selected token.
          assert(resultB && sameBinding(resultB.identity, binding) && resultB.step === index
            && resultB.tokenPosition === position, 'Partition B response identity mismatch');
          assert(Number.isSafeInteger(resultB.tokenId) && resultB.tokenId >= 0
            && resultB.tokenId < plan.vocabSize && typeof resultB.done === 'boolean'
            && typeof resultB.delta === 'string', 'Partition B must return exactly one selected token');
          assert(!('tokenIds' in resultB) && !('content' in resultB), 'Independent generation from B is forbidden');
          assert(content.length + resultB.delta.length <= policy.maxOutputCharacters, 'Partition output exceeds allocation');
          if (resultB.done) assert(identifier(resultB.stopReason), 'Doppler stopping reason required');
          assert(index + 1 < maxTokens || resultB.done, 'Doppler must finalize decoding at the request token limit');
          await permit('mesh.transfer_partition_output', authority.output, step);
          continuationA = resultA.continuation;
          continuationB = resultB.continuation;
          logits = resultB.logits == null ? null : snapshot(resultB.logits);
          outputTokens.push(resultB.tokenId);
          content += resultB.delta;
          activationBytes += sent.byteLength;
          steps.push({ ...step, tokenId: resultB.tokenId, activationBytes: sent.byteLength,
            transferMs, remoteStepMs, elapsedMs: performance.now() - started });
          if (resultB.delta) await onDelta(resultB.delta);
          combined.throwIfAborted();
          position += input.length;
          input = [resultB.tokenId];
          if (resultB.done) stopReason = resultB.stopReason;
          return resultB.done;
        });
        if (terminal) break;
      }
      return { content, tokenIds: outputTokens, logits, stopReason,
        execution: { schema: 'reploid.mesh.partition-execution/v2', ...binding,
          placement: 'two-device-layer-partition', splitLayer: plan.splitLayer,
          activationBytes, steps } };
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      // Settle both owned attempts even when cancellation arrives during a port call.
      // Shared resident weights remain owned by the host, not this conversation.
      const results = await Promise.allSettled([deviceA, deviceB].map(device =>
        Promise.resolve().then(() => device.closeAttempt({ identity: binding }))));
      active.delete(binding.attemptId);
      settle();
      const cleanupErrors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (cleanupErrors.length) throw new AggregateError(failure ? [failure, ...cleanupErrors] : cleanupErrors,
        'Partition attempt settlement failed');
    }
  }

  return Object.freeze({ plan, execute,
    async close() {
      closed = true;
      const pending = [...active.values()];
      for (const item of pending) item.controller.abort(new Error('Partition runner closed'));
      await Promise.all(pending.map(item => item.settled));
    }
  });
}

/** Final-logit comparison only. Full acceptance additionally compares every boundary/token. */
export async function verifySplitParity({ runtime, splitRunner, referenceRunner, tokenIds,
  identity, grants, maxTokens, tolerance }) {
  assert(typeof runtime?.comparePartitionExecution === 'function', 'Doppler comparison runtime required');
  assert(Number.isFinite(tolerance) && tolerance >= 0, 'Explicit numerical tolerance required');
  const splitResult = await splitRunner.execute({ tokenIds, identity, grants, maxTokens });
  const refResult = await referenceRunner.execute({ tokenIds, maxTokens });
  assert(splitResult.logits?.length > 0 && refResult.logits?.length > 0
    && [...splitResult.logits, ...refResult.logits].every(Number.isFinite), 'Finite non-empty logits required');
  const comparison = runtime.comparePartitionExecution({ splitOutput: splitResult.logits,
    referenceOutput: refResult.logits, tolerance });
  const tokensMatch = JSON.stringify(splitResult.tokenIds) === JSON.stringify(refResult.tokenIds);
  return { ...comparison, matches: comparison.matches && tokensMatch, tokensMatch,
    splitResult, refResult, comparison };
}
