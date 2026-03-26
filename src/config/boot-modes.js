/**
 * @fileoverview Product boot mode definitions and internal genesis mapping.
 */

export const DEFAULT_BOOT_MODE = 'zero';

export const BOOT_MODES = Object.freeze({
  zero: {
    id: 'zero',
    label: 'Zero',
    description: 'Minimal self-building substrate',
    detail: 'Defaults to the internal Zero foundation and no blueprints.',
    genesisLevel: 'spark',
    requiresBrowserBrain: false
  },
  awakened_zero: {
    id: 'awakened_zero',
    label: 'Awakened Zero',
    description: 'Zero with a mutable local brain',
    detail: 'Requires a browser-local model so kernels and weights stay in reach.',
    genesisLevel: 'spark',
    requiresBrowserBrain: true
  },
  x: {
    id: 'x',
    label: 'X',
    description: 'Prebuilt full RSI stack',
    detail: 'Boots the mature pre-assembled system with the broader capability surface.',
    genesisLevel: 'full',
    requiresBrowserBrain: false
  }
});

export const BOOT_MODE_ORDER = Object.freeze([
  'zero',
  'awakened_zero',
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
  switch (genesisLevel) {
    case 'tabula':
    case 'spark':
      return 'zero';
    case 'reflection':
    case 'cognition':
    case 'substrate':
    case 'full':
      return 'x';
    default:
      return normalizeBootMode(fallback);
  }
}
