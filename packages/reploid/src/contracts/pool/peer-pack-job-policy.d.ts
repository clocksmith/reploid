import type { OperationAcceptancePolicy } from './operation-acceptance.js';
import type { AdapterExecutionPolicy } from './adapter-execution.js';
import type { ProviderPersistencePolicy } from '../infrastructure/pack-job-storage.js';
import type { JsonValue } from './pack-operation-adapters.js';
import type { PeerAssignmentPolicy, ProviderCapabilitySchema } from './peer-capabilities.js';
interface PackJobPolicyBase {
  readonly schema: 'reploid.pool.peer-job-policy/v1';
  readonly schemas: Readonly<Record<'job' | 'legacyJob' | 'update' | 'cancel' | 'record' | 'legacyRecord', string>>;
  readonly limits: Readonly<Record<'maxWireBytes' | 'maxInputBytes' | 'maxOutputBytes' | 'maxStreamBytes' | 'maxEvents' | 'maxJobMs'
    | 'maxInboxMessages' | 'maxModels' | 'maxConsentProviders' | 'maxIdentityCharacters' | 'maxPublicKeyCharacters' | 'maxClockSkewMs', number>>;
  readonly attempts: { readonly initialNumber: number; readonly maximumNumber: number };
  readonly retry: Readonly<Record<'maxDeliveries' | 'delayMs' | 'maximumDeliveries' | 'minimumDelayMs' | 'maximumDelayMs', number>>;

  readonly persistence: ProviderPersistencePolicy;
}
export interface CurrentPackJobPolicy extends PackJobPolicyBase {
  readonly version: 3;
  readonly acceptance: OperationAcceptancePolicy;
  readonly execution: { readonly maxConcurrentJobs: 1; readonly adapters: AdapterExecutionPolicy };
  readonly schemas: PackJobPolicyBase['schemas'] & Readonly<Record<'providerAdvert' | 'legacyProviderAdvert', string>>;
  readonly providerCapabilitySchema: ProviderCapabilitySchema;
  readonly assignmentPolicy: PeerAssignmentPolicy;
}
export interface LegacyPackJobPolicy extends PackJobPolicyBase { readonly version: 1; readonly execution: { readonly adapterSet: readonly JsonValue[] } }
export interface ResourcePackJobPolicy extends Omit<CurrentPackJobPolicy, 'version' | 'execution' | 'acceptance'> { readonly version: 2; readonly execution: { readonly adapterSet: readonly JsonValue[]; readonly maxConcurrentJobs: 1 } }
export type PackJobPolicy = CurrentPackJobPolicy | ResourcePackJobPolicy | LegacyPackJobPolicy;
export function resolvePackJobPolicy(input: unknown): PackJobPolicy;
export const PACK_JOB_POLICY: CurrentPackJobPolicy;
