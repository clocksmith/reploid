import type { ExecutionPolicy, Protection, ExecutionRequirements, ExecutionErrorCode, ExecutionRouteValue, Participants } from '../chat/execution-policy.js';
import type { ExecutionPlan, PrepareRequest, RunRequest, RouteCandidate, InferenceEvent, InferenceResult, AdmittedRoute, ValidatedPrepareRequest, ModelPin, InferenceRoute } from './contract.js';
export * from './contract.js';
export * from './protections.js';
export { PROTECTIONS, ROUTE_KINDS, EXECUTION_ROUTES, PROTECTION_ROUTES, AUTO_ROUTES } from '../chat/execution-policy.js';
export { createProtectedExecution, PROTECTED_EXECUTION_STATUS, protectedDisclosure } from './protected.js';
import type { ProtectedExecution } from './protected.js';
export { createSecretSharedExecution, SECRET_SHARED_STATUS, secretSharedDisclosure } from './secret-shared.js';
import type { SecretSharedExecution } from './secret-shared.js';

export interface InferenceJob {
  plan: ExecutionPlan & { execution: PrepareRequest['execution']; generation: { maxOutputTokens: number | null }; policyId: string };
  policy: ExecutionPolicy;
  request: { requestId: string; attemptId: string; messages: RunRequest['input']['messages']; generation: { maxOutputTokens: number | null } };
}
export interface InferenceControls {
  signal: AbortSignal;
  requestApproval(preview: { privacyBinding?: unknown; [key: string]: unknown }): Promise<boolean>;
  onDelta(envelope: { text: string; [key: string]: unknown }): unknown;
  [key: string]: unknown;
}
export interface InferencePorts {
  resolveRoute(request: ValidatedPrepareRequest, options: { signal?: AbortSignal; context?: unknown }): RouteCandidate | Promise<RouteCandidate>;
  execute(job: InferenceJob, controls: InferenceControls, context?: unknown): Promise<unknown>;
  now?: () => number; planTtlMs?: number; randomId?: () => string;
  /** Used only with `unreviewedProtectedExecution: true`; both are off by default. */
  protectedExecution?: ProtectedExecution | null;
  unreviewedProtectedExecution?: boolean;
  /** Used only with `unreviewedSecretSharedExecution: true`; both are off by default. */
  secretSharedExecution?: SecretSharedExecution | null;
  unreviewedSecretSharedExecution?: boolean;
  /** Device identities bound to this requester. A split with requester-held edges is refused unless both edges are among them. */
  requesterDevices?: ((options: { signal?: AbortSignal; context?: unknown }) => string[] | Promise<string[]>) | null;
  /** A measured latency for a protection on a route, if one exists. With none, listCapabilities shows no latency. */
  latencyEstimate?: ((input: { protection: Protection; model: Required<ModelPin>; route: InferenceRoute }) => LatencyEstimate | null | Promise<LatencyEstimate | null>) | null;
}
/** Shown only from a relevant measurement; `measuredAt` is an IsoTime. */
export interface LatencyEstimate { milliseconds: number; measuredAt: string; source: string }
export interface CapabilityConstraints { participants?: Participants; allowMetadata?: ExecutionRequirements['allowMetadata'] }
export type CapabilityStatus = 'available' | 'unavailable' | 'unknown';
export interface RouteCapability {
  route: ExecutionRouteValue; status: CapabilityStatus; reason: string; code: ExecutionErrorCode | null; checked: string[]; checkedAt: string; latency?: LatencyEstimate;
}
/** One row per protection: its best route status, and every route it allows with that route's availability. */
export interface ProtectionCapability {
  protection: Protection; status: CapabilityStatus; reason: string; code: ExecutionErrorCode | null; checked: string[]; checkedAt: string;
  routes: RouteCapability[];
}
/** Advisory only: never permission to send. prepare and run check everything again. */
export interface Capabilities { advisory: true; checkedAt: string; capabilities: ProtectionCapability[] }
export interface InferenceRun {
  requestId: string; attemptId: string; planId: string;
  events: AsyncIterable<InferenceEvent>; result: Promise<InferenceResult>; cancel(reason?: unknown): void;
}
export interface Inference {
  listCapabilities(input?: { model?: ModelPin; constraints?: CapabilityConstraints }, options?: { signal?: AbortSignal; context?: unknown }): Promise<Capabilities>;
  prepare(request: PrepareRequest, options?: { signal?: AbortSignal; context?: unknown }): Promise<ExecutionPlan>;
  run(request: RunRequest, options?: { signal?: AbortSignal; approve?: ((preview: unknown, route: AdmittedRoute) => boolean | Promise<boolean>) | null; context?: unknown }): Promise<InferenceRun>;
}
export declare function createInference(ports: InferencePorts): Inference;
