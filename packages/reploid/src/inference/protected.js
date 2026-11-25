/**
 * Confidential execution (`confidentiality: "requester-only"`) for `reploid/inference`, over
 * `reploid.protected-generation/v1`. UNAVAILABLE BY DEFAULT: a host must pass both a protected execution port and
 * `unreviewedProtectedExecution: true` to `createInference`. Without both, requester-only stays
 * CONFIDENTIAL_EXECUTION_UNAVAILABLE and nothing is sent. The stable reason is PROTECTED_EXECUTION_STATUS.reason.
 *
 * Host ports:
 *   discover({ signal, model })        -> [{ endpoint, advertisement }]   signed advertisements; no content is sent
 *   connect(endpoint, { signal })      -> frame channel { send, receive, close }
 *   openCrypto({ parameterSet, signal }) -> the requester's key holder (it alone holds the secret key)
 */
import { createSigningIdentity } from '../artifacts/identity.js';
import { hashJson } from '../artifacts/signatures.js';
import { executionError } from '../chat/execution-policy.js';
import {
  PROTECTED_PROTOCOL, PROTECTED_BACKEND, PROTECTED_REVIEW_REASON, validateProtectedPolicy, verifyProtectedAdvertisement,
  protectedEligibility, verifyTrapSet, runProtectedRequesterSession, createProtectedJournal, secureRandomInt,
  trapDetectionProbability, protectedError
} from '../mesh/protected-generation.js';

export { PROTECTED_PROTOCOL, PROTECTED_BACKEND };
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
/** Never `available: true` in this build. */
export const PROTECTED_EXECUTION_STATUS = freeze({ available: false, reason: PROTECTED_REVIEW_REASON });
/** What a protected route exposes beyond the requester: always these three. */
export const PROTECTED_METADATA = freeze(['model-id', 'timing', 'length']);
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Disclosures for a protected route: who can read content, and what still leaks. */
export function protectedDisclosures(route) {
  return freeze({
    contentReadableBy: { requesterDevice: true, participants: [], selection: 'all' },
    executorsReadContent: false,
    metadata: [...PROTECTED_METADATA],
    computedBy: [...route.participants],
    leaks: ['model and circuit identity', 'prompt length and generated token count', 'ciphertext and message sizes',
      'timing of each step', 'evaluator and requester identities and network metadata'],
    review: { ...PROTECTED_EXECUTION_STATUS },
    statement: 'Only this device can read the prompt and the answer: the evaluator computes on ciphertext under a key that never leaves this device, '
      + 'even if every remote party colludes. The evaluator sees the model identity, the prompt length, the number of generated tokens, '
      + 'ciphertext sizes and timing. Results are checked with known-answer traps, which catch a tampering evaluator only with the stated probability. '
      + `Research route, ${PROTECTED_REVIEW_REASON}.`
  });
}

/** The fixture tokenizer: one symbol per token from the circuit's pinned alphabet. */
function tokenize(messages, alphabet) {
  if (messages.length !== 1 || messages[0].role !== 'user') {
    throw executionError('EXECUTION_REQUEST_INVALID', 'The protected route takes exactly one user message. Nothing was sent.');
  }
  const tokens = [...messages[0].content].map(symbol => alphabet.indexOf(symbol));
  if (!tokens.length || tokens.some(token => token < 0)) {
    throw executionError('EXECUTION_REQUEST_INVALID', 'The message has symbols outside the pinned tokenizer. Nothing was sent.');
  }
  return tokens;
}

export function createProtectedExecution({ policy: inputPolicy, discover, connect, openCrypto, identity = null,
  journal = createProtectedJournal(), randomInt = secureRandomInt, now = Date.now, timeoutMs = SESSION_TTL_MS }) {
  for (const [name, port] of Object.entries({ discover, connect, openCrypto })) {
    if (typeof port !== 'function') throw new TypeError(`Protected execution port ${name} is required`);
  }
  const policy = validateProtectedPolicy(inputPolicy);
  const trapSets = new Map();
  const trapSetFor = circuit => {
    if (!trapSets.has(circuit.identity)) {
      const verifying = verifyTrapSet(circuit.trapSet, { publisherKeys: circuit.trapPublisherKeys, circuit, maxTolerance: policy.maxTrapTolerance });
      verifying.catch(() => trapSets.delete(circuit.identity));
      trapSets.set(circuit.identity, verifying);
    }
    return trapSets.get(circuit.identity);
  };

  /** Find an eligible evaluator for `prepare`. It sees no prompt and sends none. */
  async function resolve(request, { signal } = {}) {
    signal?.throwIfAborted();
    const offered = await discover({ signal, model: structuredClone(request.model) });
    signal?.throwIfAborted();
    const named = request.execution.participants.kind === 'named' ? request.execution.participants.ids : null;
    const candidates = [];
    for (const item of Array.isArray(offered) ? offered.slice(0, 64) : []) {
      let verified;
      try { verified = await verifyProtectedAdvertisement(item?.advertisement); } catch { continue; }
      const eligibility = protectedEligibility(policy, verified, request.model);
      if (!eligibility.eligible || (named && !named.includes(verified.descriptor.evaluator.participantId))) continue;
      candidates.push({ endpoint: item.endpoint, verified, ...eligibility });
    }
    candidates.sort((a, b) => a.verified.descriptor.evaluator.participantId.localeCompare(b.verified.descriptor.evaluator.participantId));
    const chosen = candidates[0];
    if (!chosen) throw executionError('EXECUTION_ROUTE_UNAVAILABLE', 'No protected backend on this requester\'s allowlist is available. Nothing was sent.');
    const trapSet = await trapSetFor(chosen.circuit);
    const lanes = policy.trapLanes + 1;
    const body = { schema: 'reploid.inference-route/v1', shape: 'remote', selection: 'one-of',
      participants: [chosen.verified.descriptor.evaluator.participantId], backend: PROTECTED_BACKEND, protocol: PROTECTED_PROTOCOL,
      model: structuredClone(request.model), planIdentity: null,
      protected: { descriptorDigest: chosen.verified.descriptorDigest, parameterSet: chosen.parameterSet.digest,
        insecureDevelopment: chosen.parameterSet.insecureDevelopment, circuit: chosen.circuit.identity, trapSet: trapSet.digest,
        lanes, trapLanes: policy.trapLanes } };
    const route = freeze({ id: await hashJson(body), ...body });
    return { route, maxCharge: null, disclosures: protectedDisclosures(route),
      pinned: { endpoint: chosen.endpoint, verified: chosen.verified, circuit: chosen.circuit, parameterSet: chosen.parameterSet, trapSet } };
  }

  /**
   * Run a prepared protected plan. Streams each real token after that step's traps passed. Throws on any failure;
   * the caller turns the error into a failed result with no output.
   */
  async function execute({ plan, pinned, requestId, messages, signal, onAdmitted, onToken }) {
    const { circuit, parameterSet, trapSet, verified, endpoint } = pinned;
    const promptTokens = tokenize(messages, circuit.tokenizer.alphabet);
    const generate = plan.generation.maxOutputTokens ?? Math.min(4, circuit.context - promptTokens.length + 1);
    if (promptTokens.length + generate - 1 > circuit.context) {
      throw executionError('EXECUTION_REQUEST_INVALID', `A ${promptTokens.length}-symbol prompt with ${generate} generated tokens exceeds the ${circuit.context}-position context. Nothing was sent.`);
    }
    signal?.throwIfAborted();
    const crypto = await openCrypto({ parameterSet: structuredClone(parameterSet), signal });
    let channel = null;
    try {
      if (crypto.profileDigest !== parameterSet.digest) throw executionError('EXECUTION_PLAN_CHANGED', 'The local key holder runs a different parameter set. Nothing was sent.');
      const requester = identity ?? await createSigningIdentity({ algorithm: 'ECDSA' });
      channel = await connect(endpoint, { signal });
      const abort = () => channel?.close();
      signal?.addEventListener('abort', abort, { once: true });
      try {
        return await runProtectedRequesterSession({ channel, crypto, identity: requester, verified, planId: plan.id, routeId: plan.route.id,
          expiresAt: now() + SESSION_TTL_MS, trapSet, trapLanes: policy.trapLanes, promptTokens, generate, journal, randomInt, now, timeoutMs, signal,
          onBound: onAdmitted, onToken: (token, step) => onToken(circuit.tokenizer.alphabet[token], step) });
      } finally { signal?.removeEventListener('abort', abort); }
    } finally {
      const stats = await crypto.close().catch(() => null);
      if (stats) journal.record({ role: 'requester', session: requestId, state: 'key-holder-closed', at: now(), keyHolder: stats });
    }
  }

  return freeze({ kind: 'reploid.protected-execution/v1', protocol: PROTECTED_PROTOCOL, journal, resolve, execute,
    detectionProbability: tampered => trapDetectionProbability({ lanes: policy.trapLanes + 1, trapLanes: policy.trapLanes, tampered }) });
}

/** The receipt for a protected run: confidentiality and integrity evidence kept separate, review status stated. */
export function protectedEvidence({ plan, admitted, evidence, error }) {
  const details = evidence ?? error?.protected ?? null;
  return {
    confidentiality: {
      mode: 'requester-only',
      contentReadBy: admitted ? { requesterDevice: true, participants: [] } : null,
      verified: admitted ? [
        { claim: 'requester-held-key', by: 'requester', method: 'key-generated-on-this-device-never-sent', value: evidence?.keyEpoch ?? null },
        { claim: 'evaluator-session-binding', by: 'requester', method: 'mutually-signed-binding-before-upload', value: admitted.id },
        { claim: 'no-evaluator-requests-answered', by: 'requester', method: 'frame-kind-allowlist' }
      ] : [],
      // What left this device, all of it public evaluation keys or fresh ciphertexts.
      uploaded: details?.uploaded ?? null,
      notVerified: ['independent-security-review', 'parameter-security-estimate', 'timing-independence', 'side-channels', 'recipient-conduct'],
      review: { ...PROTECTED_EXECUTION_STATUS }
    },
    integrity: {
      verified: evidence ? [
        { claim: 'known-answer-traps', by: 'requester', method: 'signed-trap-set/doppler.protected-trapset/v1', value: {
          trapSet: evidence.trapSet, publisherKey: evidence.publisherKey, lanes: evidence.lanes, trapLanes: evidence.trapLanes,
          checks: evidence.trapChecks, passed: evidence.trapsPassed, maxAbsError: evidence.maxTrapError, tolerance: evidence.tolerance,
          detectionProbabilityPerSession: evidence.detectionProbability } },
        { claim: 'frame-binding', by: 'requester', method: 'binding-digest-sequence-and-signature-per-frame', value: {
          bindingDigest: evidence.bindingDigest, descriptorDigest: evidence.descriptorDigest, framesReceived: evidence.frames.received } },
        { claim: 'model-identity', by: 'requester', method: 'pinned-circuit', value: plan.route.model.identity }
      ] : [],
      decryptions: details?.decryptions ?? null,
      providerReceipt: null,
      notVerified: ['correct-computation-of-the-real-lane', 'sub-tolerance-deviation', 'approximation-accuracy-outside-the-trap-distribution']
    }
  };
}

export { protectedError };
