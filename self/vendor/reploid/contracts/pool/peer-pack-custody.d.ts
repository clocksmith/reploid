import type { JsonValue } from './pack-operation-adapters.js';
type JsonObject = Readonly<Record<string, JsonValue>>;
export interface CustodyArtifact { readonly artifactId: string; readonly role: string; readonly path: string; readonly hash: string; readonly sizeBytes: number }
export interface CustodyChunk { readonly index: number; readonly offset: number; readonly sizeBytes: number; readonly hash: string }
export interface CustodyCheckpoints {
  getChunk(chunk: CustodyChunk, options: { signal: AbortSignal }): Promise<Uint8Array | null>;
  putChunk(chunk: CustodyChunk, bytes: Uint8Array, options: { signal: AbortSignal }): Promise<{ evictedBytes?: number } | void>;
  deleteChunk(chunk: CustodyChunk, options: { signal: AbortSignal }): Promise<void>;
  close(): void;
}
export interface CustodyPorts {
  authorization: JsonObject;
  index: JsonObject;
  inventories: readonly JsonObject[];
  requesterPrivateKey: CryptoKey;
  requestChunk(peerId: string, request: JsonObject, control: { signal: AbortSignal; maxBytes: number }): Promise<{ message: JsonObject; bytes: Uint8Array }>;
  now?: () => number;
  signal?: AbortSignal | null;
  checkpoints?: CustodyCheckpoints | null;
  maxConcurrentChunks?: number;
}
export interface PeerPackArtifactStore {
  readEnvelope(): Promise<Uint8Array>;
  readArtifact(artifact: CustodyArtifact): Promise<Uint8Array>;
  close(): void;
  getReceipt(): JsonObject;
}
export function createPeerPackArtifactStore(options: CustodyPorts): Promise<PeerPackArtifactStore>;
export function createPeerPackSupplier(options: { authorization: JsonObject; index: JsonObject; peerId: string; privateKey: CryptoKey;
  inventory: JsonObject; readChunk(artifactId: string, chunk: CustodyChunk): Promise<Uint8Array>; now?: () => number }): Promise<{
    inventory: JsonObject; serve(request: JsonObject): Promise<{ message: JsonObject; bytes: Uint8Array }> }>;
