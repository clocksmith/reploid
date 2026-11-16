import { exportPublicKey } from "../../../shared/pool/inference-receipt.js";

import {
  PEER_CONTROL_NETWORK,
  PEER_CONTROL_VERSION,
  PEER_MESSAGE_TYPES,
  createPeerMessage,
  createSignedPeerMessage,
  hashPeerMessage,
  peerMessageSigningPayload,
  requirePeerString as requireString,
  signPeerMessage,
  validatePeerMessage,
  verifyPeerMessage
} from './peer-protocol.js';
import {
  PEER_CONTROL_BUS_VERSION,
  createDataChannelPeerBus,
  createInMemoryPeerBus
} from './peer-transport.js';
import {
  createPeerEventReducer,
  createPeerLedgerEvents
} from './peer-ledger.js';

import {
  createPeerPromptPayload,
  createPeerSequencePayload,
  validateInputPayloadForAssignment,
  validatePromptPayloadForAssignment,
  validateSequencePayloadForAssignment
} from './peer-payload.js';

import { createSignedJobIntent, createSignedProviderAdvert } from "./peer-signed-claims.js";
import { buildPeerAssignmentPlan, validatePeerAssignmentForIntentAndAdvert } from './peer-assignment-planning.js';
import { buildPeerReceiptAgreement } from './peer-receipt-agreement.js';
export { createSignedJobIntent, createSignedProviderAdvert, verifyPeerRoleClaims } from './peer-signed-claims.js';
export { buildPeerAssignmentPlan, validatePeerAssignmentForIntentAndAdvert } from './peer-assignment-planning.js';
export { buildPeerReceiptAgreement } from './peer-receipt-agreement.js';
export { createPackPeerJob as createSignedOperationJob, createPackProviderAdvert as createSignedOperationProviderAdvert,
  planPackPeerProviders } from './peer-pack-job.js';

export {
  PEER_CONTROL_BUS_VERSION,
  PEER_CONTROL_NETWORK,
  PEER_CONTROL_VERSION,
  PEER_MESSAGE_TYPES,
  createDataChannelPeerBus,
  createInMemoryPeerBus,
  createPeerEventReducer,
  createPeerLedgerEvents,
  createPeerMessage,
  createPeerPromptPayload,
  createPeerSequencePayload,
  createSignedPeerMessage,
  hashPeerMessage,
  peerMessageSigningPayload,
  signPeerMessage,
  validateInputPayloadForAssignment,
  validatePeerMessage,
  validatePromptPayloadForAssignment,
  validateSequencePayloadForAssignment,
  verifyPeerMessage
};

export function createPeerControlPlane({
  peerId,
  publicKey,
  privateKey,
  bus = createInMemoryPeerBus(),
  verifyIncoming = true
} = {}) {
  const localPeerId = requireString(peerId, 'peerId');
  const messages = new Map();
  const byType = new Map();
  const nonceIndex = new Map();
  let unsubscribe = null;

  const indexMessage = (message) => {
    messages.set(message.messageHash, message);
    const bucket = byType.get(message.type) || [];
    if (!bucket.some((entry) => entry.messageHash === message.messageHash)) bucket.push(message);
    byType.set(message.type, bucket);
  };

  const ingest = async (message) => {
    const verification = verifyIncoming ? await verifyPeerMessage(message) : { ok: true, messageHash: message.messageHash, reasons: [] };
    if (!verification.ok) {
      return {
        ok: false,
        reason: 'invalid_peer_message',
        verification
      };
    }
    const nonceKey = `${message.fromPeerId}:${message.nonce}`;
    const priorHash = nonceIndex.get(nonceKey);
    if (priorHash && priorHash !== verification.messageHash) {
      return {
        ok: false,
        reason: 'peer_message_nonce_reuse',
        verification: {
          ...verification,
          reasons: ['peer message nonce already used by different payload']
        }
      };
    }
    nonceIndex.set(nonceKey, verification.messageHash);
    if (messages.has(verification.messageHash)) {
      return {
        ok: true,
        duplicate: true,
        messageHash: verification.messageHash,
        message: messages.get(verification.messageHash)
      };
    }
    indexMessage({ ...message, messageHash: verification.messageHash });
    return {
      ok: true,
      messageHash: verification.messageHash,
      message: messages.get(verification.messageHash)
    };
  };

  const publish = async (type, body = {}, options = {}) => {
    const signed = await createSignedPeerMessage({
      type,
      fromPeerId: localPeerId,
      toPeerId: options.toPeerId || null,
      publicKey,
      privateKey,
      body,
      expiresAt: options.expiresAt || null,
      causalRefs: options.causalRefs || []
    });
    indexMessage(signed);
    bus.send(signed);
    return signed;
  };

  return Object.freeze({
    start() {
      if (!unsubscribe) unsubscribe = bus.subscribe((message) => {
        void ingest(message);
      });
      return this;
    },
    stop() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    },
    ingest,
    publish,
    async publishJobIntent({ prompt, sequence, sequenceRequest, policyId, modelRequirements, generationConfig, maxPointSpend } = {}) {
      const result = await createSignedJobIntent({
        requesterId: localPeerId,
        requesterPublicKey: publicKey,
        privateKey,
        prompt,
        sequence,
        sequenceRequest,
        policyId,
        modelRequirements,
        generationConfig,
        maxPointSpend
      });
      indexMessage(result.intent);
      bus.send(result.intent);
      return result;
    },
    publishProviderAdvert(options = {}) {
      return createSignedProviderAdvert({
        providerId: localPeerId,
        providerPublicKey: publicKey,
        privateKey,
        ...options
      }).then((advert) => {
        indexMessage(advert);
        bus.send(advert);
        return advert;
      });
    },
    buildAssignmentPlan(jobIntent) {
      return buildPeerAssignmentPlan({
        jobIntent,
        providerAdverts: byType.get(PEER_MESSAGE_TYPES.PROVIDER_ADVERT) || []
      });
    },
    messages: () => Array.from(messages.values()),
    messagesByType: (type) => [...(byType.get(type) || [])],
    reduceEvents: () => createPeerEventReducer().reduce(Array.from(messages.values()))
  });
}

export async function exportPeerPublicKey(keyPair) {
  if (!keyPair?.publicKey) throw new TypeError('keyPair.publicKey is required');
  return exportPublicKey(keyPair.publicKey);
}

export default {
  PEER_CONTROL_VERSION,
  PEER_CONTROL_BUS_VERSION,
  PEER_CONTROL_NETWORK,
  PEER_MESSAGE_TYPES,
  peerMessageSigningPayload,
  createPeerMessage,
  validatePeerMessage,
  hashPeerMessage,
  signPeerMessage,
  createSignedPeerMessage,
  verifyPeerMessage,
  createSignedJobIntent,
  createSignedProviderAdvert,
  buildPeerAssignmentPlan,
  createPeerPromptPayload,
  createPeerSequencePayload,
  validatePromptPayloadForAssignment,
  validateSequencePayloadForAssignment,
  validateInputPayloadForAssignment,
  validatePeerAssignmentForIntentAndAdvert,
  buildPeerReceiptAgreement,
  createPeerLedgerEvents,
  createPeerEventReducer,
  createDataChannelPeerBus,
  createInMemoryPeerBus,
  createPeerControlPlane,
  exportPeerPublicKey
};
