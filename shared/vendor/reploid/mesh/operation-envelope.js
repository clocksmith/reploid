/**
 * One operation-agnostic mesh envelope for `generate`, `scoreTargetSequence`, `scoreChoices` and `embed` on a named
 * provider's resident model. What every operation shares: the requester authorizes the envelope against the provider's
 * discovered offer before anything is held or sent, the refusal codes, and the signed settlement records of a charged
 * whole-model attempt (openMeshOperationCharge, acceptMeshOperationCharge). What differs: `generate` is handed to
 * the host's generation port, the `reploid:generation-*` protocol (peer-generation.js), which streams, acknowledges
 * delivery and keeps a journal for recovery. The other operations use this module's protocol (attachMeshOperations,
 * requestMeshOperation): the provider admits the envelope and signs its acceptance of the terms before the payload is
 * sent, runs the operation, signs its execution receipt and its closing stage receipt, and gets back the countersigned
 * receipt with the requester's acknowledgment. They are one unit per call and are neither resent nor recovered.
 *
 * This module owns the sequence and the wire protocol. Hosts supply the ports: discovery (`offer`), the ledger
 * (`reserve`, `settle`, `cancel`), the transport (`send`) and, on a provider, the resident session (`dispatch`).
 */
import { createReceiptDraft, signReceiptDraft, verifyReceipt } from '../artifacts/receipt.js';
import { hashJson } from '../artifacts/signatures.js';
import { MESH_OPERATION_CANCEL, MESH_OPERATION_RECEIPT, MESH_OPERATION_REQUEST, MESH_OPERATION_RESULT } from '../transport/message-types.js';
import { AUTO_ROUTES, PROTECTIONS, PROTECTION_ROUTES } from '../chat/execution-policy.js';
import {
  MAX_UNACKNOWLEDGED_OUTPUTS, OUTPUT_ACKNOWLEDGMENT_SCHEMA, STAGE_RECEIPT_SCHEMA, createAttemptEvidenceSigner, extendOutputChain, outputChainGenesis,
  verifyOutputAcknowledgment, verifyStageReceipt
} from './partitions/partition-attempt-evidence.js';
import {
  SETTLEMENT_ACCEPTANCE_SCHEMA, SETTLEMENT_FAULT_SCHEMA, SETTLEMENT_STOP_SCHEMA, SETTLEMENT_TERMS_SCHEMA, acceptSettlementTerms, signSettlementStop,
  WHOLE_MODEL_TERMS_MODE, signSettlementTermsFor, signStageFaultRecord, termsDigest, verifySettlementAcceptance, verifySettlementFault, verifySettlementTerms
} from './settlement-terms.js';
import { DIGEST_PATTERN, PARTICIPANT_ID_PATTERN } from '../contracts/identifiers.js';

export const MESH_OPERATION_SCHEMA = 'reploid.mesh-operation/v1';
export const MESH_OPERATION_GRANT_SCHEMA = 'reploid.mesh-operation-grant/v1';
/** The unit a non-generation receipt counts in (its signed `usage`); generation keeps `raw-model-tokens/v1`. */
export const MESH_OPERATION_UNITS = 'reploid.mesh-operation-units/v1';
// The frame types are registered with the transports, which own their names (transport/message-types.js).
export { MESH_OPERATION_REQUEST, MESH_OPERATION_RESULT, MESH_OPERATION_CANCEL, MESH_OPERATION_RECEIPT };

/**
 * Every operation the envelope carries. `costUnit` is what one charged unit is; `orderedSplit` says whether an
 * ordered split route (stages in sequence) can run it. Only generation streams through stages today.
 *
 * `rerank` is not one of them. Doppler defines it only as a Capsule operation (capsule-operations.json,
 * executeCapsuleRerank): it needs a signed application binding and a target plan, runs on a reranker Pack, and the
 * resident session a whole-model provider holds (DopplerX's scoped session) has no rerank method. Reploid runs it
 * locally, in document search through the Pack executor (shared/pool/pack-operation-adapters.js), and nothing sends it
 * to a provider. Adding it here needs a provider runtime that serves a reranker Capsule first; until then an offer of
 * it would be one no provider can run.
 */
export const MESH_OPERATIONS = Object.freeze({
  generate: Object.freeze({ costUnit: 'output-token', orderedSplit: true }),
  scoreTargetSequence: Object.freeze({ costUnit: 'scored-target-sequence', orderedSplit: false }),
  scoreChoices: Object.freeze({ costUnit: 'scored-choice-set', orderedSplit: false }),
  embed: Object.freeze({ costUnit: 'embedding', orderedSplit: false })
});

/** Stable refusal codes, in the style of the inference API's EXECUTION_ERROR_CODES. */
export const MESH_OPERATION_ERROR_CODES = Object.freeze({
  UNKNOWN_OPERATION: 'UNKNOWN_OPERATION',
  UNSUPPORTED_OPERATION: 'UNSUPPORTED_OPERATION',
  OPERATION_OFFER_MISMATCH: 'OPERATION_OFFER_MISMATCH',
  OPERATION_GRANT_REVOKED: 'OPERATION_GRANT_REVOKED',
  OPERATION_REQUEST_INVALID: 'OPERATION_REQUEST_INVALID',
  OPERATION_RESULT_INVALID: 'OPERATION_RESULT_INVALID',
  /** The provider's host declined the requester or the request (owner pairing, readiness, closing). */
  OPERATION_REFUSED: 'OPERATION_REFUSED',
  /** The provider already runs as many operations as it allows. */
  OPERATION_BUSY: 'OPERATION_BUSY'
});

export const meshOperationError = (code, message) => {
  if (!Object.hasOwn(MESH_OPERATION_ERROR_CODES, code)) throw new Error(`Unknown mesh operation error code ${code}`);
  return Object.assign(new Error(message), { code });
};

const SPLIT_ROUTES = Object.freeze(['split', 'split-local-edges']);
const DIGEST = DIGEST_PATTERN;
const PARTICIPANT = PARTICIPANT_ID_PATTERN;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;
const invalid = message => meshOperationError('OPERATION_REQUEST_INVALID', message);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const freezeJson = value => Object.freeze(JSON.parse(JSON.stringify(value)));

/** The operations a peer offers: those it advertises, or generation alone for a peer that predates the list. */
export function supportedMeshOperations(value) {
  if (value === undefined || value === null) return ['generate'];
  if (!Array.isArray(value) || value.length > 16 || !value.every(name => Object.hasOwn(MESH_OPERATIONS, name))) return [];
  return [...new Set(value)];
}

/** What the plan binds: the operation, the model artifact, the requirements and the recipient. */
export const meshOperationPlanDigest = ({ operation, modelId, manifestDigest, execution, recipientGrant }) =>
  hashJson({ schema: MESH_OPERATION_SCHEMA, operation, modelId, manifestDigest,
    execution: { protection: execution?.protection, route: execution?.route }, recipient: recipientGrant?.recipient });

/** The digest a receipt and a credit reservation bind for an operation's input. */
export const meshOperationInputDigest = envelope => hashJson({ schema: MESH_OPERATION_SCHEMA, requestId: envelope.requestId,
  operation: envelope.operation, planDigest: envelope.planDigest, payload: envelope.payload });

function checkGrant(grant) {
  if (!object(grant) || grant.schema !== MESH_OPERATION_GRANT_SCHEMA || !PARTICIPANT.test(grant.recipient ?? '')
    || !Number.isFinite(grant.grantedAt) || !(grant.revokedAt === null || Number.isFinite(grant.revokedAt))) {
    throw invalid('recipientGrant must name one participant, when it was granted and whether it was revoked');
  }
}

/** Validates the fields and computes `planDigest` when the caller has none. Returns a frozen envelope. */
export async function createMeshOperationEnvelope({ requestId, operation, modelId, manifestDigest, planDigest = null, execution,
  recipientGrant, maxCostUnits, payload }) {
  if (!Object.hasOwn(MESH_OPERATIONS, operation)) throw meshOperationError('UNKNOWN_OPERATION', `Unknown mesh operation ${String(operation)}`);
  checkGrant(recipientGrant);
  const computed = await meshOperationPlanDigest({ operation, modelId, manifestDigest, execution, recipientGrant });
  if (planDigest !== null && planDigest !== computed) throw invalid('planDigest differs from the operation, model, requirements and recipient');
  const envelope = { schema: MESH_OPERATION_SCHEMA, requestId, operation, modelId, manifestDigest, planDigest: computed,
    execution, recipientGrant, maxCostUnits, payload };
  assertMeshOperationEnvelope(envelope);
  return freezeJson(envelope);
}

const nonEmptyText = value => typeof value === 'string' && value.length > 0;
/**
 * How many items a payload asks to be scored or embedded: a target after a prompt or messages, the choices, the input
 * text. A request of zero is refused before anything is held or run: the provider would be paid a unit for no work,
 * and its records would commit to an output of nothing.
 */
function payloadItems(operation, payload) {
  if (operation === 'scoreTargetSequence') {
    return nonEmptyText(payload.target) && (Array.isArray(payload.messages) ? payload.messages.length > 0 : nonEmptyText(payload.prompt)) ? 1 : 0;
  }
  if (operation === 'scoreChoices') return nonEmptyText(payload.prompt) && Array.isArray(payload.choices) ? payload.choices.length : 0;
  if (operation === 'embed') return nonEmptyText(payload.input) ? 1 : 0;
  return 1;
}

/** The checks of every field but the payload: what a provider admits before the payload is disclosed. */
function assertMeshOperationFields(envelope) {
  if (!object(envelope) || envelope.schema !== MESH_OPERATION_SCHEMA) throw invalid('A reploid.mesh-operation/v1 envelope is required');
  if (!Object.hasOwn(MESH_OPERATIONS, envelope.operation)) throw meshOperationError('UNKNOWN_OPERATION', `Unknown mesh operation ${String(envelope.operation)}`);
  if (!REQUEST_ID.test(envelope.requestId ?? '')) throw invalid('requestId must be 8 to 128 letters, digits, hyphens or underscores');
  if (typeof envelope.modelId !== 'string' || !envelope.modelId || !DIGEST.test(envelope.manifestDigest ?? '') || !DIGEST.test(envelope.planDigest ?? '')) {
    throw invalid('The model id, its manifest digest and the plan digest are required');
  }
  const { protection, route } = envelope.execution ?? {};
  if (!PROTECTIONS.includes(protection) || !PROTECTION_ROUTES[protection].includes(route)) {
    throw invalid(`execution must name a protection (${PROTECTIONS.join(', ')}) and one of its routes`);
  }
  checkGrant(envelope.recipientGrant);
  if (!Number.isSafeInteger(envelope.maxCostUnits) || envelope.maxCostUnits < 1) throw invalid('maxCostUnits must be a positive integer');
  return envelope;
}

/** Shape checks only; authorization against an offer is authorizeMeshOperation. */
export function assertMeshOperationEnvelope(envelope) {
  assertMeshOperationFields(envelope);
  if (!object(envelope.payload)) throw invalid('payload must be an object');
  if (payloadItems(envelope.operation, envelope.payload) < 1) throw invalid(`The ${envelope.operation} payload has nothing to run; nothing was held or sent`);
  return envelope;
}

/**
 * Fails closed, synchronously, before any hold or wire byte. `offer` is the recipient's discovered offer:
 * `{ participantId, protection, route, modelIdentity, supportedOperations }`, `route` being the concrete route it
 * serves (`remote` for a whole-model provider, `split` or `split-local-edges` for an ordered split). Returns the
 * operation's declaration.
 */
export function authorizeMeshOperation(envelope, offer) {
  assertMeshOperationEnvelope(envelope);
  return againstOffer(envelope, offer);
}

/** authorizeMeshOperation for an admission, which carries no payload. */
function authorizeFields(admission, offer) {
  assertMeshOperationFields(admission);
  return againstOffer(admission, offer);
}

function againstOffer(envelope, offer) {
  const operation = MESH_OPERATIONS[envelope.operation];
  const { protection, route } = envelope.execution;
  if (!operation.orderedSplit && (SPLIT_ROUTES.includes(route) || SPLIT_ROUTES.includes(offer?.route))) {
    throw meshOperationError('UNSUPPORTED_OPERATION', `${envelope.operation} cannot run on an ordered split route; nothing was sent`);
  }
  if (envelope.recipientGrant.revokedAt !== null) throw meshOperationError('OPERATION_GRANT_REVOKED', 'The recipient grant was revoked; nothing was sent');
  if (!object(offer) || offer.participantId !== envelope.recipientGrant.recipient) {
    throw meshOperationError('OPERATION_OFFER_MISMATCH', 'No offer from the granted recipient was discovered; nothing was sent');
  }
  if (offer.protection !== protection) throw meshOperationError('OPERATION_OFFER_MISMATCH', `The recipient offers ${offer.protection}, not ${protection}; nothing was sent`);
  const routes = route === 'auto' ? AUTO_ROUTES[protection] : [route];
  if (!routes.includes(offer.route)) throw meshOperationError('OPERATION_OFFER_MISMATCH', `The recipient serves the ${offer.route} route, not ${route}; nothing was sent`);
  if (offer.modelIdentity !== envelope.manifestDigest) throw meshOperationError('OPERATION_OFFER_MISMATCH', 'The recipient serves another model artifact; nothing was sent');
  if (!supportedMeshOperations(offer.supportedOperations).includes(envelope.operation)) {
    throw meshOperationError('UNSUPPORTED_OPERATION', `The recipient does not offer ${envelope.operation}; nothing was sent`);
  }
  return operation;
}

/**
 * A requester's view of the granted recipient's offer, from its discovery state: `models` (its routes, as a requester's
 * `getState().models`) and `peers` (its verified swarm peers). A split route offers generation only; a whole-model
 * provider offers what it advertised. Null when the recipient or the model is not discovered.
 */
export function meshOperationOffer({ models = [], peers = [] }, envelope) {
  const recipient = envelope?.recipientGrant?.recipient;
  const model = models.find(row => row.id === envelope?.modelId && row.identity === envelope?.manifestDigest);
  if (!model) return null;
  if (model.partition) {
    const stages = model.partition.route?.stages?.map(stage => stage.participantId) ?? [];
    return stages.includes(recipient) ? { participantId: recipient, protection: 'plaintext',
      route: model.partition.route?.backend === 'doppler-partition-edges/v1' ? 'split-local-edges' : 'split',
      modelIdentity: model.identity, supportedOperations: ['generate'] } : null;
  }
  const peer = peers.find(row => row.identityVerified === true && row.participantId === recipient && row.modelIdentity === model.identity);
  return peer ? { participantId: recipient, protection: 'plaintext', route: 'remote', modelIdentity: peer.modelIdentity,
    supportedOperations: supportedMeshOperations(peer.supportedOperations) } : null;
}

/** How many units an operation's output costs. Every non-generation operation is one unit per call. */
export function meshOperationUnits(operation, output) {
  if (operation === 'generate') return output?.outputTokens;
  return 1;
}

/**
 * The requester's sequence. Authorization runs synchronously, before this returns: a refused envelope throws here
 * with nothing held or sent. A non-generation operation then goes the way a charged whole-model generation goes: the
 * cost is held, the requester signs the settlement terms of that hold (openMeshOperationCharge), the provider admits
 * the operation and signs its acceptance before the payload leaves, closes with its signed stage receipt, and the
 * requester acknowledges that close and countersigns the execution receipt in one frame before the ledger settles.
 * Ports:
 *  - `offer(envelope)`: the recipient's discovered offer (synchronous);
 *  - `reserve(envelope, inputDigest)`: holds the cost; returns the hold;
 *  - `open(hold, envelope)`: signs the settlement terms of that hold; returns the charge (openMeshOperationCharge);
 *  - `send(envelope, { signal, settlement })`: runs the wire protocol (requestMeshOperation) and returns
 *    `{ output, receipt, closing, deliver }`: the output, the provider's signed execution receipt, its signed closing
 *    stage receipt and `deliver({ receipt, acknowledgment })`, which sends both to the provider synchronously;
 *  - `countersign(receipt)`: the requester's countersignature;
 *  - `settle(hold, receipt)`: settles the countersigned receipt; `cancel(hold, error, charge)` releases, stops or
 *    fences after a failure.
 * Resolves `{ acknowledgedUnits, output, providerReceipt, settlement, costUnit, charge }`.
 */
export function executeMeshOperation(envelope, { signal = AbortSignal.timeout(60_000) } = {}, ports) {
  const operation = authorizeMeshOperation(envelope, ports.offer(envelope));
  if (envelope.operation === 'generate') {
    if (typeof ports.generate !== 'function') throw meshOperationError('UNSUPPORTED_OPERATION', 'This host runs generation through its generation path only');
    return ports.generate(envelope, { signal });
  }
  return (async () => {
    signal.throwIfAborted();
    const inputDigest = await meshOperationInputDigest(envelope);
    const hold = await ports.reserve(envelope, inputDigest);
    let receipt, output, providerReceipt, charge = null;
    try {
      charge = await ports.open(hold, envelope);
      signal.throwIfAborted();
      let closing, deliver;
      ({ output, receipt, closing, deliver } = await ports.send(envelope, { signal, settlement: charge }));
      signal.throwIfAborted();
      const units = meshOperationUnits(envelope.operation, output);
      const signed = await verifyReceipt(receipt);
      if (!signed.providerValid || receipt.consumerSignature || receipt.provider !== envelope.recipientGrant.recipient
        || receipt.jobHash !== `request:${envelope.requestId}` || receipt.model !== envelope.modelId
        || receipt.modelIdentity !== envelope.manifestDigest || receipt.inputDigest !== inputDigest
        || receipt.outputDigest !== await hashJson(output) || receipt.usage !== MESH_OPERATION_UNITS
        || receipt.stopReason !== `operation:${envelope.operation}` || receipt.outputTokens !== units || units > envelope.maxCostUnits) {
        throw meshOperationError('OPERATION_RESULT_INVALID', `The provider's ${envelope.operation} result is not bound to this envelope`);
      }
      // Countersigned first and held unsent, so that nothing is awaited between the acknowledgment and the frame that
      // carries both (as for generation, peer-generation.js).
      const countersigned = await ports.countersign(receipt);
      await charge.acknowledge({ receipt: closing, units, outputDigest: receipt.outputDigest,
        send: acknowledgment => deliver({ receipt: countersigned, acknowledgment }) });
      providerReceipt = countersigned;
    } catch (error) {
      await ports.cancel(hold, error, charge).catch(() => {});
      throw error;
    }
    const settlement = await ports.settle(hold, providerReceipt);
    return { acknowledgedUnits: providerReceipt.outputTokens, output, providerReceipt, settlement, costUnit: operation.costUnit, charge };
  })();
}

/** Provider side: runs one non-generation operation on the resident session. Generation keeps its streaming path. */
export async function dispatchMeshOperation(session, envelope, { signal }) {
  const supported = typeof session?.supportedOperations === 'function' ? supportedMeshOperations(session.supportedOperations()) : [];
  if (envelope.operation === 'generate' || !supported.includes(envelope.operation) || typeof session.executeOperation !== 'function') {
    throw meshOperationError('UNSUPPORTED_OPERATION', `This provider's runtime cannot run ${envelope.operation}`);
  }
  return session.executeOperation({ operation: envelope.operation, payload: structuredClone(envelope.payload), signal });
}

/** The envelope as a provider admits it, before its payload is disclosed: every field but the payload. */
export const meshOperationAdmission = ({ payload: _payload, ...admission }) => admission;
const admissionDigest = envelope => hashJson(meshOperationAdmission(envelope));
const RETAINED_ATTEMPTS = 64;
const remember = (map, key, value) => {
  map.set(key, value);
  while (map.size > RETAINED_ATTEMPTS) map.delete(map.keys().next().value);
};

/**
 * Provider protocol, in two steps like a charged whole-model generation (peer-generation.js):
 *  1. admission: a `MESH_OPERATION_REQUEST` carrying the envelope without its payload, the requester's `inputDigest`
 *     and its signed settlement terms. The provider authorizes the envelope against its own offer (so a requester that
 *     skipped the check is still refused), asks its host (`authorize({ action: 'operation.admit', ... })`), checks
 *     credit (`admit`), signs its acceptance of exactly those terms and answers with a `MESH_OPERATION_RESULT` that
 *     carries `admitted.settlementAcceptance`. Nothing is run and no payload has been seen.
 *  2. execution: a `MESH_OPERATION_REQUEST` with the whole envelope, which must be the admitted one with the admitted
 *     input digest. The host is asked again (`operation.execute`), the operation runs (`dispatch`) and the result carries
 *     the signed execution receipt and the signed closing stage receipt. A requester's cancel closes the attempt claiming
 *     nothing; this provider's own failure signs a stage fault. `MESH_OPERATION_RECEIPT` brings back the countersigned
 *     receipt and the requester's acknowledgment of the close, which completes this provider's records.
 * `maxRunning` bounds the attempts admitted or running at once; an admission past it is refused as busy. An admitted
 * attempt whose payload never comes is closed, claiming nothing, at its terms' deadline. `settlementAccount()` names
 * the account this provider is paid into, for terms that name the requester's; `onSettlementRecords` receives this
 * provider's records each time one is signed or received; `onReceipt` the countersigned receipt. Returns `{ close }`,
 * which refuses new work, aborts what runs and resolves once every attempt has ended.
 */
export function attachMeshOperations({ transport, identity, verifyPeer, currentPeer, offer, authorize, admit = async () => true, dispatch,
  settlementAccount = null, onSettlementRecords = null, onReceipt = null, maxRunning = 1, now = Date.now }) {
  if (typeof authorize !== 'function') throw new TypeError('attachMeshOperations needs the host authorize port');
  if (!Number.isSafeInteger(maxRunning) || maxRunning < 1) throw new TypeError('maxRunning must be a positive integer');
  const signer = createAttemptEvidenceSigner({ identity, now });
  const attempts = new Map(), served = new Map(), inFlight = new Set();
  let closed = false;
  const keep = charge => Promise.resolve().then(() => onSettlementRecords?.({ reservationId: charge.reservationId, records: charge.records() })).catch(() => {});
  const reply = (peer, payload) => { try { transport.sendToPeer(peer, MESH_OPERATION_RESULT, payload); } catch { /* The requester's timeout ends its wait. */ } };
  const refusal = (requestId, error, settlement = null) => ({ requestId, error: error?.message || 'Operation failed',
    ...(typeof error?.code === 'string' && Object.hasOwn(MESH_OPERATION_ERROR_CODES, error.code) ? { code: error.code } : {}),
    ...(settlement ? { settlement } : {}) });
  const track = work => { const running = work().catch(() => {}); inFlight.add(running); running.finally(() => inFlight.delete(running)); };
  // An attempt that ends before it ran (cancelled, expired, closed): its close claims nothing.
  const endUnrun = async (key, attempt, peer, error) => {
    if (attempts.get(key) !== attempt) return;
    attempts.delete(key);
    clearTimeout(attempt.timer);
    let settlement = null;
    try { settlement = { receipt: await attempt.charge.close({ failed: true }) }; await keep(attempt.charge); } catch { /* No close: the release window decides. */ }
    reply(peer, refusal(attempt.requestId, error, settlement));
  };

  const admitOperation = async (peer, input, key) => {
    const admission = input.envelope, requestId = admission.requestId;
    const attempt = { requestId, controller: new AbortController(), binding: JSON.stringify(transport.getPeerBinding(peer)), phase: 'admitting',
      charge: null, consumer: null, inputDigest: null, admissionDigest: null, timer: null, cancelled: false };
    attempts.set(key, attempt);
    try {
      if (Object.hasOwn(admission, 'payload')) throw invalid('An admission carries no payload');
      const consumer = await verifyPeer(peer, AbortSignal.timeout(5000));
      if (!consumer || currentPeer(peer) !== consumer) throw invalid('Verified requester required');
      if (admission.recipientGrant?.recipient !== identity.peerId) throw invalid('The envelope grants another recipient');
      authorizeFields(admission, offer());
      if (admission.planDigest !== await meshOperationPlanDigest(admission)) throw invalid('planDigest differs from the envelope');
      if (!DIGEST.test(input.inputDigest ?? '')) throw invalid('The admission needs the input digest the requester reserved');
      if (await authorize({ action: 'operation.admit', peerId: peer, consumer, envelope: structuredClone(admission) }) !== true) {
        throw meshOperationError('OPERATION_REFUSED', 'This provider does not serve this request; nothing was run');
      }
      attempt.controller.signal.throwIfAborted();
      const charge = await acceptMeshOperationCharge({ signer, settlement: input.settlement, consumer, requestId,
        planDigest: admission.planDigest, ...(settlementAccount ? { payoutAccount: await settlementAccount() } : {}), now });
      if (charge.maxCostUnits !== admission.maxCostUnits) throw invalid('Settlement terms cap another number of units than the envelope');
      await admit({ envelope: admission, consumer, inputDigest: input.inputDigest, settlement: structuredClone(input.settlement) });
      Object.assign(attempt, { charge, consumer, inputDigest: input.inputDigest, admissionDigest: await admissionDigest(admission) });
      await keep(charge);
      if (attempts.get(key) !== attempt) return;
      if (attempt.controller.signal.aborted) return void await endUnrun(key, attempt, peer, attempt.controller.signal.reason);
      attempt.phase = 'admitted';
      // An admission whose payload never arrives holds a slot until its terms' deadline, then closes claiming nothing.
      const deadline = Date.parse(input.settlement.terms.deadline);
      attempt.timer = setTimeout(() => void endUnrun(key, attempt, peer, invalid('The admitted payload did not arrive in time')), Math.max(0, deadline - now()));
      attempt.timer.unref?.();
      reply(peer, { requestId, admitted: { settlementAcceptance: charge.acceptance } });
    } catch (error) {
      if (attempts.get(key) === attempt) attempts.delete(key);
      reply(peer, refusal(requestId, error));
    }
  };

  const runOperation = async (peer, envelope, key) => {
    const attempt = attempts.get(key);
    if (!attempt) return void reply(peer, refusal(envelope.requestId, invalid('This operation was not admitted; nothing was run')));
    if (attempt.phase !== 'admitted') return;
    attempt.phase = 'running';
    clearTimeout(attempt.timer);
    const { charge, controller } = attempt;
    let ran = false;
    try {
      if (JSON.stringify(transport.getPeerBinding(peer)) !== attempt.binding || currentPeer(peer) !== attempt.consumer) {
        throw invalid('The requester connection changed');
      }
      assertMeshOperationEnvelope(envelope);
      if (await admissionDigest(envelope) !== attempt.admissionDigest || await meshOperationInputDigest(envelope) !== attempt.inputDigest) {
        throw invalid('The operation differs from the one admitted');
      }
      authorizeMeshOperation(envelope, offer());
      if (await authorize({ action: 'operation.execute', peerId: peer, consumer: attempt.consumer, envelope: structuredClone(envelope) }) !== true) {
        throw meshOperationError('OPERATION_REFUSED', 'This provider does not serve this request; nothing was run');
      }
      controller.signal.throwIfAborted();
      ran = true;
      const output = await dispatch(envelope, controller.signal);
      controller.signal.throwIfAborted();
      const count = meshOperationUnits(envelope.operation, output), outputDigest = await hashJson(output);
      const draft = await createReceiptDraft({ version: 2, provider: identity.peerId, consumer: attempt.consumer, jobHash: `request:${envelope.requestId}`,
        model: envelope.modelId, modelIdentity: envelope.manifestDigest, adapterIdentities: [], inputDigest: attempt.inputDigest,
        outputDigest, inputTokens: Number.isSafeInteger(output?.promptTokenCount) ? output.promptTokenCount : 0,
        outputTokens: count, usage: MESH_OPERATION_UNITS,
        stopReason: `operation:${envelope.operation}`, cleanup: 'settled', ownerPolicyDigest: null, status: 'completed', timestamp: now() });
      const receipt = await signReceiptDraft(draft, identity);
      const closing = await charge.close({ units: count, outputDigest, stopReason: `operation:${envelope.operation}` });
      remember(served, key, { charge, consumer: attempt.consumer, providerSignature: receipt.providerSignature });
      await keep(charge);
      reply(peer, { requestId: envelope.requestId, output, receipt, settlement: { receipt: closing } });
    } catch (error) {
      // The requester ended it, or it never ran: a close that claims nothing. This provider failed while running it: its fault.
      let settlement = null;
      try {
        settlement = attempt.cancelled || !ran ? { receipt: await charge.close({ failed: true }) } : { fault: await charge.fault() };
        await keep(charge);
      } catch { /* Neither record: the release window decides. */ }
      reply(peer, refusal(envelope.requestId, error, settlement));
    } finally { if (attempts.get(key) === attempt) attempts.delete(key); }
  };

  transport.onMessage(MESH_OPERATION_CANCEL, (peer, input) => {
    const key = JSON.stringify([peer, input?.requestId]), attempt = attempts.get(key);
    if (!attempt) return;
    attempt.cancelled = true;
    attempt.controller.abort(new Error('Requester cancelled'));
    if (attempt.phase === 'admitted') track(() => endUnrun(key, attempt, peer, new Error('Requester cancelled')));
  });
  transport.onMessage(MESH_OPERATION_REQUEST, (peer, input) => {
    const envelope = input?.envelope, requestId = envelope?.requestId;
    if (!REQUEST_ID.test(requestId ?? '') || !transport.getPeerBinding(peer)) return;
    const key = JSON.stringify([peer, requestId]);
    if (closed) return void reply(peer, refusal(requestId, meshOperationError('OPERATION_REFUSED', 'This provider is closing; nothing was run')));
    // The whole envelope runs an admitted attempt; an envelope without a payload asks for admission.
    if (envelope && Object.hasOwn(envelope, 'payload')) return track(() => runOperation(peer, envelope, key));
    if (attempts.has(key) || served.has(key)) return;
    if (attempts.size >= maxRunning) return void reply(peer, refusal(requestId, meshOperationError('OPERATION_BUSY', 'This provider is busy; nothing was run')));
    track(() => admitOperation(peer, input, key));
  });
  transport.onMessage(MESH_OPERATION_RECEIPT, (peer, input) => track(async () => {
    const key = JSON.stringify([peer, input?.requestId]), entry = served.get(key), receipt = input?.receipt;
    if (!entry || receipt?.providerSignature !== entry.providerSignature || receipt.consumer !== entry.consumer) return;
    const checked = await verifyReceipt(receipt);
    if (!checked.providerValid || !checked.consumerValid || served.get(key) !== entry) return;
    served.delete(key);
    if (await entry.charge.acknowledged(input.settlementAcknowledgment)) await keep(entry.charge);
    await onReceipt?.(structuredClone(receipt));
  }));
  return Object.freeze({
    /** Attempts admitted or running now. */
    running: () => attempts.size,
    async close() {
      closed = true;
      for (const attempt of attempts.values()) attempt.controller.abort(new Error('Provider closed'));
      for (const [key, attempt] of [...attempts]) if (attempt.phase === 'admitted') track(() => endUnrun(key, attempt, null, new Error('Provider closed')));
      while (inFlight.size) await Promise.allSettled([...inFlight]);
    }
  });
}

const replies = new WeakMap();
/**
 * Requester protocol (attachMeshOperations): asks the verified provider peer to admit the envelope without its payload,
 * sends the payload only once the provider's signed acceptance of `settlement`'s terms verifies, and returns
 * `{ output, receipt, closing, deliver }`. A closing record or fault that arrives after the call ended is still kept.
 * An error before the payload left carries `payloadSent: false`.
 */
export async function requestMeshOperation({ transport, verifyPeer, currentPeer, providerPeer, envelope, settlement, signal = AbortSignal.timeout(60_000) }) {
  // A call that is already stopped ends here, before anything is sent: an abort listener never fires for it.
  signal.throwIfAborted();
  assertMeshOperationEnvelope(envelope);
  if (typeof settlement?.accept !== 'function' || typeof settlement.close !== 'function') {
    throw invalid('A mesh operation needs its signed settlement terms (openMeshOperationCharge); nothing was sent');
  }
  const providerParticipantId = envelope.recipientGrant.recipient;
  if (!transport.getPeerBinding(providerPeer) || await verifyPeer(providerPeer, signal) !== providerParticipantId) {
    throw meshOperationError('OPERATION_OFFER_MISMATCH', 'Could not verify the granted recipient');
  }
  const inputDigest = await meshOperationInputDigest(envelope);
  signal.throwIfAborted();
  let channel = replies.get(transport);
  if (!channel) {
    channel = { waiting: new Map(), ended: new Map() };
    replies.set(transport, channel);
    transport.onMessage(MESH_OPERATION_RESULT, (peer, result) => {
      const key = JSON.stringify([peer, result?.requestId]);
      const waiting = channel.waiting.get(key);
      if (waiting) return waiting(result);
      // The provider's close or fault of a call that already ended here: kept with the requester's records.
      const record = result?.settlement?.receipt ?? result?.settlement?.fault;
      const ended = channel.ended.get(key);
      if (ended && record && currentPeer(peer) === ended.provider) void ended.charge.close(record).catch(() => {});
    });
  }
  const key = JSON.stringify([providerPeer, envelope.requestId]);
  const connected = () => currentPeer(providerPeer) === providerParticipantId;
  return new Promise((resolve, reject) => {
    let phase = 'admitting', disclosed = false;
    const abort = () => {
      try { transport.sendToPeer(providerPeer, MESH_OPERATION_CANCEL, { requestId: envelope.requestId }); } catch { /* The provider's deadline ends it. */ }
      finish(signal.reason);
    };
    const finish = (error, value) => {
      if (phase === 'done') return;
      phase = 'done';
      channel.waiting.delete(key);
      signal.removeEventListener('abort', abort);
      if (!error) return resolve(value);
      remember(channel.ended, key, { charge: settlement, provider: providerParticipantId });
      // The requester knows the payload never left: its host may settle the hold with a stop at zero.
      if (!disclosed && error && typeof error === 'object') error.payloadSent = false;
      reject(error);
    };
    const send = (payload, failure) => {
      try { if (!transport.sendToPeer(providerPeer, MESH_OPERATION_REQUEST, payload)) finish(meshOperationError('OPERATION_OFFER_MISMATCH', failure)); }
      catch (error) { finish(error); }
    };
    channel.waiting.set(key, result => {
      if (!connected()) return finish(meshOperationError('OPERATION_OFFER_MISMATCH', 'The provider connection changed'));
      const record = result?.settlement?.receipt ?? result?.settlement?.fault;
      if (result?.error) {
        if (record) void settlement.close(record).catch(() => {});
        return finish(Object.hasOwn(MESH_OPERATION_ERROR_CODES, result.code ?? '') ? meshOperationError(result.code, result.error) : new Error(result.error));
      }
      if (result?.admitted) {
        if (phase !== 'admitting') return;
        phase = 'accepting';
        return void settlement.accept(result.admitted.settlementAcceptance).then(() => {
          if (phase !== 'accepting') return;
          phase = 'sent';
          disclosed = true;
          send({ envelope }, 'Provider unavailable');
        }, () => {
          if (phase !== 'accepting') return;
          try { transport.sendToPeer(providerPeer, MESH_OPERATION_CANCEL, { requestId: envelope.requestId }); } catch { /* Nothing was disclosed. */ }
          finish(meshOperationError('OPERATION_RESULT_INVALID', 'The provider did not sign an acceptance of the settlement terms; the payload was not sent'));
        });
      }
      if (phase !== 'sent') return finish(meshOperationError('OPERATION_RESULT_INVALID', 'The provider answered before it was sent the payload'));
      finish(null, { output: result.output, receipt: result.receipt, closing: result.settlement?.receipt ?? null,
        // Synchronous: the acknowledgment is held only if this frame leaves (openMeshOperationCharge, acknowledge).
        deliver: ({ receipt, acknowledgment }) => connected() && transport.sendToPeer(providerPeer, MESH_OPERATION_RECEIPT,
          { requestId: envelope.requestId, receipt, settlementAcknowledgment: acknowledgment }) !== false });
    });
    signal.addEventListener('abort', abort, { once: true });
    send({ envelope: meshOperationAdmission(envelope), inputDigest, settlement: { terms: settlement.terms, charge: settlement.charge } }, 'Provider unavailable');
  });
}


/**
 * Signed settlement records for a whole-model operation: the single-stage case of the records a split answer signs
 * (settlement-terms.js, partitions/partition-attempt-evidence.js), so the same replay settles both
 * (docs/settlement-replay.md, "Whole-model operations").
 *
 *   requester  terms (price, cost cap, the one stage, its own account) and the charge binding, before any input leaves
 *   provider   acceptance of exactly those terms (with its payout account), before it is sent the input
 *   provider   one closing stage receipt: the units it delivered and a chain value that commits to the output; a close
 *              that claims nothing when the requester ended the answer; or a stage fault when the provider itself failed
 *   requester  one acknowledgment of those units, once the whole output has arrived and matches
 *   requester  a stop, when the person ends the answer first
 *
 * A whole-model operation is charged whole or not at all, as its ledger hold always was: there is no acknowledged
 * prefix, the provider signs its count once at the end, and the acknowledgment bound the terms carry is the
 * policy's, which a single whole-model stage does not enforce (it risks the whole answer, as it did before).
 */
export const MESH_OPERATION_ATTEMPT_SCHEMA = 'reploid.mesh-operation-attempt/v1';
export const MESH_OPERATION_SETTLEMENT_RECORDS_SCHEMA = 'reploid.mesh-operation-settlement-records/v1';
/** The whole-model route of an operation plan: what `planDigest` binds for one named recipient. */
const WHOLE_MODEL_EXECUTION = Object.freeze({ protection: 'plaintext', route: 'remote' });

/** The plan digest of a whole-model operation served by `recipient`, as both sides compute it. */
export const wholeModelOperationPlanDigest = ({ operation, modelId, manifestDigest, recipient }) =>
  meshOperationPlanDigest({ operation, modelId, manifestDigest, execution: WHOLE_MODEL_EXECUTION, recipientGrant: { recipient } });

/** The route hash every record of one whole-model attempt carries: the requester, the request and the plan. */
export const meshOperationRouteHash = ({ requesterId, requestId, planDigest }) =>
  hashJson({ schema: MESH_OPERATION_ATTEMPT_SCHEMA, requesterId, requestId, planDigest });

/**
 * The chain value after `units` delivered units. A whole-model stage signs once, at the end, so every step but the
 * last extends the chain with no text and the last extends it with the digest of the whole output.
 */
export async function meshOperationOutputChain({ reservationId, routeHash, units, outputDigest }) {
  let chain = await outputChainGenesis({ reservationId, routeHash });
  for (let step = 0; step < units; step += 1) chain = await extendOutputChain(chain, { step, delta: step === units - 1 ? outputDigest : '' });
  return chain;
}

const settlementRefusal = message => meshOperationError('OPERATION_RESULT_INVALID', message);
const iso = ms => new Date(ms).toISOString();
const units = value => Number.isSafeInteger(value) && value >= 0;
/** True for a closing receipt that claims a delivered output. */
const claimsOutput = receipt => receipt.status === 'settled' && receipt.output?.done === true;

/**
 * Requester side. Signs the terms and the charge binding for one whole-model attempt, then keeps every record of it.
 * `policy` is the public credit policy the ledger quoted; `debitAccount` the ledger account the hold sits on.
 * Returns `{ terms, charge, routeHash, accept, acknowledge, close, stop, records, summary }`.
 */
export async function openMeshOperationCharge({ signer, requestId, planDigest, recipient, reservationId, policy, maxCostUnits,
  debitAccount = undefined, now = signer?.now ?? Date.now }) {
  const routeHash = await meshOperationRouteHash({ requesterId: signer.participantId, requestId, planDigest });
  const notBefore = now();
  const terms = await signSettlementTermsFor({ signer, reservationId, attemptId: requestId, routeHash, requesterId: signer.participantId,
    participants: [recipient], weights: [1], policy, maxOutputTokens: maxCostUnits, notBefore, deadline: notBefore + policy.maxRequestMs,
    maxUnacknowledgedOutputs: policy.maxUnacknowledgedOutputs ?? MAX_UNACKNOWLEDGED_OUTPUTS, debitAccount, mode: WHOLE_MODEL_TERMS_MODE, now });
  const { publicJwk: _key, signature: _signature, ...body } = terms;
  const digest = await termsDigest(body), genesis = await outputChainGenesis({ reservationId, routeHash });
  const acknowledgment = (count, chain) => signer.sign(OUTPUT_ACKNOWLEDGMENT_SCHEMA, { schema: OUTPUT_ACKNOWLEDGMENT_SCHEMA, reservationId,
    attemptId: requestId, routeHash, requesterId: signer.participantId, count, chain, signedAt: iso(now()) });
  const charge = await acknowledgment(0, genesis);
  const held = { acceptance: null, receipt: null, fault: null, acknowledged: null, stop: null };
  // An attempt is acknowledged or stopped, never both (docs/settlement-replay.md: an acknowledgment of N with a stop at
  // zero would have the replay charge N while the ledger settled the stop). `stopping` is set the moment a stop is
  // asked for, before it is signed, so an acknowledgment still being signed is discarded.
  let stopping = null;
  // The windows the replay counts a record in (docs/settlement-replay.md, steps 4 to 9): an acceptance and an
  // acknowledgment from notBefore to the deadline, each with the policy's clock allowance, and a close or a fault
  // until the ledger releases a silent whole-model hold, strictly before deadline + releaseWindowMs ("Release window"). A record outside its window would be held here and ignored by the replay, so the
  // ledger would charge what the records do not show; it is refused instead.
  const skew = Number.isFinite(policy?.maxClockSkewMs) && policy.maxClockSkewMs > 0 ? policy.maxClockSkewMs : 0;
  const opensAt = Date.parse(body.notBefore) - skew, endsAt = Date.parse(body.deadline) + skew;
  const inTime = value => Date.parse(value) >= opensAt && Date.parse(value) <= endsAt;
  const closesInTime = value => Date.parse(value) >= opensAt && Date.parse(value) < Date.parse(body.deadline) + body.releaseWindowMs;
  const ownFault = async fault => {
    const checked = await verifySettlementFault(fault);
    const row = checked.body;
    if (!checked.ok || row.reservationId !== reservationId || row.attemptId !== requestId || row.routeHash !== routeHash
      || row.partitionIndex !== 0 || row.participantId !== recipient || !closesInTime(row.signedAt)) {
      throw settlementRefusal('The provider\'s fault is not its signed, in-time fault of this attempt');
    }
  };
  const ownReceipt = async receipt => {
    const checked = await verifyStageReceipt(receipt);
    const row = checked.body;
    if (!checked.ok || row.reservationId !== reservationId || row.attemptId !== requestId || row.routeHash !== routeHash
      || row.partitionIndex !== 0 || row.participantId !== recipient || row.timing.closedAt === null || row.status === 'executing'
      || !closesInTime(row.signedAt)) {
      throw settlementRefusal('The provider\'s closing record is not its signed, in-time close of this attempt');
    }
    return row;
  };
  return Object.freeze({
    terms: structuredClone(terms), charge: structuredClone(charge), routeHash, reservationId,
    /** The provider's acceptance of exactly these terms; throws unless it is. Nothing is sent before this passes. */
    async accept(acceptance) {
      const checked = await verifySettlementAcceptance(acceptance);
      const row = checked.body;
      if (!checked.ok || row.termsDigest !== digest || row.reservationId !== reservationId || row.attemptId !== requestId
        || row.participantId !== recipient || row.partitionIndex !== 0
        || Object.hasOwn(body, 'debitAccount') !== Object.hasOwn(row, 'payoutAccount') || !inTime(row.signedAt)) {
        throw settlementRefusal('The provider did not sign an in-time acceptance of these settlement terms');
      }
      held.acceptance = structuredClone(acceptance);
      return true;
    },
    /**
     * The provider's closing receipt for a delivered output of `delivered` units whose digest is `outputDigest` (both
     * from the provider's execution receipt, which the caller has verified against what arrived). Signs and returns the
     * acknowledgment of exactly that count; throws when the receipt commits to anything else, or when this requester's
     * own clock is past the window an acknowledgment counts in. Asked again for the receipt it already acknowledged,
     * it returns the same acknowledgment.
     *
     * An attempt that was stopped is never acknowledged: this throws when a stop was asked for before or while the
     * acknowledgment was being signed. `send(acknowledgment)`, when given, runs synchronously at the moment the
     * acknowledgment becomes held, so the caller can send it in the same step; if it returns false or throws, the
     * acknowledgment is discarded as if it had never been signed. From that moment a stop is refused.
     */
    async acknowledge({ receipt, units: delivered, outputDigest, send = undefined }) {
      const stopped = () => settlementRefusal('This attempt was stopped; nothing is acknowledged');
      if (held.acknowledged && held.receipt?.signature === receipt?.signature) {
        send?.(structuredClone(held.acknowledged));
        return structuredClone(held.acknowledged);
      }
      if (stopping) throw stopped();
      const row = await ownReceipt(receipt);
      if (!inTime(iso(now()))) throw settlementRefusal('The answer arrived outside the window its settlement terms cover');
      if (!units(delivered) || delivered > maxCostUnits || row.status !== 'settled' || row.steps !== delivered || row.output?.count !== delivered
        || row.output.done !== true || row.output.chain !== await meshOperationOutputChain({ reservationId, routeHash, units: delivered, outputDigest })) {
        throw settlementRefusal('The provider\'s closing record does not commit to the output that arrived');
      }
      const signed = delivered === 0 ? structuredClone(charge) : await acknowledgment(delivered, row.output.chain);
      // From here to the return there is no await: the acknowledgment is held and sent in one step, or not at all.
      if (stopping) throw stopped();
      if (held.fault) throw settlementRefusal('The provider already signed a fault for this attempt; its later closing record is not acknowledged');
      if (held.acknowledged) throw settlementRefusal('This attempt already acknowledged another closing record');
      const before = held.receipt;
      held.receipt = structuredClone(receipt);
      held.acknowledged = signed;
      let sent;
      try { sent = typeof send === 'function' ? send(structuredClone(signed)) : true; }
      catch (error) { held.receipt = before; held.acknowledged = null; throw error; }
      if (sent === false) {
        held.receipt = before; held.acknowledged = null;
        throw settlementRefusal('The acknowledgment was not sent, so it is not held');
      }
      return structuredClone(signed);
    },
    /**
     * Keeps what the provider signed for an answer that did not complete: its closing receipt, or its stage fault when
     * it failed itself. Nothing is acknowledged. A provider signs one or the other (acceptMeshOperationCharge): a fault
     * that arrives once any receipt is held, or a receipt once a fault is held, is refused and not kept. Otherwise a
     * provider could add a fault to the records of an answer it was already paid for, and the replay of those records
     * would no longer give the amount the ledger posted.
     */
    async close(record) {
      if (record?.schema === SETTLEMENT_FAULT_SCHEMA) {
        await ownFault(record);
        if (held.receipt) throw settlementRefusal('The provider already closed this attempt; its later fault is not kept');
        held.fault ??= structuredClone(record);
        return true;
      }
      await ownReceipt(record);
      if (held.fault) throw settlementRefusal('The provider already signed a fault for this attempt; its later closing record is not kept');
      held.receipt ??= structuredClone(record);
      return true;
    },
    /**
     * The requester's signed stop of this attempt: a whole-model answer has no acknowledged prefix, so it stops at zero.
     * Refused once the attempt's acknowledgment is held: that answer completed and its charge stands.
     */
    async stop() {
      if (held.acknowledged) throw settlementRefusal('This attempt was acknowledged before the stop; it completed and cannot be stopped');
      stopping ??= signSettlementStop({ signer, terms: body, acknowledged: 0, now });
      held.stop = await stopping;
      return structuredClone(held.stop);
    },
    /** Every record this requester holds of the attempt, in the order they were signed. */
    records: () => structuredClone([terms, charge, held.acceptance, held.receipt, held.fault, held.acknowledged, held.stop]
      .filter((record, index, all) => record && all.findIndex(other => other?.signature === record.signature) === index)),
    /**
     * What is held, and what an outsider would still miss. `complete` means the records decide the outcome now: the
     * acceptance, and either the provider's close with this requester's acknowledgment, its close that claims nothing,
     * or its fault. Without any of the provider's three the outcome is decided only once the release window has passed.
     */
    summary() {
      const delivered = held.receipt && (claimsOutput(held.receipt));
      const missing = [...(held.acceptance ? [] : ['acceptance']), ...(held.receipt || held.fault ? [] : ['close']),
        ...(delivered && !held.acknowledged ? ['acknowledgment'] : [])];
      return { reservationId, attemptId: requestId, routeHash, requesterId: signer.participantId, providerId: recipient,
        accepted: Boolean(held.acceptance), closed: Boolean(held.receipt), faulted: Boolean(held.fault), acknowledged: held.acknowledged?.count ?? null, stopped: Boolean(held.stop),
        complete: missing.length === 0, missing };
    }
  });
}

/**
 * Provider side. Checks the requester's terms and charge binding for a whole-model attempt this provider is asked to
 * serve and signs its acceptance. `consumer` is the requester's verified identity and `planDigest` this provider's own
 * digest of the plan (wholeModelOperationPlanDigest). Terms that name the requester's account are accepted only with
 * `payoutAccount`. Throws to refuse. Returns `{ acceptance, reservationId, close, acknowledged, records }`.
 */
export async function acceptMeshOperationCharge({ signer, settlement, consumer, requestId, planDigest, payoutAccount = undefined,
  now = signer?.now ?? Date.now }) {
  const checked = await verifySettlementTerms(settlement?.terms);
  const body = checked.body;
  if (!checked.ok) throw invalid(`Settlement terms do not verify: ${checked.problem}`);
  const routeHash = await meshOperationRouteHash({ requesterId: consumer, requestId, planDigest });
  if (body.requesterId !== consumer || body.attemptId !== requestId || body.routeHash !== routeHash || body.shares.length !== 1
    || body.shares[0].participantId !== signer.participantId) throw invalid('Settlement terms name another attempt, plan or provider');
  const { reservationId } = body, genesis = await outputChainGenesis({ reservationId, routeHash });
  const bound = await verifyOutputAcknowledgment(settlement.charge);
  if (!bound.ok || bound.body.count !== 0 || bound.body.reservationId !== reservationId || bound.body.attemptId !== requestId
    || bound.body.routeHash !== routeHash || bound.body.requesterId !== consumer || bound.body.chain !== genesis) {
    throw invalid('The charge binding is not the requester\'s signed binding of this attempt');
  }
  // A whole-model stage enforces no acknowledgment bound, so it accepts the one the requester's policy publishes.
  const acceptance = await acceptSettlementTerms({ signer, terms: settlement.terms, partitionIndex: 0,
    maxUnacknowledgedOutputs: body.maxUnacknowledgedOutputs, now,
    // Accounts are signed by both parties or by neither (settlement-terms.js).
    ...(Object.hasOwn(body, 'debitAccount') ? { payoutAccount } : {}) });
  const reservedAt = iso(now());
  const held = { receipt: null, fault: null, acknowledged: null };
  return Object.freeze({
    acceptance: structuredClone(acceptance), reservationId, routeHash, maxCostUnits: body.maxOutputTokens,
    /**
     * The closing receipt, signed once: `delivered` units and the output's digest for a completed operation, or
     * `failed` for one that ended early, which claims nothing.
     */
    async close({ units: delivered = 0, outputDigest = null, stopReason = null, promptUnits = null, failed = false } = {}) {
      if (held.receipt) return structuredClone(held.receipt);
      if (held.fault) throw invalid('A stage that signed a fault signs no closing receipt');
      const done = failed !== true;
      if (done && !(units(delivered) && DIGEST.test(outputDigest ?? ''))) throw invalid('A closing receipt needs the delivered units and the output digest');
      const count = done ? delivered : 0, at = iso(now());
      held.receipt = await signer.sign(STAGE_RECEIPT_SCHEMA, { schema: STAGE_RECEIPT_SCHEMA, reservationId, attemptId: requestId, routeHash,
        partitionIndex: 0, participantId: signer.participantId, sequence: 1, status: done ? 'settled' : 'failed', steps: count,
        tokens: { prompt: units(promptUnits) ? promptUnits : null, processed: (units(promptUnits) ? promptUnits : 0) + count },
        timing: { reservedAt, firstStepAt: null, lastStepAt: null, closedAt: at },
        output: { count, chain: done ? await meshOperationOutputChain({ reservationId, routeHash, units: count, outputDigest }) : genesis, done,
          stopReason: done && typeof stopReason === 'string' ? stopReason.slice(0, 64) : null }, signedAt: at });
      return structuredClone(held.receipt);
    },
    /**
     * This provider's own signed fault: it failed, signs no closing receipt and is owed nothing for this attempt.
     * Signed only when the provider itself failed, never because the requester ended the answer.
     */
    async fault() {
      if (held.receipt) throw invalid('A stage that closed signs no fault');
      held.fault ??= await signStageFaultRecord({ signer, reservationId, attemptId: requestId, routeHash, partitionIndex: 0, now });
      return structuredClone(held.fault);
    },
    /** Keeps the requester's acknowledgment of this provider's closing receipt; false when it is not one. */
    async acknowledged(acknowledgment) {
      const signed = await verifyOutputAcknowledgment(acknowledgment, { publicJwk: settlement.charge.publicJwk });
      const closing = held.receipt?.output;
      if (!signed.ok || !closing || signed.body.reservationId !== reservationId || signed.body.attemptId !== requestId
        || signed.body.routeHash !== routeHash || signed.body.requesterId !== consumer || signed.body.count !== closing.count
        || signed.body.chain !== closing.chain) return false;
      held.acknowledged = structuredClone(acknowledgment);
      return true;
    },
    /** Every record this provider holds of the attempt. */
    records: () => structuredClone([settlement.terms, settlement.charge, acceptance, held.receipt, held.fault, held.acknowledged]
      .filter((record, index, all) => record && all.findIndex(other => other?.signature === record.signature) === index))
  });
}

/** The schemas an exported record set may contain, for a reader that sorts them. */
export const MESH_OPERATION_SETTLEMENT_RECORD_SCHEMAS = Object.freeze([SETTLEMENT_TERMS_SCHEMA, OUTPUT_ACKNOWLEDGMENT_SCHEMA,
  SETTLEMENT_ACCEPTANCE_SCHEMA, STAGE_RECEIPT_SCHEMA, SETTLEMENT_FAULT_SCHEMA, SETTLEMENT_STOP_SCHEMA]);
