import type { SwarmTransport } from '../../transport/swarm.js';
import type { PartitionPeer } from './partition-peer.js';
export interface PartitionNetwork { connect(peerId: string): Promise<PartitionPeer>; close(): Promise<void> }
export function createPartitionNetwork(options: {
  transport: SwarmTransport;
  /** Existing mesh challenge verifier authenticating signatures against current RTC certificates. */
  verifyPeer(peerId: string, signal: AbortSignal): Promise<string | null>;
  createEndpoint(options: { channel: RTCDataChannel; remoteParticipantId: string }): PartitionPeer;
  maxPeers: number; timeoutMs: number; onPeer?(peerId: string, endpoint: PartitionPeer): void;
}): PartitionNetwork;
