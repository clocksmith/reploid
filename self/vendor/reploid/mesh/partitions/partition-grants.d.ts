import type { SigningIdentity } from '../../artifacts/identity.js';
import type { PartitionBinding, PartitionLimits } from './partition-runner.js';
export interface PartitionGrant {
  claim: { schema: 'reploid.partition-grant/v1'; id: string; meshId: string;
    identity: PartitionBinding; issuedAt: number; expiresAt: number;
    limits: Pick<PartitionLimits, 'maxTokens' | 'maxPromptTokens' | 'maxActivationBytes' | 'maxOutputCharacters'> };
  publicJwk: JsonWebKey; signature: string;
}
export interface PartitionGrantAuthority {
  readonly participantId: string; readonly meshId: string;
  issue(identity: PartitionBinding, limits: PartitionLimits, controls: { approved: true; ttlMs: number }): Promise<PartitionGrant>;
  verify(grant: unknown, request: { identity: PartitionBinding; action: string;
    step?: number; inputTokenCount?: number; activationBytes?: number }, controls?: { settlement?: boolean }): Promise<boolean>;
  /** Denies subsequent local use. Settling the remote attempt propagates revocation to its replay guard. */
  revoke(grant: PartitionGrant): void;
  close(): void;
}
export function createPartitionGrantAuthority(options: { identity: SigningIdentity; meshId: string;
  maxGrants: number; maxTtlMs: number; now?: () => number }): PartitionGrantAuthority;
