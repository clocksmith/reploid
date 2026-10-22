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

  it('keeps Zero as an explicit opt-in extension of X', () => {
    const zero = getSurfaceIntent('zero');
    const x = getSurfaceIntent('x');
    expect(zero.extends).toBe(x.id);
    expect(LAB_ROUTE_PROFILES.zero.extends).toBe(x.id);
    expect(x.extends).toBeUndefined();
    expect(sorted(zero.requiredModules)).toEqual(sorted(x.requiredModules));
    expect(sorted(zero.toolSurfaceIds)).toEqual(sorted(x.toolSurfaceIds));
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

describe('resolved extension authority', () => {
  it('derives resources from X and preserves ceilings independently of feature availability', async () => {
    const { SURFACE_INTENTS, authorizeSurfaceOperation } = await import('../../self/config/surface-intents.js');
    const { LAB_ROUTE_PROFILES } = await import('../../self/lab/profiles.js');
    const { BOOT_SEED_PROFILES } = await import('../../self/config/boot-seed.js');
    const zero = SURFACE_INTENTS.zero, x = SURFACE_INTENTS.x;
    expect(zero.seedPrefixes.every(path => x.seedPrefixes.includes(path))).toBe(true);
    expect(LAB_ROUTE_PROFILES.x.requiredModules).toEqual(x.requiredModules);
    expect(BOOT_SEED_PROFILES.x_home).toBe(x.seedPrefixes);
    expect(x.authorityCeiling).toEqual(zero.authorityCeiling);
    expect(await authorizeSurfaceOperation(x, { action: 'candidate.selfApprove' }, () => true)).toBe(false);
    expect(await authorizeSurfaceOperation(x, { action: 'tool.execute' }, () => false)).toBe(false);
  });
});
