import type { DopplerExecutionAdapter, ExecutionAdapterArtifact } from './adapter-execution.js';
import type { JsonValue, PackOperationRegistry } from './pack-operation-adapters.js';
export type { PackOperationDefinition } from './pack-operation-adapters.js';
export interface PackOperationRequest {
  readonly schema: 'doppler.pack-operation-request/v1' | 'doppler.capsule-operation-request/v1';
  readonly operation: { readonly name: string; readonly version: number };
  readonly input: Readonly<Record<string, JsonValue>>;
  readonly options: Readonly<Record<string, JsonValue>>;
  readonly adapterSet?: readonly DopplerExecutionAdapter[];
  readonly assignment: Readonly<Record<string, JsonValue>> | null;
  readonly limits: { readonly maxInputBytes: number; readonly maxOutputBytes: number; readonly deadlineAt: number };
}
export interface PackOperationEventBase {
  readonly schema: 'doppler.pack-operation-event/v1' | 'doppler.capsule-operation-event/v1';
  readonly operation: PackOperationRequest['operation'];
  readonly requestHash: string;
  readonly assignmentHash: string | null;
  readonly eventIndex: number;
  readonly previousEventDigest: string | null;
  readonly eventDigest: string;
  readonly output: JsonValue;
}
export type PackOperationEvent = PackOperationEventBase & (
  { readonly status: 'partial'; readonly delta?: JsonValue; readonly receipt?: never }
  | { readonly status: 'completed'; readonly receipt: Readonly<Record<string, JsonValue>> }
);
export interface PackOperationResult {
  readonly request: PackOperationRequest;
  readonly output: JsonValue;
  readonly receipt: Readonly<Record<string, JsonValue>>;
  readonly completion: Extract<PackOperationEvent, { readonly status: 'completed' }>;
  readonly eventCount: number;
  readonly finalEventDigest: string;
}
export interface PackOperationSession {
  readonly [key: string]: unknown;
  executeOperation(request: PackOperationRequest, options: { signal: AbortSignal | null; adapterArtifactStore?: { readArtifact(artifact: ExecutionAdapterArtifact): Promise<Uint8Array> } | null }): AsyncIterable<PackOperationEvent>;
}
export function snapshotPackOperationData(value: unknown, depth?: number): JsonValue;
export function assertPackOperationRequest(binding: Readonly<Record<string, JsonValue>>, request: PackOperationRequest, registry?: PackOperationRegistry): void;
export function assertPackOperationReceipt(binding: Readonly<Record<string, JsonValue>>, receipt: Readonly<Record<string, JsonValue>>,
  options: { request: PackOperationRequest; output: JsonValue; runtimeVersion: string }): Promise<void>;
export function assertPackOperationEvent(options: { binding: Readonly<Record<string, JsonValue>>; request: PackOperationRequest;
  runtimeVersion: string; event: PackOperationEvent; eventIndex: number; previousEventDigest: string | null; registry?: PackOperationRegistry }): Promise<void>;
export function runPackOperation(options: { binding: Readonly<Record<string, JsonValue>>; session: PackOperationSession; request: PackOperationRequest;
  runtimeVersion: string; registry?: PackOperationRegistry; signal?: AbortSignal | null; onPartial?: ((event: PackOperationEvent) => void | Promise<void>) | null;
  adapterArtifactStore?: { readArtifact(artifact: ExecutionAdapterArtifact): Promise<Uint8Array> } | null;
  beforeExecute?: (() => void | Promise<void>) | null; assertCurrent?: () => void | Promise<void> }): Promise<PackOperationResult>;
export function assessPackOperation(options: { execution: PackOperationResult; reference: JsonValue; policy: Readonly<Record<string, JsonValue>>;
  registry?: PackOperationRegistry }): Promise<Readonly<{ schema: 'poolday.operation-assessment/v1'; accepted: boolean; policyDigest: string;
    receiptDigest: string; claim: 'bounded-reference-comparison' }>>;
