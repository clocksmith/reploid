/**
 * @fileoverview Shared helpers for defining lab profiles as explicit extensions.
 */

import { extendIds, freezeArray } from '../config/immutability.js';

export { extendIds, freezeArray };

export const defineLabProfile = (profile) => Object.freeze({
  ...profile,
  authorityCeiling: freezeArray(profile.authorityCeiling),
  hostGrants: freezeArray(profile.hostGrants),
  toolSurfaceIds: freezeArray(profile.toolSurfaceIds),
  requiredModules: freezeArray(profile.requiredModules),
  forbiddenModules: freezeArray(profile.forbiddenModules),
  forbiddenTools: freezeArray(profile.forbiddenTools),
  runtimeSelfMirrorRules: freezeArray(profile.runtimeSelfMirrorRules)
});

export const extendLabProfile = (baseProfile, overrides = {}) => {
  const {
    additionalRequiredModules = [],
    additionalToolSurfaceIds = [],
    additionalRuntimeSelfMirrorRules = [],
    requiredModules = [],
    toolSurfaceIds = [],
    runtimeSelfMirrorRules = [],
    ...profileOverrides
  } = overrides;

  return defineLabProfile({
    ...baseProfile,
    ...profileOverrides,
    extends: baseProfile.id,
    authorityCeiling: extendIds(baseProfile.authorityCeiling || [], profileOverrides.authorityCeiling || []),
    hostGrants: freezeArray(profileOverrides.hostGrants || []),
    requiredModules: extendIds(
      baseProfile.requiredModules,
      additionalRequiredModules,
      requiredModules
    ),
    forbiddenModules: freezeArray(profileOverrides.forbiddenModules || (baseProfile.forbiddenModules || []).filter(id => ![...additionalRequiredModules, ...requiredModules].includes(id))),
    forbiddenTools: freezeArray(profileOverrides.forbiddenTools || baseProfile.forbiddenTools || []),
    toolSurfaceIds: extendIds(
      baseProfile.toolSurfaceIds,
      additionalToolSurfaceIds,
      toolSurfaceIds
    ),
    runtimeSelfMirrorRules: freezeArray([
      ...(baseProfile.runtimeSelfMirrorRules || []),
      ...additionalRuntimeSelfMirrorRules,
      ...runtimeSelfMirrorRules
    ])
  });
};
