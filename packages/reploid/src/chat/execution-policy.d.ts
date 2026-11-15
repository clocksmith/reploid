export interface ExecutionPolicy {
  schema: 'reploid.execution-policy/v1'; profile: 'provider-visible' | 'restricted' | 'cryptographic';
  placement: 'local-only' | 'network-allowed'; collusion: 'none' | 'all-remote';
  leakage: string[]; allowedRecipients: string[]; protocol: string | null; attestation: string | null;
  keyContext: string | null; retention: 'execution-and-recovery' | 'ephemeral';
  publication: false; reuse: false; allowDowngrade: false;
}
export interface ExecutionRoute {
  schema: 'reploid.execution-route/v1'; modelId: string; modelIdentity: string; adapterIdentities: string[];
  backend: string; protocol: null; route: unknown; hops: Array<{ recipient: string; placement: 'local' | 'remote'; disclosure: 'plaintext' }>;
}
export interface ExecutionBinding { schema: 'reploid.execution-binding/v1'; policy: ExecutionPolicy; route: ExecutionRoute; policyId: string; routeId: string }
export interface PrivacyRequest { model: { id: string; identity: string; partition?: unknown; adapters?: Array<{identity: string}> }; privacy?: ExecutionPolicy | null; permissions?: Record<string, unknown> }
export declare function createExecutionPolicy(profile?: ExecutionPolicy['profile'], overrides?: Partial<ExecutionPolicy>): ExecutionPolicy;
export declare function validateExecutionPolicy(input: unknown): ExecutionPolicy;
export declare function requestExecutionPolicy(request: PrivacyRequest): ExecutionPolicy;
export declare function assertAvailableExecutionPolicy(policy: ExecutionPolicy): ExecutionPolicy;
export declare function plaintextExecutionRoute(request: PrivacyRequest, options?: { recipients?: string[]; local?: boolean; route?: unknown }): ExecutionRoute;
export declare function validateExecutionRoute(policy: ExecutionPolicy, route: ExecutionRoute): ExecutionRoute;
export declare function bindExecutionRoute(request: PrivacyRequest, route: ExecutionRoute): Promise<ExecutionBinding>;
export declare function executionPrivacyReceipt(binding: ExecutionBinding): Record<string, unknown>;
export declare function sameExecutionBinding(a: unknown, b: unknown): boolean;

export declare function partitionPrivacyBinding(request: PrivacyRequest & {privacyBinding?: ExecutionBinding}, recipients: string[], route: unknown): Promise<ExecutionBinding | null>;
