import type { DeviceQueueState } from './device-lane.js';
import type { AdapterCatalogModel, ModelAdapterSelection } from './model-adapter.js';
export interface ResidentModel extends AdapterCatalogModel { id: string; [key: string]: unknown }
export interface ResidentIdentity { modelIdentity: string; [key: string]: unknown }
export interface ResidentResult {
  completion?: { generatedTokenCount?: number }; timing?: { generatedTokenCount?: number }; [key: string]: unknown;
}
export interface ResidentGenerationControl {
  signal: AbortSignal; adapters?: ModelAdapterSelection[]; maxOutputTokens?: number; contextOwner?: string; contextId?: string;
}
export interface ResidentProviderPort {
  getIdentity(): ResidentIdentity; getHardware(): unknown; getContextCacheStats?(): unknown; isReady(): boolean;
  reset(): Promise<void>; prepareAdapters(adapters: ModelAdapterSelection[]): Promise<string[]>;
  generate(messages: unknown[], onUpdate: (addition: string) => unknown, control: ResidentGenerationControl): Promise<ResidentResult>;
  close(): void;
}
export interface ResidentExecutionState {
  phase: string; error: string | null; progress: unknown; completed: number;
  production: { outputTokens: number; missingTokenCounts: number }; modelId: string; modelIdentity: string | null;
  adapterIdentities: string[]; hardware: unknown; deviceQueue: DeviceQueueState; contextCache: unknown; ready: boolean;
}
export interface ResidentExecutionOptions {
  service: { close(scope: string): unknown }; model: ResidentModel; generation: Record<string, unknown>; maxOutcomeCharacters: number;
  scope?: string; onChange?: (state: ResidentExecutionState) => void;
  onComplete?: (receipt: { modelId: string; modelIdentity: string; outputTokens: number | null }) => void;
  resolveAdapter?: (selection: ModelAdapterSelection, options: { signal: AbortSignal }) => Promise<unknown>;
  resolveSource?: (model: ResidentModel, options: { signal: AbortSignal; onProgress(progress: unknown): void }) => Promise<unknown>;
  source?: unknown; loadOptions?: Record<string, unknown>;
  openProvider(options: { model: ResidentModel; service: ResidentExecutionOptions['service']; scope: string; signal: AbortSignal;
    generation: Record<string, unknown>; maxOutcomeCharacters: number; resolveAdapter?: ResidentExecutionOptions['resolveAdapter'];
    source?: unknown; loadOptions?: Record<string, unknown>; onProgress(progress: unknown): void }): Promise<ResidentProviderPort>;
  /** Host owns storage policy. Release only after scoped runtime cleanup succeeds. */
  acquireStorage(options: { signal: AbortSignal }): Promise<() => void | Promise<void>>;
}
export interface ResidentExecution {
  getState(): ResidentExecutionState; prepare(): Promise<ResidentExecutionState>;
  generate(messages: unknown[], onUpdate: (addition: string) => unknown, control: ResidentGenerationControl): Promise<ResidentResult>;
  close(): Promise<void>;
}
export function createResidentExecution(options: ResidentExecutionOptions): ResidentExecution;
