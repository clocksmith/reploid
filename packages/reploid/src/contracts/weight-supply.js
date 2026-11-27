/**
 * @fileoverview The canonical records of the empty-cache Contribute journey (weight supply): what the mesh wants
 * (demand), what this device is offered to hold (offer), what its owner approved (approval), every change Reploid
 * made inside that approval (replacement), every completed piece transfer (transfer) and what the device reports
 * (report). One owner per concept: the library, the browser host and the native hosts import this file (vendored
 * to shared/vendor/reploid) and never restate it. Pure: no clock, crypto or I/O; ids and signatures are computed by
 * callers (artifacts/custody/weight-supply.js) and only checked for shape here.
 *
 * Policy numbers (what "in demand" and "too few copies" mean, offer bounds, expiries) live in one file,
 * weight-supply-policy.json, and are applied only by `recommendWeightSupplyPieces`.
 *
 * Roles follow contracts/computer-records.js: in a weight transfer the consumer fetches verified pieces and the
 * provider serves them. A weight supplier never runs inference or reads prompts. Joining never opts a device in;
 * pausing the weight-supply offer never stops the device's own consumption.
 */
import { ContractError, OPERATION_ROLES_SCHEMA, recordProblems as roleRecordProblems } from './computer-records.js';
import { isConnectionId, isDigest, isParticipantId, isRecordId } from './identifiers.js';
import policyFile from './weight-supply-policy.json' with { type: 'json' };

export const WEIGHT_SUPPLY_POLICY_SCHEMA = 'reploid.weight-supply-policy/1';
export const WEIGHT_DEMAND_SCHEMA = 'reploid.weight-demand/1';
export const WEIGHT_SUPPLY_OFFER_SCHEMA = 'reploid.weight-supply-offer/1';
export const WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA = 'reploid.weight-supply-recommendation/1';
export const WEIGHT_SUPPLY_APPROVAL_SCHEMA = 'reploid.weight-supply-approval/1';
export const WEIGHT_SUPPLY_REPLACEMENT_SCHEMA = 'reploid.weight-supply-replacement/1';
export const WEIGHT_TRANSFER_SCHEMA = 'reploid.weight-transfer/1';
export const WEIGHT_SUPPLY_REPORT_SCHEMA = 'reploid.weight-supply-report/1';

/** `load`: a consumer is loading the model now; `request`: a consumer asked the mesh for these pieces. */
export const WEIGHT_DEMAND_KINDS = Object.freeze(['load', 'request']);
/** Why a recommendation carries no offer. Data for the UI to choose its copy, never copy itself. */
export const NO_OFFER_REASONS = Object.freeze(['cached-models', 'no-under-supplied-piece', 'storage-cap', 'approved', 'paused']);
/** A held piece: waiting, being fetched, verified (and shareable), or failed verification or every source. */
export const PIECE_STATES = Object.freeze(['queued', 'acquiring', 'verified', 'failed']);
/** Why a replacement removed a held piece. */
export const REMOVAL_REASONS = Object.freeze(['well-supplied', 'no-demand']);
export const TRANSFER_RECORDERS = Object.freeze(['provider', 'consumer']);

const LIMITS = Object.freeze({ pieces: 4096, models: 256, demandPieces: 4096, replacements: 1024 });

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isPositive = value => Number.isSafeInteger(value) && value > 0;
const unique = values => new Set(values).size === values.length;
const sum = (rows, field) => rows.reduce((total, row) => total + row[field], 0);

function policyProblems(value) {
  if (!isObject(value)) return ['policy must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_SUPPLY_POLICY_SCHEMA) problems.push(`schema must be ${WEIGHT_SUPPLY_POLICY_SCHEMA}`);
  const need = (path, check) => {
    const field = path.split('.').reduce((node, key) => node?.[key], value);
    if (!check(field)) problems.push(`${path} is invalid`);
  };
  need('demand.windowMs', isPositive); need('demand.minConsumers', isPositive); need('supply.targetCopies', isPositive);
  need('offer.maxPieces', isPositive); need('offer.maxBytes', isPositive); need('offer.ttlMs', isPositive);
  need('approval.ttlMs', isPositive); need('acquisition.maxConcurrent', isPositive);
  need('report.maxReplacements', isPositive); need('report.maxTransfers', isPositive);
  return problems;
}

function demandProblems(value) {
  if (!isObject(value)) return ['demand must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_DEMAND_SCHEMA) problems.push(`schema must be ${WEIGHT_DEMAND_SCHEMA}`);
  if (!WEIGHT_DEMAND_KINDS.includes(value.kind)) problems.push(`kind must be one of ${WEIGHT_DEMAND_KINDS.join(', ')}`);
  if (!isConnectionId(value.consumer?.connectionId)) problems.push('consumer.connectionId must be a transport session ID');
  if (!(value.consumer?.computerId === null || isParticipantId(value.consumer?.computerId))) problems.push('consumer.computerId must be a participant ID or null');
  if (!(value.modelIdentity === null || isDigest(value.modelIdentity))) problems.push('modelIdentity must be a digest or null');
  if (!Array.isArray(value.pieceIds) || value.pieceIds.length > LIMITS.demandPieces || !value.pieceIds.every(isDigest) || !unique(value.pieceIds)) {
    problems.push('pieceIds must be distinct piece digests');
  } else if (value.modelIdentity === null && value.pieceIds.length === 0) problems.push('demand names no model or piece');
  if (!isCount(value.observedAt)) problems.push('observedAt must be epoch milliseconds');
  return problems;
}

function offeredPieceProblems(piece, path) {
  if (!isObject(piece)) return [`${path} must be an object`];
  const problems = [];
  if (!isDigest(piece.pieceId)) problems.push(`${path}.pieceId must be a piece digest`);
  if (typeof piece.path !== 'string' || piece.path.length === 0 || piece.path.length > 256) problems.push(`${path}.path must be a model file path`);
  if (!isCount(piece.offset)) problems.push(`${path}.offset must be a byte offset`);
  if (!isPositive(piece.sizeBytes)) problems.push(`${path}.sizeBytes must be a positive byte count`);
  if (!isCount(piece.demand?.consumers) || !isCount(piece.demand?.loads) || !isCount(piece.demand?.requests)) {
    problems.push(`${path}.demand must count consumers, loads and requests`);
  }
  if (!isCount(piece.supply?.verifiedCopies)) problems.push(`${path}.supply.verifiedCopies must be a count`);
  return problems;
}

function offerProblems(value) {
  if (!isObject(value)) return ['offer must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_SUPPLY_OFFER_SCHEMA) problems.push(`schema must be ${WEIGHT_SUPPLY_OFFER_SCHEMA}`);
  if (!isRecordId(value.offerId)) problems.push('offerId must be a record ID');
  if (!isParticipantId(value.computerId)) problems.push('computerId must be this computer\'s participant ID');
  if (!isRecordId(value.modelId)) problems.push('modelId must be a model ID');
  if (!isDigest(value.modelIdentity)) problems.push('modelIdentity must be a digest');
  if (!isDigest(value.pieceIndexDigest)) problems.push('pieceIndexDigest must be a digest');
  if (!Array.isArray(value.pieces) || value.pieces.length === 0 || value.pieces.length > LIMITS.pieces) problems.push('pieces must list 1 or more pieces');
  else {
    value.pieces.forEach((piece, index) => problems.push(...offeredPieceProblems(piece, `pieces[${index}]`)));
    if (!unique(value.pieces.map(piece => piece?.pieceId))) problems.push('pieces must be distinct');
    if (problems.length === 0 && value.totalDownloadBytes !== sum(value.pieces, 'sizeBytes')) problems.push('totalDownloadBytes must equal the pieces\' bytes');
  }
  if (!isPositive(value.totalDownloadBytes)) problems.push('totalDownloadBytes must be a positive byte count');
  if (!isPositive(value.storageCapBytes) || value.totalDownloadBytes > value.storageCapBytes) problems.push('storageCapBytes must be at least totalDownloadBytes');
  if (!isCount(value.createdAt) || !isCount(value.expiresAt) || value.expiresAt <= value.createdAt) problems.push('expiresAt must follow createdAt');
  return problems;
}

function cachedProblems(row, path) {
  if (!isObject(row)) return [`${path} must be an object`];
  const problems = [];
  if (!isRecordId(row.modelId) || !isDigest(row.modelIdentity) || !isDigest(row.pieceIndexDigest)) problems.push(`${path} must name a pinned model`);
  if (!isCount(row.heldPieces) || !isPositive(row.totalPieces) || row.heldPieces > row.totalPieces) problems.push(`${path}.heldPieces must be within totalPieces`);
  if (!isCount(row.heldBytes)) problems.push(`${path}.heldBytes must be a byte count`);
  if (row.complete !== (row.heldPieces === row.totalPieces)) problems.push(`${path}.complete must say whether every piece is held`);
  return problems;
}

function recommendationProblems(value) {
  if (!isObject(value)) return ['recommendation must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA) problems.push(`schema must be ${WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA}`);
  if (!isParticipantId(value.computerId)) problems.push('computerId must be a participant ID');
  if (!isCount(value.computedAt)) problems.push('computedAt must be epoch milliseconds');
  if (!isCount(value.storageCapBytes)) problems.push('storageCapBytes must be a byte count');
  if (!Array.isArray(value.cached) || value.cached.length > LIMITS.models) problems.push('cached must be an array');
  else value.cached.forEach((row, index) => problems.push(...cachedProblems(row, `cached[${index}]`)));
  // Exactly one of an offer or the reason for none: the UI never asks for a download without an offer.
  if (value.offer === null) {
    if (!NO_OFFER_REASONS.includes(value.noOffer)) problems.push(`noOffer must be one of ${NO_OFFER_REASONS.join(', ')} when offer is null`);
  } else {
    if (value.noOffer !== null) problems.push('noOffer must be null when an offer is present');
    problems.push(...offerProblems(value.offer).map(problem => `offer.${problem}`));
    if (value.offer?.computerId !== value.computerId) problems.push('offer.computerId must be the recommendation\'s computer');
  }
  return problems;
}

/** The fields an approval signs: everything but `signature`. */
export const approvalBody = approval => Object.fromEntries(Object.entries(approval).filter(([key]) => key !== 'signature'));

function approvalProblems(value) {
  if (!isObject(value)) return ['approval must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_SUPPLY_APPROVAL_SCHEMA) problems.push(`schema must be ${WEIGHT_SUPPLY_APPROVAL_SCHEMA}`);
  if (!isRecordId(value.approvalId)) problems.push('approvalId must be a record ID');
  if (!isRecordId(value.offerId)) problems.push('offerId must be the approved offer\'s ID');
  if (!isParticipantId(value.computerId)) problems.push('computerId must be the signing computer\'s participant ID');
  if (!isObject(value.publicJwk)) problems.push('publicJwk must be the signing key');
  if (!isPositive(value.storageCapBytes)) problems.push('storageCapBytes must be a positive byte count');
  for (const field of ['modelIdentities', 'pieceIndexDigests']) {
    const list = value[field];
    if (!Array.isArray(list) || list.length === 0 || list.length > LIMITS.models || !list.every(isDigest) || !unique(list)) problems.push(`${field} must be distinct digests`);
  }
  if (!isCount(value.approvedAt) || !isCount(value.expiresAt) || value.expiresAt <= value.approvedAt) problems.push('expiresAt must follow approvedAt');
  if (typeof value.signature !== 'string' || value.signature.length === 0 || value.signature.length > 256) problems.push('signature must be present');
  return problems;
}

function replacedPieceProblems(rows, path, withReason) {
  if (!Array.isArray(rows) || rows.length > LIMITS.pieces) return [`${path} must be an array`];
  const problems = [];
  rows.forEach((row, index) => {
    if (!isObject(row) || !isDigest(row.pieceId) || !isDigest(row.modelIdentity) || !isPositive(row.sizeBytes)) problems.push(`${path}[${index}] must name a piece, its model and its bytes`);
    else if (withReason && !REMOVAL_REASONS.includes(row.reason)) problems.push(`${path}[${index}].reason must be one of ${REMOVAL_REASONS.join(', ')}`);
  });
  if (!unique(rows.map(row => row?.pieceId))) problems.push(`${path} must be distinct`);
  return problems;
}

function replacementProblems(value) {
  if (!isObject(value)) return ['replacement must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_SUPPLY_REPLACEMENT_SCHEMA) problems.push(`schema must be ${WEIGHT_SUPPLY_REPLACEMENT_SCHEMA}`);
  if (!isRecordId(value.replacementId)) problems.push('replacementId must be a record ID');
  if (!isRecordId(value.approvalId)) problems.push('approvalId must name the approval it ran under');
  if (!isCount(value.recordedAt)) problems.push('recordedAt must be epoch milliseconds');
  problems.push(...replacedPieceProblems(value.removed, 'removed', true), ...replacedPieceProblems(value.added, 'added', false));
  if (Array.isArray(value.removed) && Array.isArray(value.added) && value.removed.length + value.added.length === 0) problems.push('a replacement changes at least one piece');
  if (!isPositive(value.storageCapBytes)) problems.push('storageCapBytes must be the approval\'s cap');
  if (!isCount(value.heldBytesBefore) || !isCount(value.heldBytesAfter) || value.heldBytesAfter > value.storageCapBytes) problems.push('heldBytesAfter must stay within storageCapBytes');
  return problems;
}

function transferProblems(value) {
  if (!isObject(value)) return ['transfer must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_TRANSFER_SCHEMA) problems.push(`schema must be ${WEIGHT_TRANSFER_SCHEMA}`);
  if (!isRecordId(value.transferId)) problems.push('transferId must be a record ID');
  if (!TRANSFER_RECORDERS.includes(value.recordedBy)) problems.push(`recordedBy must be one of ${TRANSFER_RECORDERS.join(', ')}`);
  if (!isDigest(value.pieceId)) problems.push('pieceId must be a piece digest');
  if (!(value.modelIdentity === null || isDigest(value.modelIdentity))) problems.push('modelIdentity must be a digest or null');
  if (!isPositive(value.pieceBytes)) problems.push('pieceBytes must be a positive byte count');
  if (!isCount(value.deliveredBytes) || value.deliveredBytes > value.pieceBytes) problems.push('deliveredBytes must be within pieceBytes');
  if (!isCount(value.startedAt) || !isCount(value.completedAt) || value.completedAt < value.startedAt) problems.push('completedAt must not precede startedAt');
  const roles = roleRecordProblems(OPERATION_ROLES_SCHEMA, value.roles);
  problems.push(...roles.map(problem => `roles.${problem}`));
  if (!roles.length && (value.roles.operation !== 'weight-transfer' || value.roles.operationId !== value.transferId)) problems.push('roles must be this weight transfer\'s');
  return problems;
}

function reportedPieceProblems(piece, path) {
  if (!isObject(piece)) return [`${path} must be an object`];
  const problems = [];
  if (!isDigest(piece.pieceId) || !isDigest(piece.modelIdentity) || !isDigest(piece.pieceIndexDigest)) problems.push(`${path} must name a piece of a pinned model`);
  if (!isPositive(piece.sizeBytes)) problems.push(`${path}.sizeBytes must be a positive byte count`);
  if (!PIECE_STATES.includes(piece.state)) problems.push(`${path}.state must be one of ${PIECE_STATES.join(', ')}`);
  if (!(piece.verifiedAt === null || isCount(piece.verifiedAt)) || (piece.state === 'verified') !== (piece.verifiedAt !== null)) problems.push(`${path}.verifiedAt is set exactly when verified`);
  if (!isCount(piece.servedBytes) || !isCount(piece.servedTransfers)) problems.push(`${path} must count served bytes and transfers`);
  return problems;
}

function reportProblems(value) {
  if (!isObject(value)) return ['report must be an object'];
  const problems = [];
  if (value.schema !== WEIGHT_SUPPLY_REPORT_SCHEMA) problems.push(`schema must be ${WEIGHT_SUPPLY_REPORT_SCHEMA}`);
  if (!isParticipantId(value.computerId)) problems.push('computerId must be a participant ID');
  if (!isCount(value.reportedAt)) problems.push('reportedAt must be epoch milliseconds');
  if (typeof value.paused !== 'boolean') problems.push('paused must be a boolean');
  const approval = value.approval;
  if (!(approval === null || isObject(approval) && isRecordId(approval.approvalId) && isPositive(approval.storageCapBytes) && isCount(approval.expiresAt))) {
    problems.push('approval must be null or { approvalId, storageCapBytes, expiresAt }');
  }
  if (!(value.offer === null || isObject(value.offer) && value.offer.kind === 'weight-supply')) problems.push('offer must be null or this computer\'s weight-supply offer');
  else if (value.offer) problems.push(...roleRecordProblems(value.offer.schema, value.offer).map(problem => `offer.${problem}`));
  if (!isCount(value.verifiedBytes) || !isCount(value.servedBytes) || !isCount(value.servedTransfers)) problems.push('verifiedBytes, servedBytes and servedTransfers must be counts');
  const acquisition = value.acquisition;
  if (!isObject(acquisition) || !['queuedPieces', 'acquiringPieces', 'failedPieces', 'pendingBytes'].every(key => isCount(acquisition[key]))) {
    problems.push('acquisition must count queued, acquiring and failed pieces and pending bytes');
  }
  if (!Array.isArray(value.pieces) || value.pieces.length > LIMITS.pieces) problems.push('pieces must be an array');
  else {
    value.pieces.forEach((piece, index) => problems.push(...reportedPieceProblems(piece, `pieces[${index}]`)));
    if (!unique(value.pieces.map(piece => piece?.pieceId))) problems.push('pieces must be distinct');
    if (!problems.length) {
      const verified = value.pieces.filter(piece => piece.state === 'verified');
      if (value.verifiedBytes !== sum(verified, 'sizeBytes')) problems.push('verifiedBytes must equal the verified pieces\' bytes');
      if (sum(value.pieces, 'servedBytes') > value.servedBytes) problems.push('servedBytes must include every held piece\'s served bytes');
      if (approval && value.verifiedBytes > approval.storageCapBytes) problems.push('verifiedBytes must stay within the approved storage cap');
    }
  }
  if (!Array.isArray(value.replacements) || value.replacements.length > LIMITS.replacements) problems.push('replacements must be an array');
  else value.replacements.forEach((row, index) => problems.push(...replacementProblems(row).map(problem => `replacements[${index}].${problem}`)));
  return problems;
}

const CHECKS = Object.freeze({ [WEIGHT_SUPPLY_POLICY_SCHEMA]: policyProblems, [WEIGHT_DEMAND_SCHEMA]: demandProblems,
  [WEIGHT_SUPPLY_OFFER_SCHEMA]: offerProblems, [WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA]: recommendationProblems,
  [WEIGHT_SUPPLY_APPROVAL_SCHEMA]: approvalProblems, [WEIGHT_SUPPLY_REPLACEMENT_SCHEMA]: replacementProblems,
  [WEIGHT_TRANSFER_SCHEMA]: transferProblems, [WEIGHT_SUPPLY_REPORT_SCHEMA]: reportProblems });

/** The problems with `value` as the weight-supply record `schema` names (empty when valid). Unknown fields are ignored. */
export function weightSupplyRecordProblems(schema, value) {
  const check = CHECKS[schema];
  if (!check) return [`unknown weight-supply schema ${String(schema)}`];
  return check(value);
}

const parser = schema => value => {
  const problems = weightSupplyRecordProblems(schema, value);
  if (problems.length) throw new ContractError(schema, problems);
  return structuredClone(value);
};
/** Each parser returns a copy of a valid record and throws ContractError otherwise. */
export const parseWeightSupplyPolicy = parser(WEIGHT_SUPPLY_POLICY_SCHEMA);
export const parseWeightDemand = parser(WEIGHT_DEMAND_SCHEMA);
export const parseWeightSupplyOffer = parser(WEIGHT_SUPPLY_OFFER_SCHEMA);
export const parseWeightSupplyRecommendation = parser(WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA);
export const parseWeightSupplyApproval = parser(WEIGHT_SUPPLY_APPROVAL_SCHEMA);
export const parseWeightSupplyReplacement = parser(WEIGHT_SUPPLY_REPLACEMENT_SCHEMA);
export const parseWeightTransfer = parser(WEIGHT_TRANSFER_SCHEMA);
export const parseWeightSupplyReport = parser(WEIGHT_SUPPLY_REPORT_SCHEMA);
/** The weight-supply record a value's own `schema` names, parsed. */
export const parseWeightSupplyRecord = value => parser(value?.schema)(value);

/** The policy in force: weight-supply-policy.json, the one place its numbers are set. */
export const WEIGHT_SUPPLY_POLICY = Object.freeze(parseWeightSupplyPolicy(policyFile));

// Readers of the wire forms the mesh already carries.

/**
 * A pinned model's pieces from its Doppler piece index (`doppler.verified-pieces/v1`, shared/config/model-pieces),
 * which the caller has already verified against `pieceIndexDigest`. The index must name the pinned manifest.
 */
export function pinnedModelPieces({ modelId, modelIdentity, pieceIndexDigest, index }) {
  const problems = [];
  if (!isRecordId(modelId) || !isDigest(modelIdentity) || !isDigest(pieceIndexDigest)) problems.push('model must be pinned by ID, identity and piece-index digest');
  if (index?.schema !== 'doppler.verified-pieces/v1' || index.manifestIdentity !== modelIdentity || !Array.isArray(index.files)) problems.push('index must be the pinned model\'s verified piece index');
  if (problems.length) throw new ContractError('doppler.verified-pieces/v1', problems);
  const pieces = [];
  for (const file of index.files) {
    for (const piece of file.pieces ?? []) {
      if (!isDigest(piece.identity) || !isPositive(piece.size) || !isCount(piece.offset)) throw new ContractError('doppler.verified-pieces/v1', [`${file.path} has an invalid piece`]);
      pieces.push({ pieceId: piece.identity, path: file.path, offset: piece.offset, sizeBytes: piece.size });
    }
  }
  if (pieces.length === 0 || pieces.length > LIMITS.pieces * 16) throw new ContractError('doppler.verified-pieces/v1', ['index must list pieces']);
  return Object.freeze({ modelId, modelIdentity, pieceIndexDigest, pieces: Object.freeze(pieces) });
}

/** A peer's inference offer in `preparing` readiness is a load of its model (contracts/computer-records.js). */
export function weightDemandFromInferenceOffer(offer, { observedAt }) {
  if (offer?.kind !== 'inference' || offer.readiness !== 'preparing' || !isConnectionId(offer.connectionId)) return null;
  const modelIdentity = offer.scope?.modelIdentities?.[0];
  if (!isDigest(modelIdentity)) return null;
  return parseWeightDemand({ schema: WEIGHT_DEMAND_SCHEMA, kind: 'load', consumer: { connectionId: offer.connectionId, computerId: null },
    modelIdentity, pieceIds: [], observedAt });
}

/** A consumer's custody demand announcement (exchange.js `getState().demand`): the pieces it is fetching. */
export function weightDemandFromAnnouncement({ connectionId, files, observedAt }) {
  if (!isConnectionId(connectionId) || !Array.isArray(files)) return null;
  const pieceIds = [...new Set(files.filter(file => file?.hashAlgorithm === 'sha256').map(file => `sha256:${file.hash}`).filter(isDigest))];
  if (pieceIds.length === 0) return null;
  return parseWeightDemand({ schema: WEIGHT_DEMAND_SCHEMA, kind: 'request', consumer: { connectionId, computerId: null },
    modelIdentity: null, pieceIds: pieceIds.slice(0, LIMITS.demandPieces), observedAt });
}

/**
 * Verified copies offered per piece: one per connection whose weight-supply offer (reploid.offer/1) lists the
 * piece's bytes, either as a piece file (hash = piece digest) or as a whole file `wholeFiles` maps to its pieces.
 */
export function verifiedCopiesByPiece(offers, { wholeFiles = {}, now = null } = {}) {
  const holders = new Map();
  for (const offer of offers ?? []) {
    if (offer?.kind !== 'weight-supply' || offer.paused || !['ready', 'busy'].includes(offer.readiness)) continue;
    if (now !== null && offer.expiresAt !== null && offer.expiresAt <= now) continue;
    const holder = offer.connectionId ?? JSON.stringify(offer.scope.files);
    for (const file of offer.scope?.files ?? []) {
      if (file.hashAlgorithm !== 'sha256') continue;
      for (const pieceId of wholeFiles[file.hash] ?? [`sha256:${file.hash}`]) {
        if (!holders.has(pieceId)) holders.set(pieceId, new Set());
        holders.get(pieceId).add(holder);
      }
    }
  }
  return new Map([...holders].map(([pieceId, set]) => [pieceId, set.size]));
}

/** Per piece: distinct consumers, loads and requests inside the policy's demand window. */
export function demandByPiece(models, demand, { now, policy = WEIGHT_SUPPLY_POLICY }) {
  const rows = new Map();
  const count = (pieceId, record) => {
    const row = rows.get(pieceId) ?? { consumers: new Set(), loads: 0, requests: 0 };
    row.consumers.add(record.consumer.computerId ?? record.consumer.connectionId);
    row[record.kind === 'load' ? 'loads' : 'requests']++;
    rows.set(pieceId, row);
  };
  for (const record of demand ?? []) {
    if (weightSupplyRecordProblems(WEIGHT_DEMAND_SCHEMA, record).length || now - record.observedAt > policy.demand.windowMs || record.observedAt > now) continue;
    const named = new Set(record.pieceIds);
    for (const model of models) {
      const whole = record.modelIdentity === model.modelIdentity;
      for (const piece of model.pieces) if (whole || named.has(piece.pieceId)) count(piece.pieceId, record);
    }
  }
  return new Map([...rows].map(([pieceId, row]) => [pieceId, { consumers: row.consumers.size, loads: row.loads, requests: row.requests }]));
}

/**
 * Pieces of `models` that are in demand (at least `demand.minConsumers` distinct consumers in the window) and
 * under-supplied (fewer than `supply.targetCopies` verified copies offered by other computers), most useful
 * first: the largest copy deficit, then the most consumers, then index order. `exclude` skips held pieces.
 */
export function rankUnderSuppliedPieces({ models, offers, demand, now, wholeFiles = {}, exclude = new Set(), policy = WEIGHT_SUPPLY_POLICY }) {
  const copies = verifiedCopiesByPiece(offers, { wholeFiles, now }), wanted = demandByPiece(models, demand, { now, policy });
  const ranked = [];
  let order = 0;
  for (const model of models) {
    for (const piece of model.pieces) {
      order++;
      const demandRow = wanted.get(piece.pieceId), verifiedCopies = copies.get(piece.pieceId) ?? 0;
      if (exclude.has(piece.pieceId) || !demandRow || demandRow.consumers < policy.demand.minConsumers || verifiedCopies >= policy.supply.targetCopies) continue;
      ranked.push({ model, piece, order, deficit: policy.supply.targetCopies - verifiedCopies,
        demand: demandRow, supply: { verifiedCopies } });
    }
  }
  return ranked.sort((a, b) => b.deficit - a.deficit || b.demand.consumers - a.demand.consumers || a.order - b.order);
}

/**
 * The bounded offer body for an empty cache: one pinned model (the one whose under-supplied pieces rank first),
 * at most `offer.maxPieces` pieces and the smallest of `offer.maxBytes`, the storage cap and the device limits.
 * Returns null when nothing qualifies or nothing fits. `offerId` and `createdAt` are the caller's.
 */
export function recommendWeightSupplyPieces({ computerId, offerId, models, offers, demand, now, storageCapBytes, deviceLimits = {},
  wholeFiles = {}, policy = WEIGHT_SUPPLY_POLICY }) {
  const ranked = rankUnderSuppliedPieces({ models, offers, demand, now, wholeFiles, policy });
  if (!ranked.length) return { offer: null, noOffer: 'no-under-supplied-piece' };
  const limits = [policy.offer.maxBytes, storageCapBytes, deviceLimits.freeStorageBytes, deviceLimits.maxDownloadBytes].filter(isCount);
  const budget = Math.min(...limits);
  const model = ranked[0].model, chosen = [];
  let bytes = 0;
  for (const row of ranked) {
    if (row.model !== model || chosen.length >= policy.offer.maxPieces) continue;
    if (isPositive(deviceLimits.maxPieceBytes) && row.piece.sizeBytes > deviceLimits.maxPieceBytes) continue;
    if (bytes + row.piece.sizeBytes > budget) continue;
    bytes += row.piece.sizeBytes;
    chosen.push({ ...row.piece, demand: row.demand, supply: row.supply });
  }
  if (!chosen.length) return { offer: null, noOffer: 'storage-cap' };
  return { noOffer: null, offer: parseWeightSupplyOffer({ schema: WEIGHT_SUPPLY_OFFER_SCHEMA, offerId, computerId, modelId: model.modelId,
    modelIdentity: model.modelIdentity, pieceIndexDigest: model.pieceIndexDigest, pieces: chosen, totalDownloadBytes: bytes,
    storageCapBytes, createdAt: now, expiresAt: now + policy.offer.ttlMs }) };
}

/** The piece file a holder offers and a consumer fetches for one pinned piece (as work-model-files.js stores it). */
export const pieceFile = piece => Object.freeze({ path: `piece-${piece.pieceId.slice(7)}.bin`, role: 'model-weights',
  sizeBytes: piece.sizeBytes, hash: piece.pieceId.slice(7), hashAlgorithm: 'sha256' });
