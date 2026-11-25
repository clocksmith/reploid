import type { ExecutionPolicy, ExecutionRequirements, ExecutionErrorCode, ExecutionMetadata, Protection, RouteKind } from '../chat/execution-policy.js';
export { EXECUTION_ERROR_CODES, executionError } from '../chat/execution-policy.js';
export type { ExecutionRequirements, ExecutionErrorCode, ExecutionMetadata, Protection, RouteKind, ExecutionRouteValue, Participants } from '../chat/execution-policy.js';

export declare const INFERENCE_API_VERSION: 'reploid.inference/v2';
export declare const EXECUTION_ROUTE_SCHEMA: 'reploid.inference-route/v1';
export declare const EXECUTION_RECEIPT_SCHEMA: 'reploid.execution-receipt/v2';
/** Exactly `YYYY-MM-DDTHH:MM:SS.sssZ`, the settlement records' format. Every time in the API uses it. */
export type IsoTime = string;
export declare const ISO_TIME: RegExp;
export declare function isoTime(ms: number): IsoTime;
export type DisclosureSectionName = 'prompt' | 'intermediate' | 'answer' | 'metadata';
export declare const DISCLOSURE_SECTIONS: readonly DisclosureSectionName[];
export type Review = { state: 'not-applicable' } | { state: 'not-reviewed' } | { state: 'reviewed'; by: string; at: IsoTime; reference: string };
export declare const REVIEW_STATES: readonly Review['state'][];
export declare const NOT_REVIEWED: Readonly<{ state: 'not-reviewed' }>;
export declare const NOT_APPLICABLE: Readonly<{ state: 'not-applicable' }>;
export type ReaderRole = 'requester-device' | 'requester-edge-device' | 'answering-computer' | 'stage-operator' | 'share-holder'
  | 'evaluator' | 'carrier' | 'signaling' | 'network-observer';
export declare const READER_ROLES: readonly ReaderRole[];
export type Assumption = 'recipient-conduct-unchecked' | 'named-device-ownership-unchecked' | 'edge-devices-bound-to-requester'
  | 'activations-may-reveal-content' | 'share-holders-do-not-collude' | 'requester-recombines-intermediates' | 'semi-honest-operators'
  | 'not-independently-reviewed' | 'parameters-not-estimated' | 'insecure-development-parameters' | 'requester-key-holder-unchecked'
  | 'traps-detect-blind-tampering-only' | 'trap-oracle-does-not-collude' | 'hardware-vendor-trusted';
export declare const ASSUMPTIONS: readonly Assumption[];
export type EvidenceClaimCode = 'content-stayed-on-requester-device' | 'content-recipients' | 'edge-devices-bound-to-requester'
  | 'activation-only-recipients' | 'share-recipients' | 'fresh-shares-every-round' | 'evaluator-session-binding' | 'no-evaluator-requests-answered'
  | 'model-identity' | 'adapter-identities' | 'stream-matches-answer' | 'known-answer-traps' | 'frame-binding';
export declare const EVIDENCE_CLAIMS: readonly EvidenceClaimCode[];
export type InferenceEventType = 'admitted' | 'output.delta' | 'completed' | 'cancelled' | 'failed';
export declare const INFERENCE_EVENT_TYPES: readonly InferenceEventType[];
export type RouteShape = 'local' | 'remote' | 'split';
export type RouteSelection = 'all' | 'one-of' | 'any-eligible';
export declare const ROUTE_SHAPES: readonly RouteShape[];
export declare const ROUTE_SELECTIONS: readonly RouteSelection[];

export interface ModelPin { id: string; identity: string; adapterIdentities?: string[] }
export interface PrepareRequest { model: ModelPin; generation?: { maxOutputTokens?: number }; execution: ExecutionRequirements }
export interface RunRequest { planId: string; requestId: string; input: { messages: Array<{ role: string; content: string; [key: string]: unknown }> } }
export interface ValidatedPrepareRequest {
  model: Required<ModelPin>; generation: { maxOutputTokens: number | null }; execution: ExecutionRequirements; policy: ExecutionPolicy;
  /** Set only when the host enabled the unreviewed protected route and the request is homomorphic. */
  protected?: true;
  /** Set only when the host enabled the unreviewed secret-shared route and the request is secret-sharing. */
  secretShared?: true;
}
export interface InferenceRoute {
  id: string; schema: 'reploid.inference-route/v1'; shape: RouteShape; selection: RouteSelection; participants: string[];
  backend: string; protocol: string | null; model: Required<ModelPin>; planIdentity: string | null;
  /** Edges routes only: the two requester-held stages that read content. */
  edgeParticipants?: string[];
}
/** Never unknown: a network route that cannot cap its charge is not planned. */
export type ChargeCeiling = { kind: 'capped'; maximum: number; unit: string } | { kind: 'free' };
export declare const FREE: Readonly<{ kind: 'free' }>;
/** A reader. `ids` lists the participants in that role; `when` makes it conditional (two share holders of one stage, if they collude). */
export interface DisclosureReader {
  role: ReaderRole; ids?: string[]; selection?: RouteSelection;
  stages?: Array<{ stage: number; layers: [number, number]; ids: string[] }>;
  when?: { collusion: { sameStage: true; count: number } };
}
/** Who can read one part of the request: a non-empty list of readers, or "unknown". Never an empty list. */
export interface DisclosureSection { readers: DisclosureReader[] | 'unknown'; assumptions: Assumption[]; verified: boolean; check: 'local-route' | 'route-binding-before-release' | null }
export interface SharesHeld { stage: number; layers: [number, number]; shareA: string; shareB: string }
export interface DisclosureExtensions {
  secretSharing?: { protocol: string; collusion: 'non-colluding-share-pairs'; sharesHeldBy: SharesHeld[] };
  homomorphic?: { status: { protection: 'none' | 'target-not-established'; reason: string }; computedBy: string[]; leaks: string[];
    trapOracle: { learns: string[]; trusted: string } | null };
}
export interface Disclosure {
  prompt: DisclosureSection; intermediate: DisclosureSection; answer: DisclosureSection;
  metadata: DisclosureSection & { items: ExecutionMetadata[] };
  trustAssumptions: Assumption[]; review: Review; extensions?: DisclosureExtensions;
}
export interface ExecutionPlan {
  id: string; expiresAt: IsoTime; protection: Protection; routeKind: RouteKind; route: InferenceRoute; maxCharge: ChargeCeiling; disclosure: Disclosure;
}
export interface AdmittedRoute {
  id: string | null; planRouteId: string; policyId: string | null; shape: RouteShape; participants: string[]; backend: string; protocol: string | null;
}
export interface EvidenceClaim { claim: EvidenceClaimCode; by: 'requester'; method: string; value?: unknown }
export interface PrivacyEvidence {
  protection: Protection; routeKind: RouteKind; contentReadBy: { requesterDevice: boolean; participants: string[] } | 'unknown' | null;
  intermediateReadBy?: { participants: string[] } | null; checks: EvidenceClaim[]; notVerified: string[]; review?: Review;
  extensions?: {
    homomorphic?: { status: 'none' | 'target-not-established'; keyHolderReports: { keyEpoch: string | null; secretKeySent: false } | null; uploaded: unknown };
    secretSharing?: { collusion: 'non-colluding-share-pairs'; sharesHeldBy: SharesHeld[] | null; transport: unknown };
  };
}
export interface IntegrityEvidence {
  checks: EvidenceClaim[]; providerReceipt: { digest: string; checkedHere: false } | null; notVerified: string[];
  extensions?: { homomorphic?: { decryptions: { trap: number; real: number } | null }; secretSharing?: { cost: unknown } };
}
/** A typed service-credit record. Fields outside it are dropped and kept only in the digest. */
export interface ServiceCreditRecord {
  kind: 'service-credit'; id?: string; reservationId?: string; status?: string; unit?: string; settledAt?: string;
  charge?: number; charged?: number; released?: number; outputTokens?: number;
}
/** Credits charged or released, as reported. A signed bill is not proof of confidentiality. */
export interface CreditEvidence { record: ServiceCreditRecord | null; digest: string | null; checkedHere: false; notVerified: string[] }
/** `path` names the data channel of the same connection a frame or path change used (0: the connection's own). */
export interface DeliveryEvent { event: 'sent' | 'resent' | 'received' | 'path-opened' | 'path-failed' | 'ice-restart' | 'ice-restarted' | 'ice-restart-failed';
  stage: 'admit' | 'request'; attempt: number; at: number; path?: number }
export interface ExecutionReceipt {
  schema: 'reploid.execution-receipt/v2'; api: 'reploid.inference/v2'; requestId: string; attemptId: string; planId: string;
  status: 'completed' | 'cancelled' | 'failed'; issuedAt: IsoTime; protection: Protection; routeKind: RouteKind;
  /** Requester-observed frame delivery to the recipient, in milliseconds from the first frame; present only when kept. */
  timeline?: DeliveryEvent[];
  requested: { model: Required<ModelPin>; execution: ExecutionRequirements; policyId: string };
  route: { planRouteId: string; admittedRouteId: string | null; policyId: string | null; shape: RouteShape; participants: string[]; backend: string; protocol: string | null; planIdentity: string | null;
    extensions?: { secretSharing?: { stages: Array<{ index: number; layers: [number, number]; shares: [string, string] }> }; homomorphic?: unknown } } | null;
  disclosure: Disclosure;
  /** Privacy checks and their limits, answer integrity, and credits, kept separate. */
  evidence: { privacy: PrivacyEvidence; integrity: IntegrityEvidence; credits: CreditEvidence };
}
export interface InferenceOutput { text: string; finishReason: 'stop' | 'length' | 'unknown'; stopReason: string | null }
export interface InferenceResult {
  requestId: string; attemptId: string; status: 'completed' | 'cancelled' | 'failed'; output: InferenceOutput | null;
  usage: { inputTokens: number; outputTokens: number } | null; settlement: unknown; executionReceipt: ExecutionReceipt;
  error?: { code: string | null; message: string };
}
export type InferenceEvent =
  | { type: 'admitted'; requestId: string; attemptId: string; route: AdmittedRoute }
  | { type: 'output.delta'; requestId: string; attemptId: string; sequence: number; text: string }
  | { type: 'completed' | 'cancelled' | 'failed'; result: InferenceResult };

export declare function validateModelPin(model: unknown): Required<ModelPin>;
export declare const SECRET_SHARED_BACKEND: 'doppler-secret-shared-2party/v1';
export declare function validatePrepareRequest(input: unknown, options?: { protectedProtocol?: string | null; secretShared?: boolean }): ValidatedPrepareRequest;
export declare function validateRunRequest(input: unknown): { planId: string; requestId: string; messages: RunRequest['input']['messages'] };
/** `maxCharge` is required for a network route; a local route is free. A bare { maximum, unit } reads as capped. */
export interface RouteCandidate { shape: RouteShape; backend: string; participants?: string[]; selection?: RouteSelection;
  maxCharge?: ChargeCeiling | { maximum: number; unit: string }; planIdentity?: string | null;
  /** Required for the edges backend: the requester-held first and last stage participants. */
  edgeParticipants?: string[] }
export declare function describeRoute(candidate: RouteCandidate, model: Required<ModelPin>): Promise<{ route: InferenceRoute; maxCharge: ChargeCeiling }>;
export declare function chargeCeiling(value: unknown, shape: RouteShape): ChargeCeiling;
export declare function chargeWithin(current: ChargeCeiling, planned: ChargeCeiling): boolean;
export declare const REQUESTER_DEVICE: Readonly<{ role: 'requester-device' }>;
export declare const CARRIER: Readonly<{ role: 'carrier' }>;
export declare function routeKindOf(route: InferenceRoute): RouteKind;
export declare function routeDisclosure(route: InferenceRoute, execution: ExecutionRequirements): Disclosure;
export declare function assertDisclosureComplete<T extends Disclosure>(disclosure: T): T;
export declare function assertLeakageAllowed(disclosure: Disclosure, allowMetadata: ExecutionMetadata[]): void;
export declare function assertRouteWithinRequirements(route: InferenceRoute, execution: ExecutionRequirements): void;
export declare function admitRoute(plan: ExecutionPlan, policy: ExecutionPolicy, binding: unknown): AdmittedRoute;
export declare function admitLocalRoute(plan: ExecutionPlan): AdmittedRoute;
export declare function readExecutorResult(plan: ExecutionPlan & { generation: { maxOutputTokens: number | null } }, raw: unknown, streamed: string | null): {
  output: InferenceOutput; usage: InferenceResult['usage']; settlement: unknown; providerReceipt: unknown; timeline: DeliveryEvent[] | null;
};
export declare function deliveryTimeline(delivery: unknown): DeliveryEvent[] | null;
export declare function plaintextPrivacyEvidence(plan: ExecutionPlan, admitted: AdmittedRoute | null): PrivacyEvidence;
export declare function creditEvidence(settlement: unknown): Promise<CreditEvidence>;
export declare function executionReceipt(input: { plan: ExecutionPlan & { execution: ExecutionRequirements; policyId: string }; requestId: string; attemptId: string;
  status: ExecutionReceipt['status']; admitted: AdmittedRoute | null; read?: { providerReceipt: unknown; settlement?: unknown; timeline?: DeliveryEvent[] | null } | null;
  timeline?: DeliveryEvent[] | null; settlement?: unknown; privacy?: PrivacyEvidence | null; integrity?: IntegrityEvidence | null;
  routeExtensions?: NonNullable<ExecutionReceipt['route']>['extensions'] | null; at?: number }): Promise<ExecutionReceipt>;
export declare function freezeDeep<T>(value: T): T;
export declare function metadataNames(): ExecutionMetadata[];
