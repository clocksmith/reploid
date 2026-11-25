import type { ExecutionPolicy, ExecutionRequirements, ExecutionErrorCode, ExecutionMetadata } from '../chat/execution-policy.js';
export { EXECUTION_ERROR_CODES, executionError } from '../chat/execution-policy.js';
export type { ExecutionRequirements, ExecutionErrorCode, ExecutionMetadata } from '../chat/execution-policy.js';

export declare const INFERENCE_API_VERSION: 'reploid.inference/v1';
export declare const EXECUTION_ROUTE_SCHEMA: 'reploid.inference-route/v1';
export declare const EXECUTION_RECEIPT_SCHEMA: 'reploid.execution-receipt/v1';
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
  /** Set only when the host enabled the unreviewed protected route and the request is requester-only. */
  protected?: true;
}
export interface InferenceRoute {
  id: string; schema: 'reploid.inference-route/v1'; shape: RouteShape; selection: RouteSelection; participants: string[];
  backend: string; protocol: string | null; model: Required<ModelPin>; planIdentity: string | null;
  /** Edges routes only: the two requester-held stages that read content. */
  edgeParticipants?: string[];
}
export interface ChargeCeiling { maximum: number; unit: string }
export interface Disclosures {
  contentReadableBy: { requesterDevice: boolean; participants: string[]; selection: RouteSelection };
  /** Edges routes only: the stages that read intermediate activations and never content. */
  activationsReadableBy?: { participants: string[]; selection: 'all' };
  executorsReadContent: boolean; metadata: ExecutionMetadata[]; statement: string;
}
export interface ExecutionPlan { id: string; expiresAt: number; route: InferenceRoute; maxCharge: ChargeCeiling | null; disclosures: Disclosures }
export interface AdmittedRoute {
  id: string | null; planRouteId: string; policyId: string | null; shape: RouteShape; participants: string[]; backend: string; protocol: string | null;
}
export interface EvidenceClaim { claim: string; by: 'requester'; method: string; value?: unknown }
/** `path` names the data channel of the same connection a frame or path change used (0: the connection's own). */
export interface DeliveryEvent { event: 'sent' | 'resent' | 'received' | 'path-opened' | 'path-failed' | 'ice-restart' | 'ice-restarted' | 'ice-restart-failed';
  stage: 'admit' | 'request'; attempt: number; at: number; path?: number }
export interface ExecutionReceipt {
  schema: 'reploid.execution-receipt/v1'; api: 'reploid.inference/v1'; requestId: string; attemptId: string; planId: string;
  status: 'completed' | 'cancelled' | 'failed';
  /** Requester-observed frame delivery to the recipient; present only when the route kept a record. */
  timeline?: DeliveryEvent[];
  requested: { model: Required<ModelPin>; execution: ExecutionRequirements; policyId: string };
  route: { planRouteId: string; admittedRouteId: string | null; policyId: string | null; shape: RouteShape; participants: string[]; backend: string; protocol: string | null; planIdentity: string | null } | null;
  disclosures: Disclosures;
  evidence: {
    confidentiality: { mode: 'executor-readable' | 'requester-edges'; contentReadBy: { requesterDevice: boolean; participants: string[] } | null;
      activationsReadBy?: { participants: string[] } | null; verified: EvidenceClaim[]; notVerified: string[] };
    integrity: { verified: EvidenceClaim[]; providerReceipt: { digest: string; checkedHere: false } | null; notVerified: string[] };
  };
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
export interface RouteCandidate { shape: RouteShape; backend: string; participants?: string[]; selection?: RouteSelection; maxCharge?: ChargeCeiling | null; planIdentity?: string | null;
  /** Required for the edges backend: the requester-held first and last stage participants. */
  edgeParticipants?: string[] }
export declare function describeRoute(candidate: RouteCandidate, model: Required<ModelPin>): Promise<{ route: InferenceRoute; maxCharge: ChargeCeiling | null }>;
export declare function routeDisclosures(route: InferenceRoute, execution: ExecutionRequirements): Disclosures;
export declare function assertLeakageAllowed(disclosures: Disclosures, allowMetadata: ExecutionMetadata[]): void;
export declare function assertRouteWithinRequirements(route: InferenceRoute, execution: ExecutionRequirements): void;
export declare function admitRoute(plan: ExecutionPlan, policy: ExecutionPolicy, binding: unknown): AdmittedRoute;
export declare function admitLocalRoute(plan: ExecutionPlan): AdmittedRoute;
export declare function readExecutorResult(plan: ExecutionPlan & { generation: { maxOutputTokens: number | null } }, raw: unknown, streamed: string | null): {
  output: InferenceOutput; usage: InferenceResult['usage']; settlement: unknown; providerReceipt: unknown; timeline: DeliveryEvent[] | null;
};
export declare function deliveryTimeline(delivery: unknown): DeliveryEvent[] | null;
export declare function executionReceipt(input: { plan: ExecutionPlan & { execution: ExecutionRequirements; policyId: string }; requestId: string; attemptId: string;
  status: ExecutionReceipt['status']; admitted: AdmittedRoute | null; read?: { providerReceipt: unknown; timeline?: DeliveryEvent[] | null } | null;
  timeline?: DeliveryEvent[] | null }): Promise<ExecutionReceipt>;
export declare function freezeDeep<T>(value: T): T;
export declare function metadataNames(): ExecutionMetadata[];
