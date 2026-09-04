/** Poolday's exact execution requirement. Doppler owns signature and byte verification. */

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const IDENTITY_FIELDS = ['schema', 'packId', 'semanticRoot', 'envelopeDigest', 'artifactClosureDigest'];

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
  if (Object.keys(binding).some((key) => ![...IDENTITY_FIELDS, 'requiredOperation', 'acceptedTargetPlanDigests', 'artifacts'].includes(key))) reasons.push('Unknown executable Pack binding field');
  if (!['doppler.pack/v2', 'doppler.pack/v3'].includes(binding.schema)) reasons.push('Unsupported executable Pack schema');
  if (typeof binding.packId !== 'string' || !binding.packId) reasons.push('Pack id is required');
  for (const field of IDENTITY_FIELDS.slice(2)) if (!DIGEST.test(binding[field])) reasons.push(`Invalid Pack ${field}`);
  if (binding.requiredOperation !== 'encodeSequence') reasons.push('Poolday requires the public encodeSequence Pack operation');
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
  if (IDENTITY_FIELDS.some((field) => binding[field] !== evidence?.pack?.[field])) throw new Error('Doppler did not execute the required exact Pack');
  if (!binding.acceptedTargetPlanDigests.includes(evidence.targetPlanDigest)) throw new Error('Doppler selected an unaccepted TargetPlan');
  const expected = binding.artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes }));
  if (canonical(expected) !== canonical(evidence.artifactReceipts)) throw new Error('Doppler artifact receipts do not close the required Pack');
}

export async function assertPackSession(binding, session) {
  if (session?.schema !== 'doppler.pack-session/v1' || !session.loaded || typeof session[binding?.requiredOperation] !== 'function') throw new Error('Doppler did not open the required public Pack session');
  await assertPackExecutionEvidence(binding, { pack: session.packIdentity, targetPlanDigest: session.selectedTargetPlanDigest, artifactReceipts: session.verification?.artifactReceipts });
}

export async function assertPackReceipt(binding, receipt, { assignment = null, sequence, options, result } = {}) {
  await assertPackExecutionEvidence(binding, receipt);
  if (receipt.schema !== 'doppler.pack-execution-receipt/v1' || receipt.operation !== binding.requiredOperation) throw new Error('Invalid Doppler Pack operation receipt');
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
