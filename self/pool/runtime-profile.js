/**
 * @fileoverview Browser runtime profile evidence for pool provider routing.
 */

import { hashJson } from './inference-receipt.js';
import { LAUNCH_MODEL } from './model-contract.js';

export const RUNTIME_PROFILE_VERSION = 'reploid_pool_runtime_profile/v1';

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object') return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
};

const cleanString = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const cleanObject = (value) => (
  value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const sortedList = (value) => (
  Array.isArray(value) ? value.map(String).sort() : []
);

const browserFamilyFromUserAgent = (userAgent = '') => {
  const ua = String(userAgent || '');
  if (/Firefox\/(\d+)/.test(ua)) return { family: 'firefox', majorVersion: RegExp.$1 };
  if (/Edg\/(\d+)/.test(ua)) return { family: 'edge', majorVersion: RegExp.$1 };
  if (/Chrome\/(\d+)/.test(ua)) return { family: 'chrome', majorVersion: RegExp.$1 };
  if (/Version\/(\d+).+Safari\//.test(ua)) return { family: 'safari', majorVersion: RegExp.$1 };
  return { family: null, majorVersion: null };
};

export function collectBrowserProfile(navigatorLike = globalThis.navigator) {
  const userAgentData = navigatorLike?.userAgentData || null;
  const userAgent = cleanString(navigatorLike?.userAgent);
  const browser = browserFamilyFromUserAgent(userAgent);
  const primaryBrand = Array.isArray(userAgentData?.brands)
    ? userAgentData.brands.find((brand) => !/Not/i.test(brand.brand))
    : null;
  return {
    userAgent,
    family: cleanString(globalThis.REPLOID_POOL_BROWSER_FAMILY || primaryBrand?.brand || browser.family),
    majorVersion: cleanString(globalThis.REPLOID_POOL_BROWSER_MAJOR_VERSION || primaryBrand?.version || browser.majorVersion),
    platform: cleanString(navigatorLike?.platform || userAgentData?.platform),
    brands: sortedList((userAgentData?.brands || []).map((brand) => `${brand.brand}:${brand.version}`)),
    mobile: userAgentData?.mobile === true,
    language: cleanString(navigatorLike?.language),
    browserHint: cleanString(globalThis.REPLOID_POOL_BROWSER_HINT)
  };
}

export function buildRuntimeProfile({
  modelInfo = LAUNCH_MODEL,
  runtimeInfo = {},
  deviceInfo = {},
  browserProfile = collectBrowserProfile(),
  shaderProfile = globalThis.REPLOID_DOPPLER_SHADER_PROFILE || null,
  kernelProfile = globalThis.REPLOID_DOPPLER_KERNEL_PROFILE || null,
  determinismProfile = globalThis.REPLOID_POOL_DETERMINISM_PROFILE || null
} = {}) {
  const adapterInfo = cleanObject(deviceInfo.adapterInfo);
  const runtimeDevice = cleanObject(runtimeInfo.device);
  const adapterVendor = cleanString(adapterInfo.vendor || runtimeDevice.vendor);
  const adapterArchitecture = cleanString(adapterInfo.architecture || runtimeDevice.architecture);
  const adapterDevice = cleanString(adapterInfo.device || runtimeDevice.device);
  const adapterDescription = cleanString(adapterInfo.description || runtimeDevice.description);
  const dopplerRuntimeProfile = cleanString(
    runtimeInfo.runtimeProfile
    || runtimeInfo.profile?.profileId
    || runtimeInfo.profile?.name
    || runtimeInfo.profile?.implementation
    || runtimeInfo.publicApi
  );
  const dopplerKernelProfileHash = cleanString(
    runtimeInfo.kernelProfileHash
    || runtimeInfo.profile?.kernelProfileHash
    || globalThis.REPLOID_DOPPLER_KERNEL_PROFILE_HASH
    || kernelProfile
  );
  return deepFreeze({
    profileVersion: RUNTIME_PROFILE_VERSION,
    browser: {
      userAgent: cleanString(browserProfile.userAgent),
      family: cleanString(browserProfile.family),
      majorVersion: cleanString(browserProfile.majorVersion),
      platform: cleanString(browserProfile.platform),
      brands: sortedList(browserProfile.brands),
      mobile: browserProfile.mobile === true,
      language: cleanString(browserProfile.language),
      browserHint: cleanString(browserProfile.browserHint)
    },
    webgpu: {
      hasWebGPU: deviceInfo.hasWebGPU === true,
      probeStatus: cleanString(deviceInfo.probeStatus),
      adapterVendor,
      adapterArchitecture,
      adapterClass: cleanString(deviceInfo.adapterClass || runtimeDevice.adapterClass || adapterArchitecture || adapterVendor),
      backend: cleanString(deviceInfo.backend || runtimeInfo.backend || modelInfo.backend || LAUNCH_MODEL.backend),
      shaderProfile: cleanString(shaderProfile || deviceInfo.shaderProfile || runtimeInfo.shaderProfile),
      adapter: {
        vendor: adapterVendor,
        architecture: adapterArchitecture,
        device: adapterDevice,
        description: adapterDescription
      },
      features: sortedList(deviceInfo.features),
      hasF16: deviceInfo.hasF16 === true || sortedList(deviceInfo.features).includes('shader-f16'),
      hasSubgroups: deviceInfo.hasSubgroups === true || sortedList(deviceInfo.features).includes('subgroups'),
      limitsHashInput: cleanObject(deviceInfo.limits),
      maxBufferSize: Number(deviceInfo.maxBufferSize || deviceInfo.limits?.maxBufferSize || 0)
    },
    doppler: {
      runtime: cleanString(runtimeInfo.runtime || modelInfo.runtime || LAUNCH_MODEL.runtime),
      backend: cleanString(runtimeInfo.backend || modelInfo.backend || LAUNCH_MODEL.backend),
      publicApi: cleanString(runtimeInfo.publicApi),
      runtimeProfile: dopplerRuntimeProfile,
      kernelProfileHash: dopplerKernelProfileHash,
      profile: cleanObject(runtimeInfo.profile),
      shaderProfile: cleanString(shaderProfile),
      kernelProfile: cleanString(kernelProfile),
      determinismProfile: cleanString(determinismProfile)
    },
    model: {
      modelId: cleanString(modelInfo.modelId || modelInfo.id || LAUNCH_MODEL.modelId),
      modelHash: cleanString(modelInfo.modelHash || modelInfo.hash || LAUNCH_MODEL.modelHash),
      manifestHash: cleanString(modelInfo.manifestHash || LAUNCH_MODEL.manifestHash),
      contextLength: Number(modelInfo.contextLength || LAUNCH_MODEL.contextLength || 0),
      quantization: cleanString(modelInfo.quantization || LAUNCH_MODEL.quantization)
    }
  });
}

export async function hashRuntimeProfile(runtimeProfile = {}) {
  return hashJson(runtimeProfile);
}

export async function collectRuntimeProfile({
  runtime = null,
  modelInfo = null,
  runtimeInfo = null,
  deviceInfo = null,
  browserProfile = null
} = {}) {
  const resolvedModelInfo = modelInfo
    || (typeof runtime?.getModelInfo === 'function' ? runtime.getModelInfo() : null)
    || LAUNCH_MODEL;
  const resolvedRuntimeInfo = runtimeInfo
    || (typeof runtime?.getRuntimeInfo === 'function' ? runtime.getRuntimeInfo() : null)
    || {};
  const resolvedDeviceInfo = deviceInfo
    || (typeof runtime?.getDeviceInfo === 'function' ? await runtime.getDeviceInfo() : null)
    || {};
  const runtimeProfile = buildRuntimeProfile({
    modelInfo: resolvedModelInfo,
    runtimeInfo: resolvedRuntimeInfo,
    deviceInfo: resolvedDeviceInfo,
    browserProfile: browserProfile || collectBrowserProfile()
  });
  return {
    runtimeProfile,
    runtimeProfileHash: await hashRuntimeProfile(runtimeProfile)
  };
}

export default {
  RUNTIME_PROFILE_VERSION,
  collectBrowserProfile,
  buildRuntimeProfile,
  hashRuntimeProfile,
  collectRuntimeProfile
};
