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

/** Explicit ordinary ordered provider surface; not supported by the accepted legacy package. */
export interface OrderedResidentAllocation {
  model: { id: string; identity: string; generation: Record<string, unknown>; [key: string]: unknown };
  plan: import('./partition-route-execution.js').OrderedExecutionPlan; planId: string; index: number;
  participantId: string; limits: PartitionLimits; signal?: AbortSignal;
}
export interface OrderedProviderIdentity {
  schema: 'doppler.resident-partition-attempt/v2'; modelId: string; modelIdentity: string; planId: string;
  threadId: string; attemptId: string; requesterId: string; placementGeneration: number;
  stages: readonly import('./partition-contract.js').PartitionRouteStage[];
}
export interface OrderedDopplerResidentSession {
  getDescriptor(): Omit<DopplerDescriptor, 'schema' | 'index'> & { schema: 'doppler.resident-partition/v2'; index: number; stageCount: number };
  getRecoveryCapabilities(): ResidentRecoveryCapabilities;
  tokenize(request: { identity: OrderedProviderIdentity; messages: Array<{ role: string; content: string }>; signal?: AbortSignal }): Promise<PartitionTokenization>;
  executeStage(request: Omit<Parameters<import('./partition-route-execution.js').OrderedStageDevice['executeStage']>[0], 'identity'> & {
    identity: OrderedProviderIdentity }): Promise<Omit<import('./partition-route-execution.js').OrderedStageResult, 'identity'> & { identity: OrderedProviderIdentity }>;
  closeAttempt(request: { identity: OrderedProviderIdentity }): Promise<void>;
  close(): Promise<void>;
}
export interface OrderedResidentPartition extends Omit<import('./partition-route-execution.js').OrderedStageDevice, 'reserve'> {
  readonly index: number;
  reserve(request: import('./partition-route-execution.js').OrderedStageBinding & { signal?: AbortSignal }): Promise<import('./partition-route-execution.js').OrderedReservation>;
  prepare(options: { approved: true; signal?: AbortSignal }): Promise<OrderedResidentState>;
  getState(): OrderedResidentState;
  canAccept(identity: import('./partition-contract.js').RouteAttemptBinding): boolean;
  subscribe(listener: (state: OrderedResidentState) => void): () => void;
  tokenize(request: { identity: import('./partition-contract.js').RouteAttemptBinding; messages: Array<{ role: string; content: string }>; signal?: AbortSignal }): Promise<PartitionTokenization>;
  close(): Promise<void>; drain(): Promise<void>;
}
export interface OrderedResidentState extends Omit<ResidentPartitionState, 'index' | 'descriptor' | 'reservations'> {
  index: number; descriptor: ReturnType<OrderedDopplerResidentSession['getDescriptor']> | null;
  reservations: Omit<PartitionReservationsState, 'records'> & { records: Array<Omit<PartitionReservation, 'identity' | 'index'> & {
    identity: import('./partition-contract.js').RouteAttemptBinding; index: number }> };
}
export function createResidentPartition(options: Omit<OrderedResidentAllocation, 'signal'> & {
  runtime: { openResidentPartition(options: OrderedResidentAllocation): Promise<OrderedDopplerResidentSession> };
  ordered: { runtime: Pick<import('./partition-route-execution.js').OrderedExecutionRuntime,
    'hashLayerPartitionPlan' | 'hashPartitionGeneration' | 'getPartitionActivationContract'>;
    stage: import('./partition-contract.js').PartitionRouteStage };
  onChange?(state: OrderedResidentState): void;
}): OrderedResidentPartition;
