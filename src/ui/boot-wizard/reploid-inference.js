/**
 * @fileoverview Minimal inference and launch-state helpers for the primary Reploid route.
 */

import {
  DEFAULT_REPLOID_CLOUD_MODEL,
  buildReploidCloudModelConfig,
  getReploidCloudAccessWindowStatus
} from '../../self/cloud-access.js';
import { deriveSwarmRole } from '../../self/swarm.js';

const normalize = (value) => String(value || '').trim();

export function hasDirectInferenceConfig(state = {}) {
  const direct = state.directConfig || {};
  return !!(
    normalize(direct.provider) &&
    normalize(direct.model) &&
    normalize(direct.apiKey) &&
    (direct.provider !== 'other' || normalize(direct.baseUrl))
  );
}

export function buildDirectModelConfig(directConfig = {}) {
  if (!hasDirectInferenceConfig({ directConfig })) return null;

  return {
    id: normalize(directConfig.model),
    name: normalize(directConfig.model),
    provider: normalize(directConfig.provider),
    hostType: 'browser-cloud',
    apiKey: normalize(directConfig.apiKey),
    baseUrl: normalize(directConfig.baseUrl) || null
  };
}

export function getReploidLaunchState(state = {}, now = new Date()) {
  const accessCode = normalize(state.accessConfig?.accessCode);
  const ownInference = state.connectionType === 'direct';
  const { config, label, available } = getReploidCloudAccessWindowStatus(now);
  const accessProvisioned = !!available;
  const accessModel = String(config.model || DEFAULT_REPLOID_CLOUD_MODEL).trim() || DEFAULT_REPLOID_CLOUD_MODEL;
  const directInference = ownInference && hasDirectInferenceConfig(state);
  const accessInference = !ownInference && accessProvisioned && !!accessCode;
  const hasInference = directInference || accessInference;
  const swarmEnabled = !!state.swarmEnabled;
  const role = deriveSwarmRole({
    hasInference,
    swarmEnabled
  });

  return {
    ownInference,
    accessCode,
    accessModel,
    accessProvisioned,
    accessWindowLabel: label,
    accessProvider: config.provider,
    hasInference,
    hasDirectInference: directInference,
    hasAccessInference: accessInference,
    swarmEnabled,
    role,
    canAwaken: hasInference || swarmEnabled,
    isDead: !hasInference && !swarmEnabled
  };
}

export async function resolveReploidModelConfig(state = {}, now = new Date()) {
  const launch = getReploidLaunchState(state, now);
  if (launch.hasDirectInference) {
    return buildDirectModelConfig(state.directConfig);
  }
  if (launch.hasAccessInference) {
    return buildReploidCloudModelConfig({
      accessCode: launch.accessCode,
      date: now
    });
  }
  return null;
}

export default {
  buildDirectModelConfig,
  getReploidLaunchState,
  hasDirectInferenceConfig,
  resolveReploidModelConfig
};
