import type { PartitionRuntime, PartitionPlan, ActivationFrame } from './partition-runner.js';
import type { PartitionCommitRuntime } from './partition-stage-commit.js';
import type { CanonicalPartitionPhaseRequest } from './partition-step-receiver.js';
export interface CanonicalPartitionWireRuntime extends PartitionRuntime, PartitionCommitRuntime {
  tokenDigest(tokens: readonly number[], vocabSize: number, maxTokens: number): string;
  validateResidentCursor(input: unknown, policy: unknown, vocabSize: number): {
    cursorId: string; generationId: string; terminal: boolean; revision: number;
    materializedTokenCount: number; pendingTokenId: number; acceptedTokenDigest: string;
  };
  validateOrdinaryActivation(input: unknown, bytes: Uint8Array, limits: { maxRows: number; maxBytes: number }): { bytes: Uint8Array };
  validateExecutionPublication(input: unknown, attempt: unknown, policy: unknown, vocabSize: number, base: unknown): unknown;
  validateAdmissionPublication(input: unknown, attempt: unknown, policy: unknown, vocabSize: number): unknown;
}
export interface CanonicalPartitionContract {
  readonly schema: 'reploid.canonical-partition-request/v1';
  validateBinding(request: CanonicalPartitionPhaseRequest): unknown;
  validateControl(request: CanonicalPartitionPhaseRequest): boolean;
  validateHeader(request: CanonicalPartitionPhaseRequest, byteLength: number): boolean;
  fingerprint(request: CanonicalPartitionPhaseRequest): Promise<string>;
  serializeActivation(request: CanonicalPartitionPhaseRequest & {
    activationTensor: Omit<Parameters<PartitionRuntime['serializeActivationFrame']>[0], 'metadata'>;
  }): Promise<ActivationFrame>;
  validatePayload(request: CanonicalPartitionPhaseRequest, payload: Uint8Array): ReturnType<PartitionRuntime['deserializeActivationFrame']>;
  /** Verifies signed stage results and exact coordinator receipt; does not attest remote storage. */
  verifyPublication(request: CanonicalPartitionPhaseRequest, retainedResult: unknown): Promise<boolean>;
}
export function createCanonicalPartitionContract(options: {
  runtime: CanonicalPartitionWireRuntime; plan: PartitionPlan; planId: string; modelIdentity: string;
}): CanonicalPartitionContract;
