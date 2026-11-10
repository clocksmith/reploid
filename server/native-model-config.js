/** Operator-local model configuration; never public catalog or release authority. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { sha256Digest } from './hashing.js';
import { resolveGenerationOptions } from '../shared/config/doppler-generation-contract.js';

const requireValue = (condition, message) => { if (!condition) throw new Error(message); };

export async function readNativeModelConfiguration(file, { modelId, modelDirectory, models = [],
  loadRuntime = () => import('doppler-gpu/partitions') }) {
  requireValue(path.isAbsolute(file), 'Native model configuration requires an absolute JSON path');
  const configuration = JSON.parse(await fs.readFile(file, 'utf8'));
  requireValue(configuration?.schema === 'reploid.native-model/v1'
    && Object.keys(configuration).every(key => ['schema', 'model', 'partition', 'partitionRuntime'].includes(key)),
  'Unknown native model configuration schema or field');
  const catalogReference = typeof configuration.model === 'string';
  const model = structuredClone(catalogReference ? models.find(row => row.id === configuration.model) : configuration.model);
  requireValue(model?.id === modelId && model.provider === 'doppler' && typeof model.name === 'string'
    && /^sha256:[a-f0-9]{64}$/.test(model.identity), 'Native model configuration requires an exact Doppler model identity');
  model.generation = resolveGenerationOptions(model.generation);
  const root = await fs.realpath(modelDirectory);
  const manifestPath = await fs.realpath(path.join(root, 'manifest.json'));
  requireValue(path.dirname(manifestPath) === root, 'Native model manifest escapes the approved directory');
  const bytes = await fs.readFile(manifestPath);
  requireValue(sha256Digest(bytes) === model.identity,
    'Native model configuration differs from the actual manifest');
  const manifest = JSON.parse(bytes);
  requireValue(manifest.modelId === model.id, 'Native model configuration differs from the actual model id');
  if (configuration.partitionRuntime !== undefined) model.partitionRuntime = structuredClone(configuration.partitionRuntime);
  if (model.partitionRuntime?.runtimeConfig === 'model') {
    requireValue(model.loadOptions?.runtimeConfig && typeof model.loadOptions.runtimeConfig === 'object',
      'The model runtime reference requires explicit model.loadOptions.runtimeConfig');
    model.partitionRuntime.runtimeConfig = structuredClone(model.loadOptions.runtimeConfig);
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
