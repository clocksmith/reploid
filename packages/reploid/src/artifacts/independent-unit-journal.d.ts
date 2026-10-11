import type { JsonValue } from '../contracts/pool/pack-operation-adapters.js';
import type { PackPeerJobResult } from '../contracts/pool/peer-pack-requester.js';
import type { PackPeerJobBody, SignedPackPeerMessage } from '../contracts/pool/peer-pack-job.js';
export type UnitData = Readonly<Record<string, JsonValue>>;
export interface IndependentUnitManifest {
  readonly requesterId: string;
  readonly parentId: string;
  readonly identity: string;
  readonly expiresAt: number;
  readonly application: UnitData;
  readonly binding: UnitData;
  readonly units: readonly { readonly unitId: string; readonly positions: readonly number[];
    readonly input: UnitData; readonly reference: UnitData; readonly comparisonPolicy: UnitData }[];
}
export interface IndependentUnitAttempt {
  readonly jobHash: string;
  readonly job: SignedPackPeerMessage<PackPeerJobBody>;
  readonly providerId: string;
  readonly assignmentId: string;
  readonly attemptId: string;
  readonly attemptNumber: number;
}
export interface IndependentUnitOutcome {
  readonly identity: string;
  readonly result: PackPeerJobResult;
}
export interface IndependentUnitRecord {
  readonly schema: 'reploid.independent-unit-aggregate/v1';
  readonly parentId: string;
  readonly requesterId: string;
  readonly manifest: IndependentUnitManifest;
  readonly expiresAt: number;
  readonly retainUntil: number;
  readonly status: 'pending' | 'completed' | 'cancelled';
  readonly units: readonly { readonly unitId: string; readonly attempts: readonly IndependentUnitAttempt[];
    readonly outcome: (IndependentUnitOutcome & { readonly location: string }) | null }[];
}
export interface IndependentUnitJournal {
  create(manifest: IndependentUnitManifest): Promise<IndependentUnitRecord>;
  get(parentId: string): Promise<IndependentUnitRecord>;
  assign(parentId: string, unitId: string, expectedAttemptNumber: number, attempt: IndependentUnitAttempt): Promise<IndependentUnitRecord>;
  /** Caller verifies signed result and numerical comparison before this atomic commit. */
  commit(parentId: string, unitId: string, jobHash: string, outcome: IndependentUnitOutcome): Promise<IndependentUnitRecord>;
  cancel(parentId: string): Promise<IndependentUnitRecord>;
  close(): void;
}
export interface IndependentUnitStoragePolicy {
  readonly maxRecords: number;
  readonly maxBytes: number;
  readonly maxUnits: number;
  readonly maxAttemptsPerUnit: number;
  readonly retentionMs: number;
  readonly maxFutureMs: number;
  readonly storageTimeoutMs: number;
}
/** Browser-managed durability; the aggregate journal is separate from provider outcome storage. */
export function openIndependentUnitJournal(options: { requesterId: string; name: string;
  policy: IndependentUnitStoragePolicy; indexedDB?: IDBFactory }): Promise<IndependentUnitJournal>;
