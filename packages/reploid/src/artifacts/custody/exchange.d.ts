import type { SwarmTransport } from '../../transport/swarm.js';
import type { OperationRoles, WeightSupplyOffer } from '../../contracts/computer-records.js';
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
/** `reploid.custody-key-certificate/v1` (../custody-certificate.js): a persistent participant
 * identity's signed statement that it holds this per-process custody key and peer id. */
export interface CustodyKeyCertificate {
  schema: 'reploid.custody-key-certificate/v1'; certificateId: string; participantId: string;
  custodyPeerId: string; custodyPublicKey: string; issuedAt: string; expiresAt: string; signature: string;
}
/** `reploid.custody-delivery-attestation/v1` (../delivery-attestation.js): the requester's
 * signature, with its granted custody key, over the exact completed receipt. */
export interface CustodyDeliveryAttestation {
  schema: 'reploid.custody-delivery-attestation/v1'; authorizationHash: string; transferId: string;
  receiptDigest: string; completed: unknown[]; attestedAt: string; signature: string;
}
/** One granted (supplier) or completed (requester) transfer. A certificate is null unless that
 * party sent one bound to its grant key and peer id; the signer is not verified here. A certified
 * requester attests its receipt; supplier records and uncertified requesters carry null. */
export interface CustodyDeliveryRecord {
  role: 'supplier' | 'requester'; transferId: string; peerId: string;
  authorization: unknown; index: unknown; receipt: ReturnType<Store['getReceipt']> | null;
  certificates: { requester: CustodyKeyCertificate | null; supplier: CustodyKeyCertificate | null };
  attestation: CustodyDeliveryAttestation | null;
  /** Requester consumes, supplier provides; a party names a computer only from this side's own certificate. */
  roles: OperationRoles | null;
}
/** A granted transfer its requester confirmed, with a signature by the grant's requester key over the exact
 * receipt, as completed and verified. The only source of served bytes. */
export interface CustodyServedTransfer {
  transferId: string; peerId: string; artifact: FileDescriptor; deliveredBytes: number; grantedAt: number; completedAt: number;
  roles: OperationRoles | null;
}
export interface CustodyExchangePorts {
  /** Required for supply, not acquisition. Durable atomic reservations never refund uncertainty. */
  supplyBudget?: {
    getState(): { reservedBytes: number; maxBytes: number } | null;
    reserve(bytes: number): Promise<{ reservedBytes: number; maxBytes: number }>;
  };
  /** Host-wide default charged before each payload request, including retries. */
  reserveDownload?(bytes: number): Promise<void>;
  /** Authenticate the selected peer before opening a grant or disclosing the requested range. */
  authorizePeer?(peerId: string, signal: AbortSignal): Promise<boolean>;
  /** Optional explicit admission of the certificate bound to the supplier in the grant, before requesting bytes. */
  authorizeSupplier?(certificate: CustodyKeyCertificate): Promise<boolean>;
  /** Host wall clock; defaults to Date.now. */
  now?(): number;
  /** Optional host admission for new supply. `active` counts transfers being prepared or granted;
   * `advertise` asks whether the inventory may be announced. Returning false withholds the
   * announcement and refuses new requests; granted transfers are never revoked by it. */
  /** Optional owner restriction checked on the connected peer before reserving or reading bytes. */
  authorizeRequester?(peer: string, signal: AbortSignal): Promise<boolean>;
  admitSupply?(request: { active: number; advertise: boolean }): boolean;
  createSupplier: typeof createPeerPackSupplier;
  createStore: typeof createPeerPackArtifactStore;
  createChannel(options: { channel: RTCDataChannel; limits: CustodyChannelLimits; serve: Supplier['serve'] }): {
    requestChunk: (message: Parameters<Supplier['serve']>[0], controls: { signal: AbortSignal; maxBytes: number }) => ReturnType<Supplier['serve']>;
    close(): void;
  };
  readArtifact(file: FileDescriptor, controls: { signal: AbortSignal }): Promise<Uint8Array>;
  /** Only use a range bound to the offered file by a trusted local index. The exchange
   * verifies the returned bytes against the selected commitment. Null requests a full-file check. */
  readIndexedRange?(file: FileDescriptor, range: { offset: number; size: number; identity: string },
    controls: { signal: AbortSignal }): Promise<Uint8Array | null>;
  verifyArtifact(file: FileDescriptor, bytes: Uint8Array): Promise<void>;
  commitArtifact?(file: FileDescriptor, bytes: Uint8Array, controls: { signal: AbortSignal }): Promise<void>;
  hash(value: unknown): Promise<string>;
  hashBytes(bytes: Uint8Array): Promise<string>;
  checkpoints?: CustodyCheckpoints;
  observe?(receipt: ReturnType<Store['getReceipt']>): void;
  /** This participant's certificate for its custody key, sent beside requests and grants.
   * Without it, or when it does not bind this key and peer id, nothing is sent. */
  certificate?(): Promise<CustodyKeyCertificate | null>;
  /** Evidence for each granted or completed transfer, with both parties' bound certificates
   * and, for a certified requester, its delivery attestation. */
  observeDelivery?(record: CustodyDeliveryRecord): void;
  /** Each transfer this side served that its requester confirmed as completed and verified. */
  observeServed?(transfer: CustodyServedTransfer): void;
  /** The participant ID a peer's bound certificate verifiably names, or null. Without it, roles name only this side's computer. */
  verifyPeerCertificate?(certificate: CustodyKeyCertificate): Promise<string | null>;
  onChange?(): void;
  onError?(error: Error): void;
}
export function createCustodyExchange(options: {
  transport: SwarmTransport;
  identity: { peerId: string; publicKey: string; privateKey: CryptoKey };
  policy: CustodyExchangePolicy; ports: CustodyExchangePorts;
}): {
  announce(peerId?: string): void;
  /** `offering`: peers whose latest announced inventory is non-empty. */
  getState(): { sharing: boolean; suppliedBytes: number; pending: number; peers: string[]; offering: string[]; offers: WeightSupplyOffer[];
    /** Bytes and transfers this side served that requesters confirmed as completed and verified. */
    servedBytes: number; servedTransfers: number;
    /** Connected peers' latest demand announcements. */
    demand: { connectionId: string; files: { hashAlgorithm: 'sha256' | 'blake3'; hash: string; sizeBytes: number }[]; observedAt: number }[] };
  has(file: FileDescriptor): boolean;
  /** With `revoke: false` while sharing, grants for files still offered stay open. */
  offer(files: FileDescriptor[], options?: { revoke?: boolean }): void;
  /** Announce the files this participant is fetching; an empty list withdraws the announcement. */
  announceDemand(files: { hashAlgorithm: 'sha256' | 'blake3'; hash: string; sizeBytes: number }[]): void;
  stopSupply(): void;
  /** Uses at most `maxAcquisitionAttempts` fresh grants. A supplier that delivered nothing
   * (error code `CUSTODY_SUPPLIER_UNAVAILABLE`) may be asked again, after waiting at most one
   * channel timeout for an offer if none is connected; one that sent invalid data or refused is not.
   * `onSupplier` receives the room participant id of the peer that delivered the verified bytes. */
  acquire(file: FileDescriptor, controls: { signal: AbortSignal;
    range?: { offset: number; size: number; identity: string } | null;
    reserveDownload?: ((bytes: number) => Promise<void>) | null;
    onSupplier?: ((peerId: string) => void) | null }): Promise<Uint8Array>;
  close(): Promise<PromiseSettledResult<unknown>[]>;
};
