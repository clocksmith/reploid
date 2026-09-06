import { validateExecutablePack } from './executable-pack.js';
import { createPackOperationRegistry } from './pack-operation-adapters.js';

export const PACK_EXECUTION_MODE = 'complete_pack_browser';
export const PACK_OPERATION_WORKLOADS = Object.freeze({
  generate: 'text-generation', embed: 'embedding', rerank: 'reranking', encodeSequence: 'sequence.embedding.v1'
});

export function validateOperationModel(model, registry = createPackOperationRegistry()) {
  const reasons = [...validateExecutablePack(model?.executablePack).reasons];
  const operation = model?.executablePack?.requiredOperation;
  if (!Object.hasOwn(registry, operation || '')) reasons.push('Unknown Pack operation');
  if (typeof model?.modelId !== 'string' || !model.modelId) reasons.push('Exact model id required');
  if (model?.runtime !== 'doppler' || model?.backend !== 'browser-webgpu'
    || model?.executionMode !== PACK_EXECUTION_MODE) reasons.push('Explicit complete browser Pack execution required');
  if (model?.workload !== PACK_OPERATION_WORKLOADS[operation]) reasons.push('Workload does not match Pack operation');
  if (model?.modelHash !== model?.executablePack?.semanticRoot
    || model?.manifestHash !== model?.executablePack?.envelopeDigest) reasons.push('Model identity must bind the exact executable Pack');
  for (const field of ['distributedExecution', 'executionTopology', 'modelSplit', 'modelPartitions',
    'partitionPlan', 'splitPlan', 'kvShardPlan', 'attentionShardPlan']) {
    if (model?.[field] !== undefined && model[field] !== null && model[field] !== false) reasons.push(`Unsupported ${field}`);
  }
  return { ok: reasons.length === 0, reasons };
}
