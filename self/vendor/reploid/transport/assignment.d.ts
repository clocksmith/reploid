import type { ResolvedConfig } from '../config/index.js';
import type { SignalingChannel } from './signaling.js';
export interface P2PTransport {
  /** Close and connection deadlines reject pending waiters without waiting for browser setup. Late setup results are ignored. */
  connect(): Promise<void>; ready(): Promise<void>; send(value: unknown): void; close(reason?: string | null): Promise<void>;
  getState(): string; getPeerConnection(): RTCPeerConnection | null; getDataChannel(): RTCDataChannel | null;
  getDiagnostics(): Record<string, unknown>;
}
export interface P2POptions {
  config: ResolvedConfig; signaling: SignalingChannel; initiator: boolean; rtcConfig?: RTCConfiguration;
  dataChannelLabel?: string; dataChannelOptions?: RTCDataChannelInit;
  serialize?: (value: unknown) => string | ArrayBuffer | ArrayBufferView | Blob;
  deserialize?: (value: unknown) => unknown;
  onMessage?: ((value: unknown, event: MessageEvent) => void) | null; onStateChange?: ((state: string) => void) | null;
  onPeerConnection?: ((connection: RTCPeerConnection) => void) | null; onDataChannel?: ((channel: RTCDataChannel) => void) | null;
  maxPendingRemoteIceCandidates?: number; pendingRemoteIceTtlMs?: number; now?: () => number;
  RTCPeerConnectionImpl?: typeof RTCPeerConnection; RTCSessionDescriptionImpl?: typeof RTCSessionDescription; RTCIceCandidateImpl?: typeof RTCIceCandidate;
}
export const P2P_TRANSPORT_STATES: Readonly<Record<'IDLE'|'CONNECTING'|'CONNECTED'|'CLOSING'|'CLOSED'|'FAILED', string>>;
export function createP2PTransport(options: P2POptions): P2PTransport;
export function descriptionToPayload(value: RTCSessionDescription | null): RTCSessionDescriptionInit | null;
export function candidateToPayload(value: RTCIceCandidate | null): RTCIceCandidateInit | null;
export function defaultSerialize(value: unknown): string | ArrayBuffer | ArrayBufferView | Blob;
export function defaultDeserialize(value: unknown): unknown;
