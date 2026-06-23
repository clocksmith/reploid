/**
 * @fileoverview Product boot mode definitions and internal genesis mapping.
 */

export const DEFAULT_BOOT_MODE = 'reploid';

export const BOOT_MODES = Object.freeze({
  pool: {
    id: 'pool',
    label: 'Pool',
    description: 'Receipt-backed browser inference pool.',
    detail: 'Public product route for running prompts, contributing browser compute, inspecting receipts, and managing agents.',
    genesisLevel: 'capsule',
    requiresBrowserBrain: false
  },
  zero: {
    id: 'zero',
    label: 'Zero',
    description: 'Tabula-rasa browser RSI agent.',
    detail: 'Self-contained RSI agent with server proxy inference by default and optional local Doppler execution.',
    genesisLevel: 'spark',
    requiresBrowserBrain: false
  },
  reploid: {
    id: 'reploid',
    label: 'Reploid',
    description: 'Minimal seed Reploid.',
    detail: 'Awakens from the smallest live self for observable, bounded browser-native self-improvement.',
    genesisLevel: 'capsule',
    requiresBrowserBrain: false
  },
  x: {
    id: 'x',
    label: 'X',
    description: 'Prebuilt full-stack substrate.',
    detail: 'Starts with the mature RSI surface already assembled.',
    genesisLevel: 'full',
    requiresBrowserBrain: false
  }
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
