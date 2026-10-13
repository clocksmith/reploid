import type { CanonicalPartitionWireRuntime } from './partition-canonical-contract.js';
import type { PartitionCommitAttempt, PartitionCommitStage, PartitionStageEvidence, PartitionStageCommit } from './partition-stage-commit.js';
import type { PartitionBinding, PartitionGrants, PartitionAttemptReceipt } from './partition-runner.js';
import type { PublicationReceipt } from '../../chat/workspace-publication.js';
export interface CanonicalRunnerAttempt extends PartitionCommitAttempt {
  schema: 'doppler.resident-attempt/v2'; requesterId: string; inputDigest: string; authorizationScope: string;
  routeId: string; coordinatorEpoch: string; publisherEpoch: string; routeKind: 'two-stage-layer';
}
export interface CanonicalRunnerPolicy { maxGeneratedTokens: number; maxVisibleOutputUtf16: number; }
export interface CanonicalRunnerGeneration {
  policy: CanonicalRunnerPolicy; executionIdentity: string; generationId: string;
}
export interface CanonicalRunnerRuntime extends CanonicalPartitionWireRuntime {
  canonicalGenerationIdentity(policy: unknown, executionIdentity: string, vocabSize: number): CanonicalRunnerGeneration;
  hashLayerPartitionPlan(plan: unknown): string;
  admitResidentPrompt(tokens: readonly number[], policy: unknown, vocabSize: number, generationId: string): unknown;
}
/** Host transaction owner, configured to verify and persist every stage envelope. */
export interface CanonicalPublicationPort {
  readonly requiresCommitEvidence: boolean;
  reconcile(): Promise<{ head: string | null; attempts: Array<{ identity: { attemptId: string; coordinatorEpoch: string } }> }>;
  admitAttempt(input: { identity: CanonicalRunnerAttempt; generationPolicy: unknown; executionIdentity: string;
    vocabSize: number; deadlineAt: number }): Promise<unknown>;
  publish(input: unknown, options: { evidence: readonly PartitionStageEvidence[] }): Promise<PublicationReceipt>;
  cancel(attemptId: string, coordinatorEpoch: string): Promise<unknown>;
}
export interface CanonicalRunnerRequest {
  tokenIds: number[];
  identity: Omit<PartitionBinding, 'modelId' | 'participantA' | 'participantB'>;
  grants: PartitionGrants;
  canonical: { attempt: CanonicalRunnerAttempt; generation: CanonicalRunnerGeneration;
    publication: CanonicalPublicationPort; deadlineAt: number };
  signal?: AbortSignal; onDelta?: (delta: string) => void | Promise<void>;
}
export interface CanonicalParticipantDescription {
  getCanonicalStage(): PartitionCommitStage | null;
  getCanonicalGeneration(): CanonicalRunnerGeneration | null;
}
export interface CanonicalRunnerResult {
  content: string; tokenIds: number[]; logits: null; stopReason: string;
  execution: PartitionBinding & {
    schema: 'reploid.mesh.canonical-partition-execution/v1'; canonicalAttempt: CanonicalRunnerAttempt;
    placement: 'two-device-layer-partition'; splitLayer: number; activationBytes: number;
    settlement: PartitionAttemptReceipt;
    steps: Array<{ sequence: number; step: number; tokenPosition: number; inputTokenCount: number; tokenId: number;
      activationBytes: number; leaseWaitMs: number; elapsedMs: number; outputDeliveryMs: number }>;
    publications: Array<{ publication: unknown; receipt: PublicationReceipt; commits: PartitionStageCommit[] }>;
  };
}
/** Internal runner branch: its caller retains the existing attempt/FIFO/cleanup owners. */
export function executeCanonicalPartition(options: {
  runtime: CanonicalRunnerRuntime; plan: import('./partition-runner.js').PartitionPlan;
  deviceA: unknown; deviceB: unknown; policy: import('./partition-runner.js').PartitionLimits;
  binding: PartitionBinding; authority: PartitionGrants; canonical: CanonicalRunnerRequest['canonical'];
  tokenIds: number[]; signal: AbortSignal;
  lease<T>(task: () => Promise<T>): Promise<T>;
  permit(action: string, grant: object, step: object): Promise<void>;
  onDelta(delta: string): void | Promise<void>; ownDevice(participantId: string): void; receipt: PartitionAttemptReceipt;
}): Promise<CanonicalRunnerResult>;
