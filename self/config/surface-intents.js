/**
 * @fileoverview Canonical route intent for Reploid lab surfaces.
 */

import { extendIds, freezeArray } from './immutability.js';
import {
  X_TOOL_SURFACE_IDS,
  ZERO_TOOL_SURFACE_IDS
} from './tool-surfaces.js';

const ZERO_REQUIRED_MODULES = Object.freeze([
  'AgentLoop',
  'CircuitBreaker',
  'ContextManager',
  'LLMClient',
  'ToolRunner',
  'ToolWriter',
  'VFS'
]);

const X_ADDITIONAL_REQUIRED_MODULES = Object.freeze([
  'ArenaHarness',
  'DopplerToolbox',
  'ErrorStore',
  'KnowledgeGraph',
  'MemoryManager',
  'SemanticMemory',
  'SubstrateLoader',
  'SwarmTransport',
  'TelemetryTimeline',
  'VFSSandbox',
  'VerificationManager',
  'WebRTCSwarm',
  'WorkerManager'
]);

const X_ADDITIONAL_TOOL_SURFACE_IDS = Object.freeze(
  X_TOOL_SURFACE_IDS.filter((id) => !ZERO_TOOL_SURFACE_IDS.includes(id))
);

const createSurfaceIntentRegistry = () => Object.create(null);

const defineSurfaceIntent = (intent, registry = createSurfaceIntentRegistry()) => {
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
    forbiddenModules: freezeArray(intent.forbiddenModules)
  });
};

const surfaceIntents = createSurfaceIntentRegistry();

surfaceIntents.zero = defineSurfaceIntent({
    id: 'zero',
    label: 'Zero',
    route: '/zero',
    mode: 'zero',
    bootProfile: 'zero_home',
    genesisLevel: 'spark',
    uiMode: 'zero',
    surface: 'zero',
    summary: 'Tabula-rasa browser RSI agent.',
    detail: 'Self-contained RSI agent with server proxy inference by default and optional local Doppler execution.',
    intent: 'Awaken the smallest self-loading browser RSI loop that starts from CreateTool and grows the reader, writer, loader, and self-mutation tools it needs.',
    role: 'Minimal self-loading browser research surface.',
    toolSurfaceIds: ZERO_TOOL_SURFACE_IDS,
    requiredModules: ZERO_REQUIRED_MODULES,
    forbiddenModules: [
      ...X_ADDITIONAL_REQUIRED_MODULES,
      'HITLController'
    ],
    requiresBrowserBrain: false
});

surfaceIntents.x = defineSurfaceIntent({
    id: 'x',
    label: 'X',
    route: '/x',
    mode: 'x',
    bootProfile: 'x_home',
    genesisLevel: 'full',
    uiMode: 'proto',
    surface: 'x',
    extends: 'zero',
    summary: 'Prebuilt full-stack substrate.',
    detail: 'Starts with the mature RSI surface already assembled.',
    intent: 'Run Zero plus arena, sandbox, worker, memory, swarm, verification, and promotion lanes as the mature self-evolution workspace.',
    role: 'Mature governed substrate surface.',
    additionalToolSurfaceIds: X_ADDITIONAL_TOOL_SURFACE_IDS,
    additionalRequiredModules: X_ADDITIONAL_REQUIRED_MODULES,
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
