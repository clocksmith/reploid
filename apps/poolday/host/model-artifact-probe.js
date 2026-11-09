import { buildModelArtifactUrls, verifyModelArtifactManifest } from '../../../shared/pool/model-artifacts.js';
const errorString = error => String(error?.message || error?.error || error || 'Unknown error');
const artifactPreflightFailureAction = (model) => (
  `Deploy ${model?.modelId || 'the selected model'} artifacts at the configured model base, or attach a compatible Doppler runtime handle before contributing.`
);

const usesRegistryBackedDopplerLoad = (model = {}) => (
  Boolean(model.dopplerLoadRef || model.registryId || model.loadRef)
);

export const supportsAdapterPublications = () => false;

export const probeModelArtifacts = async (model) => {
  if (model.executablePack && window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT !== true) {
    return { ok: true, status: 'capsule_verification_pending', runtime: model.runtime,
      action: 'Doppler verifies the signed Capsule and complete artifact closure during model load.' };
  }
  if (window.REPLOID_POOL_STRICT_ARTIFACT_PREFLIGHT !== true && usesRegistryBackedDopplerLoad(model)) {
    return {
      ok: true,
      status: 'doppler_registry',
      runtime: model.runtime || 'doppler',
      loadRef: model.dopplerLoadRef || model.registryId || model.loadRef,
      action: 'Doppler runtime identity is checked after model load.'
    };
  }
  try {
    return {
      status: 'verified_manifest',
      ...(await verifyModelArtifactManifest({ model }))
    };
  } catch (error) {
    let urls = error.urls || null;
    try {
      urls = urls || buildModelArtifactUrls(model);
    } catch {
      urls = null;
    }
    return {
      ok: false,
      status: 'manifest_unavailable',
      error: errorString(error),
      statusCode: error.status || null,
      retryable: error.retryable === true,
      urls,
      action: artifactPreflightFailureAction(model)
    };
  }
};
