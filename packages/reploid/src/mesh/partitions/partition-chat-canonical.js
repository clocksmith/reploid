import { assertPartition as assert, canonicalPartitionJson } from './partition-contract.js';
import { validateEntryPublicationContext } from './partition-entry-publication.js';

/** Fixed two-stage chat composition. Actual residents supply generation/stages;
 * Doppler and the existing grant owner supply attempt and disclosure identities. */
export function createCanonicalChatBinding({ runtime, local, remote, authority, model, plan, planId, limits, coordinatorEpoch }) {
  assert(/^[a-f0-9]{32}$/.test(coordinatorEpoch) && ['metadataDigest', 'canonicalGenerationIdentity',
    'validateResidentAttemptIdentity', 'tokenDigest', 'hashLayerPartitionPlan'].every(name => typeof runtime[name] === 'function')
    && ['canonicalScope', 'issueCanonical'].every(name => typeof authority[name] === 'function')
    && [local, remote].every(device => ['getCanonicalStage', 'getCanonicalGeneration'].every(name => typeof device[name] === 'function')),
  'Canonical chat requires declared runtime, grant and resident capabilities');
  assert(runtime.hashLayerPartitionPlan(plan) === planId, 'Canonical chat plan mismatch');
  const same = (a, b) => canonicalPartitionJson(a) === canonicalPartitionJson(b);
  const grantLimits = Object.fromEntries(['maxTokens', 'maxPromptTokens', 'maxActivationBytes', 'maxOutputCharacters']
    .map(key => [key, limits[key]]));
  const describe = () => {
    const supplied = local.getCanonicalGeneration(), target = remote.getCanonicalGeneration();
    const stages = [local.getCanonicalStage(), remote.getCanonicalStage()];
    if (!supplied || !target || stages.some(stage => !stage)) return null;
    const generation = runtime.canonicalGenerationIdentity(supplied.policy, supplied.executionIdentity, plan.vocabSize);
    assert(same(generation, supplied) && same(generation, target), 'Canonical stages use different generation contracts');
    assert(generation.policy.maxGeneratedTokens <= limits.maxTokens
      && generation.policy.maxVisibleOutputUtf16 <= limits.maxOutputCharacters, 'Canonical generation exceeds chat allocation');
    const routeId = runtime.metadataDigest('reploid.canonical-chat-route/v1', { meshId: authority.meshId,
      modelId: model.id, modelIdentity: model.identity, planId, coordinatorEpoch, stages, generationId: generation.generationId });
    return { coordinatorEpoch, routeId, stages, generation, vocabSize: plan.vocabSize };
  };
  const check = (context, binding, publication) => {
    validateEntryPublicationContext(context, binding);
    const current = describe();
    assert(current && Object.keys(current).every(key => same(current[key], context[key])), 'Canonical chat placement or generation changed');
    assert(context.deadlineAt > Date.now() && publication?.requiresCommitEvidence === true
      && ['reconcile', 'admitAttempt', 'publish', 'cancel'].every(name => typeof publication[name] === 'function'),
    'Canonical requester publication or deadline unavailable');
    return structuredClone(context);
  };
  return Object.freeze({ describe, check,
    attempt({ context, binding, publication, tokenIds }) {
      context = check(context, binding, publication);
      return runtime.validateResidentAttemptIdentity({ schema: 'doppler.resident-attempt/v2', attemptId: binding.attemptId,
        requesterId: binding.requesterId, inputDigest: runtime.tokenDigest(tokenIds, plan.vocabSize, limits.maxPromptTokens),
        authorizationScope: authority.canonicalScope({ identity: binding, limits: grantLimits,
          disclosure: 'partition-activations-and-tokens', generationId: context.generation.generationId }),
        routeId: context.routeId, generationId: context.generation.generationId, coordinatorEpoch, publisherEpoch: context.publisherEpoch,
        routeKind: 'two-stage-layer', stages: context.stages });
    },
    grantLimits: Object.freeze(grantLimits),
  });
}
