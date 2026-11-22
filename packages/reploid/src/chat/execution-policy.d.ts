export interface ExecutionPolicy {
  schema: 'reploid.execution-policy/v2'; computation: 'plaintext' | 'cryptographic' | 'attested';
  recipients: {kind: 'none' | 'named' | 'open'; ids: string[]};
  placement: 'local-only' | 'network-allowed'; collusion: 'none' | 'all-remote';
  leakage: string[]; protocol: string | null; attestation: string | null;
  keyContext: string | null; retention: 'execution-and-recovery' | 'ephemeral';
  publication: false; reuse: false; allowDowngrade: false;
}
export interface ExecutionRoute {
  schema: 'reploid.execution-route/v1'; modelId: string; modelIdentity: string; adapterIdentities: string[];
  backend: string; protocol: null; route: unknown; hops: Array<{ recipient: string; placement: 'local' | 'remote'; disclosure: 'plaintext' }>;
}
export interface ExecutionBinding { schema: 'reploid.execution-binding/v2'; policy: ExecutionPolicy; route: ExecutionRoute; policyId: string; routeId: string }
export interface PrivacyRequest { model: { id: string; identity: string; partition?: unknown; adapters?: Array<{identity: string}> }; privacy?: ExecutionPolicy | null; permissions?: Record<string, unknown> }
export declare const EXECUTION_POLICY_SCHEMA: 'reploid.execution-policy/v2';
export declare const EXECUTION_BINDING_SCHEMA: 'reploid.execution-binding/v2';
export declare function createExecutionPolicy(overrides?: Partial<ExecutionPolicy>): ExecutionPolicy;
export declare function validateExecutionPolicy(input: unknown): ExecutionPolicy;
export declare function requestExecutionPolicy(request: PrivacyRequest): ExecutionPolicy;
export declare function assertAvailableExecutionPolicy(policy: ExecutionPolicy): ExecutionPolicy;
export declare function plaintextExecutionRoute(request: PrivacyRequest, options?: { recipients?: string[]; local?: boolean; route?: unknown }): ExecutionRoute;
export declare function validateExecutionRoute(policy: ExecutionPolicy, route: ExecutionRoute): ExecutionRoute;
export declare function bindExecutionRoute(request: PrivacyRequest, route: ExecutionRoute): Promise<ExecutionBinding>;
export declare function executionPrivacyReceipt(binding: ExecutionBinding): Record<string, unknown>;
export declare function sameExecutionBinding(a: unknown, b: unknown): boolean;

export declare function partitionPrivacyBinding(request: PrivacyRequest & {privacyBinding?: ExecutionBinding}, recipients: string[], route: unknown): Promise<ExecutionBinding>;

export interface AuxiliaryPath {schema: 'reploid.auxiliary-path/v1'; id: string; version: string; hops: ExecutionRoute['hops']}
export interface AuxiliaryDetail {operation: 'search' | 'extract' | 'check'; id: string; version: string; resourceOrigin?: string; requestId?: string}
export interface AuxiliaryBinding {schema: 'reploid.auxiliary-binding/v2'; policy: ExecutionPolicy; policyId: string; pathId: string; path: AuxiliaryDetail & {schema: 'reploid.auxiliary-path/v1'; complete: boolean; hops: ExecutionRoute['hops']}}
export declare function validatePlaintextHops(policy: ExecutionPolicy, hops: ExecutionRoute['hops']): ExecutionRoute['hops'];
export declare function bindAuxiliaryDisclosure(policy: ExecutionPolicy, detail: AuxiliaryDetail, declared: AuxiliaryPath): Promise<AuxiliaryBinding>;
