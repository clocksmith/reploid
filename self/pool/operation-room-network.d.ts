import type { DocumentOperationNetwork } from './document-delegation.js';
import type { CurrentPackJobPolicy } from './peer-pack-job-policy.js';
import type { PeerOperationRequesterClient } from './peer-room.js';
import type { PackPeerProviderOptions, PackPeerProviderState } from './peer-pack-provider.js';
import type { ProviderCapabilities, WorkRequirements } from './peer-capabilities.js';
import type { PackPeerLimits, createPackPeerConnection } from './peer-pack-job.js';
export interface OperationNetworkPolicy {
  schema: 'reploid.pool.operation-network-policy/v1'; discoveryMs: number; advertMs: number;
  advertLifetimeMs: number; connectionMs: number; maxConnections: 1; maxChannelBytes: number;
  channelTimeoutMs: number; maxPendingIce: number; pendingIceMs: number; dataChannelLabel: string;
  identityNamespace: string; requestResources: WorkRequirements['resources']; requestLimits: PackPeerLimits;
}
export interface OperationRoomBus {
  postMessage(message: object): void | Promise<void>;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  close(): void;
}
export interface OperationRoomOptions {
  roomId: string; roomBusFactory(options: { roomId: string; role: string; localPeerId?: string }): OperationRoomBus;
  rtcConfig: RTCConfiguration; policy?: OperationNetworkPolicy; jobPolicy?: CurrentPackJobPolicy;
}
export function createOperationRoomNetwork(options: OperationRoomOptions & {
  requesterClient: PeerOperationRequesterClient & {
    createPeerOperationConnection(options: Omit<Parameters<typeof createPackPeerConnection>[0], 'identity'>): ReturnType<typeof createPackPeerConnection>;
  };
}): DocumentOperationNetwork;
export function createOperationRoomProvider(options: OperationRoomOptions & Pick<PackPeerProviderOptions,
  'identity' | 'models' | 'authorize' | 'adapterResolver' | 'executor' | 'onError'> & {
  observeCapabilities(state: PackPeerProviderState): ProviderCapabilities | Promise<ProviderCapabilities>;
}): { start(): Promise<void>; close(): Promise<void>;
  getState(): { sharing: boolean; connections: number; execution: PackPeerProviderState | null } };
