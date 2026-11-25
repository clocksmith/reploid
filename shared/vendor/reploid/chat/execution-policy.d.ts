export interface ExecutionPolicy {
  schema: 'reploid.execution-policy/v2'; computation: 'plaintext' | 'cryptographic' | 'attested';
  recipients: {kind: 'none' | 'named' | 'open'; ids: string[]};
  placement: 'local-only' | 'network-allowed'; collusion: 'none' | 'all-remote' | 'non-colluding-share-pairs';
  leakage: string[]; protocol: string | null; attestation: string | null;
  keyContext: string | null; retention: 'execution-and-recovery' | 'ephemeral';
  publication: false; reuse: false; allowDowngrade: false;
}
export interface ExecutionRoute {
  schema: 'reploid.execution-route/v1'; modelId: string; modelIdentity: string; adapterIdentities: string[];
  backend: string; protocol: null; route: unknown; hops: Array<{ recipient: string; placement: 'local' | 'remote'; disclosure: 'plaintext' | 'activations' }>;
}
export interface ExecutionBinding { schema: 'reploid.execution-binding/v2'; policy: ExecutionPolicy; route: ExecutionRoute; policyId: string; routeId: string }
export interface PrivacyRequest { model: { id: string; identity: string; partition?: unknown; adapters?: Array<{identity: string}> }; privacy?: ExecutionPolicy | null; permissions?: Record<string, unknown> }
export declare const EXECUTION_POLICY_SCHEMA: 'reploid.execution-policy/v2';
export declare const EXECUTION_BINDING_SCHEMA: 'reploid.execution-binding/v2';
export type ExecutionErrorCode = 'CONFIDENTIAL_EXECUTION_UNAVAILABLE' | 'LEAKAGE_NOT_ALLOWED' | 'EXECUTION_PLAN_EXPIRED'
  | 'EXECUTION_PLAN_CHANGED' | 'RESULT_UNVERIFIED' | 'EXECUTION_REQUEST_INVALID' | 'EXECUTION_ROUTE_UNAVAILABLE';
export declare const EXECUTION_ERROR_CODES: Readonly<{ [K in ExecutionErrorCode]: K }>;
export declare function executionError(code: ExecutionErrorCode, message: string): Error & { code: ExecutionErrorCode };
export type ExecutionMetadata = 'model-id' | 'timing' | 'length' | 'access-patterns';
export declare const EXECUTION_METADATA: readonly ExecutionMetadata[];
export interface ExecutionBackend { computation: 'plaintext'; protocol: null; executorsReadContent: boolean; executorsReadActivations?: true; metadata: ExecutionMetadata[] }
export declare const EXECUTION_BACKENDS: Readonly<Record<string, ExecutionBackend>>;
export declare const EDGES_BACKEND: 'doppler-partition-edges/v1';
/** How data is processed. Not ranked: each states who can read what and under which trust assumptions. */
export type Protection = 'plaintext' | 'secret-sharing' | 'homomorphic' | 'attested';
export declare const PROTECTIONS: readonly Protection[];
/** Where and how the model runs. `auto` is any route the protection allows; plans record the concrete one. */
export type RouteKind = 'local' | 'remote' | 'split' | 'split-local-edges';
export type ExecutionRouteValue = RouteKind | 'auto';
export declare const ROUTE_KINDS: readonly RouteKind[];
export declare const EXECUTION_ROUTES: readonly ExecutionRouteValue[];
export declare const PROTECTION_ROUTES: Readonly<{ plaintext: readonly ['local', 'remote', 'split', 'split-local-edges', 'auto'];
  'secret-sharing': readonly ['split', 'auto']; homomorphic: readonly ['remote', 'auto']; attested: readonly ['remote', 'auto'] }>;
export declare const AUTO_ROUTES: Readonly<Record<Protection, readonly RouteKind[]>>;
/** True for route `split-local-edges`. */
export declare function requesterEdges(execution: unknown): boolean;
export declare function executionBackend(backend: string): ExecutionBackend | null;
/** `open` permits discovery, not disclosure. A device that holds one share is still a participant. */
export type Participants = { kind: 'open' } | { kind: 'named'; ids: string[] };
/** Typed per protection so an invalid pair cannot be written; runtime validation refuses anything else. */
export type ExecutionRequirements =
  | { protection: 'plaintext'; route: 'local'; allowMetadata: ExecutionMetadata[] }
  | { protection: 'plaintext'; route: 'remote' | 'split' | 'split-local-edges' | 'auto'; participants: Participants; allowMetadata: ExecutionMetadata[] }
  | { protection: 'secret-sharing'; route: 'split' | 'auto'; participants: Participants; allowMetadata: ExecutionMetadata[] }
  | { protection: 'homomorphic'; route: 'remote' | 'auto'; participants: Participants; allowMetadata: ExecutionMetadata[] }
  | { protection: 'attested'; route: 'remote' | 'auto'; participants: Participants; allowMetadata: ExecutionMetadata[] };
export declare function compileExecutionRequirements(execution: ExecutionRequirements): ExecutionPolicy;
export declare const CONFIDENTIAL_EXECUTION_REVIEW_REASON: 'awaiting independent security review';
export declare function compileProtectedExecutionRequirements(execution: ExecutionRequirements, protocol: string): ExecutionPolicy;
export declare const SECRET_SHARED_PROTOCOL: 'reploid.secret-shared-2party/v1';
export declare const SECRET_SHARED_COLLUSION: 'non-colluding-share-pairs';
export declare const SECRET_SHARED_REVIEW_REASON: string;
export declare const ATTESTED_UNAVAILABLE_REASON: string;
/** Only the inference API calls this, when its host enabled the unreviewed secret-shared route. */
export declare function compileSecretSharedExecutionRequirements(execution: ExecutionRequirements): ExecutionPolicy;
export declare function executionRequirementsFor(policy: ExecutionPolicy): ExecutionRequirements;
export declare function narrowsExecutionPolicy(base: ExecutionPolicy, narrowed: ExecutionPolicy): boolean;
export declare function createExecutionPolicy(overrides?: Partial<ExecutionPolicy>): ExecutionPolicy;
export declare function validateExecutionPolicy(input: unknown): ExecutionPolicy;
export declare function requestExecutionPolicy(request: PrivacyRequest): ExecutionPolicy;
export declare function assertAvailableExecutionPolicy(policy: ExecutionPolicy): ExecutionPolicy;
export declare function plaintextExecutionRoute(request: PrivacyRequest, options?: { recipients?: string[]; local?: boolean; route?: unknown }): ExecutionRoute;
export declare function validateExecutionRoute(policy: ExecutionPolicy, route: ExecutionRoute): ExecutionRoute;
export declare function edgesExecutionRoute(request: PrivacyRequest, options: { route: { stages: Array<{ index: number; participantId: string }> } }): ExecutionRoute;
export declare function tokenContextStages(binding: unknown): number[] | null;
export declare function bindExecutionRoute(request: PrivacyRequest, route: ExecutionRoute): Promise<ExecutionBinding>;
export declare function sameExecutionBinding(a: unknown, b: unknown): boolean;

export declare function partitionPrivacyBinding(request: PrivacyRequest & {privacyBinding?: ExecutionBinding}, recipients: string[], route: unknown): Promise<ExecutionBinding>;

export interface AuxiliaryPath {schema: 'reploid.auxiliary-path/v1'; id: string; version: string; hops: ExecutionRoute['hops']}
export interface AuxiliaryDetail {operation: 'search' | 'extract' | 'check'; id: string; version: string; resourceOrigin?: string; requestId?: string}
export interface AuxiliaryBinding {schema: 'reploid.auxiliary-binding/v2'; policy: ExecutionPolicy; policyId: string; pathId: string; path: AuxiliaryDetail & {schema: 'reploid.auxiliary-path/v1'; complete: boolean; hops: ExecutionRoute['hops']}}
export declare function validatePlaintextHops(policy: ExecutionPolicy, hops: ExecutionRoute['hops'], exposed?: readonly ExecutionMetadata[], options?: { activations?: boolean }): ExecutionRoute['hops'];
export declare function bindAuxiliaryDisclosure(policy: ExecutionPolicy, detail: AuxiliaryDetail, declared: AuxiliaryPath): Promise<AuxiliaryBinding>;
