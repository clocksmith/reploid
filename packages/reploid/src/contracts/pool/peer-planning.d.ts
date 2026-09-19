import type { AssignmentMetric, PeerAssignmentPolicy, ProviderCapabilities, ProviderCapabilitySchema, WorkRequirements } from './peer-capabilities.js';
export interface OperationProviderCandidate {
  readonly providerId: string;
  readonly advertHash: string;
  readonly capabilities: ProviderCapabilities;
  readonly limits: WorkRequirements['limits'];
}
export interface OperationCandidateAssessment {
  readonly providerId: string;
  readonly advertHash: string;
  readonly eligible: boolean;
  readonly reasons: readonly string[];
  readonly metrics: Readonly<Record<Exclude<AssignmentMetric, 'providerId'>, number>> & { readonly providerId: string };
  readonly unknownMemory: { readonly gpu: boolean; readonly storage: boolean };
}
export interface OperationAssignmentPlan {
  readonly schema: 'reploid.pool.operation-assignment-plan/v1';
  readonly policyId: string;
  readonly policyDigest: string;
  readonly requirementsDigest: string;
  readonly selectedAt: number;
  readonly historyProjectionDigest: null;
  readonly candidates: readonly OperationCandidateAssessment[];
  readonly orderedProviderIds: readonly string[];
  readonly selectedProviderId: string | null;
}
export function planOperationProviders(input: { requirements: WorkRequirements; candidates: readonly OperationProviderCandidate[];
  policy: PeerAssignmentPolicy; capabilitySchema: ProviderCapabilitySchema; now: number; observations: null }): Promise<OperationAssignmentPlan>;
type LegacyObject = Record<string, unknown>;
export function peerIdForMessage(message?: LegacyObject): string | undefined;
export function selectRuntimeCompatibleAdverts(options?: LegacyObject): LegacyObject;
export function candidateSortKey(options: LegacyObject): Promise<string>;
export function intentWorkload(intent?: LegacyObject): string;
export function intentMaxTokens(intent?: LegacyObject): number;
export function providerAssignmentLimits(advert?: LegacyObject): Record<string, number>;
export function agreementFieldForIntent(intent?: LegacyObject, policy?: LegacyObject): string;
export function buildPeerRingPlan(options: LegacyObject): Promise<LegacyObject>;
