/** Boot projections derive from the surface intent owner, without loading lab composition. */
import { LAB_SURFACE_IDS, requireSurfaceIntent } from '../../shared/config/surface-intents.js';

export const ROUTE_BOOT_SPECS = Object.freeze(Object.fromEntries(LAB_SURFACE_IDS.map(id => {
  const intent = requireSurfaceIntent(id);
  return [intent.route, Object.freeze({ title: intent.label, extends: intent.extends || null,
    mode: intent.mode, bootProfile: intent.bootProfile, genesisLevel: intent.genesisLevel,
    uiMode: intent.uiMode, surface: intent.surface, productFacing: false })];
})));
