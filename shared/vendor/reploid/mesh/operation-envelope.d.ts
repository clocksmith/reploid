import type { SwarmTransport } from '../transport/swarm.js';
import type { Protection } from '../chat/execution-policy.js';

export type MeshOperationName = 'generate' | 'scoreTargetSequence' | 'scoreChoices' | 'embed';
export type MeshOperationErrorCode = 'UNKNOWN_OPERATION' | 'UNSUPPORTED_OPERATION' | 'OPERATION_OFFER_MISMATCH'
  | 'OPERATION_GRANT_REVOKED' | 'OPERATION_REQUEST_INVALID' | 'OPERATION_RESULT_INVALID' | 'OPERATION_REFUSED' | 'OPERATION_BUSY';
export type MeshOperationRoute = 'local' | 'remote' | 'split' | 'split-local-edges' | 'auto';

export const MESH_OPERATION_SCHEMA: 'reploid.mesh-operation/v1';
export const MESH_OPERATION_GRANT_SCHEMA: 'reploid.mesh-operation-grant/v1';
export const MESH_OPERATION_UNITS: 'reploid.mesh-operation-units/v1';
export const MESH_OPERATION_REQUEST: 'reploid:mesh-operation-request';
export const MESH_OPERATION_RESULT: 'reploid:mesh-operation-result';
export const MESH_OPERATION_CANCEL: 'reploid:mesh-operation-cancel';
export const MESH_OPERATION_RECEIPT: 'reploid:mesh-operation-receipt';
export const MESH_OPERATIONS: Readonly<Record<MeshOperationName, Readonly<{ costUnit: string; orderedSplit: boolean }>>>;
export const MESH_OPERATION_ERROR_CODES: Readonly<{ [K in MeshOperationErrorCode]: K }>;
export function meshOperationError(code: MeshOperationErrorCode, message: string): Error & { code: MeshOperationErrorCode };

export interface MeshOperationGrant {
  schema: 'reploid.mesh-operation-grant/v1';
  /** The one participant that may receive the payload. */
  recipient: string;
  grantedAt: number;
  revokedAt: number | null;
}
export interface MeshOperationExecution { protection: Protection; route: MeshOperationRoute; [key: string]: unknown }
export interface MeshOperationEnvelope {
  schema: 'reploid.mesh-operation/v1';
  requestId: string;
  operation: MeshOperationName;
  modelId: string;
  manifestDigest: string;
  planDigest: string;
  execution: MeshOperationExecution;
  recipientGrant: MeshOperationGrant;
  maxCostUnits: number;
  payload: Record<string, unknown>;
}
export interface MeshOperationOffer {
  participantId: string;
  protection: Protection;
  /** The concrete route the recipient serves. */
  route: Exclude<MeshOperationRoute, 'auto'>;
  modelIdentity: string | null;
  supportedOperations?: MeshOperationName[];
}
export interface MeshOperationResult {
  acknowledgedUnits: number;
  output: Record<string, unknown>;
  /** The provider's receipt, countersigned by the requester. */
  providerReceipt: Record<string, unknown>;
  settlement: unknown;
  costUnit: string;
  /** The requester's signed settlement records of the attempt (openMeshOperationCharge). */
  charge?: Readonly<MeshOperationCharge>;
}
/** What the requester protocol returns: the output, both signed receipts and the synchronous delivery of the acknowledgment. */
export interface MeshOperationReply {
  output: Record<string, unknown>;
  receipt: Record<string, unknown>;
  closing: SignedSettlementRecord | null;
  deliver(frame: { receipt: Record<string, unknown>; acknowledgment: SignedSettlementRecord }): boolean;
}
export interface MeshOperationPorts {
  offer(envelope: MeshOperationEnvelope): MeshOperationOffer | null;
  reserve(envelope: MeshOperationEnvelope, inputDigest: string): Promise<unknown>;
  open(hold: unknown, envelope: MeshOperationEnvelope): Promise<Readonly<MeshOperationCharge>>;
  send(envelope: MeshOperationEnvelope, controls: { signal: AbortSignal; settlement: Readonly<MeshOperationCharge> }): Promise<MeshOperationReply>;
  countersign(receipt: Record<string, unknown>): Promise<Record<string, unknown>>;
  settle(hold: unknown, receipt: Record<string, unknown>): Promise<unknown>;
  cancel(hold: unknown, error: unknown, charge: Readonly<MeshOperationCharge> | null): Promise<unknown>;
  generate?(envelope: MeshOperationEnvelope, controls: { signal: AbortSignal }): Promise<MeshOperationResult>;
}
type OperationTransport = Required<Pick<SwarmTransport, 'getPeerBinding' | 'onMessage' | 'sendToPeer'>>;

export function supportedMeshOperations(value: unknown): MeshOperationName[];
export function meshOperationPlanDigest(fields: Pick<MeshOperationEnvelope, 'operation' | 'modelId' | 'manifestDigest' | 'execution' | 'recipientGrant'>): Promise<string>;
export function meshOperationInputDigest(envelope: MeshOperationEnvelope): Promise<string>;
export function createMeshOperationEnvelope(fields: Omit<MeshOperationEnvelope, 'schema' | 'planDigest'> & { planDigest?: string | null }): Promise<Readonly<MeshOperationEnvelope>>;
/** Refuses, among others, a payload with nothing to run: an empty target, prompt, choice list or input. */
export function assertMeshOperationEnvelope(envelope: unknown): MeshOperationEnvelope;
/** The envelope as a provider admits it, before the payload is disclosed. */
export function meshOperationAdmission(envelope: MeshOperationEnvelope): Omit<MeshOperationEnvelope, 'payload'>;
/** Throws synchronously, before any hold or wire byte, when the envelope does not match the offer. */
export function authorizeMeshOperation(envelope: MeshOperationEnvelope, offer: MeshOperationOffer | null): Readonly<{ costUnit: string; orderedSplit: boolean }>;
export function meshOperationOffer(discovery: { models?: Array<Record<string, any>>; peers?: Array<Record<string, any>> }, envelope: MeshOperationEnvelope): MeshOperationOffer | null;
export function meshOperationUnits(operation: MeshOperationName, output: Record<string, unknown>): number;
/** Authorizes synchronously (a refusal throws before this returns), then reserves, sends, verifies, countersigns and settles. */
export function executeMeshOperation(envelope: MeshOperationEnvelope, controls: { signal?: AbortSignal } | undefined, ports: MeshOperationPorts): Promise<MeshOperationResult>;
export function dispatchMeshOperation(session: {
  supportedOperations(): MeshOperationName[];
  executeOperation(request: { operation: MeshOperationName; payload: Record<string, unknown>; signal: AbortSignal }): Promise<Record<string, unknown>>;
}, envelope: MeshOperationEnvelope, controls: { signal: AbortSignal }): Promise<Record<string, unknown>>;
export function attachMeshOperations(options: {
  transport: OperationTransport;
  identity: { peerId: string; publicJwk: JsonWebKey; privateJwk: JsonWebKey };
  verifyPeer(peerId: string, signal?: AbortSignal): Promise<string | null>;
  currentPeer(peerId: string): string | null;
  offer(): MeshOperationOffer;
  /** The host's rule, asked at admission (`operation.admit`) and again before running (`operation.execute`). */
  authorize(request: { action: 'operation.admit' | 'operation.execute'; peerId: string; consumer: string;
    envelope: MeshOperationEnvelope | Omit<MeshOperationEnvelope, 'payload'> }): Promise<boolean>;
  admit?(input: { envelope: Omit<MeshOperationEnvelope, 'payload'>; consumer: string; inputDigest: string;
    settlement: { terms: SignedSettlementRecord; charge: SignedSettlementRecord } }): Promise<unknown>;
  dispatch(envelope: MeshOperationEnvelope, signal: AbortSignal): Promise<Record<string, unknown>>;
  settlementAccount?(): Promise<string> | string;
  onSettlementRecords?(value: { reservationId: string; records: SignedSettlementRecord[] }): unknown;
  onReceipt?(receipt: Record<string, unknown>): unknown;
  /** Attempts admitted or running at once (default 1). */
  maxRunning?: number;
  now?: () => number;
}): Readonly<{ running(): number; close(): Promise<void> }>;
export function requestMeshOperation(options: {
  transport: OperationTransport;
  verifyPeer(peerId: string, signal?: AbortSignal): Promise<string | null>;
  currentPeer(peerId: string): string | null;
  providerPeer: string;
  envelope: MeshOperationEnvelope;
  settlement: Readonly<MeshOperationCharge>;
  signal?: AbortSignal;
}): Promise<MeshOperationReply>;

/** A record signed with a participant's own key: its body, the key and the signature. */
export type SignedSettlementRecord = Record<string, unknown> & { schema: string; publicJwk: JsonWebKey; signature: string };
export const MESH_OPERATION_ATTEMPT_SCHEMA: 'reploid.mesh-operation-attempt/v1';
export const MESH_OPERATION_SETTLEMENT_RECORDS_SCHEMA: 'reploid.mesh-operation-settlement-records/v1';
export const MESH_OPERATION_SETTLEMENT_RECORD_SCHEMAS: readonly string[];
export function wholeModelOperationPlanDigest(plan: { operation: MeshOperationName; modelId: string; manifestDigest: string; recipient: string }): Promise<string>;
export function meshOperationRouteHash(attempt: { requesterId: string; requestId: string; planDigest: string }): Promise<string>;
export function meshOperationOutputChain(output: { reservationId: string; routeHash: string; units: number; outputDigest: string }): Promise<string>;
/** A participant's signing port (partition-attempt-evidence.js, createAttemptEvidenceSigner). */
export interface SettlementSigner {
  participantId: string;
  now(): number;
  sign(domain: string, body: Record<string, unknown>): Promise<SignedSettlementRecord>;
}
export interface MeshOperationCharge {
  terms: SignedSettlementRecord;
  charge: SignedSettlementRecord;
  routeHash: string;
  reservationId: string;
  /** Throws unless this is the provider's signed acceptance of exactly these terms. */
  accept(acceptance: unknown): Promise<true>;
  /** Signs the acknowledgment of the provider's closing receipt; throws when it commits to another output. */
  acknowledge(delivered: { receipt: unknown; units: number; outputDigest: string; send?: (acknowledgment: SignedSettlementRecord) => boolean | void }): Promise<SignedSettlementRecord>;
  /** Keeps the provider's closing receipt, or its stage fault, of an answer that did not complete. */
  close(record: unknown): Promise<true>;
  stop(): Promise<SignedSettlementRecord>;
  records(): SignedSettlementRecord[];
  summary(): { reservationId: string; attemptId: string; routeHash: string; requesterId: string; providerId: string; accepted: boolean;
    closed: boolean; faulted: boolean; acknowledged: number | null; stopped: boolean; complete: boolean; missing: string[] };
}
/** Requester side: signs the terms and charge binding of one whole-model attempt and keeps its records. */
export function openMeshOperationCharge(options: {
  signer: SettlementSigner; requestId: string; planDigest: string; recipient: string; reservationId: string;
  policy: Record<string, unknown>; maxCostUnits: number; debitAccount?: string; now?: () => number;
}): Promise<Readonly<MeshOperationCharge>>;
/** Provider side: checks the requester's terms and charge binding and signs the acceptance; throws to refuse. */
export function acceptMeshOperationCharge(options: {
  signer: SettlementSigner; settlement: { terms: unknown; charge: unknown }; consumer: string; requestId: string; planDigest: string;
  payoutAccount?: string; now?: () => number;
}): Promise<Readonly<{
  acceptance: SignedSettlementRecord; reservationId: string; routeHash: string; maxCostUnits: number;
  close(output?: { units?: number; outputDigest?: string | null; stopReason?: string | null; promptUnits?: number | null; failed?: boolean }): Promise<SignedSettlementRecord>;
  /** The provider's own signed fault; refused once it has closed. */
  fault(): Promise<SignedSettlementRecord>;
  acknowledged(acknowledgment: unknown): Promise<boolean>;
  records(): SignedSettlementRecord[];
}>>;
