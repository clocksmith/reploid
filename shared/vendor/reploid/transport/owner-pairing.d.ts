import type { SwarmTransport } from './swarm.js';

export const OWNER_PAIRING_REQUEST: 'reploid:owner-pairing-request';
export const OWNER_PAIRING_RESULT: 'reploid:owner-pairing-result';
export const OWNER_PAIRING_ROOM_PATTERN: RegExp;
export function ownerParticipantId(value: unknown): value is string;
export function ownerPairingCode(value: unknown): value is string;
export function ownerPairingRequestId(value: unknown): value is string;
export function ownerPairingRoomId(value: unknown): value is string;
export function ownerPairingRoomMarker(roomId: string): string;

export function requestOwnerPairing(options: {
  transport: Required<Pick<SwarmTransport, 'getPeerBinding' | 'onMessage' | 'sendToPeer'>>;
  verifyPeer(peerId: string, signal?: AbortSignal): Promise<string | null>;
  currentPeer(peerId: string): string | null;
  hostPeer: string;
  hostParticipantId: string;
  code: string;
  signal?: AbortSignal;
}): Promise<{ hostParticipantId: string }>;
