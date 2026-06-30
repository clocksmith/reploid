/**
 * @fileoverview Canonical /0 and /x lab profile registry.
 *
 * X is defined as Zero plus enhanced starter capabilities. The boot substrate,
 * VFS, /self runtime semantics, promotion model, and tool contracts are shared.
 */

import {
  ZERO_TOOL_SURFACE_IDS,
  X_TOOL_SURFACE_IDS,
  getToolNamesForSurfaceIds
} from '../config/tool-surfaces.js';
import {
  defineLabProfile,
  extendLabProfile
} from './surface.js';
import {
  ZERO_RUNTIME_UI,
  PROTO_RUNTIME_UI
} from './runtime-ui.js';
import {
  ZERO_RUNTIME_SELF_MIRROR_RULES,
  PROTO_RUNTIME_SELF_MIRROR_RULES,
  buildRuntimeSelfMirrors
} from './mirrors.js';

const ZERO_REQUIRED_MODULES = Object.freeze([
  'AgentLoop',
  'CircuitBreaker',
  'ContextManager',
  'DopplerToolbox',
  'LLMClient',
  'SubstrateLoader',
  'ToolRunner',
  'ToolWriter',
  'VFS'
]);

const X_ADDITIONAL_REQUIRED_MODULES = Object.freeze([
  'ArenaHarness',
  'KnowledgeGraph',
  'MemoryManager',
  'SemanticMemory',
  'SwarmTransport',
  'VFSSandbox',
  'VerificationManager',
  'WebRTCSwarm',
  'WorkerManager'
]);

const ZERO_FORBIDDEN_MODULES = Object.freeze([
  ...X_ADDITIONAL_REQUIRED_MODULES,
  'HITLController'
]);

const ZERO_FORBIDDEN_TOOLS = Object.freeze([
  'CopyFile',
  'DeleteFile',
  'FileOutline',
  'Find',
  'Head',
  'MakeDirectory',
  'MoveFile',
  'SpawnWorker',
  'SwarmGetStatus',
  'Tail',
  'git',
  'RunGEPA'
]);

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

export const ZERO_LAB_PROFILE = defineLabProfile({
  id: 'zero',
  route: '/0',
  label: 'zero',
  title: 'Zero',
  mode: 'zero',
  bootProfile: 'zero_home',
  genesisLevel: 'spark',
  uiMode: 'zero',
  runtimeUi: ZERO_RUNTIME_UI,
  runtimeSelfMirrorRules: ZERO_RUNTIME_SELF_MIRROR_RULES,
  surface: 'zero',
  toolSurfaceIds: ZERO_TOOL_SURFACE_IDS,
  requiredModules: ZERO_REQUIRED_MODULES,
  forbiddenModules: ZERO_FORBIDDEN_MODULES,
  forbiddenTools: ZERO_FORBIDDEN_TOOLS
});

export const X_LAB_PROFILE = extendLabProfile(ZERO_LAB_PROFILE, {
  id: 'x',
  route: '/x',
  label: 'x',
  title: 'X',
  mode: 'x',
  bootProfile: 'x_home',
  genesisLevel: 'full',
  uiMode: 'proto',
  runtimeUi: PROTO_RUNTIME_UI,
  surface: 'x',
  additionalToolSurfaceIds: X_TOOL_SURFACE_IDS,
  additionalRequiredModules: X_ADDITIONAL_REQUIRED_MODULES,
  additionalRuntimeSelfMirrorRules: PROTO_RUNTIME_SELF_MIRROR_RULES
});

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
