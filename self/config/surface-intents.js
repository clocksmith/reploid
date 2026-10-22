import { X_SEED_PREFIXES, ZERO_RUNTIME_UI } from './surface-resources.js';
/**
 * @fileoverview Canonical route intent for Reploid lab surfaces.
 */

import { extendIds, freezeArray } from './immutability.js';
import {
  ZERO_TOOL_SURFACE_IDS
} from './tool-surfaces.js';

const MINIMAL_LAB_REQUIRED_MODULES = Object.freeze([
  'AgentLoop',
  'CircuitBreaker',
  'ContextManager',
  'LLMClient',
  'ToolRunner',
  'ToolWriter',
  'VFS'
]);

const OPTIONAL_LAB_MODULES = Object.freeze([
  'ArenaHarness',
  'DopplerToolbox',
  'DopplerOptimizer',
  'ErrorStore',
  'ImprovementEpisodeLedger',
  'KnowledgeGraph',
  'MemoryManager',
  'SemanticMemory',
  'SubstrateLoader',
  'SwarmTransport',
  'TelemetryTimeline',
  'VFSSandbox',
  'WebRTCSwarm',
  'WorkerManager'
]);

const createSurfaceIntentRegistry = () => Object.create(null);

export const defineSurfaceIntent = (intent, registry = createSurfaceIntentRegistry()) => {
  const baseIntent = intent.extends && Object.hasOwn(registry, intent.extends)
    ? registry[intent.extends]
    : null;
  const additionalToolSurfaceIds = freezeArray(intent.additionalToolSurfaceIds);
  const additionalRequiredModules = freezeArray(intent.additionalRequiredModules);
  const toolSurfaceIds = intent.toolSurfaceIds
    ? freezeArray(intent.toolSurfaceIds)
    : extendIds(baseIntent?.toolSurfaceIds || [], additionalToolSurfaceIds);
  const requiredModules = intent.requiredModules
    ? freezeArray(intent.requiredModules)
    : extendIds(baseIntent?.requiredModules || [], additionalRequiredModules);

  return Object.freeze({
    ...intent,
    toolSurfaceIds,
    additionalToolSurfaceIds,
    requiredModules,
    additionalRequiredModules,
    absentModules: freezeArray(intent.forbiddenModules),
    forbiddenModules: freezeArray(intent.forbiddenModules),
    seedPrefixes: extendIds(baseIntent?.seedPrefixes || [], intent.seedPrefixes || []),
    runtimeSelfMirrorRules: freezeArray([...(baseIntent?.runtimeSelfMirrorRules || []), ...(intent.runtimeSelfMirrorRules || [])]),
    authorityCeiling: extendIds(baseIntent?.authorityCeiling || [], intent.authorityCeiling || []),
    hostGrants: freezeArray(intent.hostGrants || [])
  });
};

const surfaceIntents = createSurfaceIntentRegistry();

surfaceIntents.x = defineSurfaceIntent({
    id: 'x',
    seedPrefixes: X_SEED_PREFIXES,
    runtimeSelfMirrorRules: [],
    runtimeUi: ZERO_RUNTIME_UI,
    authorityCeiling: ['candidate.selfApprove', 'candidate.modifyEvaluator', 'permissions.escalate'],
    label: 'X',
    route: '/x',
    mode: 'x',
    bootProfile: 'x_home',
    genesisLevel: 'spark',
    uiMode: 'zero',
    surface: 'x',
    summary: 'Minimal self-bootstrapping browser agent.',
    detail: 'Starts from its own source, a prompt, and CreateTool.',
    intent: 'Boot a complete minimal self-source image and grow tools from CreateTool without preloading optional upgrades.',
    role: 'Tabula-rasa self-loading browser surface.',
    toolSurfaceIds: ZERO_TOOL_SURFACE_IDS,
    requiredModules: MINIMAL_LAB_REQUIRED_MODULES,
    forbiddenModules: [
      ...OPTIONAL_LAB_MODULES,
      'HITLController'
    ],
    requiresBrowserBrain: false
});

surfaceIntents.zero = defineSurfaceIntent({
    id: 'zero',
    extends: 'x',
    label: 'Zero',
    route: '/zero',
    mode: 'zero',
    bootProfile: 'zero_home',
    genesisLevel: 'spark',
    uiMode: 'zero',
    surface: 'zero',
    runtimeUi: ZERO_RUNTIME_UI,
    summary: 'X with optional upgrades.',
    detail: 'The same self-building core, with explicitly selected reflection, cognition, and substrate upgrades.',
    intent: 'Extend X only with operator-selected upgrades while preserving its self-source and activation boundaries.',
    role: 'Opt-in extended browser research surface.',
    forbiddenModules: [],
    requiresBrowserBrain: false
}, surfaceIntents);

export const SURFACE_INTENTS = Object.freeze(surfaceIntents);

export const LAB_SURFACE_IDS = Object.freeze(['zero', 'x']);

export function getSurfaceIntent(id) {
  const key = String(id || '').trim();
  return Object.hasOwn(SURFACE_INTENTS, key) ? SURFACE_INTENTS[key] : null;
}

export function requireSurfaceIntent(id) {
  const intent = getSurfaceIntent(id);
  if (!intent) {
    throw new Error(`Missing surface intent: ${String(id || '').trim() || '(empty)'}`);
  }
  return intent;
}

/** Feature availability never grants authority; each operation also needs host consent. */
export async function authorizeSurfaceOperation(surface, request, hostAuthorize) {
  if (surface.authorityCeiling.includes(request.action)) return false;
  return typeof hostAuthorize === 'function' && await hostAuthorize(request) === true;
}
