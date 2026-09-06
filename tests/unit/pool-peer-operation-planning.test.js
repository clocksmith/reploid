// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { planOperationProviders } from '../../self/pool/peer-planning.js';
import { resolveProviderCapabilitySchema, resolvePeerAssignmentPolicy, validateProviderCapabilities } from '../../self/pool/peer-capabilities.js';
import { PACK_JOB_POLICY } from '../../self/pool/peer-pack-job-policy.js';
import { operationFixture, operationCapabilities, operationResources } from '../fixtures/peer-pack-operation.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';

const hash = character => `sha256:${character.repeat(64)}`;
async function fixture(operation = 'embed') {
  const f = await operationFixture(operation), capabilities = await operationCapabilities(f.model), now = Date.now();
  capabilities.observedAt = now;
  const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 30000 };
  const requirements = { schema: 'reploid.pool.work-requirements/v1', modelIdentity: await hashDopplerEvidence(f.model),
    operation: { name: operation, version: 1 }, inputClass: operation === 'encodeSequence' ? 'public_biological_sequence' : 'public_text',
    adapterIdentities: [], expertIdentities: [], providerIds: [hash('a'), hash('b')], resources: operationResources, limits };
  return { requirements, now, policy: structuredClone(PACK_JOB_POLICY.assignmentPolicy), capabilitySchema: PACK_JOB_POLICY.providerCapabilitySchema,
    observations: null, candidates: [
      { providerId: hash('a'), advertHash: hash('c'), limits, capabilities: structuredClone(capabilities) },
      { providerId: hash('b'), advertHash: hash('d'), limits, capabilities: structuredClone(capabilities) }
    ] };
}

describe('operation-independent deterministic provider planning', () => {
  for (const name of ['generate', 'embed', 'rerank', 'encodeSequence']) it(`plans ${name} from the same capability contract`, async () => {
    const args = await fixture(name);
    args.candidates[0].capabilities.models[0].availability = 'fetchable';
    const first = await planOperationProviders(args);
    expect(first.selectedProviderId).toBe(hash('b'));
    expect(first).toEqual(await planOperationProviders({ ...args, candidates: [...args.candidates].reverse() }));
    expect(Object.isFrozen(first.candidates[0].metrics)).toBe(true);
    expect(first.historyProjectionDigest).toBeNull();
  });

  it('excludes incompatible identity, operation, permissions and budgets before ranking', async () => {
    for (const [edit, reason] of [
      [c => { c.models[0].identity = hash('e'); }, 'model-unavailable'],
      [c => { c.operations[0].version = 2; }, 'operation-unavailable'],
      [c => { c.inputClasses = ['another-class']; }, 'input-class-not-permitted'],
      [c => { c.resources.gpuBudgetBytes = 1; }, 'gpu-budget'],
      [c => { c.resources.storageFreeBytes = 0; }, 'storage-budget'],
      [c => { c.resources.activeJobs = 1; }, 'busy'],
      [c => { c.observedAt -= 31000; }, 'stale-observation']
    ]) {
      const args = await fixture(); edit(args.candidates[0].capabilities);
      const result = await planOperationProviders(args);
      expect(result.selectedProviderId).toBe(hash('b'));
      expect(result.candidates[0].reasons).toContain(reason);
    }
  });

  it('makes adapter fetching and unknown physical memory explicit policy decisions', async () => {
    const args = await fixture(); args.requirements.adapterIdentities = [hash('e')];
    args.policy.allowAdapterFetching = false;
    for (const candidate of args.candidates) candidate.capabilities.adapters = [{ identity: hash('e'), availability: 'fetchable' }];
    expect((await planOperationProviders(args)).selectedProviderId).toBeNull();
    args.policy.allowAdapterFetching = true;
    expect((await planOperationProviders(args)).selectedProviderId).toBe(hash('a'));
    args.policy.unknownFreeMemory = 'reject';
    expect((await planOperationProviders(args)).selectedProviderId).toBeNull();
    for (const candidate of args.candidates) Object.assign(candidate.capabilities.resources, { gpuFreeBytes: 8192, storageFreeBytes: 8192 });
    expect((await planOperationProviders(args)).selectedProviderId).toBe(hash('a'));
  });

  it('uses configured metric order and never consumes mutable scientific evidence', async () => {
    const args = await fixture();
    args.candidates[0].capabilities.resources.queuedJobs = 2;
    expect((await planOperationProviders(args)).selectedProviderId).toBe(hash('b'));
    args.policy.ranking = [{ metric: 'providerId', order: 'asc' }];
    expect((await planOperationProviders(args)).selectedProviderId).toBe(hash('a'));
    await expect(planOperationProviders({ ...args, observations: { scientificClaims: [] } })).rejects.toThrow('historical selection is disabled');
  });

  it('selects one latest observation per provider independent of message order', async () => {
    const args = await fixture(), newer = structuredClone(args.candidates[0]);
    args.candidates[0].capabilities.observedAt -= 1;
    args.candidates[0].capabilities.resources.queuedJobs = 99;
    newer.advertHash = hash('e'); args.candidates.push(newer);
    const plan = await planOperationProviders(args);
    expect(plan.candidates).toHaveLength(2);
    expect(plan.candidates[0].advertHash).toBe(hash('e'));
    expect(await planOperationProviders({ ...args, candidates: args.candidates.reverse() })).toEqual(plan);
  });

  it('rejects absent policy, invented availability and omitted observations', async () => {
    const args = await fixture();
    expect(() => resolveProviderCapabilitySchema(undefined)).toThrow();
    const policy = structuredClone(args.policy); delete policy.unknownFreeMemory;
    expect(() => resolvePeerAssignmentPolicy(policy, args.capabilitySchema)).toThrow('unknown memory policy');
    const cap = structuredClone(args.candidates[0].capabilities); delete cap.resources.gpuFreeBytes;
    expect(() => validateProviderCapabilities(cap, { schema: args.capabilitySchema, now: args.now })).toThrow('gpuFreeBytes');
    cap.resources.gpuFreeBytes = null; cap.models[0].availability = 'probably-ready';
    expect(() => validateProviderCapabilities(cap, { schema: args.capabilitySchema, now: args.now })).toThrow('models observation');
  });

  it('freezes caller inputs before asynchronous plan hashing', async () => {
    const args = await fixture(), pending = planOperationProviders(args);
    args.candidates[0].capabilities.resources.activeJobs = 1;
    args.policy.ranking[0].order = 'desc';
    const plan = await pending;
    expect(plan.selectedProviderId).toBe(hash('a'));
    expect(plan.candidates[0].metrics.activeJobs).toBe(0);
  });
});
