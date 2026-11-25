import type { ExecutionPolicy } from '../chat/execution-policy.js';
import type { ExecutionPlan, PrepareRequest, RunRequest, RouteCandidate, InferenceEvent, InferenceResult, AdmittedRoute, ValidatedPrepareRequest } from './contract.js';
export * from './contract.js';
export { createProtectedExecution, PROTECTED_EXECUTION_STATUS, protectedDisclosures } from './protected.js';
export { createAttestedExecution, ATTESTED_EXECUTION_STATUS, attestedDisclosures, ATTESTED_TRUST_BOUNDARY } from './attested/execution.js';
export { connectWebSocketFrames } from './attested/websocket-channel.js';
import type { ProtectedExecution } from './protected.js';
import type { AttestedExecution } from './attested/execution.js';

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
  /** Used only with `unreviewedAttestedExecution: true`; both are off by default. */
  attestedExecution?: AttestedExecution | null;
  unreviewedAttestedExecution?: boolean;
}
export interface InferenceRun {
  requestId: string; attemptId: string; planId: string;
  events: AsyncIterable<InferenceEvent>; result: Promise<InferenceResult>; cancel(reason?: unknown): void;
}
export interface Inference {
  prepare(request: PrepareRequest, options?: { signal?: AbortSignal; context?: unknown }): Promise<ExecutionPlan>;
  run(request: RunRequest, options?: { signal?: AbortSignal; approve?: ((preview: unknown, route: AdmittedRoute) => boolean | Promise<boolean>) | null; context?: unknown }): Promise<InferenceRun>;
}
export declare function createInference(ports: InferencePorts): Inference;
