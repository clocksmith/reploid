import config from './pool-config.json' with { type: 'json' };
import { freezeOperationPolicy } from './pack-operation-policy.js';
import { resolveProviderCapabilitySchema, resolvePeerAssignmentPolicy } from './peer-capabilities.js';
const assert = (ok, message) => { if (!ok) throw new Error(`Peer Pack policy: ${message}`); };
const positive = value => Number.isSafeInteger(value) && value > 0;

export function resolvePackJobPolicy(input) {
  const policy = freezeOperationPolicy(input);
  assert(policy?.schema === 'reploid.pool.peer-job-policy/v1' && [1, 2].includes(policy.version), 'supported versioned policy required');
  for (const name of ['job', 'legacyJob', 'update', 'cancel', 'record', 'legacyRecord']) assert(typeof policy.schemas?.[name] === 'string', `schemas.${name} required`);
  for (const name of ['maxWireBytes', 'maxInputBytes', 'maxOutputBytes', 'maxStreamBytes', 'maxEvents', 'maxJobMs', 'maxInboxMessages',
    'maxModels', 'maxConsentProviders', 'maxIdentityCharacters', 'maxPublicKeyCharacters', 'maxClockSkewMs']) assert(positive(policy.limits?.[name]), `limits.${name} required`);
  const p = policy.persistence, r = policy.retry;
  for (const name of ['databaseVersion', 'maxRecords', 'recordCeiling', 'maxSavedBytes', 'byteCeiling', 'retentionMs', 'maxFutureMs',
    'maxIdentityCharacters', 'storageTimeoutMs']) assert(positive(p?.[name]), `persistence.${name} required`);
  assert(typeof p.databaseName === 'string' && p.databaseName.length > 0 && typeof p.storeName === 'string' && p.storeName.length > 0
    && p.recordSchema === policy.schemas.record && p.legacyRecordSchema === policy.schemas.legacyRecord, 'storage identity required');
  assert(p.storageFailureBehavior === 'reject' && p.cleanup === 'expire-then-delete-after-retention' && p.durability === 'strict', 'unsupported persistence behavior');
  assert(p.maxRecords <= p.recordCeiling && p.maxSavedBytes <= p.byteCeiling && p.maxFutureMs >= policy.limits.maxJobMs, 'inconsistent persistence bounds');
  const states = ['accepted', 'running', 'completed', 'cancelled', 'interrupted', 'expired'];
  assert(Array.isArray(p.states) && p.states.length === states.length && states.every(state => p.states.includes(state)), 'attempt state contract required');
  for (const [status, state] of Object.entries({ partial: 'running', completed: 'completed', cancelled: 'cancelled', failed: 'interrupted', busy: 'interrupted' })) {
    assert(p.outcomeStates?.[status] === state, `unsupported terminal state mapping for ${status}`);
  }
  for (const [prior, next] of Object.entries({ running: 'interrupted', completed: 'completed', failed: 'interrupted', busy: 'interrupted',
    cancelled: 'cancelled', interrupted: 'interrupted' })) assert(p.legacyStates?.[prior] === next, 'legacy attempt state mapping invalid');
  for (const name of ['maxDeliveries', 'delayMs', 'maximumDeliveries', 'minimumDelayMs', 'maximumDelayMs']) assert(positive(r?.[name]), `retry.${name} required`);
  assert(r.maxDeliveries <= r.maximumDeliveries && r.delayMs >= r.minimumDelayMs && r.delayMs <= r.maximumDelayMs, 'retry bounds conflict');
  assert(positive(policy.attempts?.initialNumber) && positive(policy.attempts.maximumNumber)
    && policy.attempts.initialNumber <= policy.attempts.maximumNumber, 'explicit attempt numbering required');
  assert(Array.isArray(policy.execution?.adapterSet) && policy.execution.adapterSet.length === 0, 'explicit unadapted execution set required');
  if (policy.version === 2) {
    assert(policy.execution.maxConcurrentJobs === 1, 'current executor supports one concurrent job');
    assert(policy.schemas.job === 'reploid.peer.pack_job/v3' && policy.schemas.providerAdvert === 'reploid.peer.pack_provider/v2'
      && policy.schemas.legacyProviderAdvert === 'reploid.peer.pack_provider/v1', 'resource advertisement protocol required');
    const capabilitySchema = resolveProviderCapabilitySchema(policy.providerCapabilitySchema);
    resolvePeerAssignmentPolicy(policy.assignmentPolicy, capabilitySchema);
  }
  return policy;
}

export const PACK_JOB_POLICY = resolvePackJobPolicy(config.peerJobs);
assert(PACK_JOB_POLICY.version === 2, 'current runtime requires resource planning policy');
