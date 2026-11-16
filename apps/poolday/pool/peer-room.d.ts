import type { JsonValue, PackOperationRegistry } from '../../../shared/pool/pack-operation-adapters.js';
import type { CurrentPackJobPolicy } from '../../../shared/pool/peer-pack-job-policy.js';
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
  /** Persist before connecting. A failed save prevents delivery. */
  readonly onPrepared?: ((job: SignedPackPeerMessage<PackPeerJobBody>) => void | Promise<void>) | null;
  readonly connectTransport: (selected: { readonly providerId: string; readonly advert: SignedPackPeerMessage<PackProviderAdvertBody>;
    readonly assignment: PackPeerJobBody['assignment']; readonly signal: AbortSignal }) => PeerOperationTransport | Promise<PeerOperationTransport>;
  readonly registry?: PackOperationRegistry;
  readonly policy?: CurrentPackJobPolicy;
  readonly onError?: (error: Error) => void;
}): Promise<PackPeerJobResult>;
export function resumePeerOperationJob(options: Omit<Parameters<typeof runPeerOperationJob>[0], 'request' | 'providerAdverts' | 'onPrepared' | 'requesterClient'> & {
  readonly requesterClient: Pick<PeerOperationRequesterClient, 'createPeerPackRequester'>;
  readonly job: SignedPackPeerMessage<PackPeerJobBody>;
  readonly model: Readonly<Record<string, JsonValue>>;
  readonly reference: JsonValue;
}): Promise<PackPeerJobResult>;
export const PEER_ROOM_VERSION: string;
export const DEFAULT_PEER_ROOM_ID: string;
export interface PeerRoomActivity { status: string; phase: string; roomId: string; [detail: string]: unknown }
export interface PeerRoomOptions {
  roomId?: string;
  roomBusFactory?: typeof import('./peer-rendezvous.js').createBroadcastPeerRoomBus;
  relayAckSigner?: ((message: unknown) => unknown | Promise<unknown>) | null;
  onActivity?: ((event: PeerRoomActivity) => void) | null;
  rtcConfigProvider?: ((...args: unknown[]) => RTCConfiguration | Promise<RTCConfiguration>) | null;
}
export interface PeerJobOptions extends PeerRoomOptions {
  requesterClient: Pick<ReturnType<typeof import('./requester-client.js').createRequesterClient>,
    'createPeerJobIntent' | 'createPeerSequencePayload' | 'createPeerPromptPayload'> & Partial<Pick<
      ReturnType<typeof import('./requester-client.js').createRequesterClient>, 'createPeerReceiptAcceptance' | 'createPeerLedgerEvents'>>;
  prompt?: string; sequence?: string; sequenceRequest?: Readonly<Record<string, JsonValue>> | null;
  policyId?: string; modelRequirements?: Readonly<Record<string, JsonValue>>;
  generationConfig?: Readonly<Record<string, JsonValue>>; maxPointSpend?: number | null;
  discoveryWindowMs?: number; sessionAcceptWindowMs?: number; receiptWindowMs?: number;
  queueWindowMs?: number; transportConnectWindowMs?: number; promptDispatchConcurrency?: number | null;
  knownProviderAdverts?: readonly Readonly<Record<string, unknown>>[];
  requesterTransportFactory?: typeof import('../../../shared/pool/p2p-transport.js').createP2PRequesterTransport;
}
export interface PeerJobResult {
  transport: 'webrtc_peer_room'; roomId: string; intentHash: string; outputText: string; tokenIds: number[];
  receiptHash: string | null; receiptHashes: string[]; acceptedSessionCount: number; receiptErrors: string[];
  plan: Awaited<ReturnType<typeof import('./peer-control-plane.js').buildPeerAssignmentPlan>>;
  deliveryPolicy: { queueWindowMs: number; receiptWindowMs: number;
    queueDeadlineStartsOn: 'provider_queued_status'; receiptDeadlineStartsOn: 'input_dispatch_or_provider_execution_started' };
  [evidence: string]: unknown;
}
export function runPeerJob(options: PeerJobOptions): Promise<PeerJobResult>;
export interface PeerProviderNodeOptions extends PeerRoomOptions {
  providerClient: Pick<ReturnType<typeof import('./provider-client.js').createProviderClient>, 'createPeerProviderAdvert' | 'executePeerAssignment'>;
  providerTransportFactory?: typeof import('../../../shared/pool/p2p-transport.js').createP2PProviderTransport;
  advertIntervalMs?: number; maxActiveSessions?: number; maxQueuedSessions?: number;
}
export interface PeerProviderNode {
  start(options?: Parameters<PeerProviderNodeOptions['providerClient']['createPeerProviderAdvert']>[0]): Promise<Readonly<Record<string, unknown>>>;
  stop(): Promise<{ roomId: string; status: 'peer_provider_stopped' }>;
  getAdvert(): Awaited<ReturnType<PeerProviderNodeOptions['providerClient']['createPeerProviderAdvert']>> | null;
}
export function createPeerProviderNode(options: PeerProviderNodeOptions): PeerProviderNode;
declare const api: { DEFAULT_PEER_ROOM_ID: typeof DEFAULT_PEER_ROOM_ID; PEER_ROOM_VERSION: typeof PEER_ROOM_VERSION;
  createPeerProviderNode: typeof createPeerProviderNode; runPeerJob: typeof runPeerJob; runPeerOperationJob: typeof runPeerOperationJob;
  resumePeerOperationJob: typeof resumePeerOperationJob };
export default api;

export function createRoomSignaling(options: Record<string, unknown>): { subscribe(listener: (message: unknown) => void): () => void; sendOffer(payload: unknown): Promise<void>; sendAnswer(payload: unknown): Promise<void>; sendIceCandidate(payload: unknown): Promise<void>; sendClose(reason?: string): Promise<void>; close(): void };
