/** Poolday's exact execution requirement. Doppler owns signature and byte verification. */
import { resolveDopplerExecutionContract } from '../config/doppler-execution-contracts.js';

const DIGEST = /^sha256:[0-9a-f]{64}$/;

// Doppler canonical observation encoding, including typed arrays as value arrays.
const canonical = (value) => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite Pack evidence');
    return JSON.stringify(value);
  }
  if (ArrayBuffer.isView(value)) return canonical(Array.from(value));
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item) ?? 'null').join(',')}]`;
  return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort((a, b) => a.localeCompare(b)).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
};
export const hashDopplerEvidence = async (value) => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value))));
  return `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

export function validateExecutablePack(binding) {
  const reasons = [];
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return { ok: false, reasons: ['Signed executable Pack binding is required'] };
  let contract;
  try { contract = resolveDopplerExecutionContract(binding.schema); }
  catch { return { ok: false, reasons: ['Unsupported executable Pack schema'] }; }
  const IDENTITY_FIELDS = contract.identityFields;
  if (Object.keys(binding).some((key) => ![...IDENTITY_FIELDS, 'requiredOperation', 'acceptedTargetPlanDigests', 'artifacts'].includes(key))) reasons.push('Unknown executable Pack binding field');
  if (typeof binding[IDENTITY_FIELDS[1]] !== 'string' || !binding[IDENTITY_FIELDS[1]]) reasons.push('Pack id is required');
  for (const field of IDENTITY_FIELDS.slice(2)) if (!DIGEST.test(binding[field])) reasons.push(`Invalid Pack ${field}`);
  // Custody binds an operation name; the installed execution adapter admits it.
  // Serving model bytes must not imply that a peer can execute their operations.
  if (typeof binding.requiredOperation !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]*$/.test(binding.requiredOperation)) reasons.push('A public Pack operation name is required');
  if (!Array.isArray(binding.acceptedTargetPlanDigests) || !binding.acceptedTargetPlanDigests.length
    || binding.acceptedTargetPlanDigests.some((digest) => !DIGEST.test(digest))
    || new Set(binding.acceptedTargetPlanDigests).size !== binding.acceptedTargetPlanDigests.length) reasons.push('Accepted TargetPlan digests must be explicit and unique');
  if (!Array.isArray(binding.artifacts) || !binding.artifacts.length) reasons.push('Pack artifact closure is required');
  else {
    const ids = new Set();
    for (const artifact of binding.artifacts) {
      if (!artifact || typeof artifact.artifactId !== 'string' || !artifact.artifactId || ids.has(artifact.artifactId)
        || !DIGEST.test(artifact.hash) || !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 0
        || typeof artifact.path !== 'string' || typeof artifact.role !== 'string') reasons.push('Invalid or duplicated Pack artifact');
      ids.add(artifact?.artifactId);
    }
  }
  return { ok: !reasons.length, reasons };
}

export function executablePacksMatch(left, right) {
  return canonical(left ?? null) === canonical(right ?? null);
}

export async function assertPackExecutionEvidence(binding, evidence) {
  const validation = validateExecutablePack(binding);
  if (!validation.ok) throw new Error(validation.reasons.join('; '));
  if (await hashDopplerEvidence(binding.artifacts) !== binding.artifactClosureDigest) throw new Error('Pack artifact closure digest mismatch');
  const contract = resolveDopplerExecutionContract(binding.schema);
  if (contract.identityFields.some((field) => binding[field] !== evidence?.[contract.receiptIdentity]?.[field])) throw new Error('Doppler did not execute the required exact Pack');
  if (!binding.acceptedTargetPlanDigests.includes(evidence.targetPlanDigest)) throw new Error('Doppler selected an unaccepted TargetPlan');
  const expected = binding.artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes }));
  if (canonical(expected) !== canonical(evidence.artifactReceipts)) throw new Error('Doppler artifact receipts do not close the required Pack');
}

export async function assertPackSession(binding, session) {
  const contract = resolveDopplerExecutionContract(binding?.schema);
  if (session?.schema !== contract.sessionSchema || !session.loaded
    || (typeof session.executeOperation !== 'function' && typeof session[binding?.requiredOperation] !== 'function')) throw new Error('Doppler did not open the required public Pack session');
  await assertPackExecutionEvidence(binding, { [contract.receiptIdentity]: session[contract.sessionIdentity], targetPlanDigest: session.selectedTargetPlanDigest, artifactReceipts: session.verification?.artifactReceipts });
}

export async function assertPackReceipt(binding, receipt, { assignment = null, sequence, options, result } = {}) {
  await assertPackExecutionEvidence(binding, receipt);
  if (receipt.schema !== resolveDopplerExecutionContract(binding.schema).sequenceReceiptSchema || binding.requiredOperation !== 'encodeSequence'
    || receipt.operation !== binding.requiredOperation) throw new Error('Invalid Doppler Pack operation receipt');
  const { receiptDigest, ...payload } = receipt;
  if (receiptDigest !== await hashDopplerEvidence(payload)) throw new Error('Doppler Pack receipt digest mismatch');
  if (assignment && receipt.assignmentHash !== await hashDopplerEvidence(assignment)) throw new Error('Doppler Pack receipt assignment mismatch');
  if (sequence !== undefined) {
    const { signal, ...request } = options;
    if (receipt.inputHash !== await hashDopplerEvidence({ sequence, options: request })) throw new Error('Doppler Pack receipt input mismatch');
  }
  if (result) {
    const { phase, receipt: ignoredReceipt, dopplerProviderReceipt, ...output } = result;
    if (receipt.outputHash !== await hashDopplerEvidence(output)) throw new Error('Doppler Pack receipt output mismatch');
  }
}
