import type { Offer } from '../../contracts/computer-records.js';
import type {
  DeviceLimits, PinnedModelPieces, WeightDemand, WeightSupplyApproval, WeightSupplyPolicy, WeightSupplyRecommendation,
  WeightSupplyReplacement, WeightSupplyReport, WeightTransfer
} from '../../contracts/weight-supply.js';
import type { CustodyDeliveryRecord, CustodyServedTransfer, createCustodyExchange } from './exchange.js';

export const WEIGHT_SUPPLY_STATE_SCHEMA: 'reploid.weight-supply-state/1';
export function verifyWeightSupplyApproval(approval: unknown): Promise<boolean>;
export function meshWeightDemand(exchangeState: ReturnType<ReturnType<typeof createCustodyExchange>['getState']>, inferenceOffers: Offer[],
  options: { now: number }): WeightDemand[];
export function weightTransferFromDelivery(record: CustodyDeliveryRecord, options: { startedAt: number; completedAt: number;
  modelIdentity?: string | null }): WeightTransfer | null;

export interface WeightSupplyStore {
  get(pieceId: string): Promise<Uint8Array | null>;
  put(pieceId: string, bytes: Uint8Array): Promise<void>;
  delete(pieceId: string): Promise<void>;
  list(): Promise<string[]>;
}
export interface WeightSupplyPorts {
  now?(): number;
  hashBytes(bytes: Uint8Array): Promise<string>;
  /** Replaces the default source (peers' piece files, then verified ranges of their whole files). */
  fetchPiece?(piece: { pieceId: string; path: string; offset: number; sizeBytes: number }, controls: { signal: AbortSignal }): Promise<Uint8Array>;
  /** Peers' inference offers; one in `preparing` readiness is a load of its model. */
  inferenceOffers?(): Offer[];
  /** Each approval, replacement and served transfer, for the host's durable log. */
  onRecord?(record: WeightSupplyApproval | WeightSupplyReplacement | WeightTransfer): void;
  onChange?(): void;
  /** Piece IDs this device holds outside the piece store (a full cached model), counted as cached. */
  cachedPieceIds?(): Promise<string[]> | string[];
}
export interface WeightSupplyStatePiece {
  pieceId: string; modelIdentity: string; pieceIndexDigest: string; path: string; offset: number; sizeBytes: number;
  state: 'verified' | 'queued'; verifiedAt: number | null; servedBytes: number; servedTransfers: number;
}
export interface WeightSupplyState {
  schema: typeof WEIGHT_SUPPLY_STATE_SCHEMA; computerId: string; paused: boolean; approval: WeightSupplyApproval | null;
  pieces: WeightSupplyStatePiece[]; replacements: WeightSupplyReplacement[]; transfers: WeightTransfer[]; servedBytes: number; servedTransfers: number;
}
export type WeightSupplyRestoredApproval = 'none' | 'restored' | 'invalid' | 'other-computer' | 'expired' | 'index-changed';
export interface WeightSupplyRestore {
  approval: WeightSupplyRestoredApproval; restoredPieces: number; requeuedPieces: number;
  dropped: { pieceId: string | null; reason: string }[];
}
export function createWeightSupply(options: {
  identity: { peerId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey; algorithm?: string };
  connectionId: string;
  exchange: ReturnType<typeof createCustodyExchange>;
  models: PinnedModelPieces[];
  store: WeightSupplyStore;
  ports: WeightSupplyPorts;
  policy?: WeightSupplyPolicy;
}): Readonly<{
  recommendWeightSupply(options: { storageCapBytes: number; deviceLimits?: DeviceLimits }): Promise<WeightSupplyRecommendation>;
  approveWeightSupply(options: { offerId: string; storageCapBytes: number; modelIdentities?: string[] }): Promise<WeightSupplyApproval>;
  refreshWeightSupply(): Promise<WeightSupplyReplacement | null>;
  pauseWeightSupply(): void;
  resumeWeightSupply(): void;
  recordServed(event: CustodyServedTransfer): WeightTransfer | null;
  getWeightSupplyReport(): WeightSupplyReport;
  getServedTransfers(): WeightTransfer[];
  getApproval(): WeightSupplyApproval | null;
  exportWeightSupplyState(): WeightSupplyState;
  restoreWeightSupply(snapshot: WeightSupplyState | null): Promise<WeightSupplyRestore>;
  whenIdle(): Promise<void>;
}>;
