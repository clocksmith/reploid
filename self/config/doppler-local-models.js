/**
 * @fileoverview Reploid local Doppler model contract.
 */
import chatModels from './chat-models.json' with { type: 'json' };

export const DOPPLER_PACKAGE_NAME = 'doppler-gpu';
export const DOPPLER_PACKAGE_VERSION = '0.6.2';
export const DOPPLER_BROWSER_RUNTIME_VERSION = '0.6.2';
export const DOPPLER_PACKAGE_SPEC = DOPPLER_PACKAGE_VERSION;
export const DOPPLER_PACKAGE_TARBALL_URL =
  `https://registry.npmjs.org/${DOPPLER_PACKAGE_NAME}/-/${DOPPLER_PACKAGE_NAME}-${DOPPLER_PACKAGE_VERSION}.tgz`;
export const DOPPLER_PACKAGE_INTEGRITY =
  'sha512-AoBqh/YJKu8tHXFBdhsvYTP9EoNlzls0M5bwHPudCb4QPB2lrw/1zBLtFvwftIyQ5HWPMc04WvJ5zqqp465vLw==';
export const DOPPLER_BROWSER_RELEASE_REF =
  `${DOPPLER_PACKAGE_NAME}@${DOPPLER_BROWSER_RUNTIME_VERSION}`;
const DOPPLER_BROWSER_RELEASE_BASE_URL =
  `/vendor/doppler/${DOPPLER_BROWSER_RUNTIME_VERSION}`;
export const DOPPLER_MODULE_URL = `${DOPPLER_BROWSER_RELEASE_BASE_URL}/src/index.js`;
export const DOPPLER_KERNEL_BASE_URL = `${DOPPLER_BROWSER_RELEASE_BASE_URL}/src/gpu/kernels`;
export const DOPPLER_TOOLING_URL = `${DOPPLER_BROWSER_RELEASE_BASE_URL}/src/tooling-exports.browser.js`;
export const DOPPLER_STORAGE_TOOLING_URL =
  `${DOPPLER_BROWSER_RELEASE_BASE_URL}/src/tooling-exports/storage.js`;

export function resolveDopplerBrowserAssets({ pageUrl, explicitBase, storedBase } = {}) {
  const origin = new URL(pageUrl);
  const normalize = value => value ? new URL(String(value).replace(/\/+$/, '') + '/', origin).href.replace(/\/$/, '') : null;
  const explicit = normalize(explicitBase);
  let saved = null;
  if (!explicit) {
    try {
      saved = normalize(storedBase);
      if (saved && !['http:', 'https:'].includes(new URL(saved).protocol)) saved = null;
    } catch { /* Ignore an unusable saved override, not an explicit developer selection. */ }
  }
  const obsolete = saved === normalize('/doppler')
    || saved === 'https://cdn.jsdelivr.net/npm/doppler-gpu@0.6.2';
  const baseUrl = explicit || (!obsolete && saved) || normalize(DOPPLER_BROWSER_RELEASE_BASE_URL);
  if (!['http:', 'https:'].includes(new URL(baseUrl).protocol)) throw new Error('Doppler assets require an HTTP(S) base');
  return { baseUrl, moduleUrl: `${baseUrl}/src/index.js`, kernelBaseUrl: `${baseUrl}/src/gpu/kernels`,
    storageModuleUrl: `${baseUrl}/src/tooling-exports/storage.js` };
}

export const DEFAULT_DOPPLER_MODEL_ID = 'qwen-3-5-2b-q4k-ehaf16';

export const LOCAL_DOPPLER_MODELS = Object.freeze(chatModels.map(model => Object.freeze({
  ...model, adapters: Object.freeze(model.adapters),
  packageName: DOPPLER_PACKAGE_NAME, packageVersion: DOPPLER_BROWSER_RUNTIME_VERSION
})));

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
    identity: model.identity,
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
