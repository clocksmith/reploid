/**
 * @fileoverview Canonical /zero and /x lab profile registry.
 *
 * X is defined as Zero plus enhanced starter capabilities. The boot substrate,
 * VFS, /self runtime semantics, promotion model, and tool contracts are shared.
 */

import {
  getToolNamesForSurfaceIds
} from '../config/tool-surfaces.js';
import { requireSurfaceIntent } from '../config/surface-intents.js';
import { defineLabProfile } from './surface.js';
import { buildRuntimeSelfMirrors } from './mirrors.js';

const ZERO_INTENT = requireSurfaceIntent('zero');
const X_INTENT = requireSurfaceIntent('x');

const intentProfileFields = (intent) => ({
  id: intent.id,
  route: intent.route,
  label: intent.id,
  title: intent.label,
  mode: intent.mode,
  bootProfile: intent.bootProfile,
  genesisLevel: intent.genesisLevel,
  uiMode: intent.uiMode,
  surface: intent.surface,
  intent: intent.intent,
  role: intent.role
});

const ZERO_TOOL_NAMES = Object.freeze(getToolNamesForSurfaceIds(ZERO_INTENT.toolSurfaceIds));
const X_TOOL_NAMES = Object.freeze(getToolNamesForSurfaceIds(X_INTENT.toolSurfaceIds));
const ZERO_FORBIDDEN_TOOLS = Object.freeze(
  X_TOOL_NAMES.filter((toolName) => !ZERO_TOOL_NAMES.includes(toolName))
);

const makeBootSpec = (profile) => Object.freeze({
  title: profile.title,
  extends: profile.extends || null,
  mode: profile.mode,
  bootProfile: profile.bootProfile,
  genesisLevel: profile.genesisLevel,
  uiMode: profile.uiMode,
  surface: profile.surface,
  productFacing: false
});

const resolvedProfile = intent => defineLabProfile({
  ...intent,
  ...intentProfileFields(intent),
  forbiddenTools: intent.id === 'zero' ? ZERO_FORBIDDEN_TOOLS : []
});
export const ZERO_LAB_PROFILE = resolvedProfile(ZERO_INTENT);
export const X_LAB_PROFILE = resolvedProfile(X_INTENT);

export const LAB_ROUTE_PROFILES = Object.freeze({
  zero: ZERO_LAB_PROFILE,
  x: X_LAB_PROFILE
});

export const LAB_ROUTE_BOOT_SPECS = Object.freeze(Object.fromEntries(
  Object.values(LAB_ROUTE_PROFILES).map((profile) => [profile.route, makeBootSpec(profile)])
));

export function getLabRouteProfileByPath(pathname = '/') {
  const normalized = String(pathname || '/').trim().replace(/\/+$/, '') || '/';
  return Object.values(LAB_ROUTE_PROFILES).find((profile) => profile.route === normalized) || null;
}

export function getLabRouteProfileByMode(mode = '') {
  return LAB_ROUTE_PROFILES[String(mode || '').trim()] || null;
}

export function getLabRouteProfileByBootProfile(bootProfile = '') {
  const normalized = String(bootProfile || '').trim();
  return Object.values(LAB_ROUTE_PROFILES).find((profile) => profile.bootProfile === normalized) || null;
}

export function getRuntimeUiSpecByMode(mode = '') {
  return getLabRouteProfileByMode(mode)?.runtimeUi || null;
}

export function getRuntimeSelfMirrorsByBootProfile(bootProfile = '', files = []) {
  const profile = getLabRouteProfileByBootProfile(bootProfile);
  return buildRuntimeSelfMirrors(profile?.runtimeSelfMirrorRules || [], files);
}

export function getLabRouteCases() {
  return Object.freeze(Object.values(LAB_ROUTE_PROFILES).map((profile) => Object.freeze({
    route: profile.route,
    label: profile.label,
    title: profile.title,
    mode: profile.mode,
    uiMode: profile.uiMode,
    bootProfile: profile.bootProfile,
    genesisLevel: profile.genesisLevel,
    requiredModules: [...profile.requiredModules],
    forbiddenModules: [...profile.forbiddenModules],
    requiredTools: getToolNamesForSurfaceIds(profile.toolSurfaceIds, {
      hasToolWriter: true,
      hasSubstrateLoader: true
    }),
    forbiddenTools: [...profile.forbiddenTools]
  })));
}
