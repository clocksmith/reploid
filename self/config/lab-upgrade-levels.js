/** Explicit optional X upgrade levels and instance-scoped selection reader. */
import { getCurrentReploidStorage } from '../../shared/instance.js';

export const LAB_UPGRADE_LEVELS = Object.freeze(['spark', 'reflection', 'cognition', 'substrate', 'full']);
export const LAB_UPGRADE_STORAGE_KEY = 'REPLOID_X_UPGRADE_LEVEL';

export function getSelectedLabUpgradeLevel(mode = 'x', storage = getCurrentReploidStorage(), source = null) {
  if (mode !== 'x') return 'spark';
  // Neither a prior Zero choice nor another instance's global preference grants
  // an upgrade to a new X. Exported X images bind their surface explicitly.
  const selected = storage?.getItem(LAB_UPGRADE_STORAGE_KEY, { legacyFallback: false });
  if (LAB_UPGRADE_LEVELS.includes(selected)) return selected;
  if (source?.surface === 'x' && LAB_UPGRADE_LEVELS.includes(source.level)) return source.level;
  return 'spark';
}
