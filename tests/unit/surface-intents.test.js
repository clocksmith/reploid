import { describe, expect, it } from 'vitest';

import { getRouteBootSpec } from '../../self/boot-spec.js';
import { BOOT_MODES } from '../../self/config/boot-modes.js';
import {
  LAB_SURFACE_IDS,
  getSurfaceIntent
} from '../../self/config/surface-intents.js';
import { LAB_ROUTE_PROFILES } from '../../self/lab/profiles.js';

const sorted = (items) => [...items].sort();
const uniqueSorted = (...groups) => sorted(new Set(groups.flat()));

describe('surface intents', () => {
  it('drives Zero and X boot modes and lab profiles from one contract', () => {
    for (const id of LAB_SURFACE_IDS) {
      const intent = getSurfaceIntent(id);
      const bootMode = BOOT_MODES[id];
      const profile = LAB_ROUTE_PROFILES[id];
      const routeSpec = getRouteBootSpec(intent.route);

      expect(bootMode).toMatchObject({
        id: intent.id,
        label: intent.label,
        route: intent.route,
        description: intent.summary,
        detail: intent.detail,
        intent: intent.intent,
        genesisLevel: intent.genesisLevel
      });

      expect(profile).toMatchObject({
        id: intent.id,
        route: intent.route,
        title: intent.label,
        mode: intent.mode,
        bootProfile: intent.bootProfile,
        genesisLevel: intent.genesisLevel,
        uiMode: intent.uiMode,
        surface: intent.surface,
        intent: intent.intent,
        role: intent.role
      });

      expect(routeSpec).toMatchObject({
        mode: intent.mode,
        bootProfile: intent.bootProfile,
        genesisLevel: intent.genesisLevel,
        uiMode: intent.uiMode,
        surface: intent.surface
      });
    }
  });

  it('keeps X as an explicit extension of Zero', () => {
    const zero = getSurfaceIntent('zero');
    const x = getSurfaceIntent('x');
    const expectedRequiredModules = uniqueSorted(zero.requiredModules, x.additionalRequiredModules);
    const expectedToolSurfaceIds = uniqueSorted(zero.toolSurfaceIds, x.additionalToolSurfaceIds);

    expect(x.extends).toBe(zero.id);
    expect(LAB_ROUTE_PROFILES.x.extends).toBe(zero.id);
    expect(sorted(x.requiredModules)).toEqual(expectedRequiredModules);
    expect(sorted(x.toolSurfaceIds)).toEqual(expectedToolSurfaceIds);
    expect(sorted(LAB_ROUTE_PROFILES.x.requiredModules)).toEqual(expectedRequiredModules);
    expect(sorted(LAB_ROUTE_PROFILES.x.toolSurfaceIds)).toEqual(expectedToolSurfaceIds);
  });

  it('does not expose /0 as a shadow boot route', () => {
    expect(getRouteBootSpec('/0')).toBeNull();
    expect(getRouteBootSpec('/zero')).toMatchObject({ mode: 'zero' });
  });

  it('does not leak Object prototype members through intent lookup', () => {
    expect(getSurfaceIntent('toString')).toBeNull();
    expect(getSurfaceIntent('constructor')).toBeNull();
    expect(getSurfaceIntent('hasOwnProperty')).toBeNull();
    expect(getSurfaceIntent('__proto__')).toBeNull();
  });
});
