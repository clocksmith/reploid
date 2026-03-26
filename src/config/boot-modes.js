/**
 * @fileoverview Product boot mode definitions and internal genesis mapping.
 */

export const DEFAULT_BOOT_MODE = 'absolute_zero';

export const BOOT_MODES = Object.freeze({
  zero: {
    id: 'zero',
    label: 'Zero',
    description: 'Mutable local substrate.',
    detail: 'Uses a browser-local model with an editable inference path.',
    genesisLevel: 'spark',
    requiresBrowserBrain: true
  },
  absolute_zero: {
    id: 'absolute_zero',
    label: 'Absolute Zero',
    description: 'Minimal self-building substrate.',
    detail: 'Starts from the smallest visible surface.',
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
  'absolute_zero',
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
      return 'absolute_zero';
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
