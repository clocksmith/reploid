/** Exact adapter composition for complete jobs. No transport or model mathematics. */
import { freezeOperationPolicy } from './pack-operation-policy.js';
import { hashDopplerEvidence } from './executable-pack.js';
import { adapterRequirementFromPack, modelIdentityMatchesAdapterRequirement } from './adapter-pack.js';
import { verifyAdapterPublication } from './adapter-publication.js';

const assert = (ok, message) => { if (!ok) throw new Error(`Adapter execution: ${message}`); };
import { resolveAdapterExecutionPolicy } from './adapter-execution-policy.js';
export { resolveAdapterExecutionPolicy } from './adapter-execution-policy.js';

/** Publication identity and every base-model compatibility field are retained. */
export async function normalizeExecutionAdapterSet(input, { model, policy: policyInput }) {
  const policy = resolveAdapterExecutionPolicy(policyInput);
  const entries = freezeOperationPolicy(input);
  assert(Array.isArray(entries) && entries.length <= policy.maxAdaptersPerJob, 'adapter count exceeds policy');
  const baseModelIdentity = await hashDopplerEvidence(model);
  const identities = new Set();
  let total = 0;
  for (const entry of entries) {
    assert(entry && Object.keys(entry).every(key => ['identity', 'baseModelIdentity', 'publication'].includes(key)), 'invalid adapter requirement fields');
    const publication = entry.publication;
    const validation = await verifyAdapterPublication(publication);
    assert(validation.ok, validation.reasons.join('; '));
    const pack = publication.pack;
    assert(entry.identity === pack.packHash && !identities.has(entry.identity), 'adapter identity mismatch or duplicate');
    identities.add(entry.identity);
    assert(entry.baseModelIdentity === baseModelIdentity
      && modelIdentityMatchesAdapterRequirement(model, adapterRequirementFromPack(pack)), 'exact base model mismatch');
    assert(policy.allowedFormats.includes(pack.adapter.format), 'adapter format is not allowed');
    assert(Number.isSafeInteger(pack.adapter.bytes) && pack.adapter.bytes <= policy.maxAdapterBytes, 'adapter byte limit exceeded');
    total += pack.adapter.bytes;
    assert(Number.isSafeInteger(total) && total <= policy.maxTotalAdapterBytes, 'adapter set byte limit exceeded');
    assert(pack.runtime.allowedSurfaces.includes(model.backend), 'adapter runtime surface mismatch');
    const version = value => {
      assert(typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value), 'explicit stable runtime versions required');
      return value.split('.').map(Number);
    };
    const actual = version(model.runtimeVersion), minimum = version(pack.runtime.minimumVersion);
    const difference = actual.map((number, index) => number - minimum[index]).find(number => number !== 0);
    assert(difference === undefined || difference > 0, 'adapter requires a newer runtime');
  }
  return entries;
}

export function executionAdapterArtifact(entry) {
  const pack = entry.publication.pack;
  return freezeOperationPolicy({ artifactId: pack.adapter.id, role: 'lora-weights',
    path: pack.runtimeManifest.weightsPath, hash: pack.adapter.sha256, sizeBytes: pack.adapter.bytes });
}

export function executionAdapterArtifactSet(entry) {
  return freezeOperationPolicy({ schema: 'reploid.pool.artifact-set/v1', identity: entry.identity,
    artifacts: [executionAdapterArtifact(entry)] });
}

export function dopplerExecutionAdapterSet(entries, model) {
  const binding = model.executablePack;
  return freezeOperationPolicy(entries.map(entry => ({ schema: 'doppler.pack-adapter/v1', identity: entry.identity,
    baseModel: { modelId: model.modelId, semanticRoot: binding.semanticRoot, envelopeDigest: binding.envelopeDigest,
      artifactClosureDigest: binding.artifactClosureDigest }, format: entry.publication.pack.adapter.format,
    manifest: entry.publication.pack.runtimeManifest, artifact: executionAdapterArtifact(entry) })));
}
