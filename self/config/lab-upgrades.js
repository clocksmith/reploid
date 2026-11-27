/** Explicit optional X extensions of the minimal Zero source image. */
import activeSource from './self-source-manifest.json' with { type: 'json' };
import { getCurrentReploidStorage } from '../../shared/instance.js';
import { ZERO_TOOL_SURFACE_IDS } from '../../shared/config/tool-surfaces.js';

export const LAB_UPGRADE_LEVELS = Object.freeze(['spark', 'reflection', 'cognition', 'substrate', 'full']);
export const LAB_UPGRADE_STORAGE_KEY = 'REPLOID_X_UPGRADE_LEVEL';

const REFLECTION_SURFACE_IDS = ['sharedFile', 'extendedFile', 'promotion'];
// X's capability packs: the tool surfaces each upgrade level gives X. Spark is Zero's seed.
export const LAB_UPGRADE_TOOL_SURFACE_IDS = Object.freeze({
  spark: ZERO_TOOL_SURFACE_IDS,
  reflection: Object.freeze([...REFLECTION_SURFACE_IDS]),
  cognition: Object.freeze([...REFLECTION_SURFACE_IDS, 'cognition']),
  substrate: Object.freeze([...REFLECTION_SURFACE_IDS, 'cognition', 'workers']),
  full: Object.freeze([...REFLECTION_SURFACE_IDS, 'cognition', 'workers', 'optimization', 'swarm'])
});

/** The tool surfaces an X upgrade selects, or undefined for every other mode and unknown levels. */
export function getLabToolSurfaceIds(mode, level = getLabUpgradeLevel(mode)) {
  return mode === 'x' && Object.hasOwn(LAB_UPGRADE_TOOL_SURFACE_IDS, level) ? LAB_UPGRADE_TOOL_SURFACE_IDS[level] : undefined;
}

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
