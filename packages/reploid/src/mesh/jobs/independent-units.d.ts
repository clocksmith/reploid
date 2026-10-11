import type { IndependentUnitJournal, IndependentUnitManifest, UnitData } from '../../artifacts/independent-unit-journal.js';
import type { PackOperationAdapter } from '../../contracts/pool/pack-operation-adapters.js';
import type { PackPeerRequester } from '../../contracts/pool/peer-pack-requester.js';
import type { PackPeerJobBody, SignedPackPeerMessage } from '../../contracts/pool/peer-pack-job.js';
export interface IndependentUnitProgress {
  readonly parentId: string;
  readonly status: 'pending' | 'completed' | 'cancelled';
  readonly pendingUnitIds: readonly string[];
  readonly committedUnitIds: readonly string[];
  readonly output: { readonly embeddings: readonly UnitData[] } | null;
}
export interface IndependentUnitCoordinator {
  create(input: { parentId: string; application: UnitData; model: UnitData; input: UnitData;
    options: UnitData; comparisonPolicy: UnitData; reference: UnitData; unitSize: number; expiresAt: number }): Promise<IndependentUnitProgress>;
  get(parentId: string): Promise<IndependentUnitProgress>;
  /** Reuses a retained signed attempt unless the host explicitly requests a replacement. */
  runUnit(parentId: string, unitId: string, options?: { replace?: boolean; signal?: AbortSignal | null }): Promise<IndependentUnitProgress>;
  cancel(parentId: string): Promise<IndependentUnitProgress>;
  /** Aborts owned delivery. Borrowed requesters/journal remain caller-owned; this is not GPU settlement. */
  close(): void;
}
export function createIndependentUnitCoordinator(options: {
  requesterId: string;
  journal: IndependentUnitJournal;
  operation: PackOperationAdapter;
  limits: { readonly maxUnits: number; readonly maxInputBytes: number; readonly maxConcurrentUnits: number };
  /** Verify Doppler's computational declaration and independently approved application evidence. */
  validateApplication(application: UnitData, binding: UnitData): void | Promise<void>;
  authorize(input: { action: 'create' | 'read' | 'execute' | 'commit' | 'cancel';
    manifest: IndependentUnitManifest; unit: IndependentUnitManifest['units'][number] | null }): boolean | Promise<boolean>;
  hashEvidence(value: unknown): Promise<string>;
  /** Use existing createPackPeerJob with host-owned grants, provider selection and limits. */
  prepareJob(input: { model: UnitData; input: UnitData; options: UnitData; comparisonPolicy: UnitData;
    jobId: string; attemptNumber: number; expiresAt: number; signal: AbortSignal }): Promise<SignedPackPeerMessage<PackPeerJobBody>>;
  runPrepared: PackPeerRequester['runPrepared'];
}): IndependentUnitCoordinator;
