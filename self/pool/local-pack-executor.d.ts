import type { PackOperationEvent, PackOperationRequest, PackOperationResult, PackOperationSession } from './pack-operation.js';
import type { PackOperationRegistry, JsonValue } from './pack-operation-adapters.js';
import type { ExecutionAdapter } from './adapter-execution.js';
import type { PreparedPeerAdapters } from './peer-adapter-execution.js';
type JsonObject = Readonly<Record<string, JsonValue>>;
export interface LocalPackRun {
  model: JsonObject; input: JsonObject; options?: JsonObject;
  assignment?: JsonObject | null; limits: PackOperationRequest['limits']; signal?: AbortSignal | null;
  adapterSet?: readonly ExecutionAdapter[];
  adapterArtifactStore?: PreparedPeerAdapters['artifactStore'] | null;
  assertAdaptersCurrent?: (() => void | Promise<void>) | null;
  onPartial?: ((event: PackOperationEvent) => void | Promise<void>) | null;
  beforeExecute?: (() => void | Promise<void>) | null;
}
export interface LocalPackExecutor {
  run(request: LocalPackRun): Promise<PackOperationResult>;
  getState(): { active: boolean; draining: boolean; disposed: boolean; retainedModelId: string | null };
  cancel(): void;
  close(): Promise<void>;
}
export function createLocalPackExecutor(options?: {
  service?: { prepare(): Promise<{ version: string }>; close(scope: string): Promise<void>;
    openPack(options: { scope: string; source: string; options: object }): Promise<PackOperationSession> };
  scope?: string; registry?: PackOperationRegistry;
  prepareRelease?: (options: { model: JsonObject }) => Promise<{ options: object; close(): void;
    assertCurrent(session: PackOperationSession): Promise<void>; checkTime?(session: PackOperationSession): void }>;
}): LocalPackExecutor;
