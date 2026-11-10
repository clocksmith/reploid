import { freezeJson, snapshotJson } from '../config/index.js';
import { canonicalizeWith } from '../artifacts/canonical-json.js';
import { sha256Hex } from '../artifacts/signatures.js';

// Compatibility with published operation v1. V2 reconstruction belongs to
// Doppler's public accumulator; never copy or hash cumulative v2 partials here.
// Operation v1 orders object keys by localeCompare, not code units.
const canonical = canonicalizeWith((a, b) => a.localeCompare(b));
const hash = value => sha256Hex(canonical(value));
const requireValue = (value, message) => { if (!value) throw new Error(`Doppler stream: ${message}`); };

export async function createV1Verifier(request) {
  const requestHash = await hash(request);
  const assignmentHash = request.assignment === null ? null : await hash(request.assignment);
  const inputHash = await hash({ input: request.input, options: request.options });
  let index = 0, previous = null, completed = null;
  return {
    async accept(value) {
      const event = snapshotJson(value);
      requireValue(!completed, 'event after completion');
      const { eventDigest, ...payload } = event;
      requireValue(event.schema === 'doppler.capsule-operation-event/v1'
        && ['partial', 'completed'].includes(event.status), 'unsupported v1 event');
      requireValue(event.eventIndex === index && event.previousEventDigest === previous, 'missing or reordered event');
      requireValue(event.requestHash === requestHash && event.assignmentHash === assignmentHash
        && canonical(event.operation) === canonical(request.operation), 'event request mismatch');
      requireValue(eventDigest === await hash(payload), 'event digest mismatch');
      requireValue(new TextEncoder().encode(JSON.stringify(event.output)).length <= request.limits.maxOutputBytes,
        'output exceeds maxOutputBytes');
      if (event.status === 'completed') {
        const { receiptDigest, ...receipt } = event.receipt ?? {};
        requireValue(receipt.schema === 'doppler.capsule-operation-receipt/v1'
          && receiptDigest === await hash(receipt), 'completion receipt digest mismatch');
        requireValue(receipt.requestHash === requestHash && receipt.assignmentHash === assignmentHash
          && receipt.inputHash === inputHash && canonical(receipt.operation) === canonical(request.operation),
        'receipt request mismatch');
        requireValue(receipt.outputHash === await hash(event.output), 'completion output mismatch');
        completed = freezeJson(event);
      }
      index++;
      previous = eventDigest;
    },
    finish() { requireValue(completed, 'stream ended without completion'); return completed; }
  };
}

export function assertSessionIdentity(event, session, runtime) {
  const { receipt } = event;
  requireValue(receipt.modelId === session.modelId && receipt.capsule?.capsuleId === session.capsuleId
    && receipt.capsule?.semanticRoot === session.semanticRoot
    && receipt.targetPlanDigest === session.selectedTargetPlanDigest
    && receipt.runtimeVersion === runtime.DOPPLER_VERSION, 'completion execution identity mismatch');
  requireValue(canonical(receipt.capsule) === canonical(session.capsuleIdentity)
    && canonical(receipt.artifactReceipts) === canonical(session.verification.artifactReceipts),
  'completion artifact identity mismatch');
}

export function assertSessionCompletion(event, session, runtime) {
  assertSessionIdentity(event, session, runtime);
  const { output } = event;
  requireValue(typeof output.text === 'string' && Array.isArray(output.tokenIds)
    && output.tokenIds.every(id => Number.isSafeInteger(id) && id >= 0)
    && output.completion?.schema === runtime.GENERATION_CONTRACT.completionSchema
    && runtime.GENERATION_CONTRACT.stoppingReasons.includes(output.completion?.stopReason)
    && output.completion.generatedTokenCount === output.tokenIds.length, 'invalid generation completion');
}
