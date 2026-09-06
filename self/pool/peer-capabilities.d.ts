export type ArtifactAvailability = 'resident' | 'cached' | 'fetchable';
export interface ProviderCapabilitySchema {
  readonly schema: 'reploid.pool.capability-policy/v1';
  readonly version: 1;
  readonly observationSchema: 'reploid.peer.capabilities/v1';
  readonly availabilityStates: readonly ArtifactAvailability[];
  readonly maxModels: number;
  readonly maxAdapters: number;
  readonly maxExperts: number;
  readonly maxOperations: number;
  readonly maxInputClasses: number;
  readonly maxIdentityCharacters: number;
  readonly maxObservationAgeMs: number;
  readonly maxClockSkewMs: number;
}
export interface ProviderArtifactObservation {
  readonly identity: string;
  readonly availability: ArtifactAvailability;
}
export interface ProviderCapabilities {
  readonly schema: 'reploid.peer.capabilities/v1';
  readonly observedAt: number;
  readonly gpuIdentity: Readonly<Record<'vendor' | 'architecture' | 'device' | 'description', string>> | null;
  readonly models: readonly ProviderArtifactObservation[];
  readonly adapters: readonly ProviderArtifactObservation[];
  readonly experts: readonly (ProviderArtifactObservation & { readonly modelIdentity: string; readonly layer: number; readonly expert: number })[];
  readonly operations: readonly { readonly name: string; readonly version: number }[];
  readonly inputClasses: readonly string[];
  readonly resources: {
    readonly gpuBudgetBytes: number;
    readonly gpuFreeBytes: number | null;
    readonly storageBudgetBytes: number;
    readonly storageFreeBytes: number | null;
    readonly bandwidthBytesPerSecond: number;
    readonly concurrency: number;
    readonly activeJobs: number;
    readonly queuedJobs: number;
  };
}
export type AssignmentMetric = 'modelAvailability' | 'adapterAvailability' | 'activeJobs' | 'queuedJobs'
  | 'gpuBudgetBytes' | 'bandwidthBytesPerSecond' | 'providerId';
export interface PeerAssignmentPolicy {
  readonly schema: 'reploid.pool.assignment-policy/v1';
  readonly version: 1;
  readonly policyId: string;
  readonly modelAvailabilityOrder: readonly ArtifactAvailability[];
  readonly adapterAvailabilityOrder: readonly ArtifactAvailability[];
  readonly allowModelFetching: boolean;
  readonly allowAdapterFetching: boolean;
  readonly requireAvailableSlot: boolean;
  readonly minimumFreeGpuBytes: number;
  readonly minimumFreeStorageBytes: number;
  readonly minimumBandwidthBytesPerSecond: number;
  readonly maxObservationAgeMs: number;
  readonly maxCandidates: number;
  readonly unknownFreeMemory: 'reject' | 'budget-only';
  readonly duplicateProviders: 'newest-observation-then-message-hash';
  readonly invalidAdvertisement: 'reject';
  readonly history: { readonly enabled: false };
  readonly ranking: readonly { readonly metric: AssignmentMetric; readonly order: 'asc' | 'desc' }[];
}
export interface WorkRequirements {
  readonly schema: 'reploid.pool.work-requirements/v1';
  readonly modelIdentity: string;
  readonly operation: { readonly name: string; readonly version: number };
  readonly adapterIdentities: readonly string[];
  readonly expertIdentities: readonly string[];
  readonly providerIds: readonly string[];
  readonly inputClass: string;
  readonly resources: Readonly<Record<'gpuBytes' | 'storageBytes' | 'bandwidthBytesPerSecond', number>>;
  readonly limits: Readonly<Record<'maxInputBytes' | 'maxOutputBytes' | 'maxStreamBytes' | 'maxEvents' | 'maxJobMs', number>>;
}
export function resolveProviderCapabilitySchema(input: unknown): ProviderCapabilitySchema;
export function resolvePeerAssignmentPolicy(input: unknown, capabilitySchema: ProviderCapabilitySchema): PeerAssignmentPolicy;
export function validateProviderCapabilities(input: unknown, context: { schema: ProviderCapabilitySchema; now: number }): ProviderCapabilities;
export function validateWorkRequirements(input: unknown): WorkRequirements;
