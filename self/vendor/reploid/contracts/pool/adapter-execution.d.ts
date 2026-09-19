import type { JsonValue } from './pack-operation-adapters.js';
export type AdapterJsonObject = Readonly<Record<string, JsonValue>>;
export interface AdapterExecutionPolicy {
  readonly schema: 'reploid.pool.adapter-execution-policy/v1';
  readonly allowedFormats: readonly string[];
  readonly maxAdaptersPerJob: number;
  readonly maxAdapterBytes: number;
  readonly maxTotalAdapterBytes: number;
  readonly fetchBeforeExecute: boolean;
  readonly combinations: { readonly allowed: false; readonly order: 'request'; readonly semantics: 'single' };
  readonly defaultAdapterSet: readonly [];
  readonly storage: { readonly databaseName: string; readonly maxCacheBytes: number; readonly maxConcurrentChunks: number };
}
export type ExecutionAdapter = AdapterJsonObject & {
  readonly identity: string;
  readonly baseModelIdentity: string;
  readonly publication: AdapterJsonObject;
};
export type ExecutionAdapterArtifact = AdapterJsonObject & { readonly artifactId: string; readonly role: 'lora-weights';
  readonly path: string; readonly hash: string; readonly sizeBytes: number };
export type DopplerExecutionAdapter = AdapterJsonObject & { readonly schema: 'doppler.pack-adapter/v1' | 'doppler.capsule-adapter/v1'; readonly identity: string;
  readonly artifact: ExecutionAdapterArtifact; readonly manifest: AdapterJsonObject; readonly baseModel: AdapterJsonObject };
export function resolveAdapterExecutionPolicy(input: unknown): AdapterExecutionPolicy;
export function normalizeExecutionAdapterSet(input: unknown, context: { model: AdapterJsonObject; policy: AdapterExecutionPolicy }): Promise<readonly ExecutionAdapter[]>;
export function executionAdapterArtifact(entry: ExecutionAdapter): ExecutionAdapterArtifact;
export function executionAdapterArtifactSet(entry: ExecutionAdapter): AdapterJsonObject;
export function dopplerExecutionAdapterSet(entries: readonly ExecutionAdapter[], model: AdapterJsonObject): readonly DopplerExecutionAdapter[];
