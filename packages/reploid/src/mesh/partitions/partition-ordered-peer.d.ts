import type { PartitionRoute } from './partition-contract.js';
import type { OrderedExecutionPlan, OrderedExecutionRuntime, OrderedStageDevice } from './partition-route-execution.js';
import type { OrderedResidentPartition, OrderedDopplerResidentSession } from './resident-partition.js';
import type { PartitionGrantAuthority } from './partition-grants.js';
import type { PartitionChannelLimits, PartitionChannelReceipt } from '../../transport/partition-data-channel.js';
export interface OrderedPartitionPeerState {
  ready: boolean; participantId: string; unsettled: number; retainedOutputBytes: number;
  descriptor: ReturnType<OrderedDopplerResidentSession['getDescriptor']> | null; receipt: PartitionChannelReceipt;
}
export interface OrderedPartitionPeer extends OrderedStageDevice {
  getState(): OrderedPartitionPeerState;
  refresh(options?: { signal?: AbortSignal }): Promise<OrderedPartitionPeerState>;
  subscribe(listener: (state: OrderedPartitionPeerState) => void): () => void;
  /** Unknown remote cleanup stays charged; closing a channel is not settlement. */
  close(): Promise<void>;
}
export interface OrderedPartitionPeerOptions {
  channel: RTCDataChannel; localParticipantId: string; remoteParticipantId: string;
  runtime: OrderedExecutionRuntime; plan: OrderedExecutionPlan; planId: string; modelIdentity: string;
  authority: PartitionGrantAuthority; contributor?: OrderedResidentPartition | null;
  limits: PartitionChannelLimits; receiverLimits: { maxAttempts: number; maxSteps: number };
  ordered: { route: PartitionRoute; partitionIndex: number }; canonical?: false;
}
export function createOrderedPartitionPeer(options: OrderedPartitionPeerOptions): OrderedPartitionPeer;
