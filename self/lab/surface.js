/**
 * @fileoverview Shared helpers for defining lab profiles as explicit extensions.
 */

const freezeArray = (items = []) => Object.freeze([...items]);

export const extendIds = (...groups) => Object.freeze([...new Set(groups.flat())]);

export const defineLabProfile = (profile) => Object.freeze({
  ...profile,
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
    requiredModules: extendIds(
      baseProfile.requiredModules,
      additionalRequiredModules,
      requiredModules
    ),
    forbiddenModules: Object.freeze(profileOverrides.forbiddenModules || []),
    forbiddenTools: Object.freeze(profileOverrides.forbiddenTools || []),
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
