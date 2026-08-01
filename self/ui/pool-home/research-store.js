/**
 * @fileoverview Room-scoped local-first persistence for signed Poolday research evidence.
 */

import { createPoolSdk } from '../../pool/sdk.js';
import { verifyResearchRecord } from '../../pool/evidence-network.js';
import { DEFAULT_PEER_ROOM_ID } from '../../pool/peer-room.js';

export const POOLDAY_RESEARCH_STORAGE_KEY = 'reploid.pool.research-evidence.v1';
export const POOLDAY_RESEARCH_RECORD_LIMIT = 1000;

const state = {
  roomId: null,
  records: []
};

const storageKey = (roomId) => `${POOLDAY_RESEARCH_STORAGE_KEY}::${encodeURIComponent(roomId || DEFAULT_PEER_ROOM_ID)}`;
const storage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const recordsEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const readRecords = (roomId) => {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(roomId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persist = () => {
  try {
    storage()?.setItem(storageKey(state.roomId), JSON.stringify(state.records.slice(-POOLDAY_RESEARCH_RECORD_LIMIT)));
  } catch {
    // The signed records remain available for this page when storage is denied.
  }
};

export function loadResearchRecords(roomId = DEFAULT_PEER_ROOM_ID) {
  if (state.roomId !== roomId) {
    state.roomId = roomId;
    state.records = readRecords(roomId);
  }
  return state.records.map(clone);
}

export async function appendResearchRecord(record, { roomId = record?.roomId || DEFAULT_PEER_ROOM_ID } = {}) {
  loadResearchRecords(roomId);
  const verification = await verifyResearchRecord(record);
  if (!verification.ok) throw new Error(`Invalid research record: ${verification.reasons.join('; ')}`);
  if (record.roomId !== roomId) throw new Error('research record room does not match the active room');
  const existing = state.records.find((candidate) => candidate.recordHash === record.recordHash);
  if (existing) {
    if (!recordsEqual(existing, record)) throw new Error('recordHash is already bound to different immutable evidence');
    return clone(existing);
  }
  const targetHash = record.kind === 'research_result'
    ? record.submissionHash
    : record.kind === 'human_claim'
      ? record.targetHash
      : null;
  const target = targetHash ? state.records.find((candidate) => candidate.recordHash === targetHash) : null;
  if (targetHash && !target) throw new Error('research record target does not exist in this room');
  if (record.kind === 'research_result') {
    if (record.sequenceHash !== target.sequence?.hash) throw new Error('research result sequence does not match its submission');
    if (JSON.stringify(record.modelContract) !== JSON.stringify(target.modelContract)) throw new Error('research result model contract does not match its submission');
    if (record.embedding && target.consent?.publishEmbedding !== true) throw new Error('research submission did not consent to embedding publication');
  }
  if (record.kind === 'human_claim'
    && record.claim?.kind === 'review_decision'
    && target.author?.identityRootId === record.author?.identityRootId) {
    throw new Error('review decisions must be independently authored');
  }
  state.records.push(clone(record));
  persist();
  return clone(record);
}

export async function publishResearchRecord(record, {
  roomId = record?.roomId || DEFAULT_PEER_ROOM_ID,
  sdk = createPoolSdk()
} = {}) {
  const saved = await appendResearchRecord(record, { roomId });
  try {
    await sdk.publishResearchRecord(saved);
    return { record: saved, remote: true };
  } catch (error) {
    return { record: saved, remote: false, remoteError: error };
  }
}

export async function hydrateResearchRecords(roomId = DEFAULT_PEER_ROOM_ID, { sdk = createPoolSdk() } = {}) {
  loadResearchRecords(roomId);
  try {
    const payload = await sdk.listResearchRecords(roomId, { limit: POOLDAY_RESEARCH_RECORD_LIMIT });
    for (const record of payload.records || []) await appendResearchRecord(record, { roomId });
    return { records: loadResearchRecords(roomId), remote: true };
  } catch (error) {
    return { records: loadResearchRecords(roomId), remote: false, remoteError: error };
  }
}

export function resetResearchStore() {
  state.roomId = null;
  state.records = [];
}

export default {
  loadResearchRecords,
  appendResearchRecord,
  publishResearchRecord,
  hydrateResearchRecords,
  resetResearchStore
};
