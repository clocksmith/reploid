/** The adapter features a model needs, read from what Doppler declares rather than restated here. Doppler's kernel
 * registry (`src/config/kernels/registry.json`) lists the features each WGSL entry point `requires`; a manifest's
 * execution graph names the entry points it runs. Doppler's capability rules
 * (`src/rules/inference/capability-transforms.rules.json`) name the hardware-compatibility transforms that run when
 * an adapter lacks `shader-f16` or `subgroups`, and those run only under a capability-aware kernel path policy that
 * remaps manifest graphs (the check `execution-v1.js` makes). Both files are data in the installed package. */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { installedPackageDirectory } from './native-shader-cache.js';
import { resolveServedFile } from './browser-roots.js';
import { sha256Digest } from './hashing.js';

// Doppler's capability names (rule `match` keys) and the adapter features they stand for.
const CAPABILITY_FEATURES = { hasF16: 'shader-f16', hasSubgroups: 'subgroups' };
// Doppler's runtime default (`config/schema/runtime/doppler.schema.js`), used when the catalog sets no policy.
const DOPPLER_DEFAULT_POLICY = { mode: 'capability-aware', sourceScope: ['model', 'manifest', 'config'], onIncompatible: 'remap' };

/** `{ kernels: Map<'file#entry', string[]>, remappable: string[] }` from the two Doppler files. */
export function dopplerGpuDeclarations(registry, rules) {
  const kernels = new Map();
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.wgsl === 'string' && typeof node.entryPoint === 'string' && Array.isArray(node.requires)) {
      const key = node.wgsl + '#' + node.entryPoint;
      kernels.set(key, [...new Set([...(kernels.get(key) ?? []), ...node.requires])]);
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(registry);
  const remappable = new Set();
  for (const rule of rules?.capabilityTransforms ?? []) {
    if (rule.kind !== 'hardware-compatibility' || !rule.transforms?.length) continue;
    for (const [capability, feature] of Object.entries(CAPABILITY_FEATURES)) if (rule.match?.[capability] === false) remappable.add(feature);
  }
  return { kernels, remappable: [...remappable].sort() };
}

export async function readDopplerGpuDeclarations(directory = null) {
  const root = directory ?? await installedPackageDirectory(createRequire(import.meta.url).resolve('dopplerx/partitions'), 'dopplerx');
  const read = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
  return dopplerGpuDeclarations(await read('src/config/kernels/registry.json'), await read('src/rules/inference/capability-transforms.rules.json'));
}

/** True when Doppler would apply capability transforms to this manifest's graph instead of refusing. */
export function remapAllowed(kernelPathPolicy) {
  const policy = { ...DOPPLER_DEFAULT_POLICY, ...(kernelPathPolicy ?? {}) };
  return policy.mode === 'capability-aware' && policy.onIncompatible === 'remap'
    && (policy.sourceScope ?? policy.allowSources ?? []).includes('manifest');
}

/** `{ modelId, required, remappable }`: the features the manifest's kernels require, and which of those Doppler's
 * capability remap can do without under this policy. Null when the manifest declares no execution graph. */
export function manifestGpuNeeds(manifest, declarations, kernelPathPolicy) {
  const graph = manifest?.inference?.execution?.kernels;
  if (!graph || typeof graph !== 'object') return null;
  const required = new Set();
  for (const entry of Object.values(graph)) {
    for (const feature of declarations.kernels.get(`${entry?.kernel}#${entry?.entry ?? 'main'}`) ?? []) required.add(feature);
  }
  const allowed = remapAllowed(kernelPathPolicy);
  return { modelId: manifest.modelId ?? null, required: [...required].sort(),
    remappable: allowed ? declarations.remappable.filter(feature => required.has(feature)) : [] };
}

/** The kernel path policy a model runs under in this execution mode. */
export const modelKernelPathPolicy = (model, mode) => (mode === 'partition'
  ? model?.partitionRuntime?.runtimeConfig?.inference?.kernelPathPolicy
  : model?.loadOptions?.runtimeConfig?.inference?.kernelPathPolicy) ?? null;

/** Needs for a catalog model: its manifest is the bundled pinned copy when there is one, otherwise `manifestBytes`
 * (checked against the model identity). Null when neither is available. */
export async function modelGpuNeeds({ model, mode = 'whole-model', manifestBytes = null, declarations = null }) {
  if (!model) return null;
  let bytes = manifestBytes;
  const pinned = model.source?.files?.find(file => file.role === 'model-manifest')?.url;
  if (!bytes && /^\/config\/model-manifests\/[a-f0-9]{64}\.json$/.test(pinned || '')) {
    bytes = await readFile(resolveServedFile(pinned, { roots: ['shared'] })).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  }
  if (!bytes || sha256Digest(bytes) !== model.identity) return null;
  return manifestGpuNeeds(JSON.parse(Buffer.from(bytes).toString('utf8')), declarations ?? await readDopplerGpuDeclarations(),
    modelKernelPathPolicy(model, mode));
}
