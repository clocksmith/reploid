// Effective weight values, not an assertion of identical physical GPU layouts.
import assert from 'node:assert/strict';
const unchanged = new Set(['Q4_0', 'Q8_0', 'F16', 'F32', 'BF16']);

export function inspectPeerRepresentation(manifest, runtimeConfig) {
  assert(manifest?.tensors && manifest.metadata?.sourceRuntime?.sourceKind === 'gguf', 'Peer representation requires the exact GGUF source manifest');
  const compute = runtimeConfig?.inference?.session?.compute?.defaults;
  assert(compute && ['activationDtype', 'mathDtype', 'accumDtype', 'outputDtype'].every(key => compute[key] === 'f32'),
    'Peer weight representation comparison requires the explicit F32 execution profile');
  const kernelPath = runtimeConfig.inference.kernelPath;
  const nativeKVDtype = runtimeConfig.inference.session.kvcache?.kvDtype ?? null;
  if (kernelPath && typeof kernelPath === 'object' && kernelPath.kvDtype != null) {
    assert.equal(nativeKVDtype, kernelPath.kvDtype,
      'Explicit native KV dtype must match the selected kernel path before model comparison');
  }
  if (manifest.inference?.hyperConnections != null) {
    const session = runtimeConfig.inference.session;
    assert(session.decodeLoop?.wholeTokenProgram !== true && session.decodeLoop?.batchSize === 1
      && session.kvcache?.layout === 'contiguous' && ['f16', 'f32'].includes(nativeKVDtype)
      && !manifest.draftModel,
    'Hyper-connection comparison requires batchSize=1, contiguous f16/f32 KV and no whole-token replay or draft model');
  }
  const mismatches = [], counts = {};
  for (const [name, tensor] of Object.entries(manifest.tensors)) {
    const dtype = tensor.dtype?.toUpperCase();
    counts[dtype] = (counts[dtype] ?? 0) + 1;
    assert(Array.isArray(tensor.shape) && tensor.shape.length >= 1 && tensor.shape.length <= 3
      && tensor.shape.every(dimension => Number.isSafeInteger(dimension) && dimension > 0)
      && tensor.sourceTransform == null, 'Unsupported peer representation tensor: ' + name);
    if (!unchanged.has(dtype)) {
      mismatches.push({ name, nativeDtype: dtype, peerDtype: tensor.shape.length >= 2 ? 'Q8_0' : 'F32',
        reason: 'Selected peer converter changes these effective weight values; raw native packing is not common' });
    }
  }
  return { schema: 'reploid.peer-effective-weights/v1', modelId: manifest.modelId, ready: mismatches.length === 0, counts, mismatches,
    cachePrecision: { native: nativeKVDtype, peer: 'f16', identical: nativeKVDtype === 'f16',
      exactTokenParityRequired: true, scope: 'Declared runtime cache precision; physical layout and numerical parity remain execution gates' },
    scope: 'Metadata conversion contract: Q4/Q8 values preserved, F16/BF16 expanded to F32, other packed quants require explicit peer-derived replacement. Runtime/kernel/token and all-source-byte checks remain separate.' };
}

export function requirePeerRepresentation(manifest, runtimeConfig) {
  const result = inspectPeerRepresentation(manifest, runtimeConfig);
  assert(result.ready, 'Effective peer representation differs for ' + result.mismatches.length + ' tensors; refuse model comparison');
  return result;
}
