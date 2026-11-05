import type { JsonValue, PackOperationRegistry } from './pool/pack-operation-adapters.js';
import type { SignedPackPeerMessage, PackPeerLimits } from './pool/peer-pack-job.js';
export interface Validation { readonly ok: boolean; readonly reasons: readonly string[] }
export interface HostContractPorts {
  readonly PEER_MESSAGE_TYPES: Readonly<Record<string, string>>;
  hashDopplerEvidence(value: unknown): Promise<string>;
  hashJson(value: unknown): Promise<string>;
  sha256Hex(value: string | BufferSource): Promise<string>;
  signCanonical(value: unknown, key: CryptoKey, options: { domain: string }): Promise<string>;
  verifyCanonicalSignature(value: unknown, key: string | CryptoKey, signature: string, options: { domain: string }): Promise<boolean>;
  validateExecutablePack(value: unknown): Validation;
  executablePacksMatch(a: unknown, b: unknown): boolean;
  validateOperationModel(value: unknown, registry?: PackOperationRegistry): Validation;
  assertOperationLimits(limits: unknown, definition: unknown): void;
  createSignedPeerMessage(input: Readonly<Record<string, JsonValue | CryptoKey>>): Promise<SignedPackPeerMessage>;
  verifyPeerMessage(message: unknown, options?: { now?: number }): Promise<Validation>;
  sealPeerAssignmentIdentity(input: { intentHash: string; providerId: string; assignmentAttemptId: string;
    routeDecisionHash: string; providerAdvertHash: string; providerParticipationProfileHash?: string | null;
    providerLimits: PackPeerLimits }): Promise<{ assignmentHash: string; assignmentId: string }>;
}
