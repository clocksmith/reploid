/**
 * @fileoverview Pure projection of existing Poolday ledgers into room activity rows.
 */

import { getEnabledPoolModelContract } from '../../pool/model-contract.js';
import { getPeerEventHash } from './record-persistence.js';

const firstPresent = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

export const recordTimeMs = (value) => {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

export const receiptOccurredAt = (record = {}) => firstPresent(
  record?.receipt?.timing?.completedAt,
  record?.receipt?.timing?.endedAt,
  record?.receipt?.endTimestamp,
  record?.timing?.completedAt,
  record?.completedAt,
  record?.createdAt,
  new Date().toISOString()
);

export const formatContributionTokens = (value) => {
  const tokens = Number(value || 0);
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return String(Math.round(tokens));
};

export const formatContributionModel = (modelId) => {
  if (!modelId) return 'none loaded';
  const contract = getEnabledPoolModelContract(modelId);
  return contract?.label || modelId;
};

const receiptRecordKind = (row = {}) => {
  const record = row.record || {};
  return record.requesterAcceptance || record.agreement
    ? 'Answer completed'
    : 'Contribution made';
};

export function projectRoomRecordRows({
  receipts = [],
  contributions = [],
  peerEvents = [],
  roomActivitySummary = null,
  limit = 60
} = {}) {
  const receiptRows = receipts.map((row) => ({
    id: `receipt:${row.receiptHash}`,
    type: 'answer',
    occurredAt: row.occurredAt || receiptOccurredAt(row.record),
    title: receiptRecordKind(row),
    meta: [row.fidelity, row.provider !== '—' ? String(row.provider || '') : null]
      .filter(Boolean)
      .map((value) => String(value).length > 24 ? `${String(value).slice(0, 16)}...${String(value).slice(-8)}` : String(value))
      .join(' · '),
    detail: row.record
  }));
  const knownReceiptHashes = new Set(receiptRows
    .map((row) => row.detail?.receiptHash || row.detail?.receipt?.receiptHash)
    .filter(Boolean));
  const contributionRows = contributions
    .filter((row) => row.receiptHash && !knownReceiptHashes.has(row.receiptHash))
    .map((row) => ({
      id: `contribution:${row.receiptHash}`,
      type: 'contribution',
      occurredAt: row.completedAt,
      title: 'Contribution made',
      meta: [
        row.tokens > 0 ? `${formatContributionTokens(row.tokens)} tokens` : null,
        row.modelId ? formatContributionModel(row.modelId) : null
      ].filter(Boolean).join(' · '),
      detail: row
    }));
  const peerRows = peerEvents.map((event) => {
    const body = event.body || {};
    const title = event.type === 'points_event'
      ? (Number(body.points || 0) < 0 ? 'Requester points spent' : 'Contributor points credited')
      : event.type === 'reputation_event'
        ? 'Contributor reputation updated'
        : 'Room activity';
    return {
      id: `peer:${getPeerEventHash(event)}`,
      type: 'room',
      occurredAt: event.createdAt,
      title,
      meta: [body.providerId || body.userId || event.fromPeerId, body.reason]
        .filter(Boolean)
        .map((value) => String(value).length > 24 ? `${String(value).slice(0, 16)}...${String(value).slice(-8)}` : String(value))
        .join(' · '),
      detail: event
    };
  });
  const roomRows = roomActivitySummary && !roomActivitySummary.error
    && (Number(roomActivitySummary.messageCount || 0) > 0 || roomActivitySummary.recent?.length)
    ? [{
        id: `room:${roomActivitySummary.roomId || 'active'}`,
        type: 'room',
        occurredAt: roomActivitySummary.recent?.[0]?.createdAt || new Date().toISOString(),
        title: 'Room activity',
        meta: `${Number(roomActivitySummary.peerCount || 0)} tabs · ${Number(roomActivitySummary.providerCount || 0)} contributors`,
        detail: roomActivitySummary
      }]
    : [];
  const byId = new Map();
  for (const row of [...receiptRows, ...contributionRows, ...peerRows, ...roomRows]) byId.set(row.id, row);
  return [...byId.values()]
    .sort((left, right) => recordTimeMs(right.occurredAt) - recordTimeMs(left.occurredAt))
    .slice(0, limit);
}

export default {
  projectRoomRecordRows,
  recordTimeMs,
  receiptOccurredAt,
  formatContributionTokens,
  formatContributionModel
};
