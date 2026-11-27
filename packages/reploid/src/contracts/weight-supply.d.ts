import type { ConnectionId, Digest, ParticipantId } from './identifiers.js';
import type { Offer, OperationRoles, WeightSupplyOffer as WeightSupplyOfferRecord } from './computer-records.js';

export const WEIGHT_SUPPLY_POLICY_SCHEMA: 'reploid.weight-supply-policy/1';
export const WEIGHT_DEMAND_SCHEMA: 'reploid.weight-demand/1';
export const WEIGHT_SUPPLY_OFFER_SCHEMA: 'reploid.weight-supply-offer/1';
export const WEIGHT_SUPPLY_RECOMMENDATION_SCHEMA: 'reploid.weight-supply-recommendation/1';
export const WEIGHT_SUPPLY_APPROVAL_SCHEMA: 'reploid.weight-supply-approval/1';
export const WEIGHT_SUPPLY_REPLACEMENT_SCHEMA: 'reploid.weight-supply-replacement/1';
export const WEIGHT_TRANSFER_SCHEMA: 'reploid.weight-transfer/1';
export const WEIGHT_SUPPLY_REPORT_SCHEMA: 'reploid.weight-supply-report/1';

export type WeightDemandKind = 'load' | 'request';
export type NoOfferReason = 'cached-models' | 'no-under-supplied-piece' | 'storage-cap' | 'approved' | 'paused';
export type PieceState = 'queued' | 'acquiring' | 'verified' | 'failed';
export type RemovalReason = 'well-supplied' | 'no-demand';
export type TransferRecorder = 'provider' | 'consumer';

export const WEIGHT_DEMAND_KINDS: readonly WeightDemandKind[];
export const NO_OFFER_REASONS: readonly NoOfferReason[];
export const PIECE_STATES: readonly PieceState[];
export const REMOVAL_REASONS: readonly RemovalReason[];
export const TRANSFER_RECORDERS: readonly TransferRecorder[];

/** weight-supply-policy.json: the one place the journey's numbers are set. */
export type WeightSupplyPolicy = {
  schema: 'reploid.weight-supply-policy/1';
  /** In demand: at least `minConsumers` distinct consumers loaded or requested the piece within `windowMs`. */
  demand: { windowMs: number; minConsumers: number };
  /** Too few copies: fewer than `targetCopies` verified copies offered by other computers. */
  supply: { targetCopies: number };
  offer: { maxPieces: number; maxBytes: number; ttlMs: number };
  approval: { ttlMs: number };
  acquisition: { maxConcurrent: number };
  report: { maxReplacements: number; maxTransfers: number };
};
export type WeightDemand = {
  schema: 'reploid.weight-demand/1'; kind: WeightDemandKind;
  consumer: { connectionId: ConnectionId; computerId: ParticipantId | null };
  /** A whole model (a load), or null when the demand names pieces. */
  modelIdentity: Digest | null; pieceIds: Digest[]; observedAt: number;
};
export type OfferedPiece = {
  pieceId: Digest; path: string; offset: number; sizeBytes: number;
  demand: { consumers: number; loads: number; requests: number };
  supply: { verifiedCopies: number };
};
export type WeightSupplyPieceOffer = {
  schema: 'reploid.weight-supply-offer/1'; offerId: string; computerId: ParticipantId;
  modelId: string; modelIdentity: Digest; pieceIndexDigest: Digest; pieces: OfferedPiece[];
  /** Exactly the sum of the pieces' bytes: what approving downloads. */
  totalDownloadBytes: number; storageCapBytes: number; createdAt: number; expiresAt: number;
};
export type CachedModel = {
  modelId: string; modelIdentity: Digest; pieceIndexDigest: Digest;
  heldPieces: number; heldBytes: number; totalPieces: number; complete: boolean;
};
export type WeightSupplyRecommendation = {
  schema: 'reploid.weight-supply-recommendation/1'; computerId: ParticipantId; computedAt: number; storageCapBytes: number;
  cached: CachedModel[];
} & ({ offer: WeightSupplyPieceOffer; noOffer: null } | { offer: null; noOffer: NoOfferReason });
export type WeightSupplyApproval = {
  schema: 'reploid.weight-supply-approval/1'; approvalId: string; offerId: string; computerId: ParticipantId; publicJwk: JsonWebKey;
  storageCapBytes: number; modelIdentities: Digest[]; pieceIndexDigests: Digest[]; approvedAt: number; expiresAt: number;
  /** signAsParticipant over every other field, domain = schema. */
  signature: string;
};
export type ReplacedPiece = { pieceId: Digest; modelIdentity: Digest; sizeBytes: number };
export type WeightSupplyReplacement = {
  schema: 'reploid.weight-supply-replacement/1'; replacementId: string; approvalId: string; recordedAt: number;
  removed: (ReplacedPiece & { reason: RemovalReason })[]; added: ReplacedPiece[];
  storageCapBytes: number; heldBytesBefore: number; heldBytesAfter: number;
};
export type WeightTransfer = {
  schema: 'reploid.weight-transfer/1'; transferId: string; recordedBy: TransferRecorder;
  pieceId: Digest; modelIdentity: Digest | null; pieceBytes: number;
  /** Bytes the consumer received in this completed, verified transfer. */
  deliveredBytes: number; startedAt: number; completedAt: number;
  roles: OperationRoles;
};
export type ReportedPiece = {
  pieceId: Digest; modelIdentity: Digest; pieceIndexDigest: Digest; sizeBytes: number; state: PieceState;
  verifiedAt: number | null; servedBytes: number; servedTransfers: number;
};
export type WeightSupplyReport = {
  schema: 'reploid.weight-supply-report/1'; computerId: ParticipantId; reportedAt: number; paused: boolean;
  approval: { approvalId: string; storageCapBytes: number; expiresAt: number } | null;
  /** This computer's reploid.offer/1 weight-supply offer: readiness, scope (verified files) and expiry. */
  offer: WeightSupplyOfferRecord | null;
  verifiedBytes: number; servedBytes: number; servedTransfers: number;
  acquisition: { queuedPieces: number; acquiringPieces: number; failedPieces: number; pendingBytes: number };
  pieces: ReportedPiece[]; replacements: WeightSupplyReplacement[];
};
export type PinnedModelPieces = {
  modelId: string; modelIdentity: Digest; pieceIndexDigest: Digest;
  pieces: readonly { pieceId: Digest; path: string; offset: number; sizeBytes: number }[];
  files?: { path: string; role: string; hash: string; hashAlgorithm: 'sha256'; sizeBytes: number }[];
};
export type PieceFile = { path: string; role: 'model-weights'; sizeBytes: number; hash: string; hashAlgorithm: 'sha256' };
type RankedPiece = { model: PinnedModelPieces; piece: PinnedModelPieces['pieces'][number]; order: number; deficit: number;
  demand: OfferedPiece['demand']; supply: OfferedPiece['supply'] };
export type DeviceLimits = { freeStorageBytes?: number; maxDownloadBytes?: number; maxPieceBytes?: number; modelIdentities?: Digest[] };

export const WEIGHT_SUPPLY_POLICY: Readonly<WeightSupplyPolicy>;
export function weightSupplyRecordProblems(schema: string, value: unknown): string[];
export function approvalBody(approval: WeightSupplyApproval): Omit<WeightSupplyApproval, 'signature'>;
export function parseWeightSupplyPolicy(value: unknown): WeightSupplyPolicy;
export function parseWeightDemand(value: unknown): WeightDemand;
export function parseWeightSupplyOffer(value: unknown): WeightSupplyPieceOffer;
export function parseWeightSupplyRecommendation(value: unknown): WeightSupplyRecommendation;
export function parseWeightSupplyApproval(value: unknown): WeightSupplyApproval;
export function parseWeightSupplyReplacement(value: unknown): WeightSupplyReplacement;
export function parseWeightTransfer(value: unknown): WeightTransfer;
export function parseWeightSupplyReport(value: unknown): WeightSupplyReport;
export function parseWeightSupplyRecord(value: unknown): unknown;
export function pinnedModelPieces(options: { modelId: string; modelIdentity: Digest; pieceIndexDigest: Digest; index: unknown }): PinnedModelPieces;
export function weightDemandFromInferenceOffer(offer: Offer, options: { observedAt: number }): WeightDemand | null;
export function weightDemandFromAnnouncement(row: { connectionId: string; files: { hashAlgorithm: string; hash: string; sizeBytes: number }[]; observedAt: number }): WeightDemand | null;
export function verifiedCopiesByPiece(offers: Offer[], options?: { wholeFiles?: Record<string, Digest[]>; now?: number | null }): Map<Digest, number>;
export function demandByPiece(models: PinnedModelPieces[], demand: WeightDemand[], options: { now: number; policy?: WeightSupplyPolicy }): Map<Digest, OfferedPiece['demand']>;
export function rankUnderSuppliedPieces(options: { models: PinnedModelPieces[]; offers: Offer[]; demand: WeightDemand[]; now: number;
  wholeFiles?: Record<string, Digest[]>; exclude?: Set<Digest>; policy?: WeightSupplyPolicy }): RankedPiece[];
export function recommendWeightSupplyPieces(options: { computerId: ParticipantId; offerId: string; models: PinnedModelPieces[]; offers: Offer[];
  demand: WeightDemand[]; now: number; storageCapBytes: number; deviceLimits?: DeviceLimits; wholeFiles?: Record<string, Digest[]>;
  policy?: WeightSupplyPolicy }): { offer: WeightSupplyPieceOffer; noOffer: null } | { offer: null; noOffer: NoOfferReason };
export function pieceFile(piece: { pieceId: Digest; sizeBytes: number }): PieceFile;
