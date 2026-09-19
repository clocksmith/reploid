export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface AgentPolicy {
  maxCycles: number; maxBatchTools: number; singleToolNudgeThreshold: number; milestoneAutoparkThreshold: number;
  maxContextChars: number; timeoutMs: number; retryDelayMs: number; maxRetryDelayMs: number;
  rgrArchiveLimit: number; requiredAnchorObservations: number; toolStringPreviewChars: number;
  toolResultPayloadChars: number; toolBatchBodyChars: number; toolSanitizeMaxDepth: number; toolSanitizeArrayLimit: number;
}
export interface Configuration {
  schema: 'reploid.config/v1';
  agent: AgentPolicy;
  legacyAgent: { discoveryLimit: number; maxToolCalls: number; settings: null | { providerThrottle: Json; cycleIntervalMs: number; functionGemma: Json } };
  tools: { allowed: string[]; allowDynamic: boolean; parallelSafe: string[]; ordered: string[]; exclusive: string[]; loaderId: string | null };
  memory: { storeId: string | null; checkpointPrefix: string; maxCheckpointBytes: number };
  models: { providerId: string | null; contract: Record<string, Json> | null };
  mesh: { enabled: boolean; executeJobs: boolean; supplyArtifacts: boolean; shareCandidates: boolean;
    roomId: string | null; routing: 'local-only' | 'local-first' | 'remote-only';
    generationTimeoutMs: number; maxPendingJobs: number; maxInboundJobs: number; maxRetainedJobs: number };
  webrtc: { protocol: 'assignment/v1' | 'swarm/v1'; signalingUrl: string | null;
    rtcConfig: { iceServers: { urls: string | string[] }[]; iceTransportPolicy: 'all' | 'relay' };
    dataChannelLabel: string; dataChannelOptions: { ordered: boolean; maxRetransmits: number | null };
    maxPendingRemoteIceCandidates: number; pendingRemoteIceTtlMs: number; maxMessageBytes: number;
    maxBufferedBytes: number; connectTimeoutMs: number; reconnectBaseMs: number; maxBackoffMs: number;
    heartbeatIntervalMs: number; peerTimeoutMs: number; announceIntervalMs: number; signalingProbeTimeoutMs: number;
    signaling: { pollIntervalMs: number; pollTimeoutMs: number; failureThreshold: number; backoffBaseMs: number; backoffMaxMs: number };
    transportOrder: ('webrtc' | 'broadcast')[]; sessionId: string | null; broadcastRoomId: string | null };
  artifacts: { root: string; maxBytes: number };
  improvement: { enabled: boolean; evaluatorId: string | null; approvalId: string | null; isolationId: string | null };
  observation: { enabled: boolean };
}
export type DeepPartial<T> = T extends unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export interface ResolvedConfig { readonly value: DeepReadonly<Configuration>; readonly identity: string; readonly provenance: Readonly<Record<string, string>> }
export interface Profile { schema: 'reploid.profile/v1'; id: string; config: DeepPartial<Configuration> }
export class ConfigurationError extends TypeError { readonly path: string; constructor(path: string, message: string); }
export function resolveConfig(input?: { chain?: DeepPartial<Configuration>[]; profile?: Profile | null; overrides?: DeepPartial<Configuration>; request?: DeepPartial<Configuration> }): ResolvedConfig;
export function requireResolvedConfig(config: ResolvedConfig): DeepReadonly<Configuration>;
export function snapshotJson<T extends Json>(value: T, path?: string): T;
export function freezeJson<T>(value: T): DeepReadonly<T>;
export function hashConfiguration(config: ResolvedConfig, cryptoApi?: Crypto): Promise<string>;
