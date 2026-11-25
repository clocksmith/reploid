/** `reploid.protected-generation/v1`: research protected route, unavailable until independent security review. */
export declare const PROTECTED_PROTOCOL: 'reploid.protected-generation/v1';
export declare const PROTECTED_BACKEND: 'doppler-protected-ckks/v1';
export declare const PROTECTED_REVIEW_REASON: 'awaiting independent security review';
export declare const PROTECTED_DESCRIPTOR_SCHEMA: 'reploid.protected-backend/v1';
export declare const PROTECTED_ADVERTISEMENT_SCHEMA: 'reploid.protected-advertisement/v1';
export declare const PROTECTED_BINDING_SCHEMA: 'reploid.protected-binding/v1';
export declare const TRAP_SET_SCHEMA: 'doppler.protected-trapset/v1';
export declare const TRAP_SET_ENVELOPE_SCHEMA: 'doppler.protected-trapset-envelope/v1';
export declare const TRAP_REQUEST_SCHEMA: 'doppler.protected-trap-request/v1';
export declare const TRAP_BATCH_SCHEMA: 'doppler.protected-trap-batch/v1';
export declare const TRAP_BATCH_ENVELOPE_SCHEMA: 'doppler.protected-trap-batch-envelope/v1';
export declare const TRAP_SOURCES: readonly ['oracle', 'public-set'];
export declare const PROTECTED_FRAME_CEILINGS: Readonly<Record<string, number>>;
export declare const PROTECTED_REQUESTER_FRAME_KINDS: string[];

export interface SigningIdentity { peerId: string; publicJwk: JsonWebKey; privateJwk?: JsonWebKey; algorithm?: string; version?: number }
export interface ProtectedDescriptor {
  schema: 'reploid.protected-backend/v1'; protocol: string; backend: string;
  engine: { protocol: string; implementation: string }; scheme: string;
  parameterSet: { id: string; digest: string };
  circuit: { identity: string; modelIdentity: string; vocab: number; context: number; inputLevel: number; logSlots: number; rotations: number[] };
  evaluator: { participantId: string; publicJwk: JsonWebKey };
  keyEpochs: { maxTtlSeconds: number; reuse: boolean }; lanes: { max: number }; issuedAt: number;
}
export interface ProtectedAdvertisement { schema: 'reploid.protected-advertisement/v1'; descriptor: ProtectedDescriptor; signature: string }
export interface VerifiedAdvertisement { descriptor: ProtectedDescriptor; descriptorDigest: string }
export interface EngineManifest {
  protocol: string; implementation: string; scheme: string; profile: string; profileDigest: string; circuit: string; model: string;
  vocab: number; context: number; inputLevel: number; logSlots: number; rotations: number[]; maxLanes?: number; [key: string]: unknown;
}
export interface TrapSetEnvelope { schema: 'doppler.protected-trapset-envelope/v1'; body: string; bodyDigest: string; publicKey: string; signature: string }
/** v2: a pinned trap oracle. v1 (`public-set`) is broken by a vanishing perturbation and needs `allowPublicTrapSet`. */
export type TrapSource =
  | { source: 'oracle'; endpoint: string; oracleKeys: string[] }
  | { source: 'public-set'; envelope: TrapSetEnvelope; publisherKeys: string[] };
export interface PinnedCircuit {
  identity: string; modelIdentity: string; tokenizer: { alphabet: string }; vocab: number; context: number; inputLevel: number; logSlots: number;
  rotations: number[]; traps: TrapSource;
}
export interface TrapRequest {
  schema: 'doppler.protected-trap-request/v1'; circuit: string; promptLength: number; generate: number; count: number;
  requesterNonce: string; requesterKey: string;
}
export interface TrapBatchEnvelope { schema: 'doppler.protected-trap-batch-envelope/v1'; header: string; ciphertext: string; oracleKey: string; signature: string }
export interface ProtectedPolicy {
  protocols: string[]; engines: string[]; parameterSets: Array<{ id: string; digest: string; insecureDevelopment: boolean }>;
  allowInsecureDevelopment: boolean; allowPublicTrapSet: boolean; circuits: PinnedCircuit[]; trapLanes: number; maxTrapTolerance: number; maxKeyEpochSeconds: number;
}
export interface Trap { id: string; prompt: number[]; continuation: number[]; expectedLogits: number[][] }
export interface VerifiedTrapSet {
  source: 'oracle' | 'public-set'; digest: string; publisherKey: string; tolerance: { maxAbsLogitError: number }; traps: Trap[]; circuit: string;
  batchId?: string; oracleKey?: string; distribution?: string | null; issuedAt?: number;
}
export interface ProtectedFrame { header: Record<string, any>; blobs: Uint8Array[] }
export interface FrameChannel {
  send(frame: ProtectedFrame): Promise<void>;
  receive(options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<ProtectedFrame>;
  close(): void;
}
export interface RequesterKeyHolder {
  profileDigest: string;
  epoch: { id: string; expiresAt: number; keysDigest: string | null; reused?: boolean };
  generateKeys(onKey: (blob: Uint8Array) => unknown): Promise<string>;
  commitKeys(keysDigest: string): Promise<void>;
  encrypt(tokens: number[]): Promise<Uint8Array[]>;
  decrypt(blob: Uint8Array): Promise<ArrayLike<number> | null>;
  close(): Promise<{ encryptions: number; decryptions: number } | null>;
}
export interface EvaluatorEngineSession {
  manifest: { profileDigest: string; circuit: string; heldKeysDigest?: string; [key: string]: unknown }; keyCount: number;
  sendKey(blob: Uint8Array): Promise<void>; keysHeld(): Promise<void>; ready(): Promise<string>;
  step(input: { phase: 'prefill' | 'decode'; seq: number; blobs: Uint8Array[] }): Promise<Uint8Array[]>;
  close(): Promise<void>;
}
export interface EvaluatorEngine {
  open(schedule: { profile: string; modelIdentity: string; lanes: number; promptTokens: number; generatedTokens: number;
    keyEpoch: { id: string; expiresAt: number } }): Promise<EvaluatorEngineSession>;
}
export interface ProtectedJournal {
  record(entry: Record<string, unknown>): void;
  entries(): Array<Readonly<Record<string, unknown>>>;
  recover(now?: number): string[];
}
export interface ProtectedSessionEvidence {
  session: string; bindingDigest: string; descriptorDigest: string; evaluator: string; keyEpoch: string; keysUploaded: boolean;
  lanes: number; trapLanes: number; trapSource: 'oracle' | 'public-set'; trapBatch: string | null; trapSet: string; publisherKey: string; tolerance: number; trapChecks: number; trapsPassed: number;
  maxTrapError: number; detectionProbability: number; decryptions: { trap: number; real: number };
  uploaded: { keyFrames: number; stepFrames: number; bytes: number };
  frames: { sent: number; received: number }; bytes: { sent: number; received: number };
}

export declare function protectedError(code: string, message: string, details?: unknown): Error & { code: string; protected: unknown };
export declare function validateProtectedDescriptor(input: unknown): ProtectedDescriptor;
export declare function createProtectedAdvertisement(options: { identity: SigningIdentity; manifest: EngineManifest; keyEpochMaxTtlSeconds?: number;
  maxLanes?: number; now?: () => number }): Promise<ProtectedAdvertisement>;
export declare function verifyProtectedAdvertisement(input: unknown): Promise<VerifiedAdvertisement>;
export declare function validateProtectedPolicy(input: unknown): ProtectedPolicy;
export declare function protectedEligibility(policy: ProtectedPolicy, verified: VerifiedAdvertisement, model: { identity: string; adapterIdentities?: string[] }):
  { eligible: true; circuit: PinnedCircuit; parameterSet: ProtectedPolicy['parameterSets'][number] } | { eligible: false; reasons: string[] };
export declare function verifyTrapSet(envelope: unknown, options: { publisherKeys: string[]; circuit: PinnedCircuit; maxTolerance: number }): Promise<VerifiedTrapSet>;
export declare function createTrapRequest(options: { circuit: string; promptLength: number; generate: number; count: number }):
  Promise<{ request: TrapRequest; secret: { privateKey: CryptoKey; requesterNonce: string } }>;
export declare function openTrapBatch(envelope: unknown, options: { request: TrapRequest; secret: { privateKey: CryptoKey; requesterNonce: string };
  oracleKeys: string[]; circuit: PinnedCircuit; maxTolerance: number; now?: () => number; usedBatches?: Map<string, number> | null }): Promise<VerifiedTrapSet>;
export declare function secureRandomInt(n: number): number;
export declare function planProtectedLanes(options: { trapSet: { traps: Trap[] }; promptLength: number; generate: number; trapLanes: number;
  randomInt?: (n: number) => number }): Array<{ kind: 'real' | 'trap'; trap: Trap | null }>;
export declare function checkTrapResult(expected: ArrayLike<number>, logits: ArrayLike<number>, tolerance: { maxAbsLogitError: number }):
  { pass: boolean; maxAbsError: number; argmaxOk: boolean };
export declare function totalArgmax(values: ArrayLike<number>): number;
export declare function trapDetectionProbability(options: { lanes: number; trapLanes: number; tampered?: number }): number;
export declare function encodeProtectedFrame(header: unknown, blobs?: Uint8Array[]): Uint8Array[];
export declare function createFrameDecoder(options: { inspect(header: any): number[]; onFrame(frame: ProtectedFrame): void; maxHeaderBytes?: number }):
  { push(chunk: Uint8Array): void };
export declare function inspectProtectedHeader(header: unknown): number[];
export declare function createMemoryFrameChannelPair(): [FrameChannel, FrameChannel];
export declare function signProtectedFrame(identity: SigningIdentity, fields: { kind: string; session: string | null; binding?: string | null; seq: number;
  fields?: Record<string, unknown> }, blobs?: Uint8Array[]): Promise<ProtectedFrame>;
export declare function verifyProtectedFrame(frame: ProtectedFrame, expected: { kinds: string[]; session: string | null; binding: string | null; seq: number;
  sender: string; publicJwk: JsonWebKey }): Promise<Record<string, any>>;
export declare function bindingDigest(offer: unknown, evaluatorNonce: string): Promise<string>;
export declare function requestProtectedAdvertisement(channel: FrameChannel, options?: { timeoutMs?: number }): Promise<unknown>;
export declare function createProtectedJournal(options?: { limit?: number }): ProtectedJournal;
export declare function runProtectedRequesterSession(options: {
  channel: FrameChannel; crypto: RequesterKeyHolder; identity: SigningIdentity; verified: VerifiedAdvertisement; planId: string; routeId: string;
  expiresAt: number; trapSet: VerifiedTrapSet; trapLanes: number; promptTokens: number[]; generate: number; journal?: ProtectedJournal;
  onToken?: (token: number, step: number) => unknown; onBound?: (binding: { bindingDigest: string; session: string }) => unknown;
  randomInt?: (n: number) => number; now?: () => number; timeoutMs?: number; signal?: AbortSignal;
}): Promise<{ tokens: number[]; evidence: ProtectedSessionEvidence }>;
export declare function serveProtectedEvaluatorSession(options: {
  channel: FrameChannel; identity: SigningIdentity; advertisement: ProtectedAdvertisement; backend: EvaluatorEngine; seenNonces: Map<string, number>;
  journal?: ProtectedJournal; now?: () => number; timeoutMs?: number; misbehave?: 'ask-decrypt' | 'replay-result' | null; signingIdentity?: SigningIdentity;
}): Promise<{ outcome: 'advertised' | 'completed' | 'failed' | 'misbehaved'; error?: string; session?: string; bindingDigest?: string;
  frames?: Record<string, number>; bytes?: { received: number; sent: number } }>;
