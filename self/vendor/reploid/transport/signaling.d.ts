import type { ResolvedConfig } from '../config/index.js';
export interface SignalMessage {
  id: string; sessionId: string; assignmentId: string | null; type: string;
  fromPeerId: string; toPeerId: string | null; payload: unknown; createdAt: number; expiresAt: number | null;
}
export interface SignalingAdapter {
  publish(message: SignalMessage): unknown | Promise<unknown>;
  subscribe(listener: (message: SignalMessage) => void): () => void;
  close?: (() => void | Promise<void>) | null;
}
export interface SignalingChannel {
  subscribe(listener: (message: SignalMessage) => void): () => void;
  sendOffer(payload: RTCSessionDescriptionInit | null): unknown | Promise<unknown>;
  sendAnswer(payload: RTCSessionDescriptionInit | null): unknown | Promise<unknown>;
  sendIceCandidate(payload: RTCIceCandidateInit | null): unknown | Promise<unknown>;
  sendClose?(reason?: string | null): unknown | Promise<unknown>;
  close(): void;
}
export const SIGNAL_TYPES: Readonly<Record<string, string>>;
export const DEFAULT_SIGNAL_POLL_TIMEOUT_MS: number, DEFAULT_SIGNAL_FAILURE_THRESHOLD: number;
export const DEFAULT_SIGNAL_POLL_BACKOFF_BASE_MS: number, DEFAULT_SIGNAL_POLL_BACKOFF_MAX_MS: number;
export function createSignalId(prefix?: string): string;
export function createSignalMessage(input: Partial<SignalMessage> & Pick<SignalMessage, 'sessionId'|'type'|'fromPeerId'>): SignalMessage;
export function normalizeSignalMessage(value: unknown): SignalMessage;
export function isSignalForPeer(message: SignalMessage, options: { sessionId?: string; localPeerId?: string; remotePeerId?: string | null; includeOwnSignals?: boolean; now?: number }): boolean;
export function createCallbackSignalingAdapter(ports: { publish: SignalingAdapter['publish']; subscribe: SignalingAdapter['subscribe']; close?: SignalingAdapter['close'] }): SignalingAdapter;
export function createFirestoreLikeSignalingAdapter(ports: { addSignal: SignalingAdapter['publish']; listenSignals: SignalingAdapter['subscribe']; close?: SignalingAdapter['close'] }): SignalingAdapter;
export function createPollingSignalingAdapter(options: Record<string, unknown> & { config: ResolvedConfig }): SignalingAdapter;
export function createPoolSdkSignalingAdapter(options: Record<string, unknown> & { config: ResolvedConfig }): SignalingAdapter;
export function createSignalingChannel(options: { sessionId: string; assignmentId?: string | null; localPeerId: string;
  remotePeerId?: string | null; adapter: SignalingAdapter; signalTtlMs?: number | null }): SignalingChannel;
