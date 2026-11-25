/** Secret-shared split execution: two-party additive shares per stage, non-colluding share operators. Off by default. */
export declare const SECRET_SHARED_PROTOCOL: 'reploid.secret-shared-2party/v1';
export declare const SECRET_SHARED_BACKEND: 'doppler-secret-shared-2party/v1';
export declare const SECRET_SHARED_EXECUTION_KIND: 'reploid.secret-shared-execution/v1';
export declare const SECRET_SHARED_STATUS: Readonly<{ available: false; reason: string }>;
export declare const SECRET_SHARED_METADATA: readonly ['model-id', 'timing', 'length'];
export interface SecretSharedStage { index: number; layers: [number, number]; shares: [string, string] }
export interface SecretSharedRoute {
  id: string; shape: 'split'; selection: 'all'; backend: 'doppler-secret-shared-2party/v1'; protocol: 'reploid.secret-shared-2party/v1';
  model: { id: string; identity: string; adapterIdentities: string[] }; planIdentity?: string; participants: string[];
  secretShared: { stages: SecretSharedStage[]; [key: string]: unknown };
}
export interface SecretSharedDisclosures {
  contentReadableBy: { requesterDevice: true; participants: []; selection: 'all'; target: true };
  executorsReadContent: false; executorsReadActivations: false;
  sharesHeldBy: { stage: number; layers: [number, number]; shareA: string; shareB: string }[];
  collusion: { assumption: 'non-colluding-share-pairs'; ifBroken: { together: string[]; read: string }[]; otherCoalitions: string };
  metadata: string[]; leaks: string[]; review: { available: false; reason: string }; statement: string;
}
export interface SecretSharedExecuteJob {
  plan: unknown; pinned: unknown; requestId: string; attemptId: string; messages: { role: string; content: string }[];
  generation: { maxOutputTokens: number | null }; signal: AbortSignal;
  onAdmitted(binding: { bindingDigest: string }): void; onDelta(text: string): void;
}
export interface SecretSharedOutcome {
  text: string; stopReason: string | null; usage: { inputTokens: number; outputTokens: number } | null; settlement?: unknown; evidence?: unknown;
}
export interface SecretSharedExecutionPorts {
  resolve(request: unknown, options: { signal?: AbortSignal }): Promise<{ route: SecretSharedRoute; maxCharge?: { unit: string; maximum: number } | null; pinned?: unknown }>;
  execute(job: SecretSharedExecuteJob): Promise<SecretSharedOutcome>;
}
export interface SecretSharedExecution { kind: 'reploid.secret-shared-execution/v1'; resolve: SecretSharedExecutionPorts['resolve']; execute: SecretSharedExecutionPorts['execute'] }
export declare function validateSecretSharedRoute(route: unknown): SecretSharedRoute;
export declare function secretSharedDisclosures(route: SecretSharedRoute): SecretSharedDisclosures;
export declare function secretSharedEvidence(input: { plan: unknown; admitted: unknown; evidence?: unknown; error?: unknown }): unknown;
export declare function createSecretSharedExecution(ports: SecretSharedExecutionPorts): SecretSharedExecution;
