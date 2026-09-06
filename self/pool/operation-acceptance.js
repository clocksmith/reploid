/** Requester acceptance is distinct from model correctness qualification. */
import { hashDopplerEvidence } from './executable-pack.js';
import { snapshotPackOperationData as snapshot, assessPackOperation, assertPackOperationReceipt } from './pack-operation.js';
const assert = (ok, message) => { if (!ok) throw new Error(`Operation acceptance: ${message}`); };

export async function resolveOperationAcceptance({ mode, operation, comparisonPolicy, policy }) {
  assert(policy?.schema === 'reploid.pool.operation-acceptance-policy/v1', 'explicit acceptance policy required');
  const definition = policy.modes?.[mode];
  assert(definition && (definition.operations === null || definition.operations.includes(operation.name)), 'acceptance mode is not allowed for operation');
  assert(typeof definition.referenceRequired === 'boolean' && typeof definition.claim === 'string', 'acceptance semantics missing');
  if (definition.referenceRequired) {
    assert(mode === 'reference' && comparisonPolicy?.schema === 'poolday.operation-comparison/v1'
      && await hashDopplerEvidence(comparisonPolicy.operation) === await hashDopplerEvidence(operation)
      && /^sha256:[a-f0-9]{64}$/.test(comparisonPolicy.referenceDigest), 'frozen reference comparison required');
  } else assert(mode === 'execution' && comparisonPolicy === null, 'ordinary generation requires explicit null comparison policy');
  return snapshot({ schema: 'reploid.pool.operation-acceptance/v1', mode, operation,
    referenceRequired: definition.referenceRequired, claim: definition.claim,
    comparisonPolicyDigest: comparisonPolicy === null ? null : await hashDopplerEvidence(comparisonPolicy) });
}

export async function validateOperationReference({ job, reference, registry }) {
  const intent = job.body.intent, request = job.body.request;
  if (intent.acceptance?.mode === 'execution') {
    assert(reference === null, 'ordinary generation must not carry a reference answer');
    return;
  }
  const adapter = registry[request.operation.name];
  assert(await hashDopplerEvidence(reference) === intent.comparisonPolicy.referenceDigest, 'reference digest mismatch');
  adapter.validateOutput(reference, request, { completed: true });
  assert(adapter.compare(reference, reference, intent.comparisonPolicy) === true, 'invalid comparison policy');
}

export async function assessPeerOperation({ job, execution, reference, registry }) {
  const { intent, request } = job.body;
  if (intent.acceptance?.mode !== 'execution') return assessPackOperation({ execution, reference, policy: intent.comparisonPolicy, registry });
  const resolved = await resolveOperationAcceptance({ mode: intent.acceptance.mode, operation: request.operation,
    comparisonPolicy: intent.comparisonPolicy, policy: intent.jobPolicy.acceptance });
  const policyDigest = await hashDopplerEvidence(resolved);
  assert(await hashDopplerEvidence(intent.acceptance) === policyDigest
    && request.assignment.acceptancePolicyDigest === policyDigest, 'acceptance was not frozen in the assignment');
  await validateOperationReference({ job, reference, registry });
  registry[request.operation.name].validateOutput(execution.output, request, { completed: true });
  await assertPackOperationReceipt(intent.model.executablePack, execution.receipt,
    { request, output: execution.output, runtimeVersion: intent.model.runtimeVersion });
  return snapshot({ schema: 'poolday.operation-assessment/v2', accepted: true, policyDigest,
    receiptDigest: execution.receipt.receiptDigest, claim: resolved.claim });
}
