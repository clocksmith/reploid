import type { SwarmTransport } from '../transport/swarm.js';
import type { Protection } from '../chat/execution-policy.js';

export type MeshOperationName = 'generate' | 'scoreTargetSequence' | 'scoreChoices' | 'embed';
export type MeshOperationErrorCode = 'UNKNOWN_OPERATION' | 'UNSUPPORTED_OPERATION' | 'OPERATION_OFFER_MISMATCH'
  | 'OPERATION_GRANT_REVOKED' | 'OPERATION_REQUEST_INVALID' | 'OPERATION_RESULT_INVALID';
export type MeshOperationRoute = 'local' | 'remote' | 'split' | 'split-local-edges' | 'auto';

export const MESH_OPERATION_SCHEMA: 'reploid.mesh-operation/v1';
export const MESH_OPERATION_GRANT_SCHEMA: 'reploid.mesh-operation-grant/v1';
export const MESH_OPERATION_UNITS: 'reploid.mesh-operation-units/v1';
export const MESH_OPERATION_REQUEST: 'reploid:mesh-operation-request';
export const MESH_OPERATION_RESULT: 'reploid:mesh-operation-result';
export const MESH_OPERATION_CANCEL: 'reploid:mesh-operation-cancel';
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
}
export interface MeshOperationPorts {
  offer(envelope: MeshOperationEnvelope): MeshOperationOffer | null;
  reserve(envelope: MeshOperationEnvelope, inputDigest: string): Promise<unknown>;
  send(envelope: MeshOperationEnvelope, controls: { signal: AbortSignal }): Promise<{ output: Record<string, unknown>; receipt: Record<string, unknown> }>;
  countersign(receipt: Record<string, unknown>): Promise<Record<string, unknown>>;
  settle(hold: unknown, receipt: Record<string, unknown>): Promise<unknown>;
  cancel(hold: unknown, error: unknown): Promise<unknown>;
  generate?(envelope: MeshOperationEnvelope, controls: { signal: AbortSignal }): Promise<MeshOperationResult>;
}
type OperationTransport = Required<Pick<SwarmTransport, 'getPeerBinding' | 'onMessage' | 'sendToPeer'>>;

export function supportedMeshOperations(value: unknown): MeshOperationName[];
export function meshOperationPlanDigest(fields: Pick<MeshOperationEnvelope, 'operation' | 'modelId' | 'manifestDigest' | 'execution' | 'recipientGrant'>): Promise<string>;
export function meshOperationInputDigest(envelope: MeshOperationEnvelope): Promise<string>;
export function createMeshOperationEnvelope(fields: Omit<MeshOperationEnvelope, 'schema' | 'planDigest'> & { planDigest?: string | null }): Promise<Readonly<MeshOperationEnvelope>>;
export function assertMeshOperationEnvelope(envelope: unknown): MeshOperationEnvelope;
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
  admit?(input: { envelope: MeshOperationEnvelope; consumer: string; inputDigest: string }): Promise<unknown>;
  dispatch(envelope: MeshOperationEnvelope, signal: AbortSignal): Promise<Record<string, unknown>>;
  now?: () => number;
}): void;
export function requestMeshOperation(options: {
  transport: OperationTransport;
  verifyPeer(peerId: string, signal?: AbortSignal): Promise<string | null>;
  currentPeer(peerId: string): string | null;
  providerPeer: string;
  envelope: MeshOperationEnvelope;
  signal?: AbortSignal;
}): Promise<{ output: Record<string, unknown>; receipt: Record<string, unknown> }>;
