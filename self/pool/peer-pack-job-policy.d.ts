import type { ProviderPersistencePolicy } from '../infrastructure/pack-job-storage.js';
import type { JsonValue } from './pack-operation-adapters.js';
export interface PackJobPolicy {
  readonly schema: 'reploid.pool.peer-job-policy/v1';
  readonly version: number;
  readonly schemas: Readonly<Record<'job' | 'legacyJob' | 'update' | 'cancel' | 'record' | 'legacyRecord', string>>;
  readonly limits: Readonly<Record<'maxWireBytes' | 'maxInputBytes' | 'maxOutputBytes' | 'maxStreamBytes' | 'maxEvents' | 'maxJobMs'
    | 'maxInboxMessages' | 'maxModels' | 'maxConsentProviders' | 'maxIdentityCharacters' | 'maxPublicKeyCharacters' | 'maxClockSkewMs', number>>;
  readonly attempts: { readonly initialNumber: number; readonly maximumNumber: number };
  readonly retry: Readonly<Record<'maxDeliveries' | 'delayMs' | 'maximumDeliveries' | 'minimumDelayMs' | 'maximumDelayMs', number>>;
  readonly execution: { readonly adapterSet: readonly JsonValue[] };
  readonly persistence: ProviderPersistencePolicy;
}
export function resolvePackJobPolicy(input: unknown): PackJobPolicy;
export const PACK_JOB_POLICY: PackJobPolicy;
