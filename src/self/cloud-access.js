/**
 * @fileoverview Public access-window metadata for Reploid Cloud style access-code inference.
 *
 * This file contains only sealed blobs and public metadata. Plaintext secrets never belong here.
 */

import { createAccessWindowLabel, unsealString } from './key-unsealer.js';
import GENERATED_REPLOID_CLOUD_ACCESS_STATUS from './cloud-access-status.js';

export const DEFAULT_REPLOID_CLOUD_PROVIDER = 'gemini';
export const DEFAULT_REPLOID_CLOUD_MODEL = 'gemini-3.1-flash-lite-preview';

export const REPLOID_CLOUD_ACCESS = Object.freeze({
  version: 1,
  provider: DEFAULT_REPLOID_CLOUD_PROVIDER,
  model: DEFAULT_REPLOID_CLOUD_MODEL,
  windows: []
});

export const REPLOID_CLOUD_ACCESS_STATUS = Object.freeze({
  version: 1,
  provider: DEFAULT_REPLOID_CLOUD_PROVIDER,
  model: DEFAULT_REPLOID_CLOUD_MODEL,
  availableLabels: []
});

const cloneWindowEntry = (entry = {}) => ({
  label: String(entry.label || '').trim(),
  model: entry.model ? String(entry.model).trim() : null,
  provider: entry.provider ? String(entry.provider).trim() : null,
  blob: entry.blob && typeof entry.blob === 'object'
    ? {
        version: Number(entry.blob.version || 1),
        kdf: String(entry.blob.kdf || ''),
        cipher: String(entry.blob.cipher || ''),
        label: String(entry.blob.label || entry.label || ''),
        iterations: Number(entry.blob.iterations || 0),
        salt: String(entry.blob.salt || ''),
        iv: String(entry.blob.iv || ''),
        ciphertext: String(entry.blob.ciphertext || '')
      }
    : null
});

const getOverrideConfig = () => {
  if (typeof window === 'undefined') return null;
  const override = window.__REPLOID_CLOUD_ACCESS__;
  if (!override || typeof override !== 'object') return null;
  return override;
};

const getAvailableLabels = (source = {}) => {
  if (Array.isArray(source.availableLabels)) {
    return Array.from(new Set(source.availableLabels.map((label) => String(label || '').trim()).filter(Boolean)));
  }

  if (Array.isArray(source.windows)) {
    return Array.from(new Set(source.windows.map((entry) => String(entry?.label || '').trim()).filter(Boolean)));
  }

  return [];
};

export function getReploidCloudAccessConfig() {
  const source = getOverrideConfig() || GENERATED_REPLOID_CLOUD_ACCESS_STATUS || REPLOID_CLOUD_ACCESS_STATUS;
  const provider = String(source.provider || DEFAULT_REPLOID_CLOUD_PROVIDER).trim() || DEFAULT_REPLOID_CLOUD_PROVIDER;
  const model = String(source.model || DEFAULT_REPLOID_CLOUD_MODEL).trim() || DEFAULT_REPLOID_CLOUD_MODEL;
  const availableLabels = getAvailableLabels(source);

  return {
    version: Number(source.version || 1),
    provider,
    model,
    availableLabels
  };
}

export function getReploidCloudAccessWindowStatus(date = new Date()) {
  const config = getReploidCloudAccessConfig();
  const label = createAccessWindowLabel(date);
  const available = config.availableLabels.includes(label)
    || config.availableLabels.includes('default');

  return {
    config,
    label,
    available
  };
}

export function hasProvisionedReploidCloudWindow(date = new Date()) {
  return !!getReploidCloudAccessWindowStatus(date).available;
}

async function loadProvisionedCloudAccessConfig() {
  const override = getOverrideConfig();
  if (override) {
    return {
      version: Number(override.version || 1),
      provider: String(override.provider || DEFAULT_REPLOID_CLOUD_PROVIDER).trim() || DEFAULT_REPLOID_CLOUD_PROVIDER,
      model: String(override.model || DEFAULT_REPLOID_CLOUD_MODEL).trim() || DEFAULT_REPLOID_CLOUD_MODEL,
      windows: Array.isArray(override.windows)
        ? override.windows.map(cloneWindowEntry).filter((entry) => entry.label && entry.blob?.ciphertext)
        : []
    };
  }

  const generatedModule = await import('./cloud-access-windows.js');
  const source = generatedModule.default || generatedModule.GENERATED_REPLOID_CLOUD_ACCESS || REPLOID_CLOUD_ACCESS;
  return {
    version: Number(source.version || 1),
    provider: String(source.provider || DEFAULT_REPLOID_CLOUD_PROVIDER).trim() || DEFAULT_REPLOID_CLOUD_PROVIDER,
    model: String(source.model || DEFAULT_REPLOID_CLOUD_MODEL).trim() || DEFAULT_REPLOID_CLOUD_MODEL,
    windows: Array.isArray(source.windows)
      ? source.windows.map(cloneWindowEntry).filter((entry) => entry.label && entry.blob?.ciphertext)
      : []
  };
}

function parseAccessPayload(plaintext, fallback = {}) {
  const raw = String(plaintext || '').trim();
  if (!raw) {
    throw new Error('Unsealed payload was empty');
  }

  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    const apiKey = String(parsed.apiKey || '').trim();
    if (!apiKey) {
      throw new Error('Unsealed payload is missing apiKey');
    }
    return {
      apiKey,
      provider: String(parsed.provider || fallback.provider || DEFAULT_REPLOID_CLOUD_PROVIDER).trim() || DEFAULT_REPLOID_CLOUD_PROVIDER,
      model: String(parsed.model || fallback.model || DEFAULT_REPLOID_CLOUD_MODEL).trim() || DEFAULT_REPLOID_CLOUD_MODEL,
      baseUrl: parsed.baseUrl ? String(parsed.baseUrl).trim() : null
    };
  }

  return {
    apiKey: raw,
    provider: String(fallback.provider || DEFAULT_REPLOID_CLOUD_PROVIDER).trim() || DEFAULT_REPLOID_CLOUD_PROVIDER,
    model: String(fallback.model || DEFAULT_REPLOID_CLOUD_MODEL).trim() || DEFAULT_REPLOID_CLOUD_MODEL,
    baseUrl: null
  };
}

export async function unsealReploidCloudAccess(options = {}) {
  const status = getReploidCloudAccessWindowStatus(options.date);
  const config = await loadProvisionedCloudAccessConfig();
  const entry = config.windows.find((item) => item.label === status.label)
    || config.windows.find((item) => item.label === 'default')
    || null;
  if (!entry?.blob) {
    throw new Error(`No Reploid Cloud access window is provisioned for ${status.label}`);
  }

  const plaintext = await unsealString({
    accessCode: options.accessCode,
    blob: entry.blob,
    cryptoApi: options.cryptoApi
  });

  return {
    label: status.label,
    provider: entry.provider || config.provider,
    model: entry.model || config.model,
    payload: parseAccessPayload(plaintext, {
      provider: entry.provider || config.provider,
      model: entry.model || config.model
    })
  };
}

export async function buildReploidCloudModelConfig(options = {}) {
  const unsealed = await unsealReploidCloudAccess(options);
  return {
    id: unsealed.payload.model,
    name: unsealed.payload.model,
    provider: unsealed.payload.provider,
    hostType: 'browser-cloud',
    keySource: 'access-code',
    accessWindow: unsealed.label,
    baseUrl: unsealed.payload.baseUrl || null,
    getApiKey: async () => unsealed.payload.apiKey
  };
}

export default {
  DEFAULT_REPLOID_CLOUD_MODEL,
  DEFAULT_REPLOID_CLOUD_PROVIDER,
  REPLOID_CLOUD_ACCESS,
  REPLOID_CLOUD_ACCESS_STATUS,
  buildReploidCloudModelConfig,
  getReploidCloudAccessConfig,
  getReploidCloudAccessWindowStatus,
  hasProvisionedReploidCloudWindow,
  unsealReploidCloudAccess
};
