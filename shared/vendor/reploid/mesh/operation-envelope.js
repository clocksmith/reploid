/**
 * One operation-agnostic mesh envelope. `generate`, `scoreTargetSequence`, `scoreChoices` and `embed` reach a named
 * provider's resident model the same way: the requester authorizes the envelope against the provider's discovered
 * offer before anything is held or sent, reserves the operation's cost, sends the envelope, verifies the provider's
 * signed receipt, countersigns it and settles. Cancellation, refusal codes and the receipt are the same for every
 * operation; each operation only declares its cost unit and whether an ordered split can run it.
 *
 * This module owns the sequence and the wire protocol. Hosts supply the ports: discovery (`offer`), the ledger
 * (`reserve`, `settle`, `cancel`), the transport (`send`) and, on a provider, the resident session (`dispatch`).
 */
import { createReceiptDraft, signReceiptDraft, verifyReceipt } from '../artifacts/receipt.js';
import { hashJson } from '../artifacts/signatures.js';
import { AUTO_ROUTES, PROTECTIONS, PROTECTION_ROUTES } from '../chat/execution-policy.js';

export const MESH_OPERATION_SCHEMA = 'reploid.mesh-operation/v1';
export const MESH_OPERATION_GRANT_SCHEMA = 'reploid.mesh-operation-grant/v1';
/** The unit a non-generation receipt counts in (its signed `usage`); generation keeps `raw-model-tokens/v1`. */
export const MESH_OPERATION_UNITS = 'reploid.mesh-operation-units/v1';
export const MESH_OPERATION_REQUEST = 'reploid:mesh-operation-request';
export const MESH_OPERATION_RESULT = 'reploid:mesh-operation-result';
export const MESH_OPERATION_CANCEL = 'reploid:mesh-operation-cancel';

/**
 * Every operation the envelope carries. `costUnit` is what one charged unit is; `orderedSplit` says whether an
 * ordered split route (stages in sequence) can run it. Only generation streams through stages today.
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
  OPERATION_RESULT_INVALID: 'OPERATION_RESULT_INVALID'
});

export const meshOperationError = (code, message) => {
  if (!Object.hasOwn(MESH_OPERATION_ERROR_CODES, code)) throw new Error(`Unknown mesh operation error code ${code}`);
  return Object.assign(new Error(message), { code });
};

const SPLIT_ROUTES = Object.freeze(['split', 'split-local-edges']);
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const PARTICIPANT = /^peer:[a-f0-9]{24}$/;
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

/** Shape checks only; authorization against an offer is authorizeMeshOperation. */
export function assertMeshOperationEnvelope(envelope) {
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
  if (!object(envelope.payload)) throw invalid('payload must be an object');
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
 * with nothing held or sent. Ports:
 *  - `offer(envelope)`: the recipient's discovered offer (synchronous);
 *  - `reserve(envelope, inputDigest)`: holds the cost; returns a hold, or null for free execution;
 *  - `send(envelope, { signal })`: delivers the envelope and returns `{ output, receipt }` with the provider's signed receipt;
 *  - `countersign(receipt)`: the requester's countersignature;
 *  - `settle(hold, receipt)`: settles the countersigned receipt; `cancel(hold, error)` releases or fences after a failure.
 * Resolves `{ acknowledgedUnits, output, providerReceipt, settlement }`.
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
    let receipt, output;
    try {
      ({ output, receipt } = await ports.send(envelope, { signal }));
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
    } catch (error) {
      await ports.cancel(hold, error).catch(() => {});
      throw error;
    }
    const providerReceipt = await ports.countersign(receipt);
    const settlement = await ports.settle(hold, providerReceipt);
    return { acknowledgedUnits: providerReceipt.outputTokens, output, providerReceipt, settlement, costUnit: operation.costUnit };
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

/**
 * Provider protocol. `offer()` is this provider's own current offer; `admit({ envelope, consumer, inputDigest })`
 * is its credit admission (resolves, or throws to refuse); `dispatch(envelope, signal)` runs the operation. The
 * provider authorizes the envelope against its own offer as the requester did, so a requester that skipped the
 * check is still refused before the session is touched.
 */
export function attachMeshOperations({ transport, identity, verifyPeer, currentPeer, offer, admit = async () => true, dispatch, now = Date.now }) {
  const running = new Map();
  transport.onMessage(MESH_OPERATION_CANCEL, (peer, input) => running.get(JSON.stringify([peer, input?.requestId]))?.abort(new Error('Requester cancelled')));
  transport.onMessage(MESH_OPERATION_REQUEST, (peer, input) => {
    void (async () => {
      const envelope = input?.envelope, requestId = envelope?.requestId;
      if (!REQUEST_ID.test(requestId ?? '') || !transport.getPeerBinding(peer)) return;
      const key = JSON.stringify([peer, requestId]);
      if (running.has(key)) return;
      const controller = new AbortController();
      running.set(key, controller);
      const refuse = error => transport.sendToPeer(peer, MESH_OPERATION_RESULT, { requestId, error: error?.message || 'Operation failed',
        ...(typeof error?.code === 'string' && Object.hasOwn(MESH_OPERATION_ERROR_CODES, error.code) ? { code: error.code } : {}) });
      try {
        const consumer = await verifyPeer(peer, AbortSignal.timeout(5000));
        if (!consumer || currentPeer(peer) !== consumer) throw invalid('Verified requester required');
        if (envelope.recipientGrant?.recipient !== identity.peerId) throw invalid('The envelope grants another recipient');
        authorizeMeshOperation(envelope, offer());
        if (envelope.planDigest !== await meshOperationPlanDigest(envelope)) throw invalid('planDigest differs from the envelope');
        const inputDigest = await meshOperationInputDigest(envelope);
        await admit({ envelope, consumer, inputDigest });
        const output = await dispatch(envelope, controller.signal);
        controller.signal.throwIfAborted();
        const draft = await createReceiptDraft({ version: 2, provider: identity.peerId, consumer, jobHash: `request:${requestId}`,
          model: envelope.modelId, modelIdentity: envelope.manifestDigest, adapterIdentities: [], inputDigest,
          outputDigest: await hashJson(output), inputTokens: Number.isSafeInteger(output?.promptTokenCount) ? output.promptTokenCount : 0,
          outputTokens: meshOperationUnits(envelope.operation, output), usage: MESH_OPERATION_UNITS,
          stopReason: `operation:${envelope.operation}`, cleanup: 'settled', ownerPolicyDigest: null, status: 'completed', timestamp: now() });
        transport.sendToPeer(peer, MESH_OPERATION_RESULT, { requestId, output, receipt: await signReceiptDraft(draft, identity) });
      } catch (error) { refuse(error); } finally { running.delete(key); }
    })().catch(() => {});
  });
}

const replies = new WeakMap();
/** Requester protocol: sends an authorized envelope to the verified provider peer and returns `{ output, receipt }`. */
export async function requestMeshOperation({ transport, verifyPeer, currentPeer, providerPeer, envelope, signal = AbortSignal.timeout(60_000) }) {
  const providerParticipantId = envelope.recipientGrant.recipient;
  if (!transport.getPeerBinding(providerPeer) || await verifyPeer(providerPeer, signal) !== providerParticipantId) {
    throw meshOperationError('OPERATION_OFFER_MISMATCH', 'Could not verify the granted recipient');
  }
  let waiting = replies.get(transport);
  if (!waiting) {
    waiting = new Map();
    replies.set(transport, waiting);
    transport.onMessage(MESH_OPERATION_RESULT, (peer, result) => waiting.get(JSON.stringify([peer, result?.requestId]))?.(result));
  }
  const key = JSON.stringify([providerPeer, envelope.requestId]);
  return new Promise((resolve, reject) => {
    const abort = () => {
      transport.sendToPeer(providerPeer, MESH_OPERATION_CANCEL, { requestId: envelope.requestId });
      finish(signal.reason);
    };
    const finish = (error, value) => {
      waiting.delete(key);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    waiting.set(key, result => {
      if (currentPeer(providerPeer) !== providerParticipantId) return finish(meshOperationError('OPERATION_OFFER_MISMATCH', 'The provider connection changed'));
      if (result.error) {
        return finish(Object.hasOwn(MESH_OPERATION_ERROR_CODES, result.code ?? '') ? meshOperationError(result.code, result.error) : new Error(result.error));
      }
      finish(null, { output: result.output, receipt: result.receipt });
    });
    signal.addEventListener('abort', abort, { once: true });
    try {
      if (!transport.sendToPeer(providerPeer, MESH_OPERATION_REQUEST, { envelope })) throw meshOperationError('OPERATION_OFFER_MISMATCH', 'Provider unavailable');
    } catch (error) { finish(error); }
  });
}

