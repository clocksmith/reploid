/** Explicit optional extensions of the minimal X source image. */
import activeSource from './self-source-manifest.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../instance.js';

export const LAB_UPGRADE_LEVELS = Object.freeze(['spark', 'reflection', 'cognition', 'substrate', 'full']);
export const LAB_UPGRADE_STORAGE_KEY = 'REPLOID_ZERO_UPGRADE_LEVEL';

export function getLabUpgradeLevel(mode = 'x', storage = getCurrentReploidStorage()) {
  if (mode !== 'zero') return 'spark';
  const selected = storage?.getItem(LAB_UPGRADE_STORAGE_KEY);
  return LAB_UPGRADE_LEVELS.includes(selected) ? selected
    : LAB_UPGRADE_LEVELS.includes(activeSource.level) ? activeSource.level : 'spark';
}

export function isMinimalLabMode(mode) {
  return (mode === 'x' || mode === 'zero') && getLabUpgradeLevel(mode) === 'spark';
}
