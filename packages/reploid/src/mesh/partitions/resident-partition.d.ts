import type { PartitionPlan, PartitionLimits, PartitionDeviceA, PartitionDeviceB, PartitionBinding } from './partition-runner.js';
import type { ResidentPartitionDescriptor as DopplerDescriptor, ResidentPartitionSession,
  ResidentPartitionOpenOptions, ResidentPartitionTokenizationResult, ResidentRecoveryCapabilities } from 'doppler-gpu/partitions';
/** A ready descriptor is admitted only after runtime identity and generation checks. */
export type ResidentPartitionDescriptor = DopplerDescriptor & { ready: true };
export type PartitionTokenization = ResidentPartitionTokenizationResult;
export type DopplerResidentPartitionSession = ResidentPartitionSession;
export interface DopplerPartitionSessionFactory {
  openResidentPartition(options: Omit<ResidentPartitionOpenOptions, 'model'> & {
    model: Omit<ResidentPartitionOpenOptions['model'], 'capsule'> & { capsule?: ResidentPartitionOpenOptions['model']['capsule'] };
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
export interface ResidentPartition extends PartitionDeviceA, PartitionDeviceB {
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
export function createResidentPartition(options: {
  runtime: DopplerPartitionSessionFactory; model: Parameters<DopplerPartitionSessionFactory['openResidentPartition']>[0]['model'];
  plan: PartitionPlan; planId: string; index: 0 | 1; participantId: string; limits: PartitionLimits;
  onChange?(state: ResidentPartitionState): void;
}): ResidentPartition;
