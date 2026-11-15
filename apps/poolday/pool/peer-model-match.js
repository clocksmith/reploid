/** One exact model/pack/adapter predicate for discovery, planning and admission.
 * Policy acceptance and runtime-profile verification remain separate gates.
 */
import { executablePacksMatch } from '../../../shared/pool/executable-pack.js';
import { modelSupportsPoolWorkload, POOLDAY_MODEL_WORKLOADS } from '../../../shared/pool/model-contract.js';
import { modelSupportsAdapterRequirement } from '../../../shared/pool/adapter-pack.js';

export function providerModelMatches(model, requirements, workload = requirements?.workload ?? POOLDAY_MODEL_WORKLOADS.sequenceEmbedding) {
  if (!model || !requirements) return false;
  return ['modelId', 'modelHash', 'manifestHash', 'runtime', 'backend']
    .every(key => typeof requirements[key] === 'string' && model[key] === requirements[key])
    && executablePacksMatch(model.executablePack, requirements.executablePack)
    && modelSupportsPoolWorkload(model, workload)
    && modelSupportsAdapterRequirement(model, requirements.adapter ?? null);
}

export function advertSupportsModel(advert, requirements, workload) {
  return Array.isArray(advert?.body?.models)
    && advert.body.models.some(model => providerModelMatches(model, requirements, workload));
}
