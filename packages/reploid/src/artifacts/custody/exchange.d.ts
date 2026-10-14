import type { SwarmTransport } from '../../transport/swarm.js';
import type { CustodyCheckpoints, createPeerPackArtifactStore, createPeerPackSupplier } from '../../contracts/pool/peer-pack-custody.js';

export interface FileDescriptor {
  path: string; role: string; sizeBytes: number; hash: string; hashAlgorithm: 'sha256' | 'blake3';
}
export interface CustodyChannelLimits {
  maxFrameBytes: number; maxControlBytes: number; maxChunkBytes: number; maxBufferedBytes: number;
  maxPendingRequests: number; maxTransferBytes: number; timeoutMs: number;
}
export interface CustodyExchangePolicy {
  maxTransfers: number; maxPeers: number; maxAcquisitionAttempts: number;
  maxInventoryFiles: number; maxSupplyBytes: number; maxArtifactBytes: number;
  grantMs: number; channel: CustodyChannelLimits;
}
type Supplier = Awaited<ReturnType<typeof createPeerPackSupplier>>;
type Store = Awaited<ReturnType<typeof createPeerPackArtifactStore>>;
export interface CustodyExchangePorts {
  /** Required for supply, not acquisition. Durable atomic reservations never refund uncertainty. */
  supplyBudget?: {
    getState(): { reservedBytes: number; maxBytes: number } | null;
    reserve(bytes: number): Promise<{ reservedBytes: number; maxBytes: number }>;
  };
  /** Host wall clock; defaults to Date.now. */
  now?(): number;
  createSupplier: typeof createPeerPackSupplier;
  createStore: typeof createPeerPackArtifactStore;
  createChannel(options: { channel: RTCDataChannel; limits: CustodyChannelLimits; serve: Supplier['serve'] }): {
    requestChunk: (message: Parameters<Supplier['serve']>[0], controls: { signal: AbortSignal; maxBytes: number }) => ReturnType<Supplier['serve']>;
    close(): void;
  };
  readArtifact(file: FileDescriptor, controls: { signal: AbortSignal }): Promise<Uint8Array>;
  verifyArtifact(file: FileDescriptor, bytes: Uint8Array): Promise<void>;
  commitArtifact?(file: FileDescriptor, bytes: Uint8Array, controls: { signal: AbortSignal }): Promise<void>;
  hash(value: unknown): Promise<string>;
  hashBytes(bytes: Uint8Array): Promise<string>;
  checkpoints?: CustodyCheckpoints;
  observe?(receipt: ReturnType<Store['getReceipt']>): void;
  onChange?(): void;
  onError?(error: Error): void;
}
export function createCustodyExchange(options: {
  transport: SwarmTransport;
  identity: { peerId: string; publicKey: string; privateKey: CryptoKey };
  policy: CustodyExchangePolicy; ports: CustodyExchangePorts;
}): {
  announce(peerId?: string): void;
  getState(): { sharing: boolean; suppliedBytes: number; pending: number; peers: string[] };
  has(file: FileDescriptor): boolean;
  offer(files: FileDescriptor[]): void;
  stopSupply(): void;
  /** Uses at most `maxAcquisitionAttempts` fresh grants. A supplier that delivered nothing
   * (error code `CUSTODY_SUPPLIER_UNAVAILABLE`) may be asked again, after waiting at most one
   * channel timeout for an offer if none is connected; one that sent invalid data or refused is not. */
  acquire(file: FileDescriptor, controls: { signal: AbortSignal;
    range?: { offset: number; size: number; identity: string } | null }): Promise<Uint8Array>;
  close(): Promise<PromiseSettledResult<unknown>[]>;
};
