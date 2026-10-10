import type { SigningIdentity } from '../artifacts/identity.js';
export interface IntroductionPolicy {
  schema: 'reploid.introductions-policy/v1'; contactTtlMs: number; messageTtlMs: number;
  maxContacts: number; maxPending: number; maxMessageBytes: number; maxMessagesPerWindow: number;
  windowMs: number; maxBootstrapRoutes: number; maxClockSkewMs: number;
}
export interface PeerContact {
  body: { schema: 'reploid.contact/v1'; participantId: string; peerId: string; roomId: string;
    sequence: number; createdAt: number; expiresAt: number; encryptionKey: JsonWebKey; admission?: { schema: 'reploid.room-admission/v1'; proof: string } };
  publicJwk: JsonWebKey; signature: string;
}
export interface IntroductionEnvelope { record: { body: Record<string, unknown>; publicJwk: JsonWebKey; signature: string }; forwarded: boolean }
export type IntroductionRoute = (envelope: IntroductionEnvelope) => boolean | void | Promise<boolean | void>;
export interface IntroductionGrant { action: 'admit' | 'connect' | 'forward' | 'announce'; roomId: string;
  contact?: PeerContact; from?: PeerContact; to?: string }
export interface PeerIntroductions {
  exportContact(): PeerContact;
  announce(peerId: string): Promise<void>;
  connect(contact: PeerContact, route: IntroductionRoute, signal?: AbortSignal): Promise<void>;
  receive(via: string | null, type: string, value: unknown, replyRoute?: IntroductionRoute): Promise<void>;
  cancelPending(peerId: string): void;
  retirePeer(peerId: string, attemptId?: string): void; settled(peerId: string): void;
  getState(): { contacts: number; pending: number; closed: boolean }; close(): void;
}
export interface IntroductionExchange { attemptId: string; isActive(): boolean; publish(message: Record<string, unknown>): Promise<void> }
export interface IntroductionTransport {
  _getPeerId(): string; getConnectedPeers(): { id: string }[];
  onMessage(type: string, listener: (via: string, value: unknown) => void): void;
  sendToPeer(peerId: string, type: string, payload: unknown): boolean;
  connectIntroducedPeer(peerId: string, exchange: IntroductionExchange): Promise<void>;
  acceptIntroductionSignal(peerId: string, payload: Record<string, unknown>, exchange: IntroductionExchange): Promise<void>;
  cancelIntroduction?(peerId: string, attemptId: string): void;
}
export interface IntroductionOptions {
  getIdentity(): SigningIdentity | Promise<SigningIdentity>;
  createAdmission?: (body: Omit<PeerContact['body'], 'admission'>) => Promise<NonNullable<PeerContact['body']['admission']>>;
  authorize(request: IntroductionGrant): boolean | Promise<boolean>;
  policy?: IntroductionPolicy;
}
export const INTRODUCTION_CONTACT: 'reploid:introduction-contact', INTRODUCTION_SIGNAL: 'reploid:introduction-signal';
export function createPeerIntroductions(options: {
  transport: IntroductionTransport; identity: SigningIdentity; roomId: string;
  authorize: IntroductionOptions['authorize']; createAdmission?: IntroductionOptions['createAdmission']; policy?: IntroductionPolicy;
  now?: () => number; onError?: (error: Error) => void;
}): Promise<PeerIntroductions>;
