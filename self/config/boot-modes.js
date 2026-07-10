/**
 * @fileoverview Product boot mode definitions and internal genesis mapping.
 */

import { requireSurfaceIntent } from './surface-intents.js';

export const DEFAULT_BOOT_MODE = 'reploid';

const ZERO_SURFACE = requireSurfaceIntent('zero');
const X_SURFACE = requireSurfaceIntent('x');

const toSurfaceBootMode = (surface) => Object.freeze({
  id: surface.id,
  label: surface.label,
  route: surface.route,
  description: surface.summary,
  detail: surface.detail,
  intent: surface.intent,
  genesisLevel: surface.genesisLevel,
  requiresBrowserBrain: surface.requiresBrowserBrain
});

export const BOOT_MODES = Object.freeze({
  pool: {
    id: 'pool',
    label: 'Pool',
    description: 'Receipt-backed browser inference pool.',
    detail: 'Public product route for running prompts, contributing browser compute, inspecting receipts, and managing agents.',
    genesisLevel: 'capsule',
    requiresBrowserBrain: false
  },
  zero: toSurfaceBootMode(ZERO_SURFACE),
  reploid: {
    id: 'reploid',
    label: 'Reploid',
    description: 'Minimal seed Reploid.',
    detail: 'Awakens from the smallest live self for observable, bounded browser-native self-improvement.',
    genesisLevel: 'capsule',
    requiresBrowserBrain: false
  },
  x: toSurfaceBootMode(X_SURFACE)
});

export const BOOT_MODE_ORDER = Object.freeze([
  'reploid',
  'zero',
  'x'
]);

export function normalizeBootMode(mode, fallback = DEFAULT_BOOT_MODE) {
  return typeof mode === 'string' && BOOT_MODES[mode] ? mode : fallback;
}

export function getBootModeConfig(mode) {
  return BOOT_MODES[normalizeBootMode(mode)];
}

export function getDefaultGenesisLevelForMode(mode) {
  return getBootModeConfig(mode).genesisLevel;
}

export function inferBootModeFromGenesis(genesisLevel, fallback = DEFAULT_BOOT_MODE) {
  const normalizedFallback = normalizeBootMode(fallback);
  if (BOOT_MODES[normalizedFallback]?.genesisLevel === genesisLevel) {
    return normalizedFallback;
  }

  switch (genesisLevel) {
    case 'capsule':
    case 'tabula':
      return 'reploid';
    case 'spark':
      return 'zero';
    case 'reflection':
    case 'cognition':
    case 'substrate':
    case 'full':
      return 'x';
    default:
      return normalizedFallback;
  }
}
