import type { PeerContact, PeerIntroductions, IntroductionPolicy, IntroductionEnvelope, IntroductionRoute } from './introductions.js';
export interface IntroductionBootstrapRoute {
  id: string;
  open(options: { contact: PeerContact; retainedContact: PeerContact | null; signal: AbortSignal;
    receive(envelope: IntroductionEnvelope): Promise<void> }): Promise<{
      contact: PeerContact; publish: IntroductionRoute; close(): void;
    }>;
}
export interface IntroductionContactStore {
  load(): unknown | Promise<unknown>;
  save(records: { routeId: string; contact: PeerContact }[]): void | Promise<void>;
}
export interface IntroductionBootstrapOptions {
  routes: IntroductionBootstrapRoute[]; store?: IntroductionContactStore;
}
export function bootstrapIntroductions(options: IntroductionBootstrapOptions & {
  introductions: PeerIntroductions; signal?: AbortSignal; isConnected(peerId: string): boolean;
  policy?: IntroductionPolicy; onState?: (state: Record<string, unknown>) => void;
}): Promise<{ routeId: string; peerId: string; failures: { routeId: string; message: string }[] }>;
export function createWebSocketIntroductionRoute(options: {
  id: string; url: string; expectedParticipantId: string; maxMessageBytes?: number; WebSocket?: typeof WebSocket;
}): IntroductionBootstrapRoute;
