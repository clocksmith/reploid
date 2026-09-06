import type { PackOperationRegistry } from './pack-operation-adapters.js';
import type { CurrentPackJobPolicy } from './peer-pack-job-policy.js';
import type { PackPeerJobBody, PackProviderAdvertBody, SignedPackPeerMessage, createPackPeerJob } from './peer-pack-job.js';
import type { PackPeerBus, PackPeerJobResult, PackPeerRequester, PackPeerRequesterOptions, PackPeerRunCallbacks, PackPeerRunInput } from './peer-pack-requester.js';
export interface PeerOperationRequesterClient {
  createPeerOperationJob(options: Omit<Parameters<typeof createPackPeerJob>[0], 'identity'>): Promise<SignedPackPeerMessage<PackPeerJobBody>>;
  createPeerPackRequester(options: Omit<PackPeerRequesterOptions, 'identity'>): PackPeerRequester | Promise<PackPeerRequester>;
}
export interface PeerOperationTransport {
  readonly bus: PackPeerBus;
  close(): void | Promise<void>;
}
export function runPeerOperationJob(options: PackPeerRunCallbacks & {
  readonly requesterClient: PeerOperationRequesterClient;
  readonly request: Omit<PackPeerRunInput, 'signal' | 'onPartial' | 'advert' | 'adverts'>;
  readonly providerAdverts: readonly SignedPackPeerMessage<PackProviderAdvertBody>[];
  readonly connectTransport: (selected: { readonly providerId: string; readonly advert: SignedPackPeerMessage<PackProviderAdvertBody>;
    readonly assignment: PackPeerJobBody['assignment']; readonly signal: AbortSignal }) => PeerOperationTransport | Promise<PeerOperationTransport>;
  readonly registry?: PackOperationRegistry;
  readonly policy?: CurrentPackJobPolicy;
  readonly onError?: (error: Error) => void;
}): Promise<PackPeerJobResult>;
export const PEER_ROOM_VERSION: string;
export const DEFAULT_PEER_ROOM_ID: string;
export function runPeerJob(options: Record<string, unknown>): Promise<Record<string, unknown>>;
export function createPeerProviderNode(options: Record<string, unknown>): {
  start(options?: Record<string, unknown>): Promise<Record<string, unknown>>;
  stop(): Promise<Record<string, unknown>>;
  getAdvert(): Record<string, unknown> | null;
};
declare const api: { DEFAULT_PEER_ROOM_ID: typeof DEFAULT_PEER_ROOM_ID; PEER_ROOM_VERSION: typeof PEER_ROOM_VERSION;
  createPeerProviderNode: typeof createPeerProviderNode; runPeerJob: typeof runPeerJob; runPeerOperationJob: typeof runPeerOperationJob };
export default api;
