export interface PeerAdvertisement {
  kind: string; peerId: string; role: string; swarmEnabled: boolean; hasInference: boolean;
  capabilities: string[]; contribution: Record<string, unknown> | null; updatedAt: number;
  model?: string | null; modelContract?: Record<string, unknown> | null;
}
export const SWARM_ROLES: Readonly<Record<'SOLO'|'PROVIDER'|'CONSUMER'|'DEAD', string>>;
export function deriveSwarmRole(options?: { hasInference?: boolean; swarmEnabled?: boolean }): string;
export function createPeerAdvertisement(options?: Record<string, unknown>): PeerAdvertisement;
export function createGenerationRequest(options?: Record<string, unknown>): Record<string, unknown>;
export function createGenerationResult(options?: Record<string, unknown>): Record<string, unknown>;
export function buildSwarmState(options?: Record<string, unknown>): Record<string, unknown>;
export function chooseProviderPeer(peers?: PeerAdvertisement[], options?: Record<string, unknown>): PeerAdvertisement | null;
export function createSwarmController(options?: Record<string, unknown>): {
  upsertPeer(peer: Record<string, unknown>): PeerAdvertisement | null; removePeer(peerId: string): boolean;
  listPeers(): PeerAdvertisement[]; chooseProvider(now?: number): PeerAdvertisement | null;
  getState(input?: Record<string, unknown>): Record<string, unknown>;
  createAdvertisement: typeof createPeerAdvertisement; createRequest: typeof createGenerationRequest; createResult: typeof createGenerationResult;
};
declare const api: { SWARM_ROLES: typeof SWARM_ROLES; deriveSwarmRole: typeof deriveSwarmRole; createPeerAdvertisement: typeof createPeerAdvertisement;
  createGenerationRequest: typeof createGenerationRequest; createGenerationResult: typeof createGenerationResult; buildSwarmState: typeof buildSwarmState;
  chooseProviderPeer: typeof chooseProviderPeer; createSwarmController: typeof createSwarmController };
export default api;
