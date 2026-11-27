/**
 * @fileoverview This device's weight supply: the empty-cache Contribute journey over the custody exchange.
 *
 * `recommendWeightSupply` is read-only: from the mesh's own data (other computers' weight-supply offers and the
 * consumers' load and request demand) it returns the compatible models cached here or, for an empty cache, at most
 * one bounded offer of in-demand, under-supplied pieces, with their exact download bytes, or no offer at all.
 * `approveWeightSupply` records the owner's signed approval (a storage cap, the models it may hold, an expiry) and
 * fetches the offered pieces from verified sources; each piece is shared the moment it verifies. `refreshWeightSupply`
 * may replace held pieces with more useful ones inside the approved cap, recording every replacement. Served bytes
 * count only transfers the consumer confirmed as completed and verified (exchange.js `observeServed`). Pausing stops
 * serving and fetching and keeps verified pieces; it never touches this device's own consumption. A weight supplier
 * never runs inference or reads prompts. Records: contracts/weight-supply.js.
 */
import { operationRoles, weightSupplyOffer } from '../../contracts/computer-records.js';
import {
  WEIGHT_SUPPLY_APPROVAL_SCHEMA, WEIGHT_SUPPLY_POLICY, WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA, WEIGHT_SUPPLY_REPLACEMENT_SCHEMA,
  WEIGHT_SUPPLY_REPORT_SCHEMA, WEIGHT_TRANSFER_SCHEMA, approvalBody, demandByPiece, parseWeightSupplyApproval,
  parseWeightSupplyRecommendation, parseWeightSupplyReplacement, parseWeightSupplyReport, parseWeightTransfer, pieceFile,
  rankUnderSuppliedPieces, recommendWeightSupplyPieces, verifiedCopiesByPiece, weightDemandFromAnnouncement, weightDemandFromInferenceOffer
} from '../../contracts/weight-supply.js';
import { participantIdFor, signAsParticipant, verifyParticipantSignature } from '../participant-proofs.js';

/** Whether `approval` is signed by the computer it names (its key's participant ID). */
export async function verifyWeightSupplyApproval(approval) {
  try {
    const parsed = parseWeightSupplyApproval(approval);
    return await participantIdFor(parsed.publicJwk) === parsed.computerId
      && await verifyParticipantSignature(parsed.publicJwk, WEIGHT_SUPPLY_APPROVAL_SCHEMA, approvalBody(parsed), parsed.signature);
  } catch { return false; }
}

/**
 * The mesh's demand as reploid.weight-demand/1 records: consumers' custody demand announcements and peers whose
 * inference offers are loading a model (`inferenceOffers`, reploid.offer/1 records with their connection IDs).
 */
export function meshWeightDemand(exchangeState, inferenceOffers = [], { now }) {
  const rows = (exchangeState?.demand ?? []).map(row => weightDemandFromAnnouncement(row));
  for (const offer of inferenceOffers) rows.push(weightDemandFromInferenceOffer(offer, { observedAt: now }));
  return rows.filter(Boolean);
}

/**
 * A completed acquisition as a reploid.weight-transfer/1 record kept by the consumer: exchange.js requester delivery
 * record (its roles name the provider's computer only from a verified certificate) and the caller's timings.
 */
export function weightTransferFromDelivery(record, { startedAt, completedAt, modelIdentity = null }) {
  const completed = record?.receipt?.completed?.[0];
  if (record?.role !== 'requester' || !completed || !record.roles) return null;
  return parseWeightTransfer({ schema: WEIGHT_TRANSFER_SCHEMA, transferId: record.transferId, recordedBy: 'consumer',
    pieceId: completed.hash, modelIdentity, pieceBytes: completed.sizeBytes,
    deliveredBytes: Math.min(record.receipt.receivedBytes, completed.sizeBytes), startedAt, completedAt, roles: record.roles });
}

/**
 * @param {object} options
 * @param {{ peerId: string, publicJwk: object, privateJwk: object }} options.identity this computer's participant identity
 * @param {string} options.connectionId this computer's transport session ID (the exchange's peer ID)
 * @param {object} options.exchange createCustodyExchange(...) result; this service owns its supply inventory
 * @param {object[]} options.models pinnedModelPieces(...) rows; each may carry `files` (whole-file descriptors by path)
 * @param {object} options.store verified piece bytes by piece ID: { get, put, delete, list }
 * @param {object} options.ports { now, hashBytes, fetchPiece?, inferenceOffers?, onRecord?, onChange? }
 */
export function createWeightSupply({ identity, connectionId, exchange, models, store, ports, policy = WEIGHT_SUPPLY_POLICY }) {
  if (!identity?.peerId || !identity.privateJwk || !identity.publicJwk) throw new TypeError('Weight supply requires this computer\'s participant identity');
  if (!exchange?.offer || !exchange.stopSupply || !exchange.getState) throw new TypeError('Weight supply requires a custody exchange');
  if (!['get', 'put', 'delete', 'list'].every(name => typeof store?.[name] === 'function')) throw new TypeError('Weight supply requires a piece store');
  if (typeof ports?.hashBytes !== 'function') throw new TypeError('Weight supply requires the piece hash');
  const computerId = identity.peerId, now = ports.now ?? Date.now;
  const catalog = new Map(), wholeFiles = {};
  for (const model of models) for (const piece of model.pieces) catalog.set(piece.pieceId, { model, piece });
  for (const model of models) {
    for (const file of model.files ?? []) {
      if (file.hashAlgorithm === 'sha256') wholeFiles[file.hash] = model.pieces.filter(piece => piece.path === file.path).map(piece => piece.pieceId);
    }
  }
  const issuedOffers = new Map(), held = new Map(), queue = [], replacements = [], transfers = [];
  let approval = null, paused = false, active = 0, controller = new AbortController(), servedBytes = 0, servedTransfers = 0;
  const idleWaiters = new Set();
  const changed = () => {
    ports.onChange?.();
    if (active === 0 && (paused || queue.length === 0)) for (const wake of idleWaiters) wake();
  };
  const record = value => { try { ports.onRecord?.(structuredClone(value)); } catch { /* the host's log never blocks supply */ } return value; };
  const approvalActive = () => approval !== null && approval.expiresAt > now();
  const mesh = () => {
    const state = exchange.getState(), at = now();
    return { offers: state.offers ?? [], demand: meshWeightDemand(state, ports.inferenceOffers?.() ?? [], { now: at }), now: at };
  };
  const heldBytes = () => [...held.values()].filter(row => row.state !== 'failed').reduce((total, row) => total + row.sizeBytes, 0);
  const verifiedFiles = () => [...held.values()].filter(row => row.state === 'verified').map(row => pieceFile(row));

  const share = () => {
    if (paused || !approvalActive()) return;
    const files = verifiedFiles();
    if (files.length) exchange.offer(files, { revoke: false });
  };

  async function fetchPiece(row, signal) {
    if (ports.fetchPiece) return ports.fetchPiece(row, { signal });
    const file = pieceFile(row);
    if (exchange.has(file)) return exchange.acquire(file, { signal });
    const whole = catalog.get(row.pieceId)?.model.files?.find(item => item.path === row.path);
    if (whole && exchange.has(whole)) {
      return exchange.acquire(whole, { signal, range: { offset: row.offset, size: row.sizeBytes, identity: row.pieceId } });
    }
    throw Object.assign(new Error('No verified source offers this piece'), { code: 'WEIGHT_SUPPLY_NO_SOURCE' });
  }

  const pump = () => {
    while (!paused && approvalActive() && active < policy.acquisition.maxConcurrent && queue.length) {
      const row = held.get(queue.shift());
      if (!row || row.state !== 'queued') continue;
      active++; row.state = 'acquiring'; changed();
      const signal = controller.signal;
      (async () => {
        try {
          const bytes = await fetchPiece(row, signal);
          signal.throwIfAborted();
          if (bytes.byteLength !== row.sizeBytes || await ports.hashBytes(bytes) !== row.pieceId) throw new Error('Piece verification failed');
          await store.put(row.pieceId, bytes);
          if (held.get(row.pieceId) !== row) { await store.delete(row.pieceId); return; }
          row.state = 'verified'; row.verifiedAt = now();
          share();
        } catch (error) {
          if (held.get(row.pieceId) !== row) return;
          // A paused fetch goes back to the queue; anything else failed verification or every source.
          if (signal.aborted) { row.state = 'queued'; queue.unshift(row.pieceId); } else { row.state = 'failed'; row.error = error.code ?? 'failed'; }
        }
      })().finally(() => { active--; pump(); changed(); });
    }
  };

  const hold = ({ model, piece }) => {
    held.set(piece.pieceId, { pieceId: piece.pieceId, modelIdentity: model.modelIdentity, pieceIndexDigest: model.pieceIndexDigest,
      path: piece.path, offset: piece.offset, sizeBytes: piece.sizeBytes, state: 'queued', verifiedAt: null, servedBytes: 0, servedTransfers: 0 });
    queue.push(piece.pieceId);
  };

  async function cachedModels(allowed) {
    const pieceIds = new Set(await store.list());
    const rows = [];
    for (const model of models) {
      if (allowed && !allowed.has(model.modelIdentity)) continue;
      const mine = model.pieces.filter(piece => pieceIds.has(piece.pieceId));
      if (!mine.length) continue;
      rows.push({ modelId: model.modelId, modelIdentity: model.modelIdentity, pieceIndexDigest: model.pieceIndexDigest,
        heldPieces: mine.length, heldBytes: mine.reduce((total, piece) => total + piece.sizeBytes, 0),
        totalPieces: model.pieces.length, complete: mine.length === model.pieces.length });
    }
    return rows;
  }

  return Object.freeze({
    /**
     * Read-only. `deviceLimits`: { freeStorageBytes?, maxDownloadBytes?, maxPieceBytes?, modelIdentities? } where
     * `modelIdentities` lists the pinned models this device is compatible with (all when absent).
     */
    async recommendWeightSupply({ storageCapBytes, deviceLimits = {} }) {
      if (!Number.isSafeInteger(storageCapBytes) || storageCapBytes < 0) throw new TypeError('storageCapBytes must be a byte count');
      const allowed = Array.isArray(deviceLimits.modelIdentities) ? new Set(deviceLimits.modelIdentities) : null;
      const compatible = allowed ? models.filter(model => allowed.has(model.modelIdentity)) : models;
      const { offers, demand, now: at } = mesh();
      const cached = await cachedModels(allowed);
      let result;
      if (paused) result = { offer: null, noOffer: 'paused' };
      else if (approvalActive()) result = { offer: null, noOffer: 'approved' };
      else if (cached.length) result = { offer: null, noOffer: 'cached-models' };
      else {
        result = recommendWeightSupplyPieces({ computerId, offerId: `wso_${crypto.randomUUID()}`, models: compatible, offers, demand,
          now: at, storageCapBytes, deviceLimits, wholeFiles, policy });
      }
      if (result.offer) issuedOffers.set(result.offer.offerId, result.offer);
      for (const [offerId, offer] of issuedOffers) if (offer.expiresAt <= at) issuedOffers.delete(offerId);
      return parseWeightSupplyRecommendation({ schema: WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA, computerId, computedAt: at, storageCapBytes,
        cached, offer: result.offer, noOffer: result.noOffer });
    },

    /**
     * The owner's approval of `offerId`: a signed scope of `storageCapBytes`, the offer's model (plus any further
     * pinned `modelIdentities` the owner allows) and an expiry. Starts fetching the offered pieces.
     */
    async approveWeightSupply({ offerId, storageCapBytes, modelIdentities = [] }) {
      const offer = issuedOffers.get(offerId), at = now();
      if (!offer || offer.expiresAt <= at) throw Object.assign(new Error('Weight-supply offer is unknown or expired'), { code: 'WEIGHT_SUPPLY_OFFER_EXPIRED' });
      if (!Number.isSafeInteger(storageCapBytes) || storageCapBytes < offer.totalDownloadBytes) {
        throw Object.assign(new Error('Storage cap is smaller than the offer'), { code: 'WEIGHT_SUPPLY_CAP_TOO_SMALL' });
      }
      const scope = models.filter(model => model.modelIdentity === offer.modelIdentity || modelIdentities.includes(model.modelIdentity));
      const body = { schema: WEIGHT_SUPPLY_APPROVAL_SCHEMA, approvalId: `wsa_${crypto.randomUUID()}`, offerId, computerId,
        publicJwk: identity.publicJwk, storageCapBytes, modelIdentities: scope.map(model => model.modelIdentity),
        pieceIndexDigests: [...new Set(scope.map(model => model.pieceIndexDigest))], approvedAt: at, expiresAt: at + policy.approval.ttlMs };
      approval = record(parseWeightSupplyApproval({ ...body, signature: await signAsParticipant(identity, WEIGHT_SUPPLY_APPROVAL_SCHEMA, body) }));
      issuedOffers.delete(offerId);
      for (const piece of offer.pieces) if (!held.has(piece.pieceId)) hold(catalog.get(piece.pieceId));
      paused = false; pump(); changed();
      return structuredClone(approval);
    },

    /**
     * Within the approved cap and models, add in-demand under-supplied pieces and, when they do not fit, replace held
     * pieces that are now well supplied or no longer in demand. No new approval; returns the recorded replacement or null.
     */
    async refreshWeightSupply() {
      if (paused || !approvalActive()) return null;
      const { offers, demand, now: at } = mesh();
      const scope = models.filter(model => approval.modelIdentities.includes(model.modelIdentity));
      const keep = new Set([...held.values()].filter(row => row.state !== 'failed').map(row => row.pieceId));
      const candidates = rankUnderSuppliedPieces({ models: scope, offers, demand, now: at, wholeFiles, exclude: keep, policy });
      const copies = verifiedCopiesByPiece(offers, { wholeFiles, now: at }), wanted = demandByPiece(scope, demand, { now: at, policy });
      const reasonFor = row => {
        if ((copies.get(row.pieceId) ?? 0) >= policy.supply.targetCopies) return 'well-supplied';
        if ((wanted.get(row.pieceId)?.consumers ?? 0) < policy.demand.minConsumers) return 'no-demand';
        return null;
      };
      // Least useful first: the most copies elsewhere.
      const removable = [...held.values()].filter(row => row.state === 'verified' && reasonFor(row))
        .sort((a, b) => (copies.get(b.pieceId) ?? 0) - (copies.get(a.pieceId) ?? 0));
      const before = heldBytes(), removed = [], added = [];
      let bytes = before;
      for (const { model, piece } of candidates) {
        const evicted = [];
        while (bytes + piece.sizeBytes > approval.storageCapBytes && removable.length) {
          const row = removable.shift();
          evicted.push(row); bytes -= row.sizeBytes;
        }
        if (bytes + piece.sizeBytes > approval.storageCapBytes) {
          // Evicting every remaining candidate would still not make room: keep them all.
          for (const row of evicted) bytes += row.sizeBytes;
          break;
        }
        for (const row of evicted) removed.push({ pieceId: row.pieceId, modelIdentity: row.modelIdentity, sizeBytes: row.sizeBytes, reason: reasonFor(row) });
        added.push({ model, piece }); bytes += piece.sizeBytes;
      }
      if (!removed.length && !added.length) return null;
      for (const row of removed) { held.delete(row.pieceId); await store.delete(row.pieceId); }
      for (const entry of added) { held.delete(entry.piece.pieceId); hold(entry); }
      const replacement = record(parseWeightSupplyReplacement({ schema: WEIGHT_SUPPLY_REPLACEMENT_SCHEMA, replacementId: `wsr_${crypto.randomUUID()}`,
        approvalId: approval.approvalId, recordedAt: at, removed,
        added: added.map(({ model, piece }) => ({ pieceId: piece.pieceId, modelIdentity: model.modelIdentity, sizeBytes: piece.sizeBytes })),
        storageCapBytes: approval.storageCapBytes, heldBytesBefore: before, heldBytesAfter: heldBytes() }));
      replacements.push(replacement);
      if (replacements.length > policy.report.maxReplacements) replacements.shift();
      if (removed.length && !paused) exchange.offer(verifiedFiles(), { revoke: false });
      pump(); changed();
      return structuredClone(replacement);
    },

    /** Stops serving and fetching; verified pieces stay. This device's own consumption is untouched. */
    pauseWeightSupply() {
      if (paused) return;
      paused = true; controller.abort(new Error('Weight supply paused')); controller = new AbortController();
      exchange.stopSupply(); changed();
    },
    resumeWeightSupply() {
      if (!paused) return;
      paused = false; share(); pump(); changed();
    },

    /** Port for exchange.js `observeServed`: one transfer the consumer confirmed as completed and verified. */
    recordServed(event) {
      if (event?.artifact?.hashAlgorithm !== 'sha256') return null;
      const row = held.get(`sha256:${event.artifact.hash}`);
      if (!row) return null;
      const transfer = record(parseWeightTransfer({ schema: WEIGHT_TRANSFER_SCHEMA, transferId: event.transferId, recordedBy: 'provider',
        pieceId: row.pieceId, modelIdentity: row.modelIdentity, pieceBytes: row.sizeBytes, deliveredBytes: event.deliveredBytes,
        startedAt: event.grantedAt, completedAt: event.completedAt,
        roles: operationRoles({ operation: 'weight-transfer', operationId: event.transferId,
          consumer: event.roles?.consumer ?? { connectionId: event.peerId },
          provider: { computerId, participantId: computerId, connectionId } }) }));
      row.servedBytes += transfer.deliveredBytes; row.servedTransfers++;
      servedBytes += transfer.deliveredBytes; servedTransfers++;
      transfers.push(transfer);
      if (transfers.length > policy.report.maxTransfers) transfers.shift();
      changed();
      return structuredClone(transfer);
    },

    /** reploid.weight-supply-report/1: held and verified bytes, bytes actually served, per-piece holdings. */
    getWeightSupplyReport() {
      const rows = [...held.values()], verified = rows.filter(row => row.state === 'verified');
      const count = state => rows.filter(row => row.state === state).length;
      let offer = null;
      if (approval) {
        let readiness = 'failed';
        if (verified.length) readiness = 'ready';
        else if (rows.some(row => row.state !== 'failed')) readiness = 'preparing';
        offer = weightSupplyOffer({ connectionId, readiness, paused, expiresAt: approval.expiresAt, modelIdentities: approval.modelIdentities,
          pieceIndexDigests: approval.pieceIndexDigests, files: verifiedFiles().map(({ hashAlgorithm, hash, sizeBytes }) => ({ hashAlgorithm, hash, sizeBytes })),
          maxStorageBytes: approval.storageCapBytes });
      }
      return parseWeightSupplyReport({ schema: WEIGHT_SUPPLY_REPORT_SCHEMA, computerId, reportedAt: now(), paused,
        approval: approval && { approvalId: approval.approvalId, storageCapBytes: approval.storageCapBytes, expiresAt: approval.expiresAt },
        offer, verifiedBytes: verified.reduce((total, row) => total + row.sizeBytes, 0), servedBytes, servedTransfers,
        acquisition: { queuedPieces: count('queued'), acquiringPieces: count('acquiring'), failedPieces: count('failed'),
          pendingBytes: rows.filter(row => ['queued', 'acquiring'].includes(row.state)).reduce((total, row) => total + row.sizeBytes, 0) },
        pieces: rows.map(row => ({ pieceId: row.pieceId, modelIdentity: row.modelIdentity, pieceIndexDigest: row.pieceIndexDigest,
          sizeBytes: row.sizeBytes, state: row.state, verifiedAt: row.verifiedAt, servedBytes: row.servedBytes, servedTransfers: row.servedTransfers })),
        replacements: structuredClone(replacements) });
    },
    /** The latest served transfers (reploid.weight-transfer/1), oldest first. */
    getServedTransfers: () => structuredClone(transfers),
    getApproval: () => (approval ? structuredClone(approval) : null),
    /** Resolves when nothing is being fetched (or supply is paused). */
    whenIdle: () => new Promise(resolve => {
      if (active === 0 && (paused || queue.length === 0 || !approvalActive())) { resolve(); return; }
      const wake = () => { idleWaiters.delete(wake); resolve(); };
      idleWaiters.add(wake);
    }),
  });
}
