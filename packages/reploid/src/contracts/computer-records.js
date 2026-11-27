/**
 * @fileoverview The canonical records for computers, their offers and the roles in an operation. One owner per
 * concept: this module defines each record, validates it and reads the older wire forms into it; the browser, the
 * native hosts and the HTTP services import it (through shared/vendor/reploid on the served and server side) and
 * never restate it. Pure: no dependencies beyond identifiers.js, no clock unless one is passed.
 *
 * Model (docs/open-mesh-architecture.md): consumer and provider are roles in one operation, never kinds of account
 * or computer. A computer has two independent offers, weight supply (serves verified model files and pieces; never
 * runs inference or reads prompts) and inference (runs a model to answer requests), each with its own readiness,
 * scope, expiry and pause. Connection assistance is separate from both. A provider is available only through an
 * active, unexpired offer; there is no permanent provider flag.
 */
import { isComputerId, isConnectionId, isDigest, isHexDigest, isParticipantId, isRecordId, isAccountId } from './identifiers.js';

export * from './identifiers.js';

export const COMPUTER_SCHEMA = 'reploid.computer/1';
export const OFFER_SCHEMA = 'reploid.offer/1';
export const CONNECTION_ASSISTANCE_SCHEMA = 'reploid.connection-assistance/1';
export const OPERATION_ROLES_SCHEMA = 'reploid.operation-roles/1';

export const OFFER_KINDS = Object.freeze(['weight-supply', 'inference']);
/** An offer's readiness. `busy` is ready with no free capacity; `unavailable` is offered but unable to serve now. */
export const OFFER_READINESS = Object.freeze(['preparing', 'ready', 'busy', 'stopping', 'failed', 'unavailable']);
/** How an inference offer runs its model: the whole model, or one qualified stage of a split model. */
export const INFERENCE_EXECUTIONS = Object.freeze(['whole-model', 'model-stage']);
export const IDENTITY_BASES = Object.freeze(['signing-key', 'ledger-enrollment']);
export const OPERATION_KINDS = Object.freeze(['inference', 'weight-transfer']);
export const FILE_HASH_ALGORITHMS = Object.freeze(['sha256', 'blake3']);

const LIMITS = Object.freeze({ connections: 64, participantIds: 64, identities: 64, files: 4096 });

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isTime = value => value === null || isCount(value);
const unique = values => new Set(values).size === values.length;

/** A record that failed its contract: `problems` lists each failing field by path. */
export class ContractError extends TypeError {
  constructor(schema, problems) {
    super(`Invalid ${schema}: ${problems.join('; ')}`);
    this.code = 'CONTRACT_INVALID';
    this.schema = schema;
    this.problems = problems;
  }
}

const digestList = (value, path, problems, max = LIMITS.identities) => {
  if (!Array.isArray(value) || value.length > max || !value.every(isDigest) || !unique(value)) problems.push(`${path} must be distinct sha256 digests`);
};

function inferenceScopeProblems(scope, problems) {
  if (!isObject(scope)) { problems.push('scope must be an object'); return; }
  if (!(scope.modelId === null || isRecordId(scope.modelId))) problems.push('scope.modelId must be a model ID or null');
  digestList(scope.modelIdentities, 'scope.modelIdentities', problems);
  digestList(scope.adapterIdentities, 'scope.adapterIdentities', problems);
  if (!INFERENCE_EXECUTIONS.includes(scope.execution)) problems.push(`scope.execution must be one of ${INFERENCE_EXECUTIONS.join(', ')}`);
  if (scope.execution === 'model-stage' ? !isCount(scope.stageIndex) : scope.stageIndex !== null) {
    problems.push('scope.stageIndex is a stage index for model-stage and null otherwise');
  }
  if (!(scope.availableSlots === null || isCount(scope.availableSlots))) problems.push('scope.availableSlots must be a count or null');
}

function weightScopeProblems(scope, problems) {
  if (!isObject(scope)) { problems.push('scope must be an object'); return; }
  digestList(scope.modelIdentities, 'scope.modelIdentities', problems);
  digestList(scope.pieceIndexDigests, 'scope.pieceIndexDigests', problems, LIMITS.files);
  if (!Array.isArray(scope.files) || scope.files.length > LIMITS.files || !scope.files.every(file => isObject(file)
    && FILE_HASH_ALGORITHMS.includes(file.hashAlgorithm) && isHexDigest(file.hash) && Number.isSafeInteger(file.sizeBytes) && file.sizeBytes > 0)) {
    problems.push('scope.files must be { hashAlgorithm, hash, sizeBytes } entries');
  }
  if (!(scope.maxStorageBytes === null || isCount(scope.maxStorageBytes))) problems.push('scope.maxStorageBytes must be a byte count or null');
}

function offerProblems(offer) {
  const problems = [];
  if (!isObject(offer)) return ['offer must be an object'];
  if (offer.schema !== OFFER_SCHEMA) problems.push(`schema must be ${OFFER_SCHEMA}`);
  if (!OFFER_KINDS.includes(offer.kind)) problems.push(`kind must be one of ${OFFER_KINDS.join(', ')}`);
  if (!(offer.connectionId === null || isConnectionId(offer.connectionId))) problems.push('connectionId must be a transport session ID or null');
  if (!OFFER_READINESS.includes(offer.readiness)) problems.push(`readiness must be one of ${OFFER_READINESS.join(', ')}`);
  if (typeof offer.paused !== 'boolean') problems.push('paused must be a boolean');
  if (!isTime(offer.expiresAt)) problems.push('expiresAt must be epoch milliseconds or null');
  if (offer.kind === 'inference') inferenceScopeProblems(offer.scope, problems);
  else if (offer.kind === 'weight-supply') weightScopeProblems(offer.scope, problems);
  return problems;
}

function assistanceProblems(value) {
  if (!isObject(value)) return ['connection assistance must be an object'];
  const problems = [];
  if (value.schema !== CONNECTION_ASSISTANCE_SCHEMA) problems.push(`schema must be ${CONNECTION_ASSISTANCE_SCHEMA}`);
  if (typeof value.enabled !== 'boolean') problems.push('enabled must be a boolean');
  return problems;
}

function computerProblems(computer) {
  if (!isObject(computer)) return ['computer must be an object'];
  const problems = [];
  if (computer.schema !== COMPUTER_SCHEMA) problems.push(`schema must be ${COMPUTER_SCHEMA}`);
  if (!IDENTITY_BASES.includes(computer.identityBasis)) problems.push(`identityBasis must be one of ${IDENTITY_BASES.join(', ')}`);
  else if (!isComputerId(computer.computerId, computer.identityBasis)) problems.push(`computerId is not a ${computer.identityBasis} identity`);
  const keys = computer.participantIds;
  if (!Array.isArray(keys) || keys.length > LIMITS.participantIds || !keys.every(isParticipantId) || !unique(keys)) {
    problems.push('participantIds must be distinct participant IDs');
  } else if (computer.identityBasis === 'signing-key' && !keys.includes(computer.computerId)) {
    problems.push('participantIds must include a signing-key computerId');
  }
  if (!(computer.accountId === null || isAccountId(computer.accountId))) problems.push('accountId must be an account ID or null');
  if (!Array.isArray(computer.connections) || computer.connections.length > LIMITS.connections) problems.push('connections must be an array');
  else {
    computer.connections.forEach((connection, index) => {
      if (!isObject(connection) || !isConnectionId(connection.connectionId)) problems.push(`connections[${index}].connectionId must be a transport session ID`);
      else if (!(connection.participantId === null || Array.isArray(keys) && keys.includes(connection.participantId))) {
        problems.push(`connections[${index}].participantId must be null or one of participantIds`);
      }
    });
    if (!unique(computer.connections.map(connection => connection?.connectionId))) problems.push('connections must be distinct');
  }
  if (!Array.isArray(computer.offers)) problems.push('offers must be an array');
  else {
    computer.offers.forEach((offer, index) => problems.push(...offerProblems(offer).map(problem => `offers[${index}].${problem}`)));
    if (!unique(computer.offers.map(offer => offer?.kind))) problems.push('offers holds at most one offer of each kind');
  }
  if (computer.connectionAssistance !== null) problems.push(...assistanceProblems(computer.connectionAssistance).map(problem => `connectionAssistance.${problem}`));
  return problems;
}

function partyProblems(party, path) {
  if (!isObject(party)) return [`${path} must be an object`];
  const problems = [];
  if (!(party.computerId === null || isComputerId(party.computerId))) problems.push(`${path}.computerId must be a computer ID or null`);
  if (!(party.participantId === null || isParticipantId(party.participantId))) problems.push(`${path}.participantId must be a participant ID or null`);
  if (party.accountId !== undefined && !isAccountId(party.accountId)) problems.push(`${path}.accountId must be an account ID when present`);
  if (party.connectionId !== undefined && !isConnectionId(party.connectionId)) problems.push(`${path}.connectionId must be a transport session ID when present`);
  if (party.computerId === null && party.participantId === null && party.connectionId === undefined) problems.push(`${path} names no computer, key or connection`);
  return problems;
}

function rolesProblems(roles) {
  if (!isObject(roles)) return ['operation roles must be an object'];
  const problems = [];
  if (roles.schema !== OPERATION_ROLES_SCHEMA) problems.push(`schema must be ${OPERATION_ROLES_SCHEMA}`);
  if (!OPERATION_KINDS.includes(roles.operation)) problems.push(`operation must be one of ${OPERATION_KINDS.join(', ')}`);
  if (!isRecordId(roles.operationId)) problems.push('operationId must be a record ID');
  problems.push(...partyProblems(roles.consumer, 'consumer'), ...partyProblems(roles.provider, 'provider'));
  return problems;
}

const CHECKS = Object.freeze({ [COMPUTER_SCHEMA]: computerProblems, [OFFER_SCHEMA]: offerProblems,
  [CONNECTION_ASSISTANCE_SCHEMA]: assistanceProblems, [OPERATION_ROLES_SCHEMA]: rolesProblems });

/** The problems with `value` as the record `schema` names (empty when it is valid). Unknown fields are ignored. */
export function recordProblems(schema, value) {
  const check = CHECKS[schema];
  if (!check) return [`unknown record schema ${String(schema)}`];
  return check(value);
}

const parser = schema => value => {
  const problems = recordProblems(schema, value);
  if (problems.length) throw new ContractError(schema, problems);
  return structuredClone(value);
};
/** Each parser returns a copy of a valid record and throws ContractError otherwise. */
export const parseComputer = parser(COMPUTER_SCHEMA);
export const parseOffer = parser(OFFER_SCHEMA);
export const parseConnectionAssistance = parser(CONNECTION_ASSISTANCE_SCHEMA);
export const parseOperationRoles = parser(OPERATION_ROLES_SCHEMA);
/** The record a value's own `schema` names, parsed. */
export function parseRecord(value) {
  return parser(value?.schema)(value);
}
export const isComputer = value => computerProblems(value).length === 0;
export const isOffer = value => offerProblems(value).length === 0;
export const isOperationRoles = value => rolesProblems(value).length === 0;

/** Whether `offer` can take new work at `now`: not paused, ready (busy counts: it is serving) and not expired. */
export function isOfferActive(offer, now) {
  return isOffer(offer) && !offer.paused && ['ready', 'busy'].includes(offer.readiness) && (offer.expiresAt === null || offer.expiresAt > now);
}
/** The computer's offer of `kind`, or null. */
export const offerOf = (computer, kind) => computer?.offers?.find(offer => offer.kind === kind) ?? null;
/** Whether the computer provides `kind` at `now`: derived from its active offer, never a stored provider flag. */
export const providesNow = (computer, kind, now) => isOfferActive(offerOf(computer, kind), now);

// Builders. Each fills the record's defaults, then validates; a caller passes only facts it has verified.

export function inferenceOffer({ connectionId = null, readiness, paused = false, expiresAt = null, modelId = null,
  modelIdentities = [], adapterIdentities = [], execution = 'whole-model', stageIndex = null, availableSlots = null }) {
  return parseOffer({ schema: OFFER_SCHEMA, kind: 'inference', connectionId, readiness, paused, expiresAt,
    scope: { modelId, modelIdentities, adapterIdentities, execution, stageIndex, availableSlots } });
}

export function weightSupplyOffer({ connectionId = null, readiness, paused = false, expiresAt = null, modelIdentities = [],
  pieceIndexDigests = [], files = [], maxStorageBytes = null }) {
  return parseOffer({ schema: OFFER_SCHEMA, kind: 'weight-supply', connectionId, readiness, paused, expiresAt,
    scope: { modelIdentities, pieceIndexDigests, files, maxStorageBytes } });
}

export const connectionAssistance = ({ enabled }) => parseConnectionAssistance({ schema: CONNECTION_ASSISTANCE_SCHEMA, enabled });

export function computerRecord({ computerId, identityBasis = 'signing-key', participantIds = null, accountId = null, connections = [],
  offers = [], connectionAssistance: assistance = null }) {
  const keys = participantIds ?? [...new Set([computerId, ...connections.map(connection => connection.participantId)].filter(isParticipantId))];
  return parseComputer({ schema: COMPUTER_SCHEMA, computerId, identityBasis, participantIds: keys, accountId,
    connections: connections.map(({ connectionId, participantId = null }) => ({ connectionId, participantId })),
    offers: offers.filter(Boolean), connectionAssistance: assistance });
}

const party = ({ computerId = null, participantId = null, accountId, connectionId } = {}) => ({ computerId, participantId,
  ...(accountId !== undefined && accountId !== null ? { accountId } : {}), ...(connectionId !== undefined && connectionId !== null ? { connectionId } : {}) });

/** `consumer` requested the operation; `provider` performed it. A party's computerId is null when nothing verified it. */
export function operationRoles({ operation, operationId, consumer, provider }) {
  return parseOperationRoles({ schema: OPERATION_ROLES_SCHEMA, operation, operationId, consumer: party(consumer), provider: party(provider) });
}

// Readers of the wire forms that predate these records. Each one is the only reconstruction of its concept.

const ADVERTISED_READINESS = Object.freeze({ loading: 'preparing', ready: 'ready', executing: 'ready', stopping: 'stopping', failed: 'failed' });

/**
 * A mesh peer advertisement's inference offer (reploid:peer-advertisement, peer-generation.js), or null when it
 * offers none. An advertisement lasts while its connection is open, so the offer has no expiry of its own; an
 * advertisement withdrawn by pausing reports `idle`, which offers nothing.
 */
export function inferenceOfferFromAdvertisement(advertisement, { connectionId = advertisement?.peerId ?? null } = {}) {
  if (!isObject(advertisement)) return null;
  const readiness = ADVERTISED_READINESS[advertisement.readiness];
  const modelIdentity = isDigest(advertisement.modelIdentity) ? advertisement.modelIdentity : null;
  if (!readiness && !modelIdentity) return null;
  const slots = Number.isSafeInteger(advertisement.availableSlots) && advertisement.availableSlots >= 0 ? advertisement.availableSlots : null;
  const adapters = Array.isArray(advertisement.adapterIdentities) ? [...new Set(advertisement.adapterIdentities.filter(isDigest))] : [];
  return inferenceOffer({ connectionId: isConnectionId(connectionId) ? connectionId : null,
    readiness: readiness === 'ready' && slots === 0 ? 'busy' : readiness || 'unavailable',
    modelId: isRecordId(advertisement.model) ? advertisement.model : null, modelIdentities: modelIdentity ? [modelIdentity] : [],
    adapterIdentities: adapters, availableSlots: slots });
}

/**
 * A custody file inventory's weight-supply offer (reploid:custody-offer, artifacts/custody/exchange.js), or null for
 * an empty inventory, which withdraws the offer.
 */
export function weightSupplyOfferFromInventory(artifacts, { connectionId = null, readiness = 'ready', paused = false,
  expiresAt = null, modelIdentities = [], maxStorageBytes = null } = {}) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) return null;
  const files = [], seen = new Set();
  for (const artifact of artifacts) {
    const key = `${artifact?.hashAlgorithm}:${artifact?.hash}`;
    if (seen.has(key)) continue;
    seen.add(key);
    files.push({ hashAlgorithm: artifact?.hashAlgorithm, hash: artifact?.hash, sizeBytes: artifact?.sizeBytes });
  }
  return weightSupplyOffer({ connectionId: isConnectionId(connectionId) ? connectionId : null, readiness, paused, expiresAt, modelIdentities, files, maxStorageBytes });
}

/**
 * One row of the fleet ledger's computer directory (server/fleet/service.js `computers`) as a Computer record. Its
 * inference offer comes from the host's latest observation: `expiresAt` is when that observation stops counting.
 */
export function computerFromLedgerRow(row, { accountId = null, observationMaxAgeMs = null } = {}) {
  const resident = row?.online ? row.resident : null;
  const paused = row?.preferences?.enabled === false;
  const expiresAt = row?.online && isCount(row.observedAt) && isCount(observationMaxAgeMs) ? row.observedAt + observationMaxAgeMs : null;
  const preparing = row?.online === true && row.preparing === true;
  let offer = null;
  if (resident && isDigest(resident.modelIdentity)) {
    const stage = resident.mode === 'partition';
    offer = inferenceOffer({ readiness: preparing ? 'preparing' : 'ready', paused, expiresAt, modelIdentities: [resident.modelIdentity],
      execution: stage ? 'model-stage' : 'whole-model', stageIndex: stage ? resident.stageIndex ?? 0 : null });
  } else if (preparing) offer = inferenceOffer({ readiness: 'preparing', paused, expiresAt });
  return computerRecord({ computerId: row?.id, identityBasis: 'ledger-enrollment', participantIds: [...(row?.participantIds ?? [])],
    accountId, offers: [offer] });
}

/**
 * The roles a signed whole-model execution receipt names (artifacts/receipt.js: `consumer` requested, `provider`
 * ran the model). The signed bytes are unchanged; these roles are derived from them. `providerComputerId` is the
 * provider key's computer when a verified link names one; otherwise the key stands for itself.
 */
export function operationRolesFromReceipt(receipt, { operationId = receipt?.jobHash, providerComputerId = null, consumerComputerId = null,
  providerConnectionId, consumerConnectionId } = {}) {
  return operationRoles({ operation: 'inference', operationId,
    consumer: { computerId: consumerComputerId ?? (isParticipantId(receipt?.consumer) ? receipt.consumer : null),
      participantId: isParticipantId(receipt?.consumer) ? receipt.consumer : null, connectionId: consumerConnectionId },
    provider: { computerId: providerComputerId ?? (isParticipantId(receipt?.provider) ? receipt.provider : null),
      participantId: isParticipantId(receipt?.provider) ? receipt.provider : null, connectionId: providerConnectionId } });
}
