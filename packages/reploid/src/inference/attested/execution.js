/**
 * Attested execution (`confidentiality: "attested-execution"`) for `reploid/inference`, over `reploid.attested-gpu/v1`.
 * UNAVAILABLE BY DEFAULT: a host must pass `unreviewedAttestedExecution: true` to createAttestedExecution, and both
 * that port (`attestedExecution`) and `unreviewedAttestedExecution: true` to `createInference`. Otherwise
 * attested-execution is ATTESTED_EXECUTION_UNAVAILABLE and nothing is sent. `requester-only` keeps its own meaning
 * and never runs here.
 *
 * Host ports:
 *   discover({ signal, model })    -> [{ endpoint, offer }]   unsigned offers; they only help choose, attestation decides
 *   connect(endpoint, { signal })  -> frame channel { send, receive, close }
 *   credits (optional)             -> { reserve({ planId, requestId, model, participantId, maximum, unit }),
 *                                       settle({ reservation, charge, outputTokens }), release({ reservation }) }
 *   hooks                          -> revocation and TDX collateral checkers named by the policy (verifier.js)
 */
import { executionError, ATTESTED_EXECUTION_REVIEW_REASON } from '../../chat/execution-policy.js';
import { hashJson } from '../../artifacts/signatures.js';
import { ATTESTED_PROTOCOL, ATTESTED_BACKEND, validateAttestedPolicy, attestedPolicyDigest } from './verifier.js';
import { runAttestedRequesterSession } from './session.js';

export { ATTESTED_PROTOCOL, ATTESTED_BACKEND };
export const ATTESTED_OFFER_SCHEMA = 'reploid.attested-gpu-offer/v1';
const CREDIT_UNIT = 'noncash-service-credit';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
/** Never `available: true` in this build. */
export const ATTESTED_EXECUTION_STATUS = freeze({ available: false, reason: ATTESTED_EXECUTION_REVIEW_REASON });
/**
 * What an attested route exposes outside the enclave. The operator's hypervisor sees timing and ciphertext sizes,
 * and confidential VMs do not hide page-level access patterns from it, so all four are disclosed.
 */
export const ATTESTED_METADATA = freeze(['model-id', 'timing', 'length', 'access-patterns']);
export const ATTESTED_TRUST_BOUNDARY = freeze({
  inside: ['the attested GPU in confidential-computing mode', 'the attested confidential VM (AMD SEV-SNP or Intel TDX)',
    'the approved runtime and model named by the attested launch measurement'],
  outside: ['the cloud operator, its hypervisor and its staff', 'whoever rents or administers the machine',
    'relays, coordinators and credit ledgers that carry the session'],
  trusted: ['NVIDIA, and AMD or Intel, for sound attestation and hardware isolation', 'the publisher of this requester\'s launch allowlist']
});
export const ATTESTED_CLAIM = 'Readable only inside the attested enclave, assuming the hardware vendors\' attestation is sound.';

/** Disclosures for an attested route: who can read content, who cannot, whom it trusts, and what still leaks. */
export function attestedDisclosures(route) {
  return freeze({
    contentReadableBy: { requesterDevice: true, participants: [], selection: 'one-of',
      attestedEnclave: { participantId: route.participants[0], platform: route.attested.platform, launchId: route.attested.launchId } },
    executorsReadContent: true,
    operatorReadsContent: false,
    metadata: [...ATTESTED_METADATA],
    computedBy: [...route.participants],
    trustBoundary: structuredClone(ATTESTED_TRUST_BOUNDARY),
    claim: ATTESTED_CLAIM,
    target: { statement: 'Nobody can read it', status: 'a target, not claimed' },
    leaks: ['model identity and the attested launch', 'prompt and answer sizes', 'timing of each output frame',
      'page-level memory access patterns visible to the hypervisor', 'the hardware operator, its region and network metadata'],
    performance: { claimed: false, reason: 'speed on confidential hardware is not claimed until it is measured' },
    review: { ...ATTESTED_EXECUTION_STATUS },
    statement: `${ATTESTED_CLAIM} The prompt is sealed to a key that only the measured confidential VM holds, after this device `
      + 'checked the CPU report, the GPU report in confidential-computing mode and the approved runtime measurement. '
      + `The cloud operator is outside the trust boundary; the hardware and the approved runtime are inside it; NVIDIA, and AMD or Intel, are trusted. `
      + `It sees timing, sizes and access patterns. Speed is not claimed. Unreviewed route, ${ATTESTED_EXECUTION_REVIEW_REASON}.`
  });
}

const offerShape = offer => offer && typeof offer === 'object' && offer.schema === ATTESTED_OFFER_SCHEMA
  && typeof offer.participantId === 'string' && typeof offer.launchId === 'string' && typeof offer.platform === 'string'
  && typeof offer.operator === 'string' && offer.operator.length <= 128 && offer.price?.unit === CREDIT_UNIT
  && Number.isSafeInteger(offer.price.creditsPerOutputToken) && offer.price.creditsPerOutputToken >= 0;

/**
 * The attested execution port. Gated like `createInference` and the protected port: without
 * `unreviewedAttestedExecution: true` its `resolve` and `execute` refuse with ATTESTED_EXECUTION_UNAVAILABLE before
 * any host port is called.
 */
export function createAttestedExecution({ policy: inputPolicy, discover, connect, hooks = {}, credits = null, now = Date.now,
  timeoutMs = 120000, generationTimeoutMs = 30 * 60 * 1000, unreviewedAttestedExecution = false }) {
  const gate = () => {
    if (unreviewedAttestedExecution !== true) {
      throw Object.assign(executionError('ATTESTED_EXECUTION_UNAVAILABLE', 'The attested route is not enabled. Nothing was sent.'),
        { reason: ATTESTED_EXECUTION_REVIEW_REASON });
    }
  };
  for (const [name, port] of Object.entries({ discover, connect })) {
    if (typeof port !== 'function') throw new TypeError(`Attested execution port ${name} is required`);
  }
  if (credits !== null && !['reserve', 'settle', 'release'].every(name => typeof credits[name] === 'function')) {
    throw new TypeError('Attested execution credits need reserve, settle and release');
  }
  const policy = validateAttestedPolicy(inputPolicy);
  const digest = attestedPolicyDigest(policy);

  /** Find an approved offer for `prepare`. It sends no content and no prompt length. */
  async function resolve(request, { signal } = {}) {
    gate();
    signal?.throwIfAborted();
    const limit = request.generation.maxOutputTokens;
    if (!Number.isSafeInteger(limit)) throw executionError('EXECUTION_REQUEST_INVALID', 'Attested execution needs generation.maxOutputTokens so the charge has a ceiling');
    const offered = await discover({ signal, model: structuredClone(request.model) });
    signal?.throwIfAborted();
    const named = request.execution.participants.kind === 'named' ? request.execution.participants.ids : null;
    const candidates = (Array.isArray(offered) ? offered.slice(0, 64) : []).filter(item => {
      const offer = item?.offer;
      if (!offerShape(offer) || (named && !named.includes(offer.participantId))) return false;
      const launch = policy.launches.find(entry => entry.id === offer.launchId && entry.platform === offer.platform);
      return launch && launch.launch.model.id === request.model.id && launch.launch.model.identity === request.model.identity
        && !request.model.adapterIdentities.length && offer.price.creditsPerOutputToken <= policy.maxCreditsPerOutputToken;
    }).sort((a, b) => a.offer.price.creditsPerOutputToken - b.offer.price.creditsPerOutputToken
      || a.offer.participantId.localeCompare(b.offer.participantId));
    const chosen = candidates[0];
    if (!chosen) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'No attested executor on this requester\'s allowlist offers this model. Nothing was sent.');
    const { offer } = chosen;
    const body = { schema: 'reploid.inference-route/v1', shape: 'remote', selection: 'one-of', participants: [offer.participantId],
      backend: ATTESTED_BACKEND, protocol: ATTESTED_PROTOCOL, model: structuredClone(request.model), planIdentity: null,
      attested: { policyDigest: await digest, launchId: offer.launchId, platform: offer.platform, operator: offer.operator, price: structuredClone(offer.price) } };
    const route = freeze({ id: await hashJson(body), ...body });
    return { route, maxCharge: freeze({ maximum: limit * offer.price.creditsPerOutputToken, unit: CREDIT_UNIT }), disclosures: attestedDisclosures(route),
      pinned: { endpoint: chosen.endpoint, offer: structuredClone(offer) } };
  }

  /**
   * Run a prepared attested plan. Verifies before sealing; any failure throws and nothing more leaves. Credits are
   * reserved after verification and before the prompt is sealed, settled on a complete answer, released otherwise.
   */
  async function execute({ plan, pinned, requestId, messages, signal, onAdmitted, onToken }) {
    gate();
    const started = now();
    const { participantId } = pinned.offer;
    const rate = plan.route.attested.price.creditsPerOutputToken;
    let reservation = null, attestedAt = null, firstOutputAt = null;
    const channel = await connect(pinned.endpoint, { signal });
    const abort = () => channel.close?.();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      const outcome = await runAttestedRequesterSession({ channel, policy, model: plan.route.model, launchId: pinned.offer.launchId, requestId,
        messages, generation: { maxOutputTokens: plan.generation.maxOutputTokens }, now, hooks, timeoutMs, generationTimeoutMs, signal,
        onAttested: async summary => {
          if (summary.participantId !== participantId || summary.launchId !== plan.route.attested.launchId || summary.platform !== plan.route.attested.platform) {
            throw executionError('EXECUTION_PLAN_CHANGED', 'The attested executor is not the planned one. Nothing was sent.');
          }
          if (credits) reservation = await credits.reserve({ planId: plan.id, requestId, model: structuredClone(plan.route.model), participantId,
            maximum: plan.maxCharge.maximum, unit: CREDIT_UNIT });
          attestedAt = now();
          onAdmitted({ bindingDigest: summary.sessionDigest, attestation: summary });
        },
        onDelta: text => { firstOutputAt ??= now(); onToken(text); } });
      if (outcome.usage.outputTokens > plan.generation.maxOutputTokens) throw executionError('RESULT_UNVERIFIED', 'The answer exceeds the output limit');
      const charge = outcome.usage.outputTokens * rate;
      const settlement = credits ? await credits.settle({ reservation, charge, outputTokens: outcome.usage.outputTokens })
        : { unit: CREDIT_UNIT, charge, outputTokens: outcome.usage.outputTokens, creditsPerOutputToken: rate, status: 'quoted' };
      reservation = null;
      const finished = now();
      return { output: outcome.output, usage: outcome.usage, settlement,
        evidence: { attestation: outcome.attestation, frames: outcome.frames,
          timing: { measuredBy: 'requester', attestationMs: attestedAt - started, firstOutputMs: firstOutputAt === null ? null : firstOutputAt - started,
            totalMs: finished - started, executor: outcome.timing } } };
    } catch (error) {
      if (reservation) await credits.release({ reservation }).catch(() => {});
      throw error;
    } finally {
      signal?.removeEventListener('abort', abort);
      channel.close?.();
    }
  }

  return freeze({ kind: 'reploid.attested-execution/v1', protocol: ATTESTED_PROTOCOL, policyDigest: () => digest, resolve, execute });
}

/** The receipt evidence for an attested run: confidentiality and integrity kept separate, review status stated. */
export function attestedEvidence({ plan, admitted, evidence }) {
  const summary = evidence?.attestation ?? null;
  return {
    confidentiality: {
      mode: 'attested-execution',
      contentReadBy: admitted ? { requesterDevice: true, participants: [],
        attestedEnclave: { participantId: plan.route.participants[0], platform: plan.route.attested.platform, launchId: plan.route.attested.launchId } } : null,
      verified: summary ? [
        { claim: 'requester-nonce', by: 'requester', method: 'fresh-32-byte-nonce-in-the-session' },
        { claim: 'cpu-confidential-vm', by: 'requester', method: summary.platform === 'intel-tdx' ? 'tdx-quote-v4/pck-chain-to-pinned-intel-root' : 'sev-snp-report/vcek-chain-to-pinned-amd-root',
          value: { platform: summary.platform, measurement: summary.measurement, debug: false } },
        { claim: 'gpu-confidential-computing', by: 'requester', method: 'spdm-report/nvidia-device-chain/stapled-ocsp/rim-reference-measurements',
          value: summary.gpus.map(gpu => ({ index: gpu.index, architecture: gpu.architecture, ccMode: gpu.ccMode, measurementSet: gpu.measurementSet })) },
        { claim: 'approved-launch', by: 'requester', method: 'launch-measurement-allowlist', value: { launchId: summary.launchId, launch: summary.launch } },
        { claim: 'session-key-binding', by: 'requester', method: 'report-data-sha512-of-session-and-gpus', value: summary.sessionDigest },
        { claim: 'sealed-to-attested-key', by: 'requester', method: 'hpke-x25519-hkdf-sha256-aes-256-gcm' }
      ] : [],
      notVerified: [...(summary?.notChecked ?? []), 'hardware-vendor-attestation-soundness', 'side-channels', 'runtime-conduct-beyond-its-measurement',
        'operator-denial-of-service', 'independent-security-review'],
      trustBoundary: structuredClone(ATTESTED_TRUST_BOUNDARY),
      claim: ATTESTED_CLAIM,
      review: { ...ATTESTED_EXECUTION_STATUS }
    },
    integrity: {
      verified: summary && evidence?.frames ? [
        { claim: 'model-identity', by: 'requester', method: 'attested-launch', value: plan.route.model.identity },
        { claim: 'stream-matches-answer', by: 'requester', method: 'sequenced-aead-frames' }
      ] : [],
      providerReceipt: null,
      notVerified: ['correct-computation', 'reported-token-counts']
    },
    ...(evidence?.timing ? { timing: structuredClone(evidence.timing) } : {})
  };
}
