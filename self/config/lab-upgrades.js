/** Explicit optional X extensions of the minimal Zero source image. */
import activeSource from './self-source-manifest.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../instance.js';

export const LAB_UPGRADE_LEVELS = Object.freeze(['spark', 'reflection', 'cognition', 'substrate', 'full']);
export const LAB_UPGRADE_STORAGE_KEY = 'REPLOID_X_UPGRADE_LEVEL';

export function getLabUpgradeLevel(mode = 'x', storage = getCurrentReploidStorage(), source = activeSource) {
  if (mode !== 'x') return 'spark';
  // Neither a prior Zero choice nor another instance's global preference grants
  // an upgrade to a new X. Exported X images bind their surface explicitly.
  const selected = storage?.getItem(LAB_UPGRADE_STORAGE_KEY, { legacyFallback: false });
  if (LAB_UPGRADE_LEVELS.includes(selected)) return selected;
  return source?.surface === 'x' && LAB_UPGRADE_LEVELS.includes(source.level)
    ? source.level : 'spark';
}

export function isMinimalLabMode(mode) {
  return (mode === 'x' || mode === 'zero') && getLabUpgradeLevel(mode) === 'spark';
}
