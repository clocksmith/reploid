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
 *   requestTraps({ endpoint, request, signal }) -> a trap batch envelope from the pinned trap oracle (v2)
 */
import { createSigningIdentity } from '../artifacts/identity.js';
import { hashJson } from '../artifacts/signatures.js';
import { executionError } from '../chat/execution-policy.js';
import {
  PROTECTED_PROTOCOL, PROTECTED_BACKEND, PROTECTED_REVIEW_REASON, validateProtectedPolicy, verifyProtectedAdvertisement,
  protectedEligibility, verifyTrapSet, runProtectedRequesterSession, createProtectedJournal, secureRandomInt,
  trapDetectionProbability, protectedError, createTrapRequest, openTrapBatch
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

/**
 * Disclosures for a protected route. They state only what holds. Keeping content from every remote party is the
 * route's TARGET, not an established property: the parameters were never estimated and the protocol is unreviewed.
 * On an insecure development parameter set there is no confidentiality, and the evaluator counts as a reader.
 */
export function protectedDisclosures(route) {
  const oracle = route.protected?.traps?.source === 'oracle';
  const insecure = route.protected?.insecureDevelopment !== false;
  const confidentiality = insecure
    ? { status: 'none', reason: 'insecure development parameter set' }
    : { status: 'target-not-established', reason: `parameters not estimated; ${PROTECTED_REVIEW_REASON}` };
  return freeze({
    contentReadableBy: insecure ? { requesterDevice: true, participants: [...route.participants], selection: 'all' }
      : { requesterDevice: true, participants: [], selection: 'all', target: true },
    executorsReadContent: insecure,
    confidentiality,
    metadata: [...PROTECTED_METADATA],
    computedBy: [...route.participants],
    leaks: ['model and circuit identity', 'prompt length (in the bind offer, before the endpoint proves its key) and generated token count',
      'lane count', 'ciphertext and message sizes', 'timing of each step', 'session linkage through the key epoch',
      'whether a session ends early: a trap failure is visible to the evaluator and can be steered by it',
      'evaluator and requester identities and network metadata'],
    trapOracle: oracle ? { learns: ['that a session is starting', 'prompt length, generated count and trap count', 'request time and network address'],
      trusted: 'not to collude with the evaluator' } : null,
    review: { ...PROTECTED_EXECUTION_STATUS },
    statement: (insecure
      ? 'Research route on an insecure development parameter set: NO confidentiality. Treat the evaluator as able to read the prompt and the answer. '
      : 'Research route. Target, not established: the evaluator computes on ciphertext under a key held by this device\'s key holder, intended to keep '
        + 'the prompt and the answer from every remote party. The parameters have not been security-estimated and the protocol has not been '
        + 'independently reviewed, so this is not a claim that no one else can read them. ')
      + 'The evaluator sees the model identity, the prompt length, the number of generated tokens and lanes, sizes and timing. '
      + 'Results are checked with known-answer traps. The checks are probabilistic and defeatable: the stated detection odds hold only for an evaluator '
      + 'that tampers blindly, '
      + (oracle ? 'they assume the trap oracle does not collude with the evaluator (it learns that a session happened, its size and its time), '
        : 'a public trap set is defeated by a perturbation that vanishes on it, ')
      + 'and a failed check can reveal one chosen fact about the prompt per attempt. '
      + `${PROTECTED_REVIEW_REASON[0].toUpperCase()}${PROTECTED_REVIEW_REASON.slice(1)}.`
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

export function createProtectedExecution({ policy: inputPolicy, discover, connect, openCrypto, requestTraps = null, identity = null,
  journal = createProtectedJournal(), randomInt = secureRandomInt, now = Date.now, timeoutMs = SESSION_TTL_MS }) {
  for (const [name, port] of Object.entries({ discover, connect, openCrypto })) {
    if (typeof port !== 'function') throw new TypeError(`Protected execution port ${name} is required`);
  }
  const policy = validateProtectedPolicy(inputPolicy);
  if (policy.circuits.some(circuit => circuit.traps.source === 'oracle') && typeof requestTraps !== 'function') {
    throw new TypeError('Protected execution port requestTraps is required for a trap oracle');
  }
  // Batch ids this requester has opened, until they expire: a batch is good for one session.
  const usedBatches = new Map();
  const trapSets = new Map();
  const trapSetFor = circuit => {
    if (!trapSets.has(circuit.identity)) {
      const verifying = verifyTrapSet(circuit.traps.envelope, { publisherKeys: circuit.traps.publisherKeys, circuit, maxTolerance: policy.maxTrapTolerance });
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
    const source = chosen.circuit.traps.source;
    const trapSet = source === 'public-set' ? await trapSetFor(chosen.circuit) : null;
    const lanes = policy.trapLanes + 1;
    const body = { schema: 'reploid.inference-route/v1', shape: 'remote', selection: 'one-of',
      participants: [chosen.verified.descriptor.evaluator.participantId], backend: PROTECTED_BACKEND, protocol: PROTECTED_PROTOCOL,
      model: structuredClone(request.model), planIdentity: null,
      protected: { descriptorDigest: chosen.verified.descriptorDigest, parameterSet: chosen.parameterSet.digest,
        insecureDevelopment: chosen.parameterSet.insecureDevelopment, circuit: chosen.circuit.identity,
        traps: source === 'oracle' ? { source, oracleKeys: [...chosen.circuit.traps.oracleKeys] } : { source, trapSet: trapSet.digest },
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
    // v2: a fresh secret batch for this session, fetched before anything reaches the evaluator.
    let traps = trapSet;
    if (circuit.traps.source === 'oracle') {
      for (const [id, expiry] of usedBatches) if (expiry <= now()) usedBatches.delete(id);
      const { request, secret } = await createTrapRequest({ circuit: circuit.identity, promptLength: promptTokens.length, generate, count: policy.trapLanes });
      let envelope;
      try { envelope = await requestTraps({ endpoint: circuit.traps.endpoint, request, signal }); } catch (error) {
        throw protectedError('EXECUTION_ROUTE_UNAVAILABLE', `The trap oracle did not answer: ${error.message}. Nothing was sent.`);
      }
      traps = await openTrapBatch(envelope, { request, secret, oracleKeys: circuit.traps.oracleKeys, circuit, maxTolerance: policy.maxTrapTolerance, now, usedBatches });
      journal.record({ role: 'requester', session: requestId, state: 'traps-ready', at: now(), trapLanes: traps.traps.length });
    }
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
          expiresAt: now() + SESSION_TTL_MS, trapSet: traps, trapLanes: policy.trapLanes, promptTokens, generate, journal, randomInt, now, timeoutMs, signal,
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
      // A target, never a verified property here: see `status`.
      status: plan.disclosures.confidentiality.status,
      contentReadBy: admitted ? { requesterDevice: true, participants: [...plan.disclosures.contentReadableBy.participants],
        target: plan.disclosures.contentReadableBy.target === true } : null,
      verified: admitted ? [
        { claim: 'evaluator-session-binding', by: 'requester', method: 'mutually-signed-binding-before-upload', value: admitted.id },
        { claim: 'no-evaluator-requests-answered', by: 'requester', method: 'frame-kind-allowlist' }
      ] : [],
      // Reported by the local key holder, not checked by this client.
      keyHolderReports: admitted ? { keyEpoch: evidence?.keyEpoch ?? null, secretKeySent: false } : null,
      // What left this device, all of it public evaluation keys or fresh ciphertexts.
      uploaded: details?.uploaded ?? null,
      notVerified: ['confidentiality', 'requester-held-key', 'independent-security-review', 'parameter-security-estimate', 'timing-independence',
        'side-channels', 'selective-failure-leakage', 'recipient-conduct'],
      review: { ...PROTECTED_EXECUTION_STATUS }
    },
    integrity: {
      verified: evidence ? [
        { claim: 'known-answer-traps', by: 'requester', method: evidence.trapSource === 'oracle'
          ? 'secret-fresh-traps/doppler.protected-trap-batch/v1' : 'public-trap-set/doppler.protected-trapset/v1 (broken: vanishing perturbation)', value: {
          source: evidence.trapSource, batch: evidence.trapBatch, trapSet: evidence.trapSet, publisherKey: evidence.publisherKey,
          lanes: evidence.lanes, trapLanes: evidence.trapLanes,
          checks: evidence.trapChecks, passed: evidence.trapsPassed, maxAbsError: evidence.maxTrapError, tolerance: evidence.tolerance,
          detectionProbabilityPerSession: evidence.detectionProbability } },
        { claim: 'frame-binding', by: 'requester', method: 'binding-digest-sequence-and-signature-per-frame', value: {
          bindingDigest: evidence.bindingDigest, descriptorDigest: evidence.descriptorDigest, framesReceived: evidence.frames.received } },
        { claim: 'model-identity', by: 'requester', method: 'pinned-circuit', value: plan.route.model.identity }
      ] : [],
      decryptions: details?.decryptions ?? null,
      providerReceipt: null,
      notVerified: ['correct-computation-of-the-real-lane', 'sub-tolerance-deviation', 'approximation-accuracy-outside-the-trap-distribution',
        'trap-oracle-independence-from-the-evaluator']
    }
  };
}

export { protectedError };
