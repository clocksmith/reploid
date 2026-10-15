/**
 * Signed execution evidence for one charged ordered-route attempt.
 *
 * The requester binds the attempt to its reservation with a signed
 * acknowledgment of zero outputs (the charge binding) before dispatch. Every
 * stage that admits the attempt signs cumulative stage receipts with its
 * persistent participant identity: reservation and route binding, steps
 * executed, tokens processed, timing, and its closing status. The final stage
 * also commits to its outputs as a hash chain over every step's delta. The
 * requester acknowledges each output it received by signing the cumulative
 * chain; it acknowledges only a receipt whose chain matches what it received.
 * Under the receiver policy's bound K, no stage computes step s unless it holds
 * the requester's verified acknowledgment of at least s - K outputs, so a
 * requester that stops acknowledging leaves at most K + 1 outputs of work
 * unacknowledged, whatever the coordinator does.
 * Signatures establish who asserted what; they do not prove honest or correct
 * computation, and verification against registered devices is the service's.
 * WebCrypto only, so browser and native hosts sign with the code the service
 * verifies with.
 */
import { canonicalPartitionJson, canonicalRouteAttemptBinding } from './partition-contract.js';
import { normalizeParticipantPublicKey, participantIdFor, signAsParticipant, verifyParticipantSignature } from '../../artifacts/participant-proofs.js';
import receiverPolicy from './partition-receiver-policy.json' with { type: 'json' };

export const STAGE_RECEIPT_SCHEMA = 'reploid.stage-receipt/v1';
export const OUTPUT_ACKNOWLEDGMENT_SCHEMA = 'reploid.output-acknowledgment/v1';
export const OUTPUT_CHAIN_SCHEMA = 'reploid.output-chain/v1';
export const ATTEMPT_EVIDENCE_SCHEMA = 'reploid.attempt-evidence/v1';
export const STAGE_RECEIPT_STATUSES = Object.freeze(['executing', 'settled', 'failed']);
export const ACKNOWLEDGMENT_OVERDUE = 'ACKNOWLEDGMENT_OVERDUE';

/** K: the most outputs a charged attempt may run ahead of the requester's verified acknowledgments. */
export const MAX_UNACKNOWLEDGED_OUTPUTS = receiverPolicy.maxUnacknowledgedOutputs;
if (!Number.isSafeInteger(MAX_UNACKNOWLEDGED_OUTPUTS) || MAX_UNACKNOWLEDGED_OUTPUTS < 0) {
  throw new Error('partition-receiver-policy.json must declare maxUnacknowledgedOutputs as a non-negative integer');
}
/** A step refused or abandoned because the requester's acknowledgments fell more than K outputs behind. */
export const acknowledgmentOverdue = (message = 'The requester\'s output acknowledgments are overdue') => Object.assign(new Error(message), { code: ACKNOWLEDGMENT_OVERDUE });

const RECEIPT_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'routeHash', 'partitionIndex', 'participantId',
  'sequence', 'status', 'steps', 'tokens', 'timing', 'output', 'signedAt']);
const ACKNOWLEDGMENT_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'routeHash', 'requesterId', 'count', 'chain', 'signedAt']);
const TIMING_KEYS = Object.freeze(['reservedAt', 'firstStepAt', 'lastStepAt', 'closedAt']);
const OUTPUT_KEYS = Object.freeze(['count', 'chain', 'done', 'stopReason']);
const BUNDLE_KEYS = Object.freeze(['schema', 'reservationId', 'attemptId', 'identity', 'receipts', 'acknowledged']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const exact = (value, keys) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;
const isoOrNull = value => value === null || typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
const iso = ms => new Date(ms).toISOString();
const hex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const digestText = async value => `sha256:${hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))}`;
const sameJson = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);

/** The ledger's route hash: sha256 over the canonical route attempt binding. */
export const attemptRouteHash = identity => digestText(canonicalPartitionJson(canonicalRouteAttemptBinding(identity)));
/** Chain value before any output, bound to the reservation and route. */
export const outputChainGenesis = ({ reservationId, routeHash }) => digestText(canonicalPartitionJson({ schema: OUTPUT_CHAIN_SCHEMA, reservationId, routeHash }));
/** One step's output appended to the chain; `delta` is that step's text, empty when it published none. */
export const extendOutputChain = (previous, { step, delta }) => digestText(canonicalPartitionJson({ previous, step, delta }));

/** Signing port over a host's persistent participant identity and its clock; the host keeps the identity. */
export function createAttemptEvidenceSigner({ identity, now = Date.now }) {
  const publicJwk = normalizeParticipantPublicKey(identity?.publicJwk);
  if (!publicJwk || !identity.privateJwk || typeof identity.peerId !== 'string') throw new TypeError('A persistent participant signing identity is required');
  const bundle = structuredClone(identity);
  let checked = null;
  if (typeof now !== 'function') throw new TypeError('The signing host clock must be a function');
  return Object.freeze({
    participantId: bundle.peerId,
    now,
    async sign(domain, body) {
      checked ??= participantIdFor(publicJwk).then(id => assert(id === bundle.peerId, 'Signing identity does not derive its participant id'));
      await checked;
      return { ...structuredClone(body), publicJwk: structuredClone(publicJwk), signature: await signAsParticipant(bundle, domain, body) };
    }
  });
}

function receiptProblem(body) {
  if (!exact(body, RECEIPT_KEYS) || body.schema !== STAGE_RECEIPT_SCHEMA || !text(body.reservationId, 160) || !text(body.attemptId, 256)
    || !DIGEST.test(body.routeHash) || !count(body.partitionIndex) || !text(body.participantId, 256)
    || !Number.isSafeInteger(body.sequence) || body.sequence < 1 || !STAGE_RECEIPT_STATUSES.includes(body.status) || !count(body.steps)
    || !exact(body.tokens, ['prompt', 'processed']) || !(body.tokens.prompt === null || count(body.tokens.prompt)) || !count(body.tokens.processed)
    || !exact(body.timing, TIMING_KEYS) || !TIMING_KEYS.every(key => isoOrNull(body.timing[key]))
    || !isoOrNull(body.signedAt) || body.signedAt === null) return 'receipt_malformed';
  if (body.output !== null && !(exact(body.output, OUTPUT_KEYS) && count(body.output.count) && body.output.count === body.steps
    && DIGEST.test(body.output.chain) && typeof body.output.done === 'boolean'
    && (body.output.stopReason === null || text(body.output.stopReason, 64)))) return 'receipt_malformed';
  return null;
}

function acknowledgmentProblem(body) {
  return exact(body, ACKNOWLEDGMENT_KEYS) && body.schema === OUTPUT_ACKNOWLEDGMENT_SCHEMA && text(body.reservationId, 160)
    && text(body.attemptId, 256) && DIGEST.test(body.routeHash) && text(body.requesterId, 256) && count(body.count)
    && DIGEST.test(body.chain) && isoOrNull(body.signedAt) && body.signedAt !== null ? null : 'acknowledgment_malformed';
}

async function verifySigned(record, { domain, problemOf, signerOf, publicJwk }) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { ok: false, problem: problemOf(null) };
  const { publicJwk: carried, signature, ...body } = record;
  const problem = problemOf(body);
  if (problem) return { ok: false, problem };
  const key = normalizeParticipantPublicKey(carried);
  if (!key || !exact(carried, Object.keys(key)) || typeof signature !== 'string') return { ok: false, problem: problemOf(null) };
  if (publicJwk && !sameJson(normalizeParticipantPublicKey(publicJwk), key)) return { ok: false, problem: 'signer_key_mismatch' };
  if (await participantIdFor(key) !== signerOf(body)) return { ok: false, problem: 'signer_key_mismatch' };
  if (!await verifyParticipantSignature(key, domain, body, signature)) return { ok: false, problem: 'signature_invalid' };
  return { ok: true, body };
}

/** Form, key-to-participant binding and signature of a stage receipt; `publicJwk`, when given, must be the signing key. */
export const verifyStageReceipt = (receipt, { publicJwk = null } = {}) => verifySigned(receipt, {
  domain: STAGE_RECEIPT_SCHEMA, problemOf: body => (body ? receiptProblem(body) : 'receipt_malformed'), signerOf: body => body.participantId, publicJwk });

/** Form, key-to-requester binding and signature of an output acknowledgment. */
export const verifyOutputAcknowledgment = (acknowledgment, { publicJwk = null } = {}) => verifySigned(acknowledgment, {
  domain: OUTPUT_ACKNOWLEDGMENT_SCHEMA, problemOf: body => (body ? acknowledgmentProblem(body) : 'acknowledgment_malformed'),
  signerOf: body => body.requesterId, publicJwk });

/**
 * Form of a charge binding carried with an ordered input: the requester's
 * acknowledgment of zero outputs of this attempt. Stages verify the signature.
 */
export function isChargeBindingShape(charge, { attemptId, requesterId }) {
  if (!exact(charge, [...ACKNOWLEDGMENT_KEYS, 'publicJwk', 'signature']) || typeof charge.signature !== 'string' || charge.signature.length > 256) return false;
  const { publicJwk, signature: _signature, ...body } = charge;
  return acknowledgmentProblem(body) === null && body.count === 0 && body.attemptId === attemptId && body.requesterId === requesterId
    && normalizeParticipantPublicKey(publicJwk) !== null;
}

/** Check the bundle's form; signatures and registrations are the verifier's. */
export function checkAttemptEvidenceBundle(bundle) {
  if (!exact(bundle, BUNDLE_KEYS) || bundle.schema !== ATTEMPT_EVIDENCE_SCHEMA || !text(bundle.reservationId, 160)
    || !text(bundle.attemptId, 256) || !Array.isArray(bundle.receipts)
    || !(bundle.acknowledged === null || exact(bundle.acknowledged, ['acknowledgment', 'receipt']))) return 'evidence_malformed';
  try { if (canonicalRouteAttemptBinding(bundle.identity).attemptId !== bundle.attemptId) return 'evidence_malformed'; }
  catch { return 'evidence_malformed'; }
  return null;
}

/** The charge binding a requester signs after binding its attempt and before any input leaves the device. */
async function checkChargeBinding(charge, binding, routeHash) {
  const checked = await verifyOutputAcknowledgment(charge);
  const body = checked.body;
  assert(checked.ok && body.count === 0 && body.attemptId === binding.attemptId && body.routeHash === routeHash
    && body.requesterId === binding.requesterId && body.chain === await outputChainGenesis({ reservationId: body.reservationId, routeHash }),
  'Attempt charge binding is not the requester\'s signed binding of this route');
  return { reservationId: body.reservationId, requesterKey: normalizeParticipantPublicKey(charge.publicJwk) };
}

/**
 * Stage side: cumulative signed receipts of one charged attempt at one stage.
 * A repeated step never advances the tally twice; a closed tally signs nothing new.
 */
export async function openStageReceipts({ signer, identity, partitionIndex, charge, now = signer?.now ?? Date.now }) {
  const binding = canonicalRouteAttemptBinding(identity);
  const stage = binding.route.stages[partitionIndex];
  assert(stage && typeof signer?.sign === 'function' && signer.participantId === stage.participantId, 'Stage receipts need this stage\'s own signing identity');
  const routeHash = await attemptRouteHash(binding);
  const { reservationId, requesterKey } = await checkChargeBinding(charge, binding, routeHash);
  const finalStage = binding.route.stages.at(-1);
  const final = partitionIndex === finalStage.index;
  const state = { sequence: 0, steps: 0, prompt: null, processed: 0, timing: { reservedAt: iso(now()), firstStepAt: null, lastStepAt: null, closedAt: null },
    output: final ? { count: 0, chain: await outputChainGenesis({ reservationId, routeHash }), done: false, stopReason: null } : null,
    receipt: null, acknowledged: null, closed: false };
  let queue = Promise.resolve();
  const serial = task => { const run = queue.then(task); queue = run.catch(() => {}); return run; };
  const sign = async status => {
    state.sequence += 1;
    state.receipt = await signer.sign(STAGE_RECEIPT_SCHEMA, { schema: STAGE_RECEIPT_SCHEMA, reservationId, attemptId: binding.attemptId, routeHash,
      partitionIndex, participantId: stage.participantId, sequence: state.sequence, status, steps: state.steps,
      tokens: { prompt: state.prompt, processed: state.processed }, timing: structuredClone(state.timing),
      output: state.output && structuredClone(state.output), signedAt: iso(now()) });
    return structuredClone(state.receipt);
  };
  return Object.freeze({
    reservationId, routeHash,
    /** Record one executed step and sign the cumulative receipt. */
    step: ({ step, inputTokenCount, delta = '', done = false, stopReason = null }) => serial(async () => {
      if (state.closed || step !== state.steps || !count(inputTokenCount)) return state.receipt && structuredClone(state.receipt);
      const at = iso(now());
      if (step === 0) { state.prompt = inputTokenCount; state.timing.firstStepAt = at; }
      state.steps += 1; state.processed += inputTokenCount; state.timing.lastStepAt = at;
      if (state.output) {
        assert(typeof delta === 'string', 'Final stage output delta required');
        state.output = { count: state.steps, chain: await extendOutputChain(state.output.chain, { step, delta }), done: done === true,
          stopReason: done === true && typeof stopReason === 'string' ? stopReason.slice(0, 64) : null };
      }
      return sign('executing');
    }),
    /** Keep the latest requester acknowledgment and the final-stage receipt it acknowledged, as forwarded by the coordinator. */
    /**
     * Keep a newer acknowledgment only when the requester's key from the charge
     * binding signed it and the final stage signed the receipt it pairs with.
     */
    async acknowledge(pair) {
      const ack = pair?.acknowledgment, receipt = pair?.receipt;
      if (!ack || ack.count <= (state.acknowledged?.acknowledgment.count ?? 0)) return false;
      const [signed, committed] = await Promise.all([verifyOutputAcknowledgment(ack, { publicJwk: requesterKey }), verifyStageReceipt(receipt)]);
      if (!signed.ok || !committed.ok || ack.reservationId !== reservationId || ack.attemptId !== binding.attemptId || ack.routeHash !== routeHash
        || ack.requesterId !== binding.requesterId || ack.count < 1 || committed.body.reservationId !== reservationId
        || committed.body.attemptId !== binding.attemptId || committed.body.routeHash !== routeHash
        || committed.body.partitionIndex !== finalStage.index || committed.body.participantId !== finalStage.participantId
        || committed.body.output?.count !== ack.count || committed.body.output.chain !== ack.chain) return false;
      if (ack.count > (state.acknowledged?.acknowledgment.count ?? 0)) state.acknowledged = structuredClone({ acknowledgment: ack, receipt });
      return true;
    },
    /** Refuse step `step` unless the verified acknowledgments cover at least step - K outputs. */
    async authorizeStep({ step, acknowledged = null }) {
      if (acknowledged) await this.acknowledge(acknowledged);
      if ((state.acknowledged?.acknowledgment.count ?? 0) < step - MAX_UNACKNOWLEDGED_OUTPUTS) {
        throw acknowledgmentOverdue(`Step ${step} needs the requester's acknowledgment of ${step - MAX_UNACKNOWLEDGED_OUTPUTS} outputs`);
      }
    },
    /** Sign the closing receipt once: settled, or failed when the stage recorded a failure. */
    close: ({ failed = false } = {}) => serial(async () => {
      if (state.closed) return state.receipt && structuredClone(state.receipt);
      state.closed = true; state.timing.closedAt = iso(now());
      return sign(failed ? 'failed' : 'settled');
    }),
    /** This stage's evidence for its own submission: its latest receipt and the latest acknowledgment it holds. */
    evidence: () => ({ schema: ATTEMPT_EVIDENCE_SCHEMA, reservationId, attemptId: binding.attemptId, identity: structuredClone(binding),
      receipts: state.receipt ? [structuredClone(state.receipt)] : [], acknowledged: state.acknowledged && structuredClone(state.acknowledged) })
  });
}

/**
 * Requester side: the charge binding, then one signed acknowledgment per
 * received output whose final-stage receipt commits to exactly the chain of
 * deltas this device received. A receipt that does not match is not
 * acknowledged, and nothing after it can be.
 */
export async function openOutputAcknowledgments({ signer, identity, reservationId, now = signer?.now ?? Date.now, restore = null }) {
  const binding = canonicalRouteAttemptBinding(identity);
  assert(typeof signer?.sign === 'function' && signer.participantId === binding.requesterId && text(reservationId, 160),
    'Acknowledgments need the requester\'s own signing identity and reservation');
  const routeHash = await attemptRouteHash(binding);
  const finalStage = binding.route.stages.at(-1);
  const sign = (outputs, chain) => signer.sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA, reservationId,
    attemptId: binding.attemptId, routeHash, requesterId: binding.requesterId, count: outputs, chain, signedAt: iso(now()) });
  const state = restore && restore.reservationId === reservationId && restore.attemptId === binding.attemptId ? structuredClone(restore)
    : { reservationId, attemptId: binding.attemptId, count: 0, chain: await outputChainGenesis({ reservationId, routeHash }),
      charge: null, acknowledged: null, latestReceipt: null, broken: false };
  state.charge ??= await sign(0, state.chain);
  let queue = Promise.resolve();
  const serial = task => { const run = queue.then(task); queue = run.catch(() => {}); return run; };
  return Object.freeze({
    routeHash,
    charge: structuredClone(state.charge),
    /** Acknowledge one step's output: `{ step, delta, receipt }` from the route. Returns the pair, or null when not acknowledged. */
    observe: ({ step, delta, receipt }) => serial(async () => {
      if (state.broken || step !== state.count || typeof delta !== 'string') { state.broken = true; return null; }
      const checked = await verifyStageReceipt(receipt);
      const body = checked.body;
      const chain = await extendOutputChain(state.chain, { step, delta });
      if (!checked.ok || body.reservationId !== reservationId || body.attemptId !== binding.attemptId || body.routeHash !== routeHash
        || body.partitionIndex !== finalStage.index || body.participantId !== finalStage.participantId
        || body.output?.count !== step + 1 || body.output.chain !== chain) { state.broken = true; return null; }
      const acknowledgment = await sign(step + 1, chain);
      Object.assign(state, { count: step + 1, chain, acknowledged: { acknowledgment, receipt: structuredClone(receipt) }, latestReceipt: structuredClone(receipt) });
      return structuredClone(state.acknowledged);
    }),
    /** Durable state for a restarted host. */
    state: () => structuredClone(state),
    /** The requester's evidence for its report: the latest final-stage receipt and its acknowledgment. */
    evidence: () => ({ schema: ATTEMPT_EVIDENCE_SCHEMA, reservationId, attemptId: binding.attemptId, identity: structuredClone(binding),
      receipts: state.latestReceipt ? [structuredClone(state.latestReceipt)] : [], acknowledged: state.acknowledged && structuredClone(state.acknowledged) })
  });
}

export default {
  STAGE_RECEIPT_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA, OUTPUT_CHAIN_SCHEMA, ATTEMPT_EVIDENCE_SCHEMA,
  attemptRouteHash, outputChainGenesis, extendOutputChain, createAttemptEvidenceSigner,
  verifyStageReceipt, verifyOutputAcknowledgment, checkAttemptEvidenceBundle, openStageReceipts, openOutputAcknowledgments
};
