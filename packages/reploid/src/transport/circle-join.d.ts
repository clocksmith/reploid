import type { SwarmTransport } from './swarm.js';

export const CIRCLE_JOIN_REQUEST: 'reploid:circle-join-request';
export const CIRCLE_JOIN_RESULT: 'reploid:circle-join-result';
export function circleInviteToken(value: unknown): value is string;
export function circleJoinRequestId(value: unknown): value is string;

export function requestCircleJoin(options: {
  transport: Required<Pick<SwarmTransport, 'getPeerBinding' | 'onMessage' | 'sendToPeer'>>;
  verifyPeer(peerId: string, signal?: AbortSignal): Promise<string | null>;
  currentPeer(peerId: string): string | null;
  hostPeer: string;
  hostParticipantId: string;
  token: string;
  signal?: AbortSignal;
}): Promise<{
  hostParticipantId: string;
  hostLabel: string;
  inviteId: string | null;
  expiresAt: number | null;
  remainingRequests: number | null;
  maxOutputTokens: number | null;
}>;
