/** Optional canonical capability. Model contracts remain injected Doppler values. */
export interface PartitionCommitStage {
  stageId: string; participantId: string; participantEpoch: string; deviceEpoch: string;
  residentId: string; partitionIndex: number; executionId: string;
}
export interface PartitionCommitAttempt {
  attemptId: string; generationId: string; stages: readonly PartitionCommitStage[];
}
export interface PartitionCommitTransition {
  acceptedTokenIds: readonly number[]; tokenRange: { start: number; end: number };
  successor: { cursorId: string; generationId: string; stopReason: string | null };
  delta: string; outputDigest: string;
}
export interface PartitionStageAcknowledgment {
  schema: 'doppler.stage-commit/v1'; stageId: string; attemptDigest: string; sequence: number;
  baseCursorId: string | null; decisionId: string; successorCursorId: string;
  participantEpoch: string; deviceEpoch: string; residentId: string; authenticationDigest: string;
}
export interface PartitionStageEvidence {
  schema: 'reploid.partition-stage-evidence/v1';
  claim: { schema: 'reploid.partition-stage-claim/v1'; stage: PartitionCommitStage;
    acknowledgment: Omit<PartitionStageAcknowledgment, 'authenticationDigest'> };
  publicJwk: JsonWebKey; signature: string;
}
export interface PartitionStageCommit { acknowledgment: PartitionStageAcknowledgment; evidence: PartitionStageEvidence; }
export interface PartitionCommitRuntime<Attempt extends PartitionCommitAttempt = PartitionCommitAttempt> {
  metadataDigest(schema: string, value: unknown): string;
  validateResidentAttemptIdentity(input: unknown): Attempt;
  residentAttemptDigest(attempt: Attempt): string;
  residentPublicationDecisionDigest(input: { attemptDigest: string; sequence: number; baseCursorId: string | null;
    acceptedTokenIds: readonly number[]; tokenRange: { start: number; end: number };
    successor: PartitionCommitTransition['successor']; delta: { text: string; outputDigest: string }; stoppingOutcome: string | null }): string;
}
export interface PartitionStageCommitAuthority<Attempt extends PartitionCommitAttempt = PartitionCommitAttempt> {
  getStage(): PartitionCommitStage;
  sign(input: { attempt: Attempt; sequence: number; baseCursorId: string | null;
    transition: PartitionCommitTransition }): Promise<PartitionStageCommit>;
  close(): void;
}
export function createPartitionStageCommitAuthority<Attempt extends PartitionCommitAttempt>(options: {
  runtime: PartitionCommitRuntime<Attempt>; identity: { peerId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey };
  stage: PartitionCommitStage;
}): PartitionStageCommitAuthority<Attempt>;
export function verifyPartitionStageCommit<Attempt extends PartitionCommitAttempt>(input: {
  runtime: PartitionCommitRuntime<Attempt>; attempt: Attempt; stage: PartitionCommitStage;
  acknowledgment: PartitionStageAcknowledgment; evidence: PartitionStageEvidence;
  transition?: PartitionCommitTransition; sequence?: number; baseCursorId?: string | null;
}): Promise<boolean>;
