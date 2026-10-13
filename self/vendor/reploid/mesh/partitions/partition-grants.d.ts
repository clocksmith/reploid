import type { RouteAttemptBinding } from './partition-contract.js';
import type { SigningIdentity } from '../../artifacts/identity.js';
import type { PartitionBinding, PartitionLimits } from './partition-runner.js';
import type { PartitionCommitAttempt, PartitionCommitRuntime } from './partition-stage-commit.js';
export interface CanonicalGrantGeneration<Policy = unknown> { policy: Policy; executionIdentity: string; generationId: string; }
export interface CanonicalPartitionGrant<Policy = unknown> {
  claim: { schema: 'reploid.partition-grant/v3'; id: string; meshId: string; identity: PartitionBinding;
    canonicalAttempt: PartitionCommitAttempt; generation: CanonicalGrantGeneration<Policy>; vocabSize: number;
    issuedAt: number; expiresAt: number; disclosure: 'partition-activations-and-tokens';
    limits: Pick<PartitionLimits, 'maxTokens' | 'maxPromptTokens' | 'maxActivationBytes' | 'maxOutputCharacters'> };
  publicJwk: JsonWebKey; signature: string;
}
export interface PartitionGrant {
  claim: { schema: 'reploid.partition-grant/v2'; id: string; meshId: string;
    identity: PartitionBinding; issuedAt: number; expiresAt: number;
    disclosure: 'partition-activations' | 'partition-activations-and-tokens'; generationDigest: string;
    limits: Pick<PartitionLimits, 'maxTokens' | 'maxPromptTokens' | 'maxActivationBytes' | 'maxOutputCharacters'> };
  publicJwk: JsonWebKey; signature: string;
}
export interface PartitionGrantAuthority {
  readonly participantId: string; readonly meshId: string;
  issue(identity: PartitionBinding, limits: PartitionLimits, controls: { approved: true; ttlMs: number;
    disclosure: PartitionGrant['claim']['disclosure']; generationDigest: string }): Promise<PartitionGrant>;
  issueOrdered(identity: RouteAttemptBinding, limits: OrderedPartitionGrant['claim']['limits'], controls: {
    approved: true; ttlMs: number; disclosure: OrderedPartitionDisclosure; generationDigest: string; expiresAt?:number;
  }): Promise<OrderedPartitionGrant>;
  verify(grant: unknown, request: OrderedPartitionGrantRequest, controls?: { settlement?: boolean }): Promise<boolean>;
  canonicalScope(input: { identity: PartitionBinding; limits: CanonicalPartitionGrant['claim']['limits'];
    disclosure: 'partition-activations-and-tokens'; generationId: string }): string;
  issueCanonical<Policy>(identity: PartitionBinding, limits: CanonicalPartitionGrant['claim']['limits'], controls: {
    approved: true; ttlMs: number; disclosure: 'partition-activations-and-tokens';
    generation: CanonicalGrantGeneration<Policy>; canonicalAttempt: PartitionCommitAttempt; vocabSize: number;
  }): Promise<CanonicalPartitionGrant<Policy>>;
  verify(grant: unknown, request: { identity: PartitionBinding; action: string;
    step?: number; inputTokenCount?: number; activationBytes?: number; generationDigest?: string;
    canonicalAttempt?: PartitionCommitAttempt; generationId?: string; phase?: 'admit' | 'step' }, controls?: { settlement?: boolean }): Promise<boolean>;
  /** Denies subsequent local use. Settling the remote attempt propagates revocation to its replay guard. */
  revoke(grant: PartitionGrant | CanonicalPartitionGrant | OrderedPartitionGrant): void;
  close(): void;
}
export function createPartitionGrantAuthority(options: { identity: SigningIdentity; meshId: string;
  maxGrants: number; maxTtlMs: number;
  canonicalRuntime?: Pick<PartitionCommitRuntime, 'metadataDigest' | 'validateResidentAttemptIdentity' | 'residentAttemptDigest'> & {
    canonicalGenerationIdentity(policy: unknown, executionIdentity: string, vocabSize: number): CanonicalGrantGeneration };
  /** Issuance-time clock tolerance only; expiration never receives a grace period. Defaults to zero. */
  maxClockSkewMs?: number; now?: () => number }): PartitionGrantAuthority;

export interface OrderedPartitionDisclosure {
  kind: 'coordinator-mediated-activations-and-tokens'; activationPaths: string[][];
  tokenRecipients: string[]; outputRecipients: string[];
}
export interface OrderedPartitionGrant {
  claim: { schema: 'reploid.partition-grant/v4'; id: string; meshId: string; identity: RouteAttemptBinding;
    coordinatorId: string; disclosure: OrderedPartitionDisclosure; generationDigest: string;
    issuedAt: number; expiresAt: number; limits: PartitionGrant['claim']['limits'] };
  publicJwk: JsonWebKey; signature: string;
}
export interface OrderedPartitionGrantRequest {
  identity: RouteAttemptBinding; coordinatorId: string; action: string; partitionIndex?: number;
  fromStage?: number; toStage?: number; recipients?: string[]; step?: number;
  inputTokenCount?: number; activationBytes?: number; generationDigest?: string;
}
export function orderedPartitionDisclosure(identity: RouteAttemptBinding): OrderedPartitionDisclosure;
