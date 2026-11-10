import { assertPartition as assert, canonicalRouteAttemptBinding, canonicalPartitionJson } from './partition-contract.js';

/** One host-owned route identity mapped consistently across the provider session lifecycle. */
export function createResidentRouteBinding({ ordered, allocation }) {
  const stage = structuredClone(ordered.stage), runtime = ordered.runtime;
  assert(allocation.plan?.schema === 'doppler.layer-partition-contract/v3'
    && stage?.index === allocation.index && stage.participantId === allocation.participantId
    && ['transportId', 'residentId', 'executionId'].every(key => typeof stage[key] === 'string' && stage[key].length > 0)
    && ['hashLayerPartitionPlan', 'hashPartitionGeneration', 'getPartitionActivationContract'].every(key => typeof runtime?.[key] === 'function'),
  'Explicit ordered resident provider and stage binding required');
  const activation = structuredClone(runtime.getPartitionActivationContract(allocation.plan));
  const identity = input => {
    const binding = canonicalRouteAttemptBinding(input), route = binding.route;
    assert(route.modelId === allocation.model.id && route.modelIdentity === allocation.model.identity
      && route.planId === allocation.planId && route.stages.length === allocation.plan.stageCount
      && canonicalPartitionJson(route.stages[allocation.index]) === canonicalPartitionJson(stage)
      && canonicalPartitionJson(route.activation) === canonicalPartitionJson(activation), 'Ordered resident route differs from allocation');
    return binding;
  };
  const providerIdentity = input => {
    const binding = identity(input);
    return { schema: 'doppler.resident-partition-attempt/v2', modelId: binding.route.modelId,
      modelIdentity: binding.route.modelIdentity, planId: binding.route.planId, threadId: binding.threadId,
      attemptId: binding.attemptId, requesterId: binding.requesterId, placementGeneration: binding.placementGeneration,
      stages: structuredClone(binding.route.stages) };
  };
  return Object.freeze({ stage: Object.freeze(stage), identity,
    async prepare() { assert(await runtime.hashLayerPartitionPlan(allocation.plan) === allocation.planId, 'Ordered resident plan identity mismatch'); },
    generationDigest: generation => runtime.hashPartitionGeneration(generation),
    wrap(session) {
      const request = input => ({ ...input, identity: providerIdentity(input.identity) });
      return Object.freeze({ ...session,
        tokenize: input => session.tokenize(request(input)),
        closeAttempt: input => session.closeAttempt(request(input)),
        async executeStage(input) {
          assert(input.partitionIndex === allocation.index, 'Ordered resident stage mismatch');
          const binding = identity(input.identity), mapped = request(input);
          const output = await session.executeStage(mapped);
          assert(output?.partitionIndex === allocation.index && output.step === input.step && output.tokenPosition === input.tokenPosition
            && canonicalPartitionJson(output.identity) === canonicalPartitionJson(mapped.identity), 'Ordered runtime result identity mismatch');
          return { ...output, identity: binding };
        }
      });
    }
  });
}
