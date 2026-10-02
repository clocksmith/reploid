import type { SwarmTransport } from '../../transport/swarm.js';
import type { PartitionPeer } from './partition-peer.js';
export interface PartitionNetwork<T = PartitionPeer> { connect(peerId: string): Promise<T>; close(): Promise<void> }
export function createPartitionNetwork<T extends { close(): void | Promise<void> }>(options: {
  transport: SwarmTransport;
  /** Existing mesh challenge verifier authenticating signatures against current RTC certificates. */
  verifyPeer(peerId: string, signal: AbortSignal): Promise<string | null>;
  createEndpoint(options: { channel: RTCDataChannel; remoteParticipantId: string }): T;
  maxPeers: number; timeoutMs: number; onPeer?(peerId: string, endpoint: T): void;
  label?: string;
}): PartitionNetwork<T>;
