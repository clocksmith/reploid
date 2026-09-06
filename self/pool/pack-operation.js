/** Local execution/evidence bridge. This module neither sends inputs nor authorizes delegation. */
import { assertPackSession, assertPackExecutionEvidence, hashDopplerEvidence } from './executable-pack.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';
import { assertOperationLimits } from './pack-operation-policy.js';

const requireValue = (value, message) => { if (!value) throw new Error(`Pack operation: ${message}`); };
const equal = async (left, right) => await hashDopplerEvidence(left) === await hashDopplerEvidence(right);

export function snapshotPackOperationData(value, depth = 0) {
  requireValue(depth <= 64, 'observation depth exceeded');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireValue(Number.isFinite(value), 'non-finite observation'); return value; }
  requireValue(value && typeof value === 'object', 'JSON observation required');
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) value = Array.from(value);
  requireValue(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'unsupported observation object');
  return Object.freeze(Array.isArray(value)
    ? Array.from(value, (item) => snapshotPackOperationData(item, depth + 1))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, snapshotPackOperationData(item, depth + 1)])));
}

function operationAdapter(registry, operation) {
  requireValue(operation && Object.hasOwn(registry, operation.name) && registry[operation.name].version === operation.version, 'unknown operation or version');
  return registry[operation.name];
}

export async function assertPackOperationReceipt(binding, receipt, { request, output, runtimeVersion }) {
  await assertPackExecutionEvidence(binding, receipt);
  requireValue(receipt.schema === 'doppler.pack-operation-receipt/v1', 'receipt schema mismatch');
  const { receiptDigest, ...payload } = receipt;
  requireValue(receiptDigest === await hashDopplerEvidence(payload), 'receipt digest mismatch');
  requireValue(typeof runtimeVersion === 'string' && runtimeVersion.length > 0 && receipt.runtimeVersion === runtimeVersion, 'runtime version mismatch');
  requireValue(binding.requiredOperation === request.operation.name && await equal(receipt.operation, request.operation), 'receipt operation mismatch');
  requireValue(receipt.requestHash === await hashDopplerEvidence(request), 'request mismatch');
  requireValue(receipt.assignmentHash === (request.assignment === null ? null : await hashDopplerEvidence(request.assignment)), 'assignment mismatch');
  requireValue(receipt.inputHash === await hashDopplerEvidence({ input: request.input, options: request.options }), 'input mismatch');
  requireValue(receipt.outputHash === await hashDopplerEvidence(output), 'output mismatch');
  if (request.adapterSet?.length) {
    requireValue(Array.isArray(receipt.adapterReceipts) && receipt.adapterReceipts.length === request.adapterSet.length, 'adapter execution evidence required');
    for (const [index, entry] of request.adapterSet.entries()) {
      const observed = receipt.adapterReceipts[index];
      requireValue(observed.identity === entry.identity && observed.sourceDigest === entry.artifact.hash
        && observed.requestDigest === await hashDopplerEvidence(entry)
        && observed.runtimeIdentity?.schema === 'doppler.lora-execution-identity/v1'
        && /^sha256:[a-f0-9]{64}$/.test(observed.runtimeIdentity.digest), 'adapter execution identity mismatch');
    }
  } else requireValue(!receipt.adapterReceipts?.length, 'unexpected active adapter');
}

export function assertPackOperationRequest(binding, request, registry = createPackOperationRegistry()) {
  const adapter = operationAdapter(registry, request.operation);
  requireValue(request.schema === 'doppler.pack-operation-request/v1' && binding.requiredOperation === request.operation.name, 'request operation binding mismatch');
  requireValue(Object.keys(request).every((key) => ['schema', 'operation', 'input', 'options', 'assignment', 'limits', 'adapterSet'].includes(key)), 'unknown request field');
  requireValue(request.assignment === null || (request.assignment && typeof request.assignment === 'object' && !Array.isArray(request.assignment)), 'explicit assignment or null required');
  for (const key of ['maxInputBytes', 'maxOutputBytes', 'deadlineAt']) requireValue(Number.isSafeInteger(request.limits?.[key]) && request.limits[key] > 0, `${key} required`);
  assertOperationLimits(request.limits, adapter.definition);
  requireValue(new TextEncoder().encode(JSON.stringify({ input: request.input, options: request.options })).length <= request.limits.maxInputBytes, 'input byte limit exceeded');
  adapter.validateRequest(request);
}

/** Shared stream verifier for local execution and signed remote delivery. */
export async function assertPackOperationEvent({ binding, request, runtimeVersion, event,
  eventIndex, previousEventDigest, registry = createPackOperationRegistry() }) {
  const adapter = operationAdapter(registry, request.operation);
  const { eventDigest, ...payload } = event;
  requireValue(event.schema === 'doppler.pack-operation-event/v1' && ['partial', 'completed'].includes(event.status), 'event schema or status mismatch');
  requireValue(event.status !== 'partial' || adapter.definition.streaming.partial, 'operation policy forbids partial output');
  requireValue(eventDigest === await hashDopplerEvidence(payload), 'event digest mismatch');
  requireValue(event.eventIndex === eventIndex && event.previousEventDigest === previousEventDigest, 'duplicate, missing, or reordered event');
  requireValue(event.requestHash === await hashDopplerEvidence(request)
    && event.assignmentHash === (request.assignment === null ? null : await hashDopplerEvidence(request.assignment))
    && await equal(event.operation, request.operation), 'event belongs to another request');
  requireValue(new TextEncoder().encode(JSON.stringify(event.output)).length <= request.limits.maxOutputBytes, 'output byte limit exceeded');
  adapter.validateOutput(event.output, request, { completed: event.status === 'completed' });
  if (event.status === 'completed') await assertPackOperationReceipt(binding, event.receipt, { request, output: event.output, runtimeVersion });
  else requireValue(!Object.hasOwn(event, 'receipt'), 'partial output cannot carry completion evidence');
}

export async function runPackOperation({ binding: bindingInput, session, request: requestInput, runtimeVersion,
  registry = createPackOperationRegistry(), signal = null, adapterArtifactStore = null, onPartial = null, beforeExecute = null, assertCurrent = async () => {} }) {
  const binding = snapshotPackOperationData(bindingInput);
  const request = snapshotPackOperationData(requestInput);
  assertPackOperationRequest(binding, request, registry);
  const definition = operationAdapter(registry, request.operation).definition;
  requireValue(request.limits.deadlineAt - Date.now() <= definition.maximumLimits.maxJobMs, 'deadline exceeds configured operation limit');
  requireValue(typeof runtimeVersion === 'string' && runtimeVersion.length > 0, 'runtime version required');
  const current = async () => {
    signal?.throwIfAborted();
    requireValue(Date.now() < request.limits.deadlineAt, 'deadline exceeded');
    await assertCurrent();
    signal?.throwIfAborted();
    requireValue(Date.now() < request.limits.deadlineAt, 'deadline exceeded');
  };
  await current();
  await assertPackSession(binding, session);
  requireValue(typeof session.executeOperation === 'function', 'public executeOperation is required; no legacy operation fallback');
  await beforeExecute?.();
  await current();
  let previousEventDigest = null;
  let eventCount = 0;
  let streamBytes = 0;
  let completed = null;
  for await (const received of session.executeOperation(request, { signal, ...(request.adapterSet?.length ? { adapterArtifactStore } : {}) })) {
    await current();
    requireValue(!completed, 'output after completion');
    const event = snapshotPackOperationData(received);
    streamBytes += new TextEncoder().encode(JSON.stringify(event)).length;
    requireValue(eventCount < definition.maximumLimits.maxEvents && streamBytes <= definition.maximumLimits.maxStreamBytes,
      'configured operation stream limit exceeded');
    await assertPackOperationEvent({ binding, request, runtimeVersion, event, eventIndex: eventCount, previousEventDigest, registry });
    await current();
    if (event.status === 'completed') {
      completed = event;
    } else {
      await onPartial?.(event);
    }
    eventCount++;
    previousEventDigest = event.eventDigest;
  }
  // Do not expose completion until iterator cleanup and the current-attempt check finish.
  await current();
  requireValue(completed, 'stream ended without completion');
  return Object.freeze({ request, output: completed.output, receipt: completed.receipt, eventCount, finalEventDigest: previousEventDigest, completion: completed });
}

export async function assessPackOperation({ execution, reference: referenceInput, policy: policyInput, registry = createPackOperationRegistry() }) {
  const policy = snapshotPackOperationData(policyInput);
  const reference = snapshotPackOperationData(referenceInput);
  const adapter = operationAdapter(registry, execution.request.operation);
  requireValue(policy.schema === 'poolday.operation-comparison/v1' && await equal(policy.operation, execution.request.operation), 'comparison operation mismatch');
  const policyDigest = await hashDopplerEvidence(policy);
  requireValue(execution.request.assignment?.comparisonPolicyDigest === policyDigest, 'comparison policy was not frozen in the assignment');
  requireValue(policy.referenceDigest === await hashDopplerEvidence(reference), 'reference digest mismatch');
  adapter.validateOutput(reference, execution.request, { completed: true });
  adapter.validateOutput(execution.output, execution.request, { completed: true });
  const accepted = adapter.compare(execution.output, reference, policy);
  requireValue(typeof accepted === 'boolean', 'comparison must return a decision');
  return Object.freeze({ schema: 'poolday.operation-assessment/v1', accepted, policyDigest,
    receiptDigest: execution.receipt.receiptDigest, claim: 'bounded-reference-comparison' });
}
