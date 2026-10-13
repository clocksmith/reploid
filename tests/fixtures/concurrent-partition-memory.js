import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Fixture deadlines do not change the application's 300-second execution policy.
export const CONCURRENT_DEADLINES = Object.freeze({ operationMs: 300000,
  cleanupMs: 10000, observationMs: 2000, sampleMs: 1000 });

export function createConcurrentOperationObserver({ evidence, persist,
  deadlines = CONCURRENT_DEADLINES }) {
  for (const key of Object.keys(CONCURRENT_DEADLINES)) {
    assert(Number.isSafeInteger(deadlines[key]) && deadlines[key] > 0, `Invalid ${key}`);
  }
  assert(deadlines.operationMs <= CONCURRENT_DEADLINES.operationMs, 'Application deadline cannot expand');
  evidence.deadlines = { ...deadlines };
  evidence.operations ||= [];
  const bounded = (promise, milliseconds, label) => {
    let timer;
    return Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`${label} exceeded ${milliseconds}ms; completion and ownership unknown`);
        error.name = 'DiagnosticDeadlineError';
        reject(error);
      }, milliseconds);
    })]).finally(() => clearTimeout(timer));
  };
  return async (page, label, callback, argument, cleanup = false, observe = true) => {
    const row = { label, startedAt: new Date().toISOString(), status: 'pending', samples: [], droppedSamples: 0 };
    evidence.operations.push(row);
    // Retain bounded recent history; failed operations are never dropped.
    if (evidence.operations.length > 128) {
      const index = evidence.operations.findIndex(item => item.status === 'completed');
      if (index >= 0) { evidence.operations.splice(index, 1); evidence.droppedOperations = (evidence.droppedOperations || 0) + 1; }
    }
    let stopped = false, timer, primaryFailure, sampling = Promise.resolve();
    const persistenceFailure = (phase, error) => {
      (row.persistenceFailures ||= []).push({ phase, message: error.message });
    };
    const sample = async () => {
      try {
        const snapshot = await bounded(page.evaluate(() => globalThis.memorySnapshot?.()),
          deadlines.observationMs, `${label} observation`);
        if (!stopped) row.samples.push({ at: new Date().toISOString(), snapshot });
      } catch (error) {
        if (!stopped) row.samples.push({ at: new Date().toISOString(), error: error.message });
      }
      if (!stopped) {
        if (row.samples.length > 32) { row.samples.shift(); row.droppedSamples++; }
        try { await persist(); }
        catch (error) { persistenceFailure('sample', error); }
        timer = setTimeout(() => { sampling = sample(); }, deadlines.sampleMs);
      }
    };
    await persist();
    sampling = observe ? sample() : Promise.resolve();
    try {
      const result = await bounded(Promise.resolve().then(() => page.evaluate(callback, argument)),
        cleanup ? deadlines.cleanupMs : deadlines.operationMs, label);
      row.status = 'completed';
      return result;
    } catch (error) {
      primaryFailure = error;
      row.status = error.name === 'DiagnosticDeadlineError' ? 'timed-out' : 'rejected';
      row.error = { name: error.name, message: error.message };
      row.ownership = 'unknown';
      throw error;
    } finally {
      stopped = true;
      clearTimeout(timer);
      await sampling;
      row.finishedAt = new Date().toISOString();
      try { await persist(); }
      catch (error) { persistenceFailure('final', error); }
      if (!primaryFailure && row.persistenceFailures?.length) {
        row.status = 'observation-failed';
        throw new Error(`Observation persistence failed: ${row.persistenceFailures[0].message}`);
      }
    }
  };
}

/** Interleave real resident attempts; never imply simultaneous GPU kernels. */
export async function runConcurrentPartitionMemory({ pages, pageA, pageB, request,
  generation, planId, runs, persist, onProgress = () => {}, operation, prefillObservationOnly = false }) {
  assert.equal(typeof prefillObservationOnly, 'boolean', 'Explicit prefill observation selector required');
  const evaluate = operation || createConcurrentOperationObserver({ evidence: {}, persist });
  const snapshot = () => Promise.all(pages.map((page, index) => evaluate(page, `settle-memory-${index}`, () => settleMemory(), undefined, true)));
  const checkMemory = snapshots => {
    for (const item of snapshots) {
      assert.deepEqual(item.gpuValidationErrors, [], 'Rejected GPU submission');
      assert.equal(item.device.maxBytes, 1420000000, 'Executor allocation policy changed');
      assert(item.device.liveBytes <= 1420000000, 'Executor allocation ceiling exceeded');
      assert(item.device.peakBytes <= 1420000000, 'Peak executor allocation ceiling exceeded');
      assert.deepEqual(item.deviceEvents, [], 'Executor device event was observed');
      assert.deepEqual(item.observationErrors, [], 'Executor memory observation failed');
    }
  };
  const open = async name => {
    const identity = { modelId: request.model.id, modelIdentity: request.model.identity,
      planId, participantA: 'memory-A', participantB: 'memory-B',
      threadId: `memory-${name}`, attemptId: `memory-${name}` };
    const row = { name, identity, generation, text: '', tokenIds: [], steps: 0,
      before: await snapshot(), inputTokens: null, completed: false, closed: false };
    runs.push(row);
    const tokenized = await evaluate(pageA, `${name}:tokenize`, ({ identity, messages }) => resident.tokenize({
      identity, messages, signal: new AbortController().signal }), { identity, messages: request.messages });
    row.inputTokens = tokenized.tokenIds.length;
    assert.equal(row.inputTokens, 1588, 'Frozen long prompt changed');
    return { row, ids: tokenized.tokenIds, position: 0, aContinuation: null, bContinuation: null };
  };
  const close = async state => {
    if (state.row.closed) return;
    const results = await Promise.allSettled(pages.map((page, index) => evaluate(page, `${state.row.name}:close-${index}`,
      identity => resident.closeAttempt({ identity }), state.row.identity, true)));
    state.row.closeResults = results.map(result => result.status === 'fulfilled'
      ? { settled: true } : { settled: false, error: String(result.reason) });
    state.row.after = await snapshot();
    checkMemory(state.row.after);
    state.row.closed = results.every(result => result.status === 'fulfilled');
    await persist();
    assert(state.row.closed, 'Attempt close failed; ownership remains unqualified');
  };
  const step = async (state, cancel = false) => {
    const { row } = state;
    assert(!row.completed && !row.closed && row.steps < generation.maxTokens);
    const parameters = { identity: row.identity, step: row.steps, tokenPosition: state.position,
      inputTokenCount: state.ids.length, generation, maxTokens: generation.maxTokens };
    const a = await evaluate(pageA, `${row.name}:step-${row.steps}:group-0`, async ({ parameters, ids, continuation, cancel }) => {
      observePrefill = parameters.step === 0;
      const controller = new AbortController();
      if (cancel) abortOnSubmit = controller;
      try {
        const value = await resident.executeGroup0({ ...parameters, tokenIds: ids,
          continuation, signal: controller.signal });
        return { activation: { ...value.activationTensor, data: encodeBytes(value.activationTensor.data) },
          continuation: value.continuation, cancellationSubmitted: cancel && controller.signal.aborted };
      } catch (error) {
        if (!cancel) throw error;
        return { cancelled: controller.signal.aborted && abortOnSubmit === null,
          error: { name: error.name, message: error.message } };
      } finally {
        if (abortOnSubmit === controller) abortOnSubmit = null;
      }
    }, { parameters, ids: state.ids, continuation: state.aContinuation, cancel });
    if (cancel) {
      row.cancellation = { requestedStep: row.steps, ...a };
      assert(a.cancelled && a.error?.name === 'AbortError',
        'Submitted cancellation must reject the selected attempt');
      row.cancelled = true;
      await persist();
      return;
    }
    if (prefillObservationOnly) {
      assert.equal(row.steps, 0, 'Prefill observation cannot decode');
      const { data, ...metadata } = a.activation;
      const bytes = Buffer.from(data, 'base64');
      row.prefillObservation = { scope: 'Group0 first activation only; no decode or concurrency qualification',
        activation: metadata, byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'), continuation: a.continuation };
      await persist();
      return;
    }
    const b = await evaluate(pageB, `${row.name}:step-${row.steps}:group-1`, async ({ parameters, ids, activation, continuation }) => {
      observePrefill = parameters.step === 0;
      const value = await resident.executeGroup1({ ...parameters, inputTokenIds: ids,
        activation: { ...activation, tensorData: Uint8Array.from(atob(activation.data), c => c.charCodeAt(0)).buffer },
        continuation, signal: new AbortController().signal });
      return { tokenId: value.tokenId, delta: value.delta, done: value.done,
        stopReason: value.stopReason, continuation: value.continuation };
    }, { parameters, ids: state.ids, activation: a.activation, continuation: state.bContinuation });
    row.steps++;
    row.text += b.delta;
    row.tokenIds.push(b.tokenId);
    row.stopReason = b.stopReason;
    row.completed = b.done;
    state.position += state.ids.length;
    state.ids = [b.tokenId];
    state.aContinuation = a.continuation;
    state.bContinuation = b.continuation;
    if (row.steps % 128 === 0 || b.done) {
      checkMemory(await snapshot());
      onProgress({ name: row.name, step: row.steps, done: b.done });
      await persist();
    }
  };
  const finish = async state => {
    while (!state.row.completed && state.row.steps < generation.maxTokens) await step(state);
    assert(state.row.completed, 'Attempt did not complete within the unchanged allowance');
    assert.equal(state.row.stopReason, 'eos-token', 'Output allowance is not natural completion');
  };
  const states = [];
  let failure;
  try {
    const baseline = await open('concurrent-baseline'); states.push(baseline);
    if (prefillObservationOnly) await step(baseline);
    else await finish(baseline);
    await close(baseline);
    if (!prefillObservationOnly) {
    const cancelled = await open('concurrent-cancelled'); states.push(cancelled);
    const survivor = await open('concurrent-survivor'); states.push(survivor);
    // Both full prompts and one decode step materialize before interruption.
    for (let round = 0; round < 2; round++) {
      await step(cancelled);
      await step(survivor);
    }
    assert(!cancelled.row.completed && !survivor.row.completed, 'Two live long attempts required');
    survivor.row.duringOverlap = await snapshot();
    checkMemory(survivor.row.duringOverlap);
    survivor.row.allocationRejections = [];
    for (const page of pages) survivor.row.allocationRejections.push(
      await evaluate(page, 'allocation-rejection', () => rejectOversizedAllocation()));
    const partial = cancelled.row.text;
    await step(cancelled, true);
    await close(cancelled);
    survivor.row.afterOtherCancellation = await snapshot();
    checkMemory(survivor.row.afterOtherCancellation);
    for (const [index, item] of survivor.row.afterOtherCancellation.entries()) {
      const weightBytes = baseline.row.after[index].device.categories.weights;
      assert(weightBytes > 0, 'Baseline attempt must retain resident weights');
      assert.equal(item.device.categories.weights, weightBytes, 'Cancellation changed resident weights');
    }
    await finish(survivor);
    assert.equal(cancelled.row.text, partial, 'Cancelled partial changed');
    assert.equal(survivor.row.text, baseline.row.text, 'Surviving answer changed');
    assert.deepEqual(survivor.row.tokenIds, baseline.row.tokenIds, 'Surviving token sequence changed');
    await close(survivor);
    const retry = await open('concurrent-retry'); states.push(retry);
    await finish(retry);
    assert.equal(retry.row.text, baseline.row.text, 'Fresh retry changed the answer');
    assert.deepEqual(retry.row.tokenIds, baseline.row.tokenIds, 'Fresh retry changed tokens');
    await close(retry);
    }
  } catch (error) {
    failure = error;
  } finally {
    // Always attempt every close, even if a different owner fails settlement.
    for (const state of states) {
      try { await close(state); }
      catch (error) { failure ||= error; }
    }
    await persist();
  }
  if (failure) throw failure;
}
