/** Operator-local model configuration; never public catalog or release authority. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Digest } from './hashing.js';
import { resolveGenerationOptions } from '../shared/config/doppler-generation-contract.js';
import { createWorkPartitionPlan } from '../apps/poolday/host/work-partition-plan.js';
import { modelToolCallFormat } from '../shared/infrastructure/tool-call-constraint.js';

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

/** The whole-model gather policy of an operator configuration or a catalog entry, validated and copied. */
export function validateWholeRuntime(model, wholeRuntime) {
  const gather = wholeRuntime?.gather;
  requireValue(wholeRuntime && Object.keys(wholeRuntime).every(key => ['gather', 'reversePromptBackend'].includes(key))
    && (wholeRuntime.reversePromptBackend === undefined || typeof wholeRuntime.reversePromptBackend === 'string'
      && /^sha256:[a-f0-9]{64}$/.test(wholeRuntime.reversePromptBackend)), 'Whole-model runtime policy is invalid');
  if (gather === undefined && wholeRuntime.reversePromptBackend) return structuredClone(wholeRuntime);
  requireValue(gather && Object.keys(gather).every(key => ['maxPartBytes', 'memoryBudgetBytes', 'concurrency', 'maxRanges', 'verificationCache'].includes(key))
    && ['maxPartBytes', 'memoryBudgetBytes', 'concurrency'].every(key => Number.isSafeInteger(gather[key]) && gather[key] > 0)
    && (gather.maxRanges === undefined || Number.isSafeInteger(gather.maxRanges) && gather.maxRanges > 0 && gather.maxRanges <= 32)
    && (gather.verificationCache === undefined || Object.keys(gather.verificationCache).every(key => key === 'directory')
      && typeof gather.verificationCache.directory === 'string' && path.isAbsolute(gather.verificationCache.directory)),
  'Whole-model runtime requires explicit gather bounds and concurrency, and an absolute verification cache directory when one is named');
  requireValue(model.executionModes?.includes('whole-model')
    && model.source?.files?.some(row => row.role === 'model-piece-index' && row.hashAlgorithm === 'sha256'),
  'Whole-model gathering requires a whole-model catalog entry with a pinned piece index');
  return structuredClone(wholeRuntime);
}

/** A catalog entry's gather policy on this machine. A catalog names bounds only; where verified state is
 * remembered is this machine's choice, beside the provider's identity. */
export function catalogWholeRuntime(model, stateDirectory) {
  const wholeRuntime = validateWholeRuntime(model, model.wholeRuntime);
  if (!wholeRuntime.gather) return wholeRuntime;
  requireValue(wholeRuntime.gather.verificationCache === undefined, 'Whole-model runtime in the catalog cannot name a machine directory');
  requireValue(path.isAbsolute(stateDirectory), 'Whole-model verification state requires an absolute directory');
  wholeRuntime.gather.verificationCache = { directory: path.join(stateDirectory, 'piece-state') };
  return wholeRuntime;
}

export async function readNativeModelConfiguration(file, { modelId, modelDirectory, models = [],
  loadRuntime = () => import('dopplerx/partitions') }) {
  requireValue(path.isAbsolute(file), 'Native model configuration requires an absolute JSON path');
  const configuration = JSON.parse(await fs.readFile(file, 'utf8'));
  requireValue(configuration?.schema === 'reploid.native-model/v1'
    && Object.keys(configuration).every(key => ['schema', 'model', 'partition', 'partitionRuntime', 'wholeRuntime'].includes(key)),
  'Unknown native model configuration schema or field');
  const catalogReference = typeof configuration.model === 'string';
  const model = structuredClone(catalogReference ? models.find(row => row.id === configuration.model) : configuration.model);
  requireValue(model?.id === modelId && model.provider === 'doppler' && typeof model.name === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(model.identity), 'Native model configuration requires an exact Doppler model identity');
  model.generation = resolveGenerationOptions(model.generation);
  // An optional `toolCallFormat` makes a whole-model provider advertise tools; an unknown one is refused here.
  modelToolCallFormat(model);
  const root = await fs.realpath(modelDirectory);
  const manifestPath = await fs.realpath(path.join(root, 'manifest.json'));
  requireValue(path.dirname(manifestPath) === root, 'Native model manifest escapes the approved directory');
  const bytes = await fs.readFile(manifestPath);
  requireValue(sha256Digest(bytes) === model.identity,
    'Native model configuration differs from the actual manifest');
  const manifest = JSON.parse(bytes);
  requireValue(manifest.modelId === model.id, 'Native model configuration differs from the actual model id');
  if (configuration.partitionRuntime !== undefined) model.partitionRuntime = structuredClone(configuration.partitionRuntime);
  // Whole-model loading through authenticated worker gathering: every weight piece is hashed against the
  // model's pinned piece index before use, by parallel workers, and what was verified is remembered for the
  // file's current state. Without it a whole model is read through the plain file loader.
  const wholeRuntime = configuration.wholeRuntime ?? model.wholeRuntime;
  if (wholeRuntime !== undefined) model.wholeRuntime = validateWholeRuntime(model, wholeRuntime);
  if (model.partitionRuntime?.runtimeConfig === 'model') {
    requireValue(model.loadOptions?.runtimeConfig && typeof model.loadOptions.runtimeConfig === 'object',
      'The model runtime reference requires explicit model.loadOptions.runtimeConfig');
    model.partitionRuntime.runtimeConfig = structuredClone(model.loadOptions.runtimeConfig);
  }
  if (model.partitionRequest !== undefined) {
    requireValue(configuration.partition === undefined, 'Cannot override a pinned compact catalog plan');
    createWorkPartitionPlan(await loadRuntime(), manifest, model);
  }
  if (configuration.partition !== undefined) {
    requireValue(catalogReference || model.partitionPlan === undefined && model.partitionPlanId === undefined,
      'Choose one partition request rather than competing prepared plans');
    requireValue(catalogReference || model.executionModes?.includes('partition'), 'Native model must explicitly allow partition execution');
    const runtime = await loadRuntime();
    requireValue(typeof runtime.createOrderedLayerPartitionPlanFromManifest === 'function'
      && typeof runtime.hashLayerPartitionPlan === 'function',
    'Installed Doppler lacks manifest-driven partition preparation; install the matching runtime');
    model.partitionPlan = runtime.createOrderedLayerPartitionPlanFromManifest(manifest, configuration.partition);
    model.partitionPlanId = runtime.hashLayerPartitionPlan(model.partitionPlan);
    // An explicit ordered plan replaces the catalog's legacy two-stage cut.
    // Keeping both makes downstream selection reject the otherwise valid plan.
    delete model.partitionSplitLayer;
    if (catalogReference) model.executionModes = [...new Set([...(model.executionModes || []), 'partition'])];
    const budgets = model.partitionRuntime?.maxGpuBufferBytes;
    requireValue(Array.isArray(budgets) && budgets.length === model.partitionPlan.stageCount
      && budgets.every(value => Number.isSafeInteger(value) && value > 0),
    'Declare one positive GPU buffer budget per partition stage');
    requireValue(model.partitionRuntime.runtimeConfig && typeof model.partitionRuntime.runtimeConfig === 'object',
      'Declare partition runtime configuration explicitly');
  }
  return model;
}
