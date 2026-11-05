export type PartitionMetadata = Record<string, unknown>;
export interface PartitionRequestTiming {
  /** readyWaitMs: waiting for the receiver's credit before the header and payload leave together (v2 has no ready reply). */
  authorizationMs: number; readyWaitMs: number; payloadUploadMs: number;
  /** Includes remote authorization and computation, not pure network time. */
  responseWaitMs: number; acceptanceMs: number; totalMs: number;
}
export interface PartitionChannelLimits {
  maxFrameBytes: number; maxControlBytes: number; maxPayloadBytes: number;
  maxPendingBytes: number; maxPendingRequests: number; maxRequestsPerChannel: number;
  maxBufferedBytes: number; maxTransferBytes: number; timeoutMs: number;
}
export interface PartitionChannelReceipt {
  schema: 'reploid.partition-channel/v2';
  sentFrameBytes: number; receivedFrameBytes: number; sentFrames: number; receivedFrames: number;
  completedRequests: number; cancelledRequests: number; discardedFrames: number;
  pendingRequests: number; inboundRequests: number; reservedBytes: number; closed: boolean;
  /** Requests and bytes the peer's window holds for this endpoint's requests until their terminal replies. */
  creditHeld: { requests: number; bytes: number }; creditWaiting: number;
  wireBytes: null; relayBytes: null;
  /** Local diagnostic only; raw failure details are never transmitted. Settlement
   * means the transport callback returned, not independent proof of GPU cleanup. */
  lastFailure: null | { requestId: number; phase: 'admission' | 'execution'; code: string;
    message: string; failedAt: number; settledAt: number | null };
}
export interface PartitionBinaryResult { readonly result: PartitionMetadata; readonly bytes: Uint8Array }
/** A serve result whose bytes return on the direct reply, within the request's `maxResponseBytes`. */
export function partitionBinaryResult(result: PartitionMetadata, bytes: Uint8Array): PartitionBinaryResult;
/** Pipelined requests: header and payload leave together under credit from the receiver's declared window
 * (maxPendingRequests, maxPendingBytes; both endpoints declare the same channel policy), returned by each
 * request's single terminal reply. A peer exceeding this endpoint's window closes the channel. */
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
    metadata: PartitionMetadata; byteLength: number; responseByteLength?: number;
  }, options: { signal: AbortSignal }): boolean | Promise<boolean>;
  /** Compose partition receiver/settlement here. Transport never infers execution authority. */
  serve(metadata: PartitionMetadata, bytes: Uint8Array, options: { signal: AbortSignal }):
    PartitionMetadata | PartitionBinaryResult | Promise<PartitionMetadata | PartitionBinaryResult>;
}): {
  /** Metadata and activation bytes are snapshotted. Abort rejects delivery, not GPU settlement. */
  request(metadata: PartitionMetadata, bytes: Uint8Array, options?: {
    signal?: AbortSignal; onTiming?: (timing: PartitionRequestTiming) => void;
  }): Promise<PartitionMetadata>;
  /** With `maxResponseBytes`, resolves the JSON result and any reply bytes the peer returned on the direct path. */
  request(metadata: PartitionMetadata, bytes: Uint8Array, options: {
    signal?: AbortSignal; onTiming?: (timing: PartitionRequestTiming) => void; maxResponseBytes: number;
  }): Promise<{ result: PartitionMetadata; bytes: Uint8Array }>;
  /** Abort owned deliveries. Hosts remain responsible for settling borrowed GPU attempts. */
  close(reason?: string): void;
  getReceipt(): PartitionChannelReceipt;
};
