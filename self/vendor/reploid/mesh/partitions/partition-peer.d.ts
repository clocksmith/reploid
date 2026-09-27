import type { PartitionDevice, PartitionDeviceB, PartitionStepOptions, ActivationFrame,
  PartitionPlan, PartitionRuntime } from './partition-runner.js';
import type { PartitionChannelLimits, PartitionChannelReceipt } from '../../transport/partition-data-channel.js';
import type { ResidentPartition, ResidentPartitionDescriptor } from './resident-partition.js';
import type { PartitionGrantAuthority } from './partition-grants.js';
export interface RemotePartitionDevice extends PartitionDevice {
  executeFrame(options: PartitionStepOptions & { frame: ActivationFrame; inputTokenIds: number[];
    outputGrant: object }): ReturnType<PartitionDeviceB['executeGroup1']>;
}
export interface PartitionPeerState {
  ready: boolean; descriptor: ResidentPartitionDescriptor | null; participantId: string; receipt: PartitionChannelReceipt;
}
export interface PartitionPeer extends RemotePartitionDevice {
  getState(): PartitionPeerState;
  subscribe(listener: (state: PartitionPeerState) => void): () => void;
  refresh(options?: { signal?: AbortSignal }): Promise<PartitionPeerState>;
  /** Closes owned channel/receiver attempts; contributor weights remain caller-owned. */
  close(): Promise<void>;
}
export function createPartitionPeer(options: {
  channel: RTCDataChannel; localParticipantId: string; remoteParticipantId: string;
  runtime: PartitionRuntime; plan: PartitionPlan; planId: string; modelIdentity: string;
  authority: PartitionGrantAuthority; contributor?: ResidentPartition | null;
  limits: PartitionChannelLimits; receiverLimits: { maxAttempts: number; maxSteps: number };
}): PartitionPeer;
