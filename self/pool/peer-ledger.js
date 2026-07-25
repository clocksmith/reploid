/**
 * @fileoverview Ledger-event creation and deterministic projection for Poolday peers.
 */

import { getLedgerReasons } from './config.js';
import {
  PEER_MESSAGE_TYPES,
  createSignedPeerMessage,
  requirePeerString
} from './peer-protocol.js';

export async function createPeerLedgerEvents({
  agreement,
  requesterId,
  requesterPublicKey,
  privateKey
} = {}) {
  if (!agreement?.accepted) return [];
  const resolvedRequesterId = requirePeerString(requesterId, 'requesterId');
  const resolvedPublicKey = requirePeerString(requesterPublicKey, 'requesterPublicKey');
  const reasons = getLedgerReasons(agreement.mode || 'single');
  const messages = [];
  for (const entry of agreement.providerPoints || []) {
    messages.push(await createSignedPeerMessage({
      type: PEER_MESSAGE_TYPES.POINTS_EVENT,
      fromPeerId: resolvedRequesterId,
      publicKey: resolvedPublicKey,
      privateKey,
      body: {
        schema: 'reploid.peer.points_event/v1',
        agreementHash: agreement.agreementHash,
        receiptHash: entry.receiptHash,
        userId: entry.providerId,
        providerId: entry.providerId,
        points: entry.points,
        direction: 'credit',
        reason: reasons.award || 'accepted_receipt'
      }
    }));
    messages.push(await createSignedPeerMessage({
      type: PEER_MESSAGE_TYPES.REPUTATION_EVENT,
      fromPeerId: resolvedRequesterId,
      publicKey: resolvedPublicKey,
      privateKey,
      body: {
        schema: 'reploid.peer.reputation_event/v1',
        agreementHash: agreement.agreementHash,
        receiptHash: entry.receiptHash,
        providerId: entry.providerId,
        acceptedReceipts: 1,
        rejectedReceipts: 0,
        timeouts: 0,
        points: entry.points,
        reason: reasons.award || 'accepted_receipt'
      }
    }));
  }
  if (agreement.pointSpend > 0) {
    messages.push(await createSignedPeerMessage({
      type: PEER_MESSAGE_TYPES.POINTS_EVENT,
      fromPeerId: resolvedRequesterId,
      publicKey: resolvedPublicKey,
      privateKey,
      body: {
        schema: 'reploid.peer.points_event/v1',
        agreementHash: agreement.agreementHash,
        receiptHash: agreement.receiptHash || null,
        userId: resolvedRequesterId,
        points: -agreement.pointSpend,
        direction: 'debit',
        reason: reasons.spend || 'accepted_receipt_spend'
      }
    }));
  }
  return messages;
}

export function createPeerEventReducer() {
  return {
    reduce(messages = []) {
      const points = new Map();
      const reputation = new Map();
      const seen = new Set();
      const ordered = [...messages].sort((left, right) => String(left.messageHash || '').localeCompare(String(right.messageHash || '')));
      for (const message of ordered) {
        const dedupeKey = message.messageHash || `${message.type}:${message.body?.agreementHash || ''}:${message.body?.receiptHash || ''}:${message.body?.userId || message.body?.providerId || ''}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        if (message.type === PEER_MESSAGE_TYPES.POINTS_EVENT) {
          const userId = message.body?.userId;
          if (!userId) continue;
          points.set(userId, Number(points.get(userId) || 0) + Number(message.body?.points || 0));
        }
        if (message.type === PEER_MESSAGE_TYPES.REPUTATION_EVENT) {
          const providerId = message.body?.providerId;
          if (!providerId) continue;
          const current = reputation.get(providerId) || {
            providerId,
            acceptedReceipts: 0,
            rejectedReceipts: 0,
            timeouts: 0,
            points: 0
          };
          reputation.set(providerId, {
            ...current,
            acceptedReceipts: current.acceptedReceipts + Number(message.body?.acceptedReceipts || 0),
            rejectedReceipts: current.rejectedReceipts + Number(message.body?.rejectedReceipts || 0),
            timeouts: current.timeouts + Number(message.body?.timeouts || 0),
            points: current.points + Number(message.body?.points || 0)
          });
        }
      }
      return {
        points: Object.fromEntries(points),
        reputation: Object.fromEntries(reputation)
      };
    }
  };
}
