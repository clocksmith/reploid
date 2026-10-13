import type { PartitionStageCommit, PartitionStageCommitAuthority, PartitionCommitStage, PartitionCommitRuntime } from './partition-stage-commit.js';
import type { PartitionPlan, PartitionLimits, PartitionDeviceA, PartitionDeviceB, PartitionBinding } from './partition-runner.js';
import type { ResidentPartitionDescriptor as DopplerDescriptor, ResidentPartitionSession,
  ResidentPartitionAllocation, ResidentPartitionTokenizationResult, ResidentRecoveryCapabilities } from '../../contracts/doppler-partitions.js';
import type { ResidentPartitionARequest, ResidentPartitionBRequest, ResidentPartitionAResult,
  ResidentPartitionBResult } from '../../contracts/doppler-partitions.js';
/** Optional future provider capability; the accepted generated contract remains unchanged.
 * Policy and transition types come from the explicitly injected Doppler module. */
export interface CanonicalResidentGeneration<Policy = unknown> {
  policy: Policy; executionIdentity: string; generationId: string;
}
export type CanonicalPartitionRequest<Request> = Omit<Request, 'generation' | 'maxTokens'> & {
  generationId: string; baseCursorId: string | null; canonicalAttempt?: unknown; sequence?: number;
};
export interface CanonicalResidentPorts<Policy = unknown, Transition = unknown> {
  getCanonicalGeneration(): CanonicalResidentGeneration<Policy> | null;
  getCanonicalStage(): PartitionCommitStage | null;
  admitCanonicalPrompt(request: { identity: PartitionBinding; tokenIds: number[]; generationId: string;
    signal?: AbortSignal }): Promise<unknown>;
  executeCanonicalGroup0(request: CanonicalPartitionRequest<ResidentPartitionARequest>): Promise<ResidentPartitionAResult>;
  executeCanonicalGroup1(request: CanonicalPartitionRequest<ResidentPartitionBRequest>): Promise<ResidentPartitionBResult & { transition: Transition; commit?: PartitionStageCommit }>;
  commitCanonicalTransition(request: { identity: PartitionBinding; baseCursorId: string | null; transition: Transition;
    canonicalAttempt?: unknown; sequence?: number; targetCommit?: PartitionStageCommit;
    signal?: AbortSignal }): Promise<Transition | { transition: Transition; commit: PartitionStageCommit }>;
}
/** A ready descriptor is admitted only after runtime identity and generation checks. */
export type ResidentPartitionDescriptor = DopplerDescriptor & { ready: true };
export type PartitionTokenization = ResidentPartitionTokenizationResult;
export type DopplerResidentPartitionSession = ResidentPartitionSession;
export interface DopplerPartitionSessionFactory {
  openResidentPartition(options: Omit<ResidentPartitionAllocation, 'generation' | 'model'> & {
    model: ResidentPartitionAllocation['model'] & { generation: ResidentPartitionAllocation['generation']; [key: string]: unknown };
    canonicalGeneration?: { policy: unknown; executionIdentity: string };
    signal: AbortSignal;
  }): Promise<ResidentPartitionSession>;
}
export interface PartitionReservation {
  identity: PartitionBinding; participantId: string; index: 0 | 1;
  phase: 'reserved' | 'settling' | 'settled' | 'failed';
  reservedAt: number | null; settlingAt: number | null; settledAt: number | null; failure: string | null;
  resources: { attemptSlots: 1; maxPromptTokens: number; maxTokens: number;
    maxActivationBytes: number; scope: 'application-attempt-limits' } | null;
}
export interface PartitionReservationsState {
  closed: boolean; active: number; availableSlots: number; records: PartitionReservation[];
}
export interface ResidentPartitionState {
  reservations: PartitionReservationsState;
  activeAttempts: number;
  phase: 'idle' | 'loading' | 'ready' | 'draining' | 'failed' | 'stopping' | 'closed'; ready: boolean;
  recovery: ResidentRecoveryCapabilities | null;
  error: string | null; descriptor: ResidentPartitionDescriptor | null;
  index: 0 | 1; participantId: string; modelId: string; modelIdentity: string; planId: string;
}
export interface ResidentPartition<Policy = unknown, Transition = unknown> extends PartitionDeviceA, PartitionDeviceB,
  CanonicalResidentPorts<Policy, Transition> {
  readonly index: 0 | 1;
  canAccept(identity: PartitionBinding): boolean;
  reserve(identity: PartitionBinding): PartitionReservation;
  drain(): Promise<void>;
  getState(): ResidentPartitionState;
  subscribe(listener: (state: ResidentPartitionState) => void): () => void;
  prepare(options: { approved: true; signal?: AbortSignal }): Promise<ResidentPartitionState>;
  tokenize(options: { messages: Array<{ role: string; content: string }>; identity: PartitionBinding;
    signal: AbortSignal }): Promise<PartitionTokenization>;
  close(): Promise<void>;
}
export function createResidentPartition<Policy = unknown, Transition = unknown>(options: {
  runtime: DopplerPartitionSessionFactory; model: Parameters<DopplerPartitionSessionFactory['openResidentPartition']>[0]['model'];
  plan: PartitionPlan; planId: string; index: 0 | 1; participantId: string; limits: PartitionLimits;
  canonicalCommitAuthority?: PartitionStageCommitAuthority;
  canonicalGeneration?: { policy: Policy; executionIdentity: string };
  canonicalRuntime?: Partial<PartitionCommitRuntime> & {
    canonicalGenerationIdentity(policy: Policy, executionIdentity: string, vocabSize: number): CanonicalResidentGeneration<Policy> };
  onChange?(state: ResidentPartitionState): void;
}): ResidentPartition<Policy, Transition>;
