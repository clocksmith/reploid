import type { AdapterExecutionPolicy, AdapterJsonObject, ExecutionAdapter, ExecutionAdapterArtifact } from './adapter-execution.js';
import type { CustodyPorts, CustodyCheckpoints } from './peer-pack-custody.js';
export interface PreparedPeerAdapters {
  readonly adapterSet: readonly ExecutionAdapter[];
  readonly receipts: readonly AdapterJsonObject[];
  readonly artifactStore: { readArtifact(artifact: ExecutionAdapterArtifact): Promise<Uint8Array> };
  assertCurrent(): Promise<void>;
  close(): void;
}
export interface PeerAdapterResolver {
  assertCurrent(options: { adapterSet: readonly ExecutionAdapter[]; model: AdapterJsonObject }): Promise<void>;
  prepare(options: { adapterSet: readonly ExecutionAdapter[]; model: AdapterJsonObject; signal: AbortSignal }): Promise<PreparedPeerAdapters>;
}
export function createPeerAdapterResolver(options: {
  registry: { getPublication(identity: string): AdapterJsonObject | null; getArtifact(identity: string): Promise<{ bytes: Uint8Array } | null> };
  resolveCustody?: (options: { entry: ExecutionAdapter; artifactSet: AdapterJsonObject; signal: AbortSignal }) => Promise<CustodyPorts>;
  policy: AdapterExecutionPolicy;
  openCheckpoints?: (options: { name: string; maxBytes: number }) => Promise<CustodyCheckpoints>;
}): PeerAdapterResolver;
