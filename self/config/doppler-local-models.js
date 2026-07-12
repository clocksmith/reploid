/**
 * @fileoverview Reploid local Doppler model contract.
 */

export const DOPPLER_PACKAGE_NAME = 'doppler-gpu';
export const DOPPLER_PACKAGE_VERSION = '0.4.8';

export const DEFAULT_DOPPLER_MODEL_ID = 'qwen-3-5-2b-q4k-ehaf16';

export const LOCAL_DOPPLER_MODELS = Object.freeze([
  Object.freeze({
    id: DEFAULT_DOPPLER_MODEL_ID,
    name: 'Qwen 3.5 2B',
    size: 'Q4K',
    recommended: true,
    provider: 'doppler',
    packageName: DOPPLER_PACKAGE_NAME,
    packageVersion: DOPPLER_PACKAGE_VERSION
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
