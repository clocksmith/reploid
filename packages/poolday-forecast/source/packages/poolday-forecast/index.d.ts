export interface Identity { keyId: string; publicKey: string; privateKey: CryptoKey }
export interface JsonRecord { [key: string]: unknown }
export interface ForecastModel {
  modelId: string; modelHash: string; manifestHash: string;
  workload: 'timeseries.forecast.v1'; executionMode: 'complete_forecast'; runtime: 'doppler'; backend: 'browser-webgpu';
  executablePack: { schema: string; packId: string; semanticRoot: string; envelopeDigest: string; artifactClosureDigest: string;
    requiredOperation: 'forecast'; acceptedTargetPlanDigests: string[];
    artifacts: { artifactId: string; hash: string; sizeBytes: number; path: string; role: string }[] };
  forecast: { contextLength: number; maxHorizon: number; quantiles: number[]; applicationDigest: string; contractDigest: string };
}
export interface ForecastPolicy {
  schema: 'reploid.pool.forecast-policy/v1'; id: string; sensitivity: 'public'; providerIds: string[];
  replicas: number; maxJobMs: number; absoluteTolerance: number; relativeTolerance: number;
}
export interface ForecastDomain { roomId: string; roomRoot: string; policyHash: string; runHash: string; snapshotHash: string }
export interface ForecastConfig { horizon: number; quantiles: number[]; stepMs: number; lastObservation: string }
export interface PeerMessage<B = JsonRecord> {
  peerControlVersion: 'reploid_peer_control/v1'; network: 'poolday'; type: string; fromPeerId: string; toPeerId: string | null;
  publicKey: string; body: B; createdAt: string; expiresAt: string; nonce: string; causalRefs: string[]; messageHash: string; signature: string;
}
export interface Availability {
  acceptingJobs: boolean; activeJobs: number; maxConcurrentJobs: number; maxJobMs: number;
  expectedLatencyMs: number | null; acceptedPolicies?: string[];
}
export type ProviderAdvert = PeerMessage<{ schema: string; providerId: string; models: ForecastModel[]; availability: Availability; reputationEvidence: JsonRecord }>;
export type ForecastIntent = PeerMessage<{ schema: string; requesterId: string; policyId: string; policyConfigVersion: string;
  policyConfigHash: string; policy: ForecastPolicy; domain: ForecastDomain; modelRequirements: ForecastModel;
  generationConfig: ForecastConfig; generationConfigHash: string; inputHash: string; workload: string }>;
export interface RouteDecision extends JsonRecord { schema: string; decisionHash: string; createdAt: string; intentHash: string; policyId: string;
  selectedProviderIds: string[]; candidates: { providerId: string | null; eligible: boolean; rejectionReasons: string[]; score: JsonRecord }[] }
export interface ForecastAssignment extends JsonRecord {
  assignmentHash: string; assignmentId: string; intentHash: string; jobId: string; providerId: string; providerPublicKey: string;
  requesterId: string; providerAdvertHash: string; routeDecisionHash: string; assignmentAttemptId: string;
  providerLimits: { maxJobMs: number; maxConcurrentJobs: number }; domain: ForecastDomain;
  generationConfig: ForecastConfig; model: ForecastModel; expiresAt: string;
}
export interface ForecastRequest { application: JsonRecord; context: number[]; horizon: number; assignmentHash: string }
export interface ForecastOutput { timestamps: string[]; point: number[]; quantiles: number[][] }
export interface ForecastCosts {
  durationMs: number; preparationMs: number; inputBytes: number; modelBytes: number; outputBytes: number;
  retries: number; replicas: number; verificationMs: number; relayBytes: number | null; energyJoules: number | null;
}
export interface ForecastReceipt extends JsonRecord {
  providerSignature: string; outputKind: string; status: string;
  forecast: { domain: ForecastDomain; output: ForecastOutput; executionReceipt: JsonRecord; costs: ForecastCosts };
}
export interface ForecastExecution { assignment: ForecastAssignment; advert: ProviderAdvert; route: RouteDecision;
  request: ForecastRequest; receipt: ForecastReceipt }
export interface ForecastAgreement { schema: string; intentHash: string; receiptHashes: string[];
  maxAbsoluteError: number; absoluteTolerance: number; relativeTolerance: number }
export interface ForecastAcceptance extends JsonRecord { accepted: boolean; acceptedAt: string; requesterId: string;
  requesterSignature: string; agreementHash: string; receiptHashes: string[] }
export interface ForecastEpisode { intent: ForecastIntent; executions: ForecastExecution[]; agreement: ForecastAgreement; acceptance: ForecastAcceptance }
export interface VerifiedForecast { receiptHash: string; output: ForecastOutput; costs: ForecastCosts }
export interface ComparedForecast { agreement: ForecastAgreement; output: ForecastOutput; verified: VerifiedForecast[] }
export function createForecastProviderAdvert(options: { identity: Identity; model: ForecastModel; availability: Availability; expiresAt: string }): Promise<ProviderAdvert>;
export function createForecastIntent(options: { identity: Identity; model: ForecastModel; domain: ForecastDomain; config: ForecastConfig; policy: ForecastPolicy; expiresAt: string }): Promise<ForecastIntent>;
export function assignForecastJob(options: { intent: ForecastIntent; adverts: ProviderAdvert[]; expectedModel: ForecastModel; assignmentAttemptId: string; history?: unknown }): Promise<{ ok: boolean; reason?: string; route: RouteDecision; assignments: ForecastAssignment[] }>;
export function validateForecastAssignment(options: { assignment: ForecastAssignment; intent: ForecastIntent; advert: ProviderAdvert; expectedModel: ForecastModel; route: RouteDecision; now?: number }): Promise<true>;
export function createForecastReceipt(options: { identity: Identity; assignment: ForecastAssignment; request: ForecastRequest; output: ForecastOutput; executionReceipt: JsonRecord; costs: ForecastCosts }): Promise<ForecastReceipt>;
export function verifyForecastReceipt(options: { receipt: ForecastReceipt; assignment: ForecastAssignment; request: ForecastRequest; expectedModel: ForecastModel }): Promise<VerifiedForecast>;
export function acceptForecastAgreement(options: { identity: Identity; intent: ForecastIntent; executions: ForecastExecution[]; expectedModel: ForecastModel }): Promise<ComparedForecast & { acceptance: ForecastAcceptance; acceptanceHash: string }>;
export function verifyForecastEpisode(options: ForecastEpisode & { expectedModel: ForecastModel }): Promise<ComparedForecast & { acceptanceHash: string }>;
export function verifyForecastPeerMessage<B = JsonRecord>(message: PeerMessage<B>, options: { type: string; recipient?: string | null; now?: number }): Promise<PeerMessage<B>>;
export function validateForecastPolicy(policy: ForecastPolicy): void;
export function validateForecastCosts(costs: ForecastCosts): void;
export function validateForecastModelContract(model: ForecastModel): { ok: boolean; reasons: string[] };
export function createSignedPeerMessage<B = JsonRecord>(options: { type: string; fromPeerId: string; toPeerId?: string | null; publicKey: string;
  privateKey: CryptoKey; body: B; expiresAt: string; causalRefs?: string[] }): Promise<PeerMessage<B>>;
export const PEER_MESSAGE_TYPES: Readonly<Record<'JOB_INTENT' | 'PROVIDER_ADVERT' | 'ASSIGNMENT_CLAIM' | 'COMMITMENT' | 'REVEAL' | 'EXECUTION_RESULT' | 'RECEIPT' | 'ACCEPTANCE' | 'POINTS_EVENT' | 'REPUTATION_EVENT' | 'HEARTBEAT', string>>;
export function hashDopplerEvidence(value: unknown): Promise<string>;
