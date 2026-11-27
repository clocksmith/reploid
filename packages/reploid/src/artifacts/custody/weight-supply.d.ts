import type { Offer } from '../../contracts/computer-records.js';
import type {
  DeviceLimits, PinnedModelPieces, WeightDemand, WeightSupplyApproval, WeightSupplyPolicy, WeightSupplyRecommendation,
  WeightSupplyReplacement, WeightSupplyReport, WeightTransfer
} from '../../contracts/weight-supply.js';
import type { CustodyDeliveryRecord, CustodyServedTransfer, createCustodyExchange } from './exchange.js';

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
  whenIdle(): Promise<void>;
}>;
