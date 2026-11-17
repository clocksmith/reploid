// Exercise the loaded model's ordinary path; the caller retains unload ownership.
import assert from 'node:assert/strict';
import { runNativeCompleteRequest } from './native-complete-request.js';
import { inspectCompleteOutput } from './peers/pooled/complete-output.js';

export async function runNativeCompleteLifecycle({ model, workload, generation, timeoutMs,
  gpuCapBytes, settle, memory, sourceReceipts }) {
  assert(Number.isSafeInteger(gpuCapBytes) && gpuCapBytes > 0, 'Explicit GPU allocation cap required');
  assert([settle, memory, sourceReceipts].every(port => typeof port === 'function'), 'Lifecycle observation ports required');
  workload = structuredClone(workload);
  generation = structuredClone(generation);
  assert(workload.maxNew === generation.maxTokens && workload.maxNew >= 2, 'Matched multi-token lifecycle workload required');
  const request = { model, prompt: workload.prompt, promptIds: workload.promptIds, generation, timeoutMs };
  const phases = [];
  let baseline;
  async function capture(name) {
    await settle();
    const snapshot = structuredClone(memory());
    const sources = structuredClone(await sourceReceipts());
    const device = snapshot.device, pool = snapshot.pool;
    assert(device.maxBytes === gpuCapBytes && device.peakBytes <= gpuCapBytes && device.rejected === 0,
      'Full-model lifecycle exceeded its frozen GPU allocation cap');
    assert(Number.isSafeInteger(pool.reuses) && pool.reuses >= 0, 'Missing buffer reuse observations');
    assert(Number.isSafeInteger(pool.resources.active.bytes) && pool.resources.active.bytes >= 0,
      'Missing active-buffer ownership');
    assert.equal(pool.resources.deferredCleanup.bytes, 0, 'Submitted cleanup did not settle');
    if (baseline) assert(pool.resources.active.bytes <= baseline.memory.pool.resources.active.bytes,
      'Request left additional active buffers after settlement');
    assert(sources.length > 0, 'Authenticated source observations required');
    for (const source of sources) {
      assert(!source.receiptFailure, 'Authenticated source receipt failed');
      assert.equal(source.generic.activeReadBytes, 0, 'Authenticated source reads did not settle');
      if (source.gather) assert.equal(source.gather.activeReadBytes, 0, 'Gather reads did not settle');
    }
    const phase = { name, memory: snapshot, sources };
    phases.push(phase);
    return phase;
  }
  const first = await runNativeCompleteRequest(request);
  const expected = inspectCompleteOutput(first, workload, 'native');
  assert(expected.completionIds.length >= 2, 'Lifecycle workload must continue beyond its first token');
  baseline = await capture('first-complete-request');
  const repeat = await runNativeCompleteRequest(request);
  assert.deepEqual(inspectCompleteOutput(repeat, workload, 'native'), expected, 'Repeated full-model output changed');
  await capture('repeated-complete-request');

  const before = new AbortController();
  before.abort(new Error('Full-model lifecycle: pre-aborted request'));
  await assert.rejects(runNativeCompleteRequest({ ...request, signal: before.signal }), error => error === before.signal.reason);
  await capture('pre-aborted-request');

  const active = new AbortController();
  let observedTokens = 0;
  await assert.rejects(runNativeCompleteRequest({ ...request, signal: active.signal, onToken() {
    observedTokens++;
    active.abort(new Error('Full-model lifecycle: cancel after first token'));
  } }), error => error === active.signal.reason);
  assert.equal(observedTokens, 1, 'Active cancellation must follow exactly one observed token');
  await capture('active-cancellation-settled');

  const recovered = await runNativeCompleteRequest(request);
  assert.deepEqual(inspectCompleteOutput(recovered, workload, 'native'), expected, 'Output changed after active cancellation');
  const final = await capture('recovered-complete-request');
  assert(final.memory.pool.reuses > baseline.memory.pool.reuses, 'No buffer reuse observed on repeated model requests');
  return { schema: 'reploid.native-complete-lifecycle/v1', phases, first, repeat, recovered, observedTokens,
    scope: 'Loaded-model repeatability, cancellation, reuse and settled reads; caller must separately verify reference correctness and final unload/process exit' };
}
