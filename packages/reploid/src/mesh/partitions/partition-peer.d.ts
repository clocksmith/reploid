import type { CanonicalPartitionWireRuntime } from './partition-canonical-contract.js';
import type { CanonicalPartitionPhaseRequest } from './partition-step-receiver.js';
import type { CanonicalResidentGeneration } from './resident-partition.js';
import type { PartitionCommitStage } from './partition-stage-commit.js';
import type { PartitionDevice, PartitionDeviceB, PartitionStepOptions, ActivationFrame,
  PartitionPlan, PartitionRuntime, PartitionBinding } from './partition-runner.js';
import type { PartitionChannelLimits, PartitionChannelReceipt } from '../../transport/partition-data-channel.js';
import type { ResidentPartition, ResidentPartitionDescriptor, PartitionReservation } from './resident-partition.js';
import type { PartitionGrantAuthority } from './partition-grants.js';
export interface RemotePartitionDevice extends PartitionDevice {
  executeFrame(options: PartitionStepOptions & { frame: ActivationFrame; inputTokenIds: number[];
    outputGrant: object }): ReturnType<PartitionDeviceB['executeGroup1']>;
}
export interface PartitionPeerState {
  ready: boolean; descriptor: ResidentPartitionDescriptor | null; participantId: string; receipt: PartitionChannelReceipt;
}
export interface PartitionPeer extends RemotePartitionDevice {
  getCanonicalGeneration(): CanonicalResidentGeneration | null;
  getCanonicalStage(): PartitionCommitStage | null;
  reserveCanonical(request: CanonicalPartitionPhaseRequest & { signal?: AbortSignal }): Promise<{ reservation: PartitionReservation }>;
  admitCanonicalPrompt(request: CanonicalPartitionPhaseRequest & { signal?: AbortSignal }): Promise<unknown>;
  executeCanonicalFrame(request: CanonicalPartitionPhaseRequest & { frame: ActivationFrame; signal?: AbortSignal }): Promise<unknown>;
  acknowledgeCanonicalPublication(request: CanonicalPartitionPhaseRequest & { signal?: AbortSignal }): Promise<unknown>;
  reserve(options: { identity: PartitionBinding; grant: object; generation: Record<string, unknown>;
    generationDigest: string; inputTokenCount: number; signal?: AbortSignal }): Promise<{ reservation: PartitionReservation }>;
  getState(): PartitionPeerState;
  subscribe(listener: (state: PartitionPeerState) => void): () => void;
  refresh(options?: { signal?: AbortSignal }): Promise<PartitionPeerState>;
  /** Closes owned channel/receiver attempts; contributor weights remain caller-owned. */
  close(): Promise<void>;
}
export function createPartitionPeer(options: {
  channel: RTCDataChannel; localParticipantId: string; remoteParticipantId: string;
  runtime: PartitionRuntime & Partial<CanonicalPartitionWireRuntime>; plan: PartitionPlan; planId: string; modelIdentity: string;
  canonical?: boolean;
  authority: PartitionGrantAuthority; contributor?: ResidentPartition | null;
  limits: PartitionChannelLimits; receiverLimits: { maxAttempts: number; maxSteps: number };
}): PartitionPeer;
