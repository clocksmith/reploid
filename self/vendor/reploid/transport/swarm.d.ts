import type { IntroductionBootstrapOptions } from './introduction-bootstrap.js';
import type { IntroductionOptions, PeerIntroductions } from './introductions.js';
import type { ResolvedConfig } from '../config/index.js';
export type SwarmDataChannelLabel = 'reploid-custody' | 'reploid-partitions'
  | 'reploid-partitions-input' | 'reploid-partitions-control' | 'reploid-jobs';
export interface SwarmTransport {
  getIntroductions(): PeerIntroductions | null;
  init(): Promise<boolean>; disconnect(): void; sendToPeer(peerId: string, type: string, payload: unknown): boolean;
  broadcast(type: string, payload: unknown): number; onMessage(type: string, handler: (peerId: string, payload: Record<string, unknown>, envelope?: object) => void): void;
  getConnectionState(): string; getConnectedPeers(): object[]; getStats(): Record<string, unknown>; getClock(): number; tick(): number;
  _getPeerId(): string | null; _getSessionId(): string | null;
  getPeerBinding?(peerId: string): { local: string; remote: string } | null;
  onDataChannel(label: SwarmDataChannelLabel, handler: (peerId: string, channel: RTCDataChannel) => void): () => void;
  openDataChannel(peerId: string, label: SwarmDataChannelLabel): RTCDataChannel;
}
export interface SwarmOptions {
  config: ResolvedConfig; Utils: { logger: Record<'info'|'debug'|'warn'|'error', (...args: unknown[]) => void>; generateId(prefix: string): string };
  EventBus: { emit(name: string, payload: unknown): void };
  peerId?: string; getSessionId?: () => string; getRoomCredentials?: () => { roomId: string; token: string };
  introductions?: IntroductionOptions;
  introductionBootstrap?: IntroductionBootstrapOptions;
  signalingAdapter?: { publish(message: Record<string, unknown>): unknown | Promise<unknown>;
    subscribe(listener: (message: Record<string, unknown>) => void): () => void };
  getRtcConfig?: () => RTCConfiguration | Promise<RTCConfiguration>;
  rtcConfig?: RTCConfiguration; WebSocket?: typeof WebSocket; RTCPeerConnection?: typeof RTCPeerConnection;
  RTCSessionDescription?: typeof RTCSessionDescription; RTCIceCandidate?: typeof RTCIceCandidate;
}
export function createWebRTCSwarm(options: SwarmOptions): SwarmTransport;
declare const WebRTCSwarm: { metadata: Readonly<Record<string, unknown>>; factory: typeof createWebRTCSwarm };
export default WebRTCSwarm;
