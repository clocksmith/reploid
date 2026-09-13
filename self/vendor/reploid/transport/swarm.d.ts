import type { ResolvedConfig } from '../config/index.js';
export interface SwarmTransport {
  init(): Promise<boolean>; disconnect(): void; sendToPeer(peerId: string, type: string, payload: unknown): boolean;
  broadcast(type: string, payload: unknown): number; onMessage(type: string, handler: (peerId: string, payload: Record<string, unknown>, envelope?: object) => void): void;
  getConnectionState(): string; getConnectedPeers(): object[]; getStats(): Record<string, unknown>; getClock(): number; tick(): number;
  _getPeerId(): string | null; _getSessionId(): string | null;
}
export interface SwarmOptions {
  config: ResolvedConfig; Utils: { logger: Record<'info'|'debug'|'warn'|'error', (...args: unknown[]) => void>; generateId(prefix: string): string };
  EventBus: { emit(name: string, payload: unknown): void };
  peerId?: string; getSessionId?: () => string; getRoomCredentials: () => { roomId: string; token: string };
  rtcConfig?: RTCConfiguration; WebSocket?: typeof WebSocket; RTCPeerConnection?: typeof RTCPeerConnection;
  RTCSessionDescription?: typeof RTCSessionDescription; RTCIceCandidate?: typeof RTCIceCandidate;
}
export function createWebRTCSwarm(options: SwarmOptions): SwarmTransport;
declare const WebRTCSwarm: { metadata: Readonly<Record<string, unknown>>; factory: typeof createWebRTCSwarm };
export default WebRTCSwarm;
