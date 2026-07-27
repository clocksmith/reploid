/**
 * @fileoverview Reploid local Doppler model contract.
 */

export const DOPPLER_PACKAGE_NAME = 'doppler-gpu';
export const DOPPLER_PACKAGE_VERSION = '0.5.1';
export const DOPPLER_BROWSER_RUNTIME_VERSION = '0.5.1';
export const DOPPLER_PACKAGE_SPEC = DOPPLER_PACKAGE_VERSION;
export const DOPPLER_PACKAGE_TARBALL_URL =
  `https://registry.npmjs.org/${DOPPLER_PACKAGE_NAME}/-/${DOPPLER_PACKAGE_NAME}-${DOPPLER_PACKAGE_VERSION}.tgz`;
export const DOPPLER_PACKAGE_INTEGRITY =
  'sha512-eVzxMdaRn5QN3z1lUQB3BSfSN+MNwB9uMMSAMa0MsAVGLUvy9vyj48jYqR2HfadXmmAsHpdMLXFYmNydjtjJrw==';
export const DOPPLER_BROWSER_RELEASE_REF =
  `${DOPPLER_PACKAGE_NAME}@${DOPPLER_BROWSER_RUNTIME_VERSION}`;
const DOPPLER_BROWSER_RELEASE_BASE_URL =
  `https://cdn.jsdelivr.net/npm/${DOPPLER_BROWSER_RELEASE_REF}`;
export const DOPPLER_MODULE_URL = `${DOPPLER_BROWSER_RELEASE_BASE_URL}/src/index.js`;
export const DOPPLER_KERNEL_BASE_URL = `${DOPPLER_BROWSER_RELEASE_BASE_URL}/src/gpu/kernels`;
export const DOPPLER_TOOLING_URL = `${DOPPLER_BROWSER_RELEASE_BASE_URL}/src/tooling-exports.browser.js`;

export const DEFAULT_DOPPLER_MODEL_ID = 'qwen-3-5-2b-q4k-ehaf16';

export const LOCAL_DOPPLER_MODELS = Object.freeze([
  Object.freeze({
    id: DEFAULT_DOPPLER_MODEL_ID,
    name: 'Qwen 3.5 2B',
    size: 'Q4K',
    recommended: true,
    provider: 'doppler',
    packageName: DOPPLER_PACKAGE_NAME,
    packageVersion: DOPPLER_BROWSER_RUNTIME_VERSION
  })
]);

export function getLocalDopplerModel(modelId) {
  const id = String(modelId || '').trim();
  if (!id) return null;
  return LOCAL_DOPPLER_MODELS.find((model) => model.id === id) || null;
}

export function getDefaultLocalDopplerModel() {
  return getLocalDopplerModel(DEFAULT_DOPPLER_MODEL_ID) || LOCAL_DOPPLER_MODELS[0] || null;
}

export function buildLocalDopplerModelConfig(modelId) {
  const model = getLocalDopplerModel(modelId);
  if (!model) return null;
  return {
    id: model.id,
    name: model.name,
    provider: model.provider,
    hostType: 'browser-local',
    packageName: model.packageName,
    packageVersion: model.packageVersion
  };
}

export function buildDefaultLocalDopplerModelConfig() {
  const model = getDefaultLocalDopplerModel();
  return model ? buildLocalDopplerModelConfig(model.id) : null;
}
