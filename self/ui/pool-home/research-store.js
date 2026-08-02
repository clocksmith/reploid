/**
 * @fileoverview Room-scoped local-first persistence for signed Poolday research evidence.
 */

import { createPoolSdk } from '../../pool/sdk.js';
import {
  validateResearchRecordModelAdmission,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../pool/evidence-network.js';
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

const readPersistedRecords = (roomId) => {
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
    // localStorage is a recovery cache, not an evidence authority. It is read
    // and verified only by hydrateResearchRecords before it can influence a
    // similarity, lifecycle, or next-action projection.
    state.records = [];
  }
  return state.records.map(clone);
}

export async function appendResearchRecord(record, { roomId = record?.roomId || DEFAULT_PEER_ROOM_ID } = {}) {
  loadResearchRecords(roomId);
  const verification = await verifyResearchRecord(record);
  if (!verification.ok) throw new Error(`Invalid research record: ${verification.reasons.join('; ')}`);
  const admission = validateResearchRecordModelAdmission(record);
  if (!admission.ok) throw new Error(`Unadmitted research model contract: ${admission.reasons.join('; ')}`);
  if (record.roomId !== roomId) throw new Error('research record room does not match the active room');
  const existing = state.records.find((candidate) => candidate.recordHash === record.recordHash);
  if (existing) {
    if (!recordsEqual(existing, record)) throw new Error('recordHash is already bound to different immutable evidence');
    return clone(existing);
  }
  const links = validateResearchRecordLinks(record, state.records);
  if (!links.ok) throw new Error(`Invalid research record links: ${links.reasons.join('; ')}`);
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
  const rejectedRecords = [];
  for (const record of readPersistedRecords(roomId)) {
    try {
      await appendResearchRecord(record, { roomId });
    } catch (error) {
      rejectedRecords.push({
        recordHash: typeof record?.recordHash === 'string' ? record.recordHash : null,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }
  // Rewrite the cache after local verification so corrupt or now-unadmitted
  // records are not retried as if they were trusted evidence on each reload.
  persist();
  try {
    const payload = await sdk.listResearchRecords(roomId, { limit: POOLDAY_RESEARCH_RECORD_LIMIT });
    for (const record of payload.records || []) {
      try {
        await appendResearchRecord(record, { roomId });
      } catch (error) {
        rejectedRecords.push({
          recordHash: typeof record?.recordHash === 'string' ? record.recordHash : null,
          reason: error instanceof Error ? error.message : String(error)
        });
      }
    }
    persist();
    return { records: loadResearchRecords(roomId), remote: true, rejectedRecords };
  } catch (error) {
    return { records: loadResearchRecords(roomId), remote: false, remoteError: error, rejectedRecords };
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
