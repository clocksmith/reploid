import type { PartitionRoute } from './partition-contract.js';
import type { OrderedExecutionPlan, OrderedExecutionRuntime, OrderedStageDevice } from './partition-route-execution.js';
import type { OrderedResidentPartition, OrderedDopplerResidentSession } from './resident-partition.js';
import type { PartitionGrantAuthority } from './partition-grants.js';
import type { PartitionChannelLimits, PartitionChannelReceipt } from '../../transport/partition-data-channel.js';
export interface OrderedPartitionPeerState {
  ready: boolean; participantId: string; unsettled: number;
  /** Serving side only: attempts this contributor settled locally whose retirement acknowledgment
   * could not be delivered because its coordinator's channel was lost. */
  undeliveredRetirements?: number;
  descriptor: ReturnType<OrderedDopplerResidentSession['getDescriptor']> | null; receipt: PartitionChannelReceipt;
}
/** Stage RPC v2: a non-final stage returns its activation on the reply to the step that produced it;
 * a step names grants its stage already verified for the attempt by digest. An expired grant is
 * refused as ANSWER_DEADLINE_EXCEEDED, any other refusal as AUTHORIZATION_DENIED. */
export interface OrderedPartitionPeer extends OrderedStageDevice {
  getState(): OrderedPartitionPeerState;
  refresh(options?: { signal?: AbortSignal }): Promise<OrderedPartitionPeerState>;
  subscribe(listener: (state: OrderedPartitionPeerState) => void): () => void;
  /** Unknown remote cleanup stays charged on the coordinator; closing a channel is not settlement. A serving
   * contributor whose coordinator channel was lost settles its own resident and retires the channel. */
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
