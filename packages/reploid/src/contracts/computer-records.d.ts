import type { ComputerIdentityBasis, ConnectionId, Digest, ParticipantId } from './identifiers.js';

export * from './identifiers.js';

export const COMPUTER_SCHEMA: 'reploid.computer/1';
export const OFFER_SCHEMA: 'reploid.offer/1';
export const CONNECTION_ASSISTANCE_SCHEMA: 'reploid.connection-assistance/1';
export const OPERATION_ROLES_SCHEMA: 'reploid.operation-roles/1';

export type OfferKind = 'weight-supply' | 'inference';
export type OfferReadiness = 'preparing' | 'ready' | 'busy' | 'stopping' | 'failed' | 'unavailable';
export type InferenceExecution = 'whole-model' | 'model-stage';
export type OperationKind = 'inference' | 'weight-transfer';
export type FileHashAlgorithm = 'sha256' | 'blake3';

export const OFFER_KINDS: readonly OfferKind[];
export const OFFER_READINESS: readonly OfferReadiness[];
export const INFERENCE_EXECUTIONS: readonly InferenceExecution[];
export const IDENTITY_BASES: readonly ComputerIdentityBasis[];
export const OPERATION_KINDS: readonly OperationKind[];
export const FILE_HASH_ALGORITHMS: readonly FileHashAlgorithm[];

type OfferBase = {
  schema: 'reploid.offer/1';
  /** The connection that serves this offer, when it was observed on one. */
  connectionId: ConnectionId | null;
  readiness: OfferReadiness;
  paused: boolean;
  /** Epoch milliseconds after which the offer no longer counts; null while its connection or owner holds it. */
  expiresAt: number | null;
};

export type InferenceScope = {
  modelId: string | null;
  /** The exact model artifact identities this offer runs. */
  modelIdentities: Digest[];
  adapterIdentities: Digest[];
  execution: InferenceExecution;
  stageIndex: number | null;
  availableSlots: number | null;
};

export type WeightSupplyScope = {
  modelIdentities: Digest[];
  pieceIndexDigests: Digest[];
  files: Array<{ hashAlgorithm: FileHashAlgorithm; hash: string; sizeBytes: number }>;
  maxStorageBytes: number | null;
};

export type InferenceOffer = OfferBase & { kind: 'inference'; scope: InferenceScope };
export type WeightSupplyOffer = OfferBase & { kind: 'weight-supply'; scope: WeightSupplyScope };
export type Offer = InferenceOffer | WeightSupplyOffer;

export type ConnectionAssistance = { schema: 'reploid.connection-assistance/1'; enabled: boolean };

export type ComputerConnection = { connectionId: ConnectionId; participantId: ParticipantId | null };

export type Computer = {
  schema: 'reploid.computer/1';
  computerId: string;
  identityBasis: ComputerIdentityBasis;
  participantIds: ParticipantId[];
  accountId: string | null;
  connections: ComputerConnection[];
  offers: Offer[];
  connectionAssistance: ConnectionAssistance | null;
};

export type OperationParty = {
  /** Null when nothing verified which computer acted. */
  computerId: string | null;
  participantId: ParticipantId | null;
  accountId?: string;
  connectionId?: ConnectionId;
};

export type OperationRoles = {
  schema: 'reploid.operation-roles/1';
  operation: OperationKind;
  operationId: string;
  consumer: OperationParty;
  provider: OperationParty;
};

export type RecordSchema = Computer['schema'] | Offer['schema'] | ConnectionAssistance['schema'] | OperationRoles['schema'];

export class ContractError extends TypeError {
  constructor(schema: string, problems: string[]);
  readonly code: 'CONTRACT_INVALID';
  readonly schema: string;
  readonly problems: string[];
}

export function recordProblems(schema: string, value: unknown): string[];
export function parseComputer(value: unknown): Computer;
export function parseOffer(value: unknown): Offer;
export function parseConnectionAssistance(value: unknown): ConnectionAssistance;
export function parseOperationRoles(value: unknown): OperationRoles;
export function parseRecord(value: unknown): Computer | Offer | ConnectionAssistance | OperationRoles;
export function isComputer(value: unknown): value is Computer;
export function isOffer(value: unknown): value is Offer;
export function isOperationRoles(value: unknown): value is OperationRoles;
export function isOfferActive(offer: unknown, now: number): boolean;
export function offerOf<K extends OfferKind>(computer: { offers?: Offer[] } | null | undefined, kind: K): Extract<Offer, { kind: K }> | null;
export function providesNow(computer: { offers?: Offer[] } | null | undefined, kind: OfferKind, now: number): boolean;
export function isOfferCurrent(offer: unknown, now: number): boolean;
export type OfferAvailability = { kind: OfferKind; offered: boolean; readiness: OfferReadiness | null; available: boolean; freeSlots: number | null };
export function offerAvailability(computer: { offers?: Offer[] } | null | undefined, kind: OfferKind, now: number): OfferAvailability;

export function inferenceOffer(input: {
  connectionId?: ConnectionId | null; readiness: OfferReadiness; paused?: boolean; expiresAt?: number | null; modelId?: string | null;
  modelIdentities?: Digest[]; adapterIdentities?: Digest[]; execution?: InferenceExecution; stageIndex?: number | null; availableSlots?: number | null;
}): InferenceOffer;
export function weightSupplyOffer(input: {
  connectionId?: ConnectionId | null; readiness: OfferReadiness; paused?: boolean; expiresAt?: number | null; modelIdentities?: Digest[];
  pieceIndexDigests?: Digest[]; files?: WeightSupplyScope['files']; maxStorageBytes?: number | null;
}): WeightSupplyOffer;
export function connectionAssistance(input: { enabled: boolean }): ConnectionAssistance;
export function computerRecord(input: {
  computerId: string; identityBasis?: ComputerIdentityBasis; participantIds?: ParticipantId[] | null; accountId?: string | null;
  connections?: Array<{ connectionId: ConnectionId; participantId?: ParticipantId | null }>; offers?: Array<Offer | null>;
  connectionAssistance?: ConnectionAssistance | null;
}): Computer;
export function operationRoles(input: {
  operation: OperationKind; operationId: string;
  consumer: Partial<OperationParty> & { accountId?: string | null; connectionId?: ConnectionId | null };
  provider: Partial<OperationParty> & { accountId?: string | null; connectionId?: ConnectionId | null };
}): OperationRoles;

export function inferenceOfferFromAdvertisement(advertisement: unknown, options?: { connectionId?: ConnectionId | null }): InferenceOffer | null;
export function offersOfPeer(peer: unknown): Offer[];
export function weightSupplyOfferFromInventory(artifacts: unknown, options?: {
  connectionId?: ConnectionId | null; readiness?: OfferReadiness; paused?: boolean; expiresAt?: number | null;
  modelIdentities?: Digest[]; maxStorageBytes?: number | null;
}): WeightSupplyOffer | null;
export function computerFromLedgerRow(row: unknown, options?: { accountId?: string | null; observationMaxAgeMs?: number | null }): Computer;
export function operationRolesFromReceipt(receipt: unknown, options?: {
  operationId?: string; providerComputerId?: string | null; consumerComputerId?: string | null;
  providerConnectionId?: ConnectionId; consumerConnectionId?: ConnectionId;
}): OperationRoles;
