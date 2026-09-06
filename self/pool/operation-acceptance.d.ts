import type { JsonValue, PackOperationRegistry } from './pack-operation-adapters.js';
import type { PackOperationResult, PackOperationRequest } from './pack-operation.js';
import type { SignedPackPeerMessage, PackPeerJobBody } from './peer-pack-job.js';
export interface OperationAcceptancePolicy {
  readonly schema: 'reploid.pool.operation-acceptance-policy/v1';
  readonly defaultMode: 'reference';
  readonly modes: Readonly<Record<string, { readonly operations: readonly string[] | null; readonly referenceRequired: boolean; readonly claim: string }>>;
}
export type ResolvedOperationAcceptance = Readonly<Record<string, JsonValue>> & { readonly schema: 'reploid.pool.operation-acceptance/v1'; readonly mode: string;
  readonly operation: PackOperationRequest['operation']; readonly referenceRequired: boolean; readonly claim: string; readonly comparisonPolicyDigest: string | null };
export function resolveOperationAcceptance(options: { mode: string; operation: PackOperationRequest['operation'];
  comparisonPolicy: JsonValue; policy: OperationAcceptancePolicy }): Promise<ResolvedOperationAcceptance>;
export function validateOperationReference(options: { job: SignedPackPeerMessage<PackPeerJobBody>; reference: JsonValue; registry: PackOperationRegistry }): Promise<void>;
export function assessPeerOperation(options: { job: SignedPackPeerMessage<PackPeerJobBody>; execution: PackOperationResult;
  reference: JsonValue; registry: PackOperationRegistry }): Promise<Readonly<Record<string, JsonValue>>>;
