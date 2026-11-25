/**
 * The requester's attestation verifier for `reploid.attested-gpu/v1`. Every decision comes from the requester's own
 * policy, never from the evidence: pinned roots, the launch allowlist (CPU measurement -> exact image, runtime and
 * model), GPU reference measurements taken from NVIDIA's RIMs, and freshness limits. Every failure throws
 * ATTESTATION_REJECTED with a stable `reason`; there is no partial pass and no readable fallback.
 *
 * Binding. The executor generates an X25519 key pair inside the confidential VM for one session, then:
 *   session        = { protocol, requesterNonce, executor key, platform, launch, issuedAt, expiresAt }
 *   sessionDigest  = SHA-256(canonical JSON of session)            -> the nonce of every GPU report
 *   reportData     = SHA-512(canonical JSON of { session: sessionDigest, gpus: [per-GPU claims and report digest] })
 *                                                                   -> the 64-byte REPORT_DATA of the CPU report
 * So the CPU TEE signs the requester's nonce, the key the prompt is encrypted to, the launch claims and the GPU
 * evidence it collected; each GPU signs the same session. Measurements say which image made those claims.
 */
import { executionError } from '../../chat/execution-policy.js';
import { canonicalize, digest, utf8, toHex, fromHex, equalBytes, decodeBase64Url, canonicalDigest } from './bytes.js';
import { parseCertificate, verifyCertificateChain, verifyOcspResponse, spkiDigest } from './x509.js';
import { parseSnpReport, verifySnpReportSignature, parseTdxQuote, verifyTdxQuoteSignatures, parseGpuReport, verifyGpuReportSignature } from './reports.js';

export const ATTESTED_PROTOCOL = 'reploid.attested-gpu/v1';
export const ATTESTED_BACKEND = 'attested-gpu/v1';
export const ATTESTED_EVIDENCE_SCHEMA = 'reploid.attested-gpu-evidence/v1';
export const ATTESTED_SESSION_SCHEMA = 'reploid.attested-gpu-session/v1';
export const ATTESTED_POLICY_SCHEMA = 'reploid.attested-gpu-policy/v1';
export const ATTESTED_PLATFORMS = Object.freeze(['amd-sev-snp', 'intel-tdx']);
export const GPU_CC_MODES = Object.freeze(['on', 'off', 'devtools']);
/** Stable `reason` values of ATTESTATION_REJECTED. */
export const ATTESTATION_REASONS = Object.freeze([
  'evidence-invalid', 'nonce-mismatch', 'evidence-stale', 'platform-unsupported', 'measurement-unknown', 'model-mismatch',
  'key-unbound', 'debug-enabled', 'gpu-not-cc', 'gpu-measurement-unknown', 'gpu-count', 'signature-invalid',
  'certificate-expired', 'certificate-invalid', 'certificate-revoked', 'revocation-unchecked', 'tcb-out-of-date'
]);

export function attestationRejected(reason, message) {
  if (!ATTESTATION_REASONS.includes(reason)) throw new Error(`Unknown attestation reason ${reason}`);
  return Object.assign(executionError('ATTESTATION_REJECTED', `${message}. Nothing was sent.`), { reason });
}
const reject = (reason, message) => { throw attestationRejected(reason, message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sha = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const label = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim();
const hexOf = (value, bytes) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${bytes * 2}}$`).test(value);
const exact = (value, keys, optional = []) => object(value) && keys.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => keys.includes(key) || optional.includes(key));

function validLaunch(launch) {
  return exact(launch, ['image', 'runtime', 'model']) && sha(launch.image)
    && exact(launch.runtime, ['name', 'version', 'digest']) && label(launch.runtime.name) && label(launch.runtime.version) && sha(launch.runtime.digest)
    && exact(launch.model, ['id', 'identity']) && label(launch.model.id) && sha(launch.model.identity);
}

/**
 * Check and freeze a requester policy. Shape errors are thrown at construction, not at run time.
 *   roots:       { amdArk, intelSgxRoot, nvidiaDevice }: pinned SubjectPublicKeyInfo digests (sha256:...)
 *   launches:    [{ id, platform, measurement | { mrTd, rtmr: [r0, r1, r2, r3|null] }, launch, label, coverage }]
 *                coverage 'full-image': the measurement covers the root filesystem (for example dm-verity root hash on
 *                the measured kernel command line), so the runtime and model claims come from measured code.
 *                coverage 'boot-chain-only': it covers firmware, kernel and command line only; the runtime and model
 *                claims are then the executor's own statement, and every receipt says so.
 *   gpu:         { measurementSets: [{ label, measurements: { index: hex } }], minCount, maxCount }
 *   revocation:  { gpuOcsp: 'required', maxOcspAgeMs, cpu: 'hook' | 'not-checked' }
 *   tdxCollateral: 'hook' | 'not-checked'; snp: { minimumTcb? }
 *   clockSkewMs, maxEvidenceAgeMs, maxSessionMs, maxCreditsPerOutputToken
 */
export function validateAttestedPolicy(input) {
  const policy = structuredClone(input);
  const bad = message => { throw new TypeError(`Attested GPU policy: ${message}`); };
  if (!object(policy) || policy.schema !== ATTESTED_POLICY_SCHEMA) bad(`schema must be ${ATTESTED_POLICY_SCHEMA}`);
  const roots = policy.roots;
  if (!object(roots) || !['amdArk', 'intelSgxRoot', 'nvidiaDevice'].every(key => Array.isArray(roots[key]) && roots[key].every(sha))) {
    bad('roots must list sha256 SubjectPublicKeyInfo digests for amdArk, intelSgxRoot and nvidiaDevice');
  }
  if (!roots.nvidiaDevice.length) bad('the NVIDIA device root must be pinned');
  if (!Array.isArray(policy.launches) || !policy.launches.length || policy.launches.length > 64) bad('launches must list 1 to 64 approved launches');
  for (const entry of policy.launches) {
    if (!label(entry?.id) || !ATTESTED_PLATFORMS.includes(entry.platform) || !validLaunch(entry.launch) || !label(entry.label)
      || !['full-image', 'boot-chain-only'].includes(entry.coverage)) bad('each launch needs id, platform, launch, label and coverage');
    if (entry.platform === 'amd-sev-snp' && !hexOf(entry.measurement, 48)) bad(`launch ${entry.id}: an SNP measurement is 48 bytes of hex`);
    if (entry.platform === 'intel-tdx' && !(exact(entry.measurement, ['mrTd', 'rtmr']) && hexOf(entry.measurement.mrTd, 48)
      && Array.isArray(entry.measurement.rtmr) && entry.measurement.rtmr.length === 4
      && entry.measurement.rtmr.every(value => value === null || hexOf(value, 48)) && entry.measurement.rtmr.slice(0, 3).every(Boolean))) {
      bad(`launch ${entry.id}: TDX pins mrTd and RTMR0 to RTMR2 (RTMR3 may be null)`);
    }
  }
  if (new Set(policy.launches.map(entry => entry.id)).size !== policy.launches.length) bad('launch ids must be unique');
  const gpu = policy.gpu;
  if (!object(gpu) || !Array.isArray(gpu.measurementSets) || !gpu.measurementSets.length
    || !gpu.measurementSets.every(set => label(set?.label) && object(set.measurements) && Object.keys(set.measurements).length
      && Object.entries(set.measurements).every(([index, value]) => /^\d{1,3}$/.test(index) && /^[a-f0-9]{64,128}$/.test(value)))) {
    bad('gpu.measurementSets must list reference measurements by index');
  }
  if (!Number.isSafeInteger(gpu.minCount) || !Number.isSafeInteger(gpu.maxCount) || gpu.minCount < 1 || gpu.maxCount < gpu.minCount || gpu.maxCount > 8) bad('gpu count bounds');
  const revocation = policy.revocation;
  if (!object(revocation) || revocation.gpuOcsp !== 'required' || !Number.isSafeInteger(revocation.maxOcspAgeMs) || revocation.maxOcspAgeMs <= 0
    || !['hook', 'not-checked'].includes(revocation.cpu)) bad('revocation: gpuOcsp is required, with maxOcspAgeMs; cpu is hook or not-checked');
  if (!['hook', 'not-checked'].includes(policy.tdxCollateral)) bad('tdxCollateral is hook or not-checked');
  for (const key of ['clockSkewMs', 'maxEvidenceAgeMs', 'maxSessionMs', 'maxCreditsPerOutputToken']) {
    if (!Number.isSafeInteger(policy[key]) || policy[key] < 0) bad(`${key} must be a non-negative integer`);
  }
  if (policy.snp !== undefined && !(object(policy.snp) && (policy.snp.minimumTcb === undefined
    || ['bootloader', 'tee', 'snp', 'microcode'].every(key => Number.isSafeInteger(policy.snp.minimumTcb[key]))))) bad('snp.minimumTcb');
  return Object.freeze(policy);
}

/** The digest the execution policy records as its `attestation` requirement. */
export const attestedPolicyDigest = policy => canonicalDigest(policy);

export async function sessionDigestBytes(session) {
  return digest('SHA-256', utf8(canonicalize(session)));
}
export async function expectedReportData(sessionDigest, gpus) {
  return digest('SHA-512', utf8(canonicalize({ session: `sha256:${toHex(sessionDigest)}`, gpus })));
}
/** Per-GPU claims bound into the CPU report: what the measured guest read through NVML, and the report digest. */
export const gpuClaims = async gpu => ({ index: gpu.index, architecture: gpu.architecture, ccMode: gpu.ccMode,
  devToolsMode: gpu.devToolsMode, report: `sha256:${toHex(await digest('SHA-256', decodeBase64Url(gpu.report, { max: 65536 })))}` });

function readEvidence(evidence) {
  const shaped = exact(evidence, ['schema', 'session', 'cpu', 'gpus']) && evidence.schema === ATTESTED_EVIDENCE_SCHEMA
    && exact(evidence.session, ['schema', 'protocol', 'requesterNonce', 'executor', 'platform', 'launch', 'issuedAt', 'expiresAt'])
    && evidence.session.schema === ATTESTED_SESSION_SCHEMA && evidence.session.protocol === ATTESTED_PROTOCOL
    && exact(evidence.session.executor, ['participantId', 'kem', 'publicKey']) && label(evidence.session.executor.participantId)
    && Number.isSafeInteger(evidence.session.issuedAt) && Number.isSafeInteger(evidence.session.expiresAt)
    && exact(evidence.cpu, ['platform', 'report', 'certificates'], ['crl'])
    && typeof evidence.cpu.report === 'string' && Array.isArray(evidence.cpu.certificates) && evidence.cpu.certificates.length <= 8
    && Array.isArray(evidence.gpus) && evidence.gpus.length >= 1 && evidence.gpus.length <= 8
    && evidence.gpus.every(gpu => exact(gpu, ['index', 'architecture', 'ccMode', 'devToolsMode', 'report', 'certificates', 'ocsp'])
      && Number.isSafeInteger(gpu.index) && label(gpu.architecture) && typeof gpu.devToolsMode === 'boolean'
      && typeof gpu.report === 'string' && Array.isArray(gpu.certificates) && Array.isArray(gpu.ocsp));
  if (!shaped || !validLaunch(evidence.session.launch)) reject('evidence-invalid', 'The attestation evidence does not have the expected shape');
  if (!ATTESTED_PLATFORMS.includes(evidence.session.platform) || evidence.cpu.platform !== evidence.session.platform) {
    reject('platform-unsupported', `Platform ${evidence.cpu.platform} is not a supported confidential VM`);
  }
}

const chainError = error => {
  const reason = { CERTIFICATE_EXPIRED: 'certificate-expired', CERTIFICATE_REVOKED: 'certificate-revoked',
    OCSP_STALE: 'revocation-unchecked', OCSP_UNAVAILABLE: 'revocation-unchecked' }[error?.code] ?? 'certificate-invalid';
  return attestationRejected(reason, error?.message ?? 'Certificate chain rejected');
};
const decodeAll = (list, what) => {
  try { return list.map(item => decodeBase64Url(item, { max: 16384 })); } catch { return reject('evidence-invalid', `${what} is not base64url DER`); }
};

/**
 * Verify evidence for one session. `expected` is what this requester chose: { nonce (32 bytes), model, launchId? }.
 * `hooks` (all optional unless the policy names them):
 *   checkCpuRevocation({ platform, chain })     required when policy.revocation.cpu === 'hook'
 *   checkTdxCollateral({ quote, pckChain })     required for TDX when policy.tdxCollateral === 'hook' (Intel PCS TCB info, QE identity)
 * Returns a frozen summary for the receipt, including what was not checked.
 */
export async function verifyAttestedEvidence(evidence, { policy, expected, now, hooks = {} }) {
  readEvidence(evidence);
  const { session } = evidence;
  const notChecked = [];

  // 1. Freshness: this requester's own nonce, a recent issue time and a bounded session.
  let nonce;
  try { nonce = decodeBase64Url(session.requesterNonce, { length: 32 }); } catch { reject('evidence-invalid', 'The session nonce is not 32 bytes'); }
  if (!equalBytes(nonce, expected.nonce)) reject('nonce-mismatch', 'The evidence answers a different nonce than this requester sent');
  if (session.issuedAt > now + policy.clockSkewMs || now - session.issuedAt > policy.maxEvidenceAgeMs) reject('evidence-stale', 'The evidence is not fresh');
  if (session.expiresAt <= now || session.expiresAt - session.issuedAt > policy.maxSessionMs) reject('evidence-stale', 'The session lifetime is outside policy');

  // 2. The launch the executor claims must be an approved one for the requested model.
  const launch = policy.launches.find(entry => entry.platform === session.platform && canonicalize(entry.launch) === canonicalize(session.launch)
    && (expected.launchId == null || entry.id === expected.launchId));
  if (!launch) reject('measurement-unknown', 'The executor claims a launch that is not on this requester\'s allowlist');
  if (session.launch.model.identity !== expected.model.identity || session.launch.model.id !== expected.model.id) {
    reject('model-mismatch', 'The attested launch serves a different model than the plan');
  }
  let executorKey;
  try { executorKey = decodeBase64Url(session.executor.publicKey, { length: 32 }); } catch { reject('key-unbound', 'The executor key is not an X25519 public key'); }
  if (session.executor.kem !== 'DHKEM(X25519, HKDF-SHA256)') reject('key-unbound', 'The executor key is for an unsupported KEM');

  // 3. GPUs: count, CC mode, reports signed by a valid, unrevoked NVIDIA chain, nonce = session digest, RIM match.
  const sessionDigest = await sessionDigestBytes(session);
  if (evidence.gpus.length < policy.gpu.minCount || evidence.gpus.length > policy.gpu.maxCount) reject('gpu-count', 'The number of attested GPUs is outside policy');
  if (new Set(evidence.gpus.map(gpu => gpu.index)).size !== evidence.gpus.length) reject('evidence-invalid', 'Duplicate GPU index');
  const gpus = [];
  for (const gpu of evidence.gpus) {
    if (!GPU_CC_MODES.includes(gpu.ccMode)) reject('evidence-invalid', 'Unknown GPU confidential-computing mode');
    if (gpu.devToolsMode || gpu.ccMode === 'devtools') reject('debug-enabled', `GPU ${gpu.index} is in developer-tools (debug) mode`);
    if (gpu.ccMode !== 'on') reject('gpu-not-cc', `GPU ${gpu.index} is not in confidential-computing mode`);
    const chainDer = decodeAll(gpu.certificates, 'A GPU certificate');
    let chain;
    try { chain = await verifyCertificateChain(chainDer, { roots: policy.roots.nvidiaDevice, now }); } catch (error) { throw chainError(error); }
    const ocspDer = decodeAll(gpu.ocsp, 'A GPU OCSP response');
    if (ocspDer.length !== chain.length - 1) reject('revocation-unchecked', `GPU ${gpu.index} needs one stapled OCSP response per non-root certificate`);
    for (let i = 0; i < chain.length - 1; i += 1) {
      try { await verifyOcspResponse(ocspDer[i], { certificate: chain[i], issuer: chain[i + 1], now, maxAgeMs: policy.revocation.maxOcspAgeMs }); }
      catch (error) { throw chainError(error); }
    }
    let report;
    try { report = parseGpuReport(decodeBase64Url(gpu.report, { max: 65536 })); } catch { reject('evidence-invalid', `GPU ${gpu.index} report is malformed`); }
    if (!await verifyGpuReportSignature(report, chain[0])) reject('signature-invalid', `GPU ${gpu.index} report signature does not verify`);
    if (!equalBytes(report.requesterNonce, sessionDigest)) reject('key-unbound', `GPU ${gpu.index} report is not bound to this session`);
    const set = policy.gpu.measurementSets.find(candidate => Object.entries(candidate.measurements)
      .every(([index, value]) => report.measurements[index] === value));
    if (!set) reject('gpu-measurement-unknown', `GPU ${gpu.index} measurements match no reference set`);
    gpus.push({ claims: await gpuClaims(gpu), measurementSet: set.label, leaf: chain[0].subjectName });
  }

  // 4. CPU TEE: signature chain, debug refusal, measurement allowlist, and REPORT_DATA = the binding.
  const reportData = await expectedReportData(sessionDigest, gpus.map(gpu => gpu.claims));
  let rawReport;
  try { rawReport = decodeBase64Url(evidence.cpu.report, { max: 65536 }); } catch { reject('evidence-invalid', 'The CPU report is not base64url'); }
  let cpu;
  if (session.platform === 'amd-sev-snp') {
    try { cpu = parseSnpReport(rawReport); } catch { reject('evidence-invalid', 'The SEV-SNP report is malformed'); }
    if (cpu.debug) reject('debug-enabled', 'The confidential VM was launched with debugging allowed');
    const chainDer = decodeAll(evidence.cpu.certificates, 'An AMD certificate');
    let chain;
    try { chain = await verifyCertificateChain(chainDer, { roots: policy.roots.amdArk, now }); } catch (error) { throw chainError(error); }
    if (!await verifySnpReportSignature(cpu, chain[0])) reject('signature-invalid', 'The SEV-SNP report signature does not verify with the VCEK');
    const minimum = policy.snp?.minimumTcb;
    if (minimum && ['bootloader', 'tee', 'snp', 'microcode'].some(key => cpu.reportedTcb[key] < minimum[key])) reject('tcb-out-of-date', 'The platform TCB is below policy');
    if (cpu.measurement !== launch.measurement) reject('measurement-unknown', 'The SEV-SNP launch measurement is not the approved image');
    await cpuRevocation(policy, hooks, session.platform, chain, notChecked);
  } else {
    try { cpu = parseTdxQuote(rawReport); } catch { reject('evidence-invalid', 'The TDX quote is malformed'); }
    if (cpu.debug) reject('debug-enabled', 'The trust domain was launched with debugging allowed');
    let chain;
    try { chain = await verifyCertificateChain(cpu.pckChain, { roots: policy.roots.intelSgxRoot, now }); } catch (error) { throw chainError(error); }
    if (!await verifyTdxQuoteSignatures(cpu)) reject('signature-invalid', 'The TDX quote signature chain does not verify');
    if (policy.tdxCollateral === 'hook') {
      if (typeof hooks.checkTdxCollateral !== 'function') reject('revocation-unchecked', 'No TDX collateral checker is configured');
      const verdict = await hooks.checkTdxCollateral({ quote: cpu, pckChain: chain });
      if (verdict?.status !== 'up-to-date') reject('tcb-out-of-date', `TDX TCB status is ${verdict?.status ?? 'unknown'}`);
    } else notChecked.push('tdx-tcb-status-and-qe-identity');
    const pinned = launch.measurement;
    if (cpu.mrTd !== pinned.mrTd || pinned.rtmr.some((value, index) => value !== null && cpu.rtmr[index] !== value)) {
      reject('measurement-unknown', 'The TDX measurements are not the approved image');
    }
    await cpuRevocation(policy, hooks, session.platform, chain, notChecked);
  }
  if (!equalBytes(cpu.reportData, reportData)) reject('key-unbound', 'The CPU report does not bind this session, its key and its GPUs');
  if (launch.coverage === 'boot-chain-only') notChecked.push('runtime-and-model-measured-only-by-the-executor-itself');

  return Object.freeze({
    platform: session.platform, launchId: launch.id, launchLabel: launch.label, coverage: launch.coverage, launch: structuredClone(session.launch),
    measurement: session.platform === 'amd-sev-snp' ? cpu.measurement : { mrTd: cpu.mrTd, rtmr: [...cpu.rtmr] },
    sessionDigest: `sha256:${toHex(sessionDigest)}`, reportData: toHex(reportData), executorKey, participantId: session.executor.participantId,
    expiresAt: session.expiresAt, gpus: gpus.map(gpu => ({ ...gpu.claims, measurementSet: gpu.measurementSet })),
    rootDigests: { cpu: session.platform === 'amd-sev-snp' ? 'amdArk' : 'intelSgxRoot', gpu: 'nvidiaDevice' }, notChecked: Object.freeze(notChecked)
  });
}

async function cpuRevocation(policy, hooks, platform, chain, notChecked) {
  if (policy.revocation.cpu === 'not-checked') { notChecked.push('cpu-certificate-revocation'); return; }
  if (typeof hooks.checkCpuRevocation !== 'function') reject('revocation-unchecked', 'No CPU certificate revocation checker is configured');
  const verdict = await hooks.checkCpuRevocation({ platform, chain });
  if (verdict?.status === 'revoked') reject('certificate-revoked', 'A CPU attestation certificate is revoked');
  if (verdict?.status !== 'good') reject('revocation-unchecked', 'CPU certificate revocation could not be checked');
}

export { spkiDigest, parseCertificate, fromHex };
