export type PartitionMetadata = Record<string, unknown>;
export interface PartitionChannelLimits {
  maxFrameBytes: number; maxControlBytes: number; maxPayloadBytes: number;
  maxPendingBytes: number; maxPendingRequests: number; maxRequestsPerChannel: number;
  maxBufferedBytes: number; maxTransferBytes: number; timeoutMs: number;
}
export interface PartitionChannelReceipt {
  schema: 'reploid.partition-channel/v1';
  sentFrameBytes: number; receivedFrameBytes: number; sentFrames: number; receivedFrames: number;
  completedRequests: number; cancelledRequests: number; discardedFrames: number;
  pendingRequests: number; inboundRequests: number; reservedBytes: number; closed: boolean;
  wireBytes: null; relayBytes: null;
}
export function createPartitionDataChannel(options: {
  /** Ownership transfers to this endpoint; close closes the dedicated RTC channel. */
  channel: RTCDataChannel;
  /** Host-authenticated channel endpoints, never supplied by received metadata. */
  localParticipantId: string; remoteParticipantId: string;
  limits: PartitionChannelLimits;
  /** Verify current grants, endpoints, purpose and allocation budgets. No default allow. */
  authorize(request: {
    action: 'send' | 'receive' | 'respond' | 'accept';
    localParticipantId: string; remoteParticipantId: string;
    metadata: PartitionMetadata; byteLength: number;
  }, options: { signal: AbortSignal }): boolean | Promise<boolean>;
  /** Compose partition receiver/settlement here. Transport never infers execution authority. */
  serve(metadata: PartitionMetadata, bytes: Uint8Array, options: { signal: AbortSignal }):
    PartitionMetadata | Promise<PartitionMetadata>;
}): {
  /** Metadata and activation bytes are snapshotted. Abort rejects delivery, not GPU settlement. */
  request(metadata: PartitionMetadata, bytes: Uint8Array, options?: { signal?: AbortSignal }): Promise<PartitionMetadata>;
  /** Abort owned deliveries. Hosts remain responsible for settling borrowed GPU attempts. */
  close(reason?: string): void;
  getReceipt(): PartitionChannelReceipt;
};
