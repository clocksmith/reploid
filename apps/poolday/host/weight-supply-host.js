/**
 * @fileoverview The browser host's weight supply: one library service (artifacts/custody/weight-supply.js) per
 * session over this device's one shared-file inventory (artifacts/custody/shared-inventory.js), its saved state, and
 * the projection the UI renders.
 *
 * Joining never opts in: a fresh profile has no saved state, so `start` builds nothing and the device offers nothing.
 * The service (and the pinned piece indexes it needs) is built only when asked: `recommend` (the Contribute view
 * opening) or a saved approval found by `start`. Commands: recommend, approve (with the storage cap the UI passes),
 * refresh, pause, resume.
 *
 * One inventory: the cached-model path ("Share model files") and weight supply each set only their own files in the
 * shared inventory, and each file lists its sources. Pausing weight supply pauses all serving from this device.
 * Weight supply never deletes the bytes of a piece the cached-model path holds.
 *
 * Saved state (reploid.weight-supply-state/1: the signed approval, held pieces, replacement and served-transfer
 * records) is written to `records` after every change and restored by `start`: the library re-verifies the approval
 * and every held piece against the pinned piece index and the stored bytes, and drops what fails or expired.
 */
import { createWeightSupply } from '../../../shared/vendor/reploid/artifacts/custody/weight-supply.js';
import { weightSupplyOffer } from './computer-records.js';

const RECORDS_DATABASE = 'reploid-weight-supply-v1';

/** Saved weight-supply state in memory (tests and hosts without IndexedDB). */
export function createMemoryWeightSupplyRecords() {
  const rows = new Map();
  return { read: async computerId => structuredClone(rows.get(computerId) ?? null),
    write: async (computerId, state) => { rows.set(computerId, structuredClone(state)); }, close: async () => {} };
}

/** Saved weight-supply state in IndexedDB, beside the chat history's database, one entry per computer. */
export async function openWeightSupplyRecords({ indexedDB = globalThis.indexedDB, openTimeoutMs = 5000 } = {}) {
  const { createIndexedDbStore } = await import('../../../shared/vendor/reploid/adapters/browser.js');
  const store = createIndexedDbStore({ databaseName: RECORDS_DATABASE, storeName: 'state', version: 1, openTimeoutMs, indexedDB });
  await store.init();
  return { read: computerId => store.get(`state:${computerId}`), write: (computerId, state) => store.set(`state:${computerId}`, state),
    close: () => store.close() };
}

/**
 * @param {object} options
 * @param {{ peerId: string, publicJwk: object, privateJwk: object }} options.identity this computer's participant identity
 * @param {string} options.connectionId this computer's transport session ID
 * @param {object} options.exchange the custody exchange (its mesh state and served-transfer counts)
 * @param {object} options.inventory createSharedFileInventory(...) over that exchange
 * @param {object} options.store verified piece bytes by piece ID: { get, put, delete, list }
 * @param {{ read, write, close? }} options.records saved state by computer ID
 * @param {() => Promise<object[]>} options.loadModels the pinned models' pieces (pinnedModelPieces rows)
 * @param {object} options.ports { hashBytes, now?, fetchPiece?, inferenceOffers?, cachedPieceIds?, onChange?, onError? }
 */
export function createHostWeightSupply({ identity, connectionId, exchange, inventory, store, records, loadModels, ports }) {
  const computerId = identity.peerId, onChange = ports.onChange ?? (() => {});
  let service = null, building = null, recommendation = null, restore = { approval: 'none', restoredPieces: 0, requeuedPieces: 0, dropped: [], checkedAt: null };
  let writing = Promise.resolve(), scheduled = false, closed = false, error = null;
  const now = ports.now ?? Date.now;

  // Weight supply's deletes skip a piece the cached-model path holds: neither path drops the other's pieces.
  const deletePiece = async pieceId => {
    if (inventory.getState().files.some(row => row.hash === pieceId.slice(7) && row.sources.includes('cached-model'))) return false;
    await store.delete(pieceId);
    return true;
  };
  const guardedStore = { get: id => store.get(id), put: (id, bytes) => store.put(id, bytes), list: () => store.list(), delete: async id => { await deletePiece(id); } };

  const save = () => {
    if (closed || !service || scheduled) return;
    scheduled = true;
    writing = writing.then(async () => {
      scheduled = false;
      if (service) await records.write(computerId, service.exportWeightSupplyState());
    }).catch(cause => { error = cause.message; ports.onError?.(cause); });
  };
  const changed = () => { save(); onChange(); };

  const ensure = () => building ??= (async () => {
    const models = await loadModels();
    if (closed) throw new Error('Weight supply is closed');
    service = createWeightSupply({ identity, connectionId, exchange: inventory.source('weight-supply'), models, store: guardedStore,
      ports: { hashBytes: ports.hashBytes, now, ...(ports.fetchPiece ? { fetchPiece: ports.fetchPiece } : {}),
        ...(ports.inferenceOffers ? { inferenceOffers: ports.inferenceOffers } : {}),
        ...(ports.cachedPieceIds ? { cachedPieceIds: ports.cachedPieceIds } : {}), onRecord: save, onChange: changed } });
    return service;
  })().catch(cause => { building = null; throw cause; });

  const report = () => service?.getWeightSupplyReport() ?? null;

  return Object.freeze({
    /** Reloads saved state; a fresh profile has none and builds nothing. */
    async start() {
      const saved = await records.read(computerId);
      if (!saved) { restore = { ...restore, checkedAt: now() }; onChange(); return restore; }
      const supply = await ensure();
      restore = { ...await supply.restoreWeightSupply(saved), checkedAt: now() };
      // A supply paused before the reload keeps every file on this device unserved.
      if (supply.getWeightSupplyReport().paused) await inventory.pause();
      changed();
      return restore;
    },
    /** Read-only. Computed only when asked: the Contribute view opening. */
    async recommend({ storageCapBytes, deviceLimits = {} }) {
      const supply = await ensure();
      recommendation = await supply.recommendWeightSupply({ storageCapBytes, deviceLimits });
      onChange();
      return structuredClone(recommendation);
    },
    async approve({ offerId, storageCapBytes, modelIdentities = [] }) {
      const supply = await ensure();
      const approval = await supply.approveWeightSupply({ offerId, storageCapBytes, modelIdentities });
      if (recommendation?.offer?.offerId === offerId) recommendation = null;
      if (inventory.getState().paused) inventory.resume();
      changed();
      return approval;
    },
    refresh: async () => (service ? service.refreshWeightSupply() : null),
    /** Pauses all serving from this device; fetching under the approval stops; verified pieces stay. */
    async pause() {
      if (service) service.pauseWeightSupply();
      await inventory.pause();
      changed();
    },
    resume() {
      service?.resumeWeightSupply();
      inventory.resume();
      changed();
    },
    /** Port for exchange.js `observeServed`. */
    recordServed: event => service?.recordServed(event) ?? null,
    deletePiece,
    whenIdle: () => service?.whenIdle() ?? Promise.resolve(),
    flush: () => writing,

    /**
     * This device's weight-supply offer (reploid.offer/1), or null: the service's offer under an approval, listing the
     * shared inventory, or the cached-model path's offer when the person chose file sharing (`cached`: { chosen,
     * enabled, readiness, modelIdentities, maxStorageBytes }).
     */
    localOffer(cached = {}) {
      const base = report()?.offer ?? null;
      if (!base && !cached.chosen) return null;
      const shared = inventory.getState();
      const paused = shared.paused || (!base && !cached.enabled);
      const ready = [base?.readiness, cached.enabled ? cached.readiness : null];
      let readiness = 'unavailable';
      if (!paused) readiness = ['ready', 'stopping', 'preparing', 'failed'].find(state => ready.includes(state)) ?? 'unavailable';
      const files = shared.files.filter(row => row.offered).map(({ hashAlgorithm, hash, sizeBytes }) => ({ hashAlgorithm, hash, sizeBytes }));
      return weightSupplyOffer({ connectionId: base?.connectionId ?? null, readiness, paused,
        // Cached-model files do not expire; approved pieces alone expire with their approval.
        expiresAt: base && !cached.enabled ? base.expiresAt : null,
        modelIdentities: [...new Set([...(base?.scope.modelIdentities ?? []), ...(cached.enabled ? cached.modelIdentities ?? [] : [])])],
        pieceIndexDigests: base?.scope.pieceIndexDigests ?? [], files,
        maxStorageBytes: base?.scope.maxStorageBytes ?? cached.maxStorageBytes ?? null });
    },

    /** The projection the UI renders. Labels and copy are the owner's: each OWNER: mark is a place one is needed. */
    getState() {
      const current = report(), approval = service?.getApproval() ?? null, shared = inventory.getState();
      const sources = new Map(shared.files.map(row => [row.hash, row.sources]));
      return structuredClone({
        // OWNER: label for the recommendation: `offer` (a bounded set of pieces to hold) or `noOffer`, a reason code
        // (cached-models, no-under-supplied-piece, storage-cap, approved, paused) for the UI to word. Null until asked.
        recommendation,
        // OWNER: label for the exact bytes the offer would download.
        downloadBytes: recommendation?.offer?.totalDownloadBytes ?? null,
        // OWNER: label for when the unapproved offer expires (epoch ms).
        offerExpiresAt: recommendation?.offer?.expiresAt ?? null,
        // OWNER: label for the approval: its storage cap, the models it covers and when it was approved and expires.
        approval: approval && { approvalId: approval.approvalId, storageCapBytes: approval.storageCapBytes, modelIdentities: approval.modelIdentities,
          approvedAt: approval.approvedAt, expiresAt: approval.expiresAt },
        // OWNER: label for paused (all serving from this device is paused).
        paused: current?.paused === true || shared.paused,
        // OWNER: label per piece state (queued, acquiring, verified, failed) and per source (cached-model, weight-supply).
        pieces: (current?.pieces ?? []).map(piece => ({ ...piece, sources: sources.get(piece.pieceId.slice(7)) ?? [] })),
        // OWNER: label for verified bytes (held and checked; not served).
        verifiedBytes: current?.verifiedBytes ?? 0,
        // OWNER: label for served bytes and transfers (only transfers a consumer confirmed as completed and verified).
        servedBytes: current?.servedBytes ?? 0,
        servedTransfers: current?.servedTransfers ?? 0,
        // OWNER: labels for acquisition counts (queued, acquiring, failed pieces; bytes still to fetch).
        acquisition: current?.acquisition ?? { queuedPieces: 0, acquiringPieces: 0, failedPieces: 0, pendingBytes: 0 },
        // OWNER: label for replacement history (pieces removed with their reason code, pieces added, held bytes before and after).
        replacements: current?.replacements ?? [],
        transfers: service?.getServedTransfers() ?? [],
        // OWNER: label for the shared-file inventory, each file with its sources and whether it is offered.
        inventory: shared,
        // OWNER: label for what the last reload kept and dropped (reason codes per dropped piece).
        restore,
        error
      });
    },
    async close() {
      closed = true;
      await writing;
      if (service) await records.write(computerId, service.exportWeightSupplyState()).catch(() => {});
    }
  });
}
