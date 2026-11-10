/** A loaded public Doppler session or handle. Only its public methods are called. */
export type DopplerPublicSession = Record<string, any>;

export interface DopplerSessionIdentity {
  modelId: string | null;
  modelHash: string | null;
  manifestHash: string | null;
  runtimeManifestHash: string | null;
  declaredManifestHash: string | null;
  artifactIdentity: Record<string, unknown> | null;
}

export interface DopplerModelDescriptor {
  id?: string; modelId?: string; hash?: string; modelHash?: string;
  manifestHash?: string; manifestByteHash?: string; artifactIdentity?: Record<string, unknown>;
}

export interface DopplerSamplingOptions {
  maxTokens?: number; temperature?: number; topP?: number; topK?: number; useSpeculative: boolean;
  stopTokens?: number[]; stopSequences?: string[]; useChatTemplate?: boolean;
}

export interface DopplerGenerationConfig {
  maxTokens?: number; maxOutputTokens?: number; temperature?: number; topP?: number; topK?: number;
  useSpeculative?: boolean; stopTokens?: unknown[]; stopSequences?: unknown[]; mode?: string; useChatTemplate?: boolean;
  [key: string]: unknown;
}

export interface DopplerEvidenceField { field: string; expected: unknown; actual: unknown; matched: boolean }
export interface DopplerGenerationEvidenceComparison {
  schema: 'reploid.doppler_generation_evidence_comparison/v1'; verified: true; evidenceSchema: string;
  transcriptHash: string; generationConfigHash: string; runtimeProfileHash: string; backendIdentityHash: string;
  fields: DopplerEvidenceField[];
}

export function resolveDopplerRuntime(module: unknown): Record<string, any> | null;
export function createDopplerModuleLoader<T extends object = Record<string, any>>(options: {
  candidates(): unknown[];
  importModule(specifier: unknown): Promise<T>;
  prepare?(): void;
  fallback?(): T | null | undefined;
  injectedLabel?: string;
  unavailableMessage?: string;
}): { load(): Promise<T>; reset(): void };
export function dopplerGenerateMethod(session: DopplerPublicSession | null | undefined): 'generateWithEvidence' | 'generate' | 'generateText' | 'run' | null;
export function dopplerEmbedMethod(session: DopplerPublicSession | null | undefined): 'embed' | 'embedText' | 'run' | null;
export function readDopplerSessionIdentity(session: DopplerPublicSession | null | undefined): Promise<DopplerSessionIdentity>;
export function assertDopplerSessionIdentity(session: DopplerPublicSession, descriptor?: DopplerModelDescriptor,
  options?: { packIdentity?: { semanticRoot: string; envelopeDigest: string } }): Promise<void>;
export function toDopplerSamplingOptions(generationConfig?: DopplerGenerationConfig): DopplerSamplingOptions;
export function generateWithDopplerSession(session: DopplerPublicSession, prompt: unknown,
  generationConfig?: DopplerGenerationConfig, assignment?: unknown): Promise<any>;
export function embedWithDopplerSession(session: DopplerPublicSession, prompt: unknown, assignment?: unknown,
  options?: { workload?: string }): Promise<any>;
export function streamDopplerText(session: DopplerPublicSession, input: unknown, options?: Record<string, unknown>): AsyncGenerator<string, void, void>;
export function readDopplerOutputText(result: unknown): string;
export function readDopplerTokenIds(result: unknown): number[];
export function readDopplerTokenCounts(result: unknown, tokenIds: number[]): { input: number; output: number };
export function readDopplerEmbedding(result: unknown): number[];
export function verifyDopplerGenerationEvidence(input: {
  result: unknown; generationConfig?: DopplerGenerationConfig; modelId?: string | null; manifestHash?: string | null;
}): Promise<DopplerGenerationEvidenceComparison | null>;
export function resetDopplerSession(session: DopplerPublicSession | null | undefined): Promise<void>;
export function cancelDopplerSession(session: DopplerPublicSession | null | undefined, reason: unknown):
  Promise<{ requested: boolean; method: 'abort' | 'cancel' | null }>;
