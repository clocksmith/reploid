export interface ExecutableModelRoots {
  readonly semanticRoot: string;
  readonly envelopeDigest: string;
  readonly artifactClosureDigest: string;
}
export type ExecutableModelIdentity = ExecutableModelRoots & (
  { readonly schema: 'doppler.pack/v2' | 'doppler.pack/v3'; readonly packId: string }
  | { readonly schema: 'doppler.capsule/v2' | 'doppler.capsule/v3'; readonly capsuleId: string }
);
export interface ExecutableModelArtifact {
  readonly artifactId: string; readonly hash: string; readonly sizeBytes: number;
  readonly role: string; readonly path: string;
}
export type ExecutableModelBinding = ExecutableModelIdentity & {
  readonly requiredOperation: string;
  readonly acceptedTargetPlanDigests: readonly string[];
  readonly artifacts: readonly ExecutableModelArtifact[];
};
export function hashDopplerEvidence(value: unknown): Promise<string>;
export function validateExecutablePack(binding: unknown): { ok: boolean; reasons: string[] };
export function executablePacksMatch(left: unknown, right: unknown): boolean;
export function assertPackExecutionEvidence(binding: ExecutableModelBinding, evidence: unknown): Promise<void>;
export function assertPackSession(binding: ExecutableModelBinding, session: unknown): Promise<void>;
export function assertPackReceipt(binding: ExecutableModelBinding, receipt: Readonly<Record<string, unknown>>, control?: {
  assignment?: Readonly<Record<string, unknown>> | null;
  sequence?: string; options?: Readonly<Record<string, unknown>>; result?: Readonly<Record<string, unknown>>;
}): Promise<void>;
