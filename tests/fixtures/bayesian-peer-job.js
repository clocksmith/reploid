import { operationFixture, operationCapabilities, operationResources, packPeerIdentity } from './peer-pack-operation.js';
import { placementBeliefPolicy } from './placement-beliefs.js';
import { PACK_JOB_POLICY } from '../../self/pool/peer-pack-job-policy.js';
import { createPackPeerJob, createPackProviderAdvert, verifyPackPeerJob, signPackPeerMessage } from '../../self/pool/peer-pack-job.js';
import { operationPlacementContext } from '../../self/pool/peer-planning.js';

/** Real signatures and planner replay, synthetic execution/outcome identities. */
export async function bayesianPeerJobFixture() {
  const fixture = await operationFixture('embed');
  const identity = await packPeerIdentity();
  const providers = await Promise.all([packPeerIdentity(), packPeerIdentity()]);
  const policy = structuredClone(PACK_JOB_POLICY);
  policy.assignmentPolicy.history = { enabled: true, beliefPolicy: placementBeliefPolicy };
  const capabilities = await operationCapabilities(fixture.model);
  const limits = { maxInputBytes: 10000, maxOutputBytes: 10000, maxStreamBytes: 200000, maxEvents: 32, maxJobMs: 30000 };
  const adverts = await Promise.all(providers.map(identity => createPackProviderAdvert({ identity, models: [fixture.model],
    capabilities, limits, expiresAt: Date.now() + 30000, policy })));
  const args = { identity, adverts, model: fixture.model, input: fixture.input, options: fixture.options,
    resources: operationResources, limits: { ...limits, deadlineAt: Date.now() + 30000 },
    comparisonPolicy: fixture.policy, policy,
    consent: { schema: 'reploid.peer.public_operation_consent/v1', publicInput: true, providerIds: providers.map(row => row.keyId) } };
  const initial = await createPackPeerJob({ ...args, observations: [] });
  const target = providers.find(row => row.keyId !== initial.toPeerId).keyId;
  const requirements = { schema: 'reploid.pool.work-requirements/v1', modelIdentity: capabilities.models[0].identity,
    operation: { name: 'embed', version: 1 }, inputClass: 'public_text', adapterIdentities: [], expertIdentities: [],
    providerIds: args.consent.providerIds, resources: operationResources, limits };
  const contextId = await operationPlacementContext(requirements, capabilities, placementBeliefPolicy.cohortId);
  const observations = [1, 2, 3].map(i => ({ evidenceId: `measured-trial-${i}`, dependencyId: `trial-${i}`,
    contextId, providerId: target, observedAt: Date.now(), outcomeId: 'fast' }));
  const job = await createPackPeerJob({ ...args, observations });
  await verifyPackPeerJob(job, { providerId: target, models: [fixture.model], policy });
  const errors = [];
  for (const change of ['tamper', 'ungranted']) {
    try {
      let candidate = job;
      if (change === 'tamper') {
        const body = structuredClone(job.body);
        body.intent.planning.observations[0].outcomeId = 'failed';
        candidate = await signPackPeerMessage({ identity, type: job.type, recipient: job.toPeerId,
          expiresAt: Date.parse(job.expiresAt), body, policy });
      }
      await verifyPackPeerJob(candidate, { providerId: target, models: [fixture.model],
        policy: change === 'ungranted' ? PACK_JOB_POLICY : policy });
    } catch (error) { errors.push({ change, error: error.message }); }
  }
  return { initialProviderId: initial.toPeerId, selectedProviderId: job.toPeerId, target,
    observations: job.body.intent.planning.observations, plan: job.body.intent.planning.plan, errors };
}
