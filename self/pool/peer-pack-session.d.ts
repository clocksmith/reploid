import type { CustodyPorts, CustodyCheckpoints } from './peer-pack-custody.js';
import type { PackOperationEvent, PackOperationRequest, PackOperationResult, PackOperationSession } from './pack-operation.js';
import type { ReploidDopplerRuntimeService } from '../infrastructure/doppler-runtime-service.js';
import type { JsonValue } from './pack-operation-adapters.js';
type JsonObject = Readonly<Record<string, JsonValue>>;
export interface PeerPackSession {
  readonly session: PackOperationSession;
  run(request: PackOperationRequest, control?: {
    onPartial?: ((event: PackOperationEvent) => void | Promise<void>) | null;
    signal?: AbortSignal | null; beforeExecute?: (() => void | Promise<void>) | null;
  }): Promise<PackOperationResult>;
  getAcquisitionReceipt(): Promise<JsonObject>;
  close(): Promise<void>;
}
export function openPeerPack(options: Omit<CustodyPorts, 'checkpoints'> & {
  trustedSigners: JsonObject; runtimeVersion: string; maxCacheBytes: number;
  scope?: string; checkpointName?: string;
  service?: Pick<ReploidDopplerRuntimeService, 'openPack' | 'openCapsule' | 'prepare' | 'close'>;
  openCheckpoints?: (options: { name: string; maxBytes: number }) => Promise<CustodyCheckpoints & { getStats(): Promise<JsonObject> }>;
}): Promise<PeerPackSession>;
