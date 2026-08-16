/**
 * @fileoverview Room-scoped local-first persistence for signed Poolday research evidence.
 */

import { createPoolSdk } from '../../pool/sdk.js';
import {
  RESEARCH_RECORD_KINDS,
  projectCrossRoomSequenceEvidence,
  validateResearchRecordModelAdmission,
  validateResearchRecordLinks,
  verifyResearchRecord
} from '../../pool/evidence-network.js';
import { validateDiscoveryContractCheckpoint } from '../../pool/discovery-contract.js';
import {
  PROTEIN_UNCERTAINTY_CAMPAIGN_QUEUE_VERSION,
  projectProteinUncertaintyCampaignQueue
} from '../../pool/protein-uncertainty-campaign.js';
import { DEFAULT_PEER_ROOM_ID } from '../../pool/peer-room.js';

export const POOLDAY_RESEARCH_STORAGE_KEY = 'reploid.pool.research-evidence.v1';
export const POOLDAY_RESEARCH_QUARANTINE_KEY = 'reploid.pool.research-evidence-quarantine.v1';
export const POOLDAY_RESEARCH_RECORD_LIMIT = 1000;

const state = {
  roomId: null,
  records: []
};

// Recovery state is deliberately volatile. The signed records and their
// local cache remain the only evidence state; this map only tells the room
// which recovery boundary the current page has observed.
const syncStates = new Map();
const crossRoomEvidenceStates = new Map();
const campaignQueueStates = new Map();

const storageKey = (roomId) => `${POOLDAY_RESEARCH_STORAGE_KEY}::${encodeURIComponent(roomId || DEFAULT_PEER_ROOM_ID)}`;
const quarantineStorageKey = (roomId) => `${POOLDAY_RESEARCH_QUARANTINE_KEY}::${encodeURIComponent(roomId || DEFAULT_PEER_ROOM_ID)}`;
const storage = () => {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const recordsEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const notifyResearchUpdate = (roomId, record = null) => {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') return;
  globalThis.dispatchEvent(new CustomEvent('reploid:pool-research-update', {
    detail: {
      roomId,
      recordHash: record?.recordHash || null,
      kind: record?.kind || null
    }
  }));
};

const defaultSyncState = () => ({
  phase: 'local_only',
  remote: 'unknown',
  rejectedRecords: [],
  remoteError: null,
  checkedAt: null
});

const setResearchSyncState = (roomId, patch = {}, { notify = true } = {}) => {
  const next = {
    ...defaultSyncState(),
    ...(syncStates.get(roomId) || {}),
    ...patch,
    rejectedRecords: Array.isArray(patch.rejectedRecords)
      ? patch.rejectedRecords.map((entry) => ({ ...entry }))
      : [...(syncStates.get(roomId)?.rejectedRecords || [])]
  };
  syncStates.set(roomId, next);
  if (notify) notifyResearchUpdate(roomId);
  return next;
};

export const getResearchSyncState = (roomId = DEFAULT_PEER_ROOM_ID) => ({
  ...(syncStates.get(roomId) || defaultSyncState()),
  rejectedRecords: [...(syncStates.get(roomId)?.rejectedRecords || [])]
});

const defaultCrossRoomEvidenceState = () => ({
  phase: 'idle',
  sequenceHash: null,
  projection: null,
  registryBoundary: null,
  error: null,
  checkedAt: null
});

const setCrossRoomEvidenceState = (roomId, patch = {}, { notify = true } = {}) => {
  const next = {
    ...defaultCrossRoomEvidenceState(),
    ...(crossRoomEvidenceStates.get(roomId) || {}),
    ...patch
  };
  crossRoomEvidenceStates.set(roomId, next);
  if (notify) notifyResearchUpdate(roomId);
  return next;
};

export const getCrossRoomSequenceEvidence = (roomId = DEFAULT_PEER_ROOM_ID) => clone(
  crossRoomEvidenceStates.get(roomId) || defaultCrossRoomEvidenceState()
);

const defaultCampaignQueueState = () => ({
  phase: 'idle',
  projection: null,
  error: null,
  checkedAt: null
});

const setCampaignQueueState = (roomId, patch = {}, { notify = true } = {}) => {
  const next = {
    ...defaultCampaignQueueState(),
    ...(campaignQueueStates.get(roomId) || {}),
    ...patch
  };
  campaignQueueStates.set(roomId, next);
  if (notify) notifyResearchUpdate(roomId);
  return next;
};

export const getProteinUncertaintyCampaignQueue = (roomId = DEFAULT_PEER_ROOM_ID) => clone(
  campaignQueueStates.get(roomId) || defaultCampaignQueueState()
);

const readPersistedRecords = (roomId) => {
  try {
    const parsed = JSON.parse(storage()?.getItem(storageKey(roomId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const readPersistedQuarantine = (roomId) => {
  try {
    const parsed = JSON.parse(storage()?.getItem(quarantineStorageKey(roomId)) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const persistQuarantine = (roomId, entries = []) => {
  const byIdentity = new Map();
  for (const entry of entries) {
    const key = entry?.record?.recordHash || `${entry?.reason || 'unknown'}:${JSON.stringify(entry?.record || null)}`;
    byIdentity.set(key, entry);
  }
  try {
    storage()?.setItem(
      quarantineStorageKey(roomId),
      JSON.stringify([...byIdentity.values()].slice(-POOLDAY_RESEARCH_RECORD_LIMIT))
    );
  } catch {
    // Quarantine remains diagnostic state for this hydration even when local
    // storage is unavailable; active evidence admission still fails closed.
  }
};

export function loadQuarantinedResearchRecords(roomId = DEFAULT_PEER_ROOM_ID) {
  return readPersistedQuarantine(roomId).map(clone);
}

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
  if (!syncStates.has(roomId)) syncStates.set(roomId, defaultSyncState());
  return state.records.map(clone);
}

export async function appendResearchRecord(record, {
  roomId = record?.roomId || DEFAULT_PEER_ROOM_ID,
  notify = true
} = {}) {
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
  if (record.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    const replay = await validateDiscoveryContractCheckpoint(record, state.records);
    if (!replay.ok) throw new Error(`Invalid Discovery Contract checkpoint: ${replay.reasons.join('; ')}`);
  }
  state.records.push(clone(record));
  persist();
  if (notify) notifyResearchUpdate(roomId, record);
  return clone(record);
}

export async function publishResearchRecord(record, {
  roomId = record?.roomId || DEFAULT_PEER_ROOM_ID,
  sdk = createPoolSdk()
} = {}) {
  loadResearchRecords(roomId);
  if (record?.kind === RESEARCH_RECORD_KINDS.discoveryCheckpoint) {
    const replay = await validateDiscoveryContractCheckpoint(record, state.records, {
      requireCurrentCompleteness: true
    });
    if (!replay.ok) throw new Error(`Stale Discovery Contract checkpoint: ${replay.reasons.join('; ')}`);
  }
  const saved = await appendResearchRecord(record, { roomId });
  try {
    await sdk.publishResearchRecord(saved);
    setResearchSyncState(roomId, {
      phase: 'synchronized',
      remote: 'synchronized',
      remoteError: null,
      checkedAt: new Date().toISOString()
    });
    return { record: saved, remote: true };
  } catch (error) {
    setResearchSyncState(roomId, {
      phase: 'stale',
      remote: 'unavailable',
      remoteError: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString()
    });
    return { record: saved, remote: false, remoteError: error };
  }
}

const isMissingLinkError = (error) => (
  error instanceof Error
  && error.message.startsWith('Invalid research record links:')
  && error.message.includes('does not exist:')
);

const appendHydrationBatch = async (records, roomId, rejectedRecords, quarantinedRecords) => {
  let pending = records.slice();
  while (pending.length) {
    const deferred = [];
    let progress = false;
    for (const record of pending) {
      try {
        await appendResearchRecord(record, { roomId, notify: false });
        progress = true;
      } catch (error) {
        if (isMissingLinkError(error)) {
          deferred.push({ record, error });
        } else {
          const rejection = {
            recordHash: typeof record?.recordHash === 'string' ? record.recordHash : null,
            reason: error instanceof Error ? error.message : String(error)
          };
          rejectedRecords.push(rejection);
          quarantinedRecords.push({
            record: clone(record),
            reason: rejection.reason,
            quarantinedAt: new Date().toISOString()
          });
        }
      }
    }
    if (!deferred.length) return;
    if (!progress) {
      for (const { record, error } of deferred) {
        const rejection = {
          recordHash: typeof record?.recordHash === 'string' ? record.recordHash : null,
          reason: error instanceof Error ? error.message : String(error)
        };
        rejectedRecords.push(rejection);
        quarantinedRecords.push({
          record: clone(record),
          reason: rejection.reason,
          quarantinedAt: new Date().toISOString()
        });
      }
      return;
    }
    pending = deferred.map(({ record }) => record);
  }
};

export async function hydrateResearchRecords(roomId = DEFAULT_PEER_ROOM_ID, {
  sdk = createPoolSdk(),
  onLocalHydrated = null
} = {}) {
  loadResearchRecords(roomId);
  setResearchSyncState(roomId, {
    phase: 'synchronizing',
    remote: 'pending',
    rejectedRecords: [],
    remoteError: null,
    checkedAt: null
  });
  const rejectedRecords = [];
  const quarantinedRecords = readPersistedQuarantine(roomId);
  await appendHydrationBatch(readPersistedRecords(roomId), roomId, rejectedRecords, quarantinedRecords);
  // Rewrite the cache after local verification so corrupt or now-unadmitted
  // records are not retried as trusted evidence. Rejected signed history is
  // preserved in a separate quarantine cache rather than silently deleted.
  persist();
  persistQuarantine(roomId, quarantinedRecords);
  if (typeof onLocalHydrated === 'function') {
    await onLocalHydrated({
      records: loadResearchRecords(roomId),
      rejectedRecords: rejectedRecords.map(clone),
      quarantinedRecords: quarantinedRecords.map(clone)
    });
  }
  try {
    const payload = await sdk.listResearchRecords(roomId, { limit: POOLDAY_RESEARCH_RECORD_LIMIT });
    await appendHydrationBatch(payload.records || [], roomId, rejectedRecords, quarantinedRecords);
    persist();
    persistQuarantine(roomId, quarantinedRecords);
    setResearchSyncState(roomId, {
      phase: 'synchronized',
      remote: 'synchronized',
      rejectedRecords,
      remoteError: null,
      checkedAt: new Date().toISOString()
    });
    return { records: loadResearchRecords(roomId), remote: true, rejectedRecords };
  } catch (error) {
    setResearchSyncState(roomId, {
      phase: 'stale',
      remote: 'unavailable',
      rejectedRecords,
      remoteError: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString()
    });
    return { records: loadResearchRecords(roomId), remote: false, remoteError: error, rejectedRecords };
  }
}

const validateCrossRoomLinks = (records = []) => {
  const rooms = new Map();
  for (const record of records) rooms.set(record.roomId, [...(rooms.get(record.roomId) || []), record]);
  for (const [roomId, roomRecords] of rooms) {
    const accepted = [];
    let pending = roomRecords.slice();
    while (pending.length) {
      const deferred = [];
      let progress = false;
      for (const record of pending) {
        const links = validateResearchRecordLinks(record, accepted);
        if (links.ok) {
          accepted.push(record);
          progress = true;
          continue;
        }
        if (links.reasons.every((reason) => reason.startsWith('linked research record does not exist:'))) {
          deferred.push({ record, links });
          continue;
        }
        throw new Error(`Invalid prior-room links in ${roomId}: ${links.reasons.join('; ')}`);
      }
      if (!deferred.length) break;
      if (!progress) {
        throw new Error(`Incomplete prior-room evidence in ${roomId}: ${deferred[0].links.reasons.join('; ')}`);
      }
      pending = deferred.map((entry) => entry.record);
    }
  }
};

export async function hydrateCrossRoomSequenceEvidence(roomId, sequenceHash, {
  sdk = createPoolSdk()
} = {}) {
  const normalizedSequenceHash = String(sequenceHash || '').trim().toLowerCase();
  setCrossRoomEvidenceState(roomId, {
    phase: 'synchronizing',
    sequenceHash: normalizedSequenceHash,
    projection: null,
    registryBoundary: null,
    error: null,
    checkedAt: null
  });
  try {
    const payload = await sdk.listSequenceResearchEvidence(normalizedSequenceHash, {
      currentRoomId: roomId,
      limit: POOLDAY_RESEARCH_RECORD_LIMIT
    });
    if (payload?.schema !== 'poolday.cross_room_sequence_evidence/v1') {
      throw new Error('Cross-room evidence schema is unsupported');
    }
    if (payload.sequence?.hash !== normalizedSequenceHash) {
      throw new Error('Cross-room evidence sequence identity does not match the request');
    }
    const records = Array.isArray(payload.records) ? payload.records : [];
    for (const record of records) {
      const verification = await verifyResearchRecord(record);
      if (!verification.ok) {
        throw new Error(`Invalid prior-room research record: ${verification.reasons.join('; ')}`);
      }
      const admission = validateResearchRecordModelAdmission(record);
      if (!admission.ok) {
        throw new Error(`Unadmitted prior-room model contract: ${admission.reasons.join('; ')}`);
      }
    }
    validateCrossRoomLinks(records);
    const projection = projectCrossRoomSequenceEvidence(records, normalizedSequenceHash, {
      currentRoomId: roomId,
      limit: POOLDAY_RESEARCH_RECORD_LIMIT
    });
    const registryBoundary = {
      boundary: payload.boundary || 'unknown_registry_snapshot',
      complete: payload.complete === true,
      inputRecordCount: Number(payload.inputRecordCount || 0),
      uniqueRecordCount: Number(payload.uniqueRecordCount || 0),
      scannedRecordCount: Number(payload.scannedRecordCount || 0)
    };
    return clone(setCrossRoomEvidenceState(roomId, {
      phase: 'synchronized',
      sequenceHash: normalizedSequenceHash,
      projection,
      registryBoundary,
      error: null,
      checkedAt: new Date().toISOString()
    }));
  } catch (error) {
    return clone(setCrossRoomEvidenceState(roomId, {
      phase: 'unavailable',
      sequenceHash: normalizedSequenceHash,
      projection: null,
      registryBoundary: null,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString()
    }));
  }
}

export async function hydrateProteinUncertaintyCampaignQueue(roomId = DEFAULT_PEER_ROOM_ID, {
  sdk = createPoolSdk()
} = {}) {
  setCampaignQueueState(roomId, {
    phase: 'synchronizing',
    projection: null,
    error: null,
    checkedAt: null
  });
  try {
    const payload = await sdk.listProteinUncertaintyCampaignQueue({
      limit: POOLDAY_RESEARCH_RECORD_LIMIT
    });
    if (payload?.schema !== PROTEIN_UNCERTAINTY_CAMPAIGN_QUEUE_VERSION) {
      throw new Error('Protein uncertainty campaign queue schema is unsupported');
    }
    const records = Array.isArray(payload.records) ? payload.records : [];
    for (const record of records) {
      const verification = await verifyResearchRecord(record);
      if (!verification.ok) {
        throw new Error(`Invalid campaign research record: ${verification.reasons.join('; ')}`);
      }
      const admission = validateResearchRecordModelAdmission(record);
      if (!admission.ok) {
        throw new Error(`Unadmitted campaign model contract: ${admission.reasons.join('; ')}`);
      }
    }
    validateCrossRoomLinks(records);
    const projected = projectProteinUncertaintyCampaignQueue(records, {
      limit: POOLDAY_RESEARCH_RECORD_LIMIT
    });
    const declaredProjection = { ...payload };
    delete declaredProjection.records;
    if (JSON.stringify(projected) !== JSON.stringify(declaredProjection)) {
      throw new Error('Protein uncertainty campaign queue replay does not match the signed input records');
    }
    return clone(setCampaignQueueState(roomId, {
      phase: 'synchronized',
      projection: projected,
      error: null,
      checkedAt: new Date().toISOString()
    }));
  } catch (error) {
    return clone(setCampaignQueueState(roomId, {
      phase: 'unavailable',
      projection: null,
      error: error instanceof Error ? error.message : String(error),
      checkedAt: new Date().toISOString()
    }));
  }
}

export function resetResearchStore() {
  state.roomId = null;
  state.records = [];
  syncStates.clear();
  crossRoomEvidenceStates.clear();
  campaignQueueStates.clear();
}

export default {
  loadResearchRecords,
  loadQuarantinedResearchRecords,
  appendResearchRecord,
  publishResearchRecord,
  hydrateResearchRecords,
  hydrateCrossRoomSequenceEvidence,
  hydrateProteinUncertaintyCampaignQueue,
  getResearchSyncState,
  getCrossRoomSequenceEvidence,
  getProteinUncertaintyCampaignQueue,
  resetResearchStore
};
