import type { PartitionPlan, PartitionLimits, PartitionDeviceA, PartitionDeviceB, PartitionBinding } from './partition-runner.js';
export interface ResidentPartitionDescriptor {
  schema: 'doppler.resident-partition/v1'; ready: true;
  modelId: string; modelIdentity: string; planId: string; index: 0 | 1;
  layerRange: readonly [number, number];
  /** Runtime allocation accounting, not physical VRAM measurement or attestation. */
  residentWeightBytes: number;
}
export interface PartitionTokenization {
  modelIdentity: string; tokenIds: number[];
  generation: Record<string, unknown> & { maxTokens: number };
}
export interface DopplerResidentPartitionSession {
  getDescriptor(): ResidentPartitionDescriptor;
  /** A only: apply the model's exact chat template and tokenizer. */
  tokenize?(options: { messages: Array<{ role: string; content: string }>; identity: PartitionBinding;
    signal: AbortSignal }): Promise<PartitionTokenization>;
  executeGroup0?: PartitionDeviceA['executeGroup0'];
  executeGroup1?: PartitionDeviceB['executeGroup1'];
  /** Idempotent; waits for submitted work and releases this attempt's state, preserving weights. */
  closeAttempt(options: { identity: PartitionBinding }): Promise<void>;
  /** Settles all attempts and releases this resident's owned resources. */
  close(): Promise<void>;
}
export interface DopplerPartitionSessionFactory {
  /** Proposed consumer contract for Doppler; unavailable implementations must fail closed. */
  openResidentPartition(options: {
    model: { id: string; identity: string; [key: string]: unknown }; plan: PartitionPlan; planId: string;
    index: 0 | 1; participantId: string; limits: PartitionLimits; signal: AbortSignal;
  }): Promise<DopplerResidentPartitionSession>;
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
  runtime: DopplerPartitionSessionFactory; model: { id: string; identity: string; [key: string]: unknown };
  plan: PartitionPlan; planId: string; index: 0 | 1; participantId: string; limits: PartitionLimits;
  onChange?(state: ResidentPartitionState): void;
}): ResidentPartition;
