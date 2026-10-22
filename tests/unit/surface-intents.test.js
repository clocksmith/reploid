import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRouteBootSpec } from '../../self/boot-spec.js';
import { BOOT_MODES, inferBootModeFromGenesis } from '../../self/config/boot-modes.js';
import {
  LAB_SURFACE_IDS,
  getSurfaceIntent
} from '../../self/config/surface-intents.js';
import { LAB_ROUTE_PROFILES } from '../../self/lab/profiles.js';
import { getGenesisLevel, getModuleOverrides, resolveModules } from '../../self/boot-helpers/config.js';
import { LAB_UPGRADE_STORAGE_KEY } from '../../self/config/lab-upgrades.js';
import { getCurrentReploidStorage } from '../../self/instance.js';
import genesisConfig from '../../self/config/genesis-levels.json' with { type: 'json' };
import moduleRegistry from '../../self/config/module-registry.json' with { type: 'json' };

afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });

const sorted = (items) => [...items].sort();

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

  it('keeps X as an explicit opt-in extension of Zero', () => {
    const zero = getSurfaceIntent('zero');
    const x = getSurfaceIntent('x');
    expect(x.extends).toBe(zero.id);
    expect(LAB_ROUTE_PROFILES.x.extends).toBe(zero.id);
    expect(zero.extends).toBeUndefined();
    expect(sorted(zero.requiredModules)).toEqual(sorted(x.requiredModules));
    expect(sorted(zero.toolSurfaceIds)).toEqual(sorted(x.toolSurfaceIds));
  });

  it.each(['zero', 'x'])('boots %s minimally despite old or global optional preferences', mode => {
    vi.stubGlobal('window', {
      REPLOID_INSTANCE_ID: `fresh-${mode}`,
      location: { pathname: `/${mode}`, href: `https://example.test/${mode}` }
    });
    localStorage.setItem('REPLOID_ZERO_UPGRADE_LEVEL', 'full');
    localStorage.setItem(LAB_UPGRADE_STORAGE_KEY, 'full');
    localStorage.setItem('REPLOID_GENESIS_LEVEL', 'full');
    localStorage.setItem('REPLOID_MODULE_OVERRIDES', JSON.stringify({ WorkerManager: 'on', HITLController: 'on' }));
    const level = getGenesisLevel(genesisConfig);
    const modules = resolveModules(level, genesisConfig, moduleRegistry, getModuleOverrides());
    expect(level).toBe('spark');
    expect(modules).toEqual(expect.arrayContaining(['AgentLoop', 'ToolWriter', 'VFS']));
    for (const name of ['WorkerManager', 'HITLController', 'ErrorStore', 'SwarmTransport', 'SubstrateLoader']) {
      expect(modules).not.toContain(name);
    }
  });

  it('resolves optional modules only for the explicitly selected X instance', () => {
    vi.stubGlobal('window', {
      REPLOID_INSTANCE_ID: 'selected-x',
      location: { pathname: '/x', href: 'https://example.test/x' }
    });
    getCurrentReploidStorage().setItem(LAB_UPGRADE_STORAGE_KEY, 'full');
    const level = getGenesisLevel(genesisConfig);
    const modules = resolveModules(level, genesisConfig, moduleRegistry, getModuleOverrides());
    expect(level).toBe('full');
    expect(modules).toEqual(expect.arrayContaining(['WorkerManager', 'SubstrateLoader', 'HITLController']));
    window.location.pathname = '/zero';
    expect(getGenesisLevel(genesisConfig)).toBe('spark');
    const zeroModules = resolveModules('spark', genesisConfig, moduleRegistry, getModuleOverrides());
    expect(zeroModules).not.toContain('WorkerManager');
    expect(zeroModules).not.toContain('HITLController');
  });

  it('preserves saved level-only mode inference without using it to rename a route', () => {
    expect(inferBootModeFromGenesis('spark')).toBe('x');
    expect(inferBootModeFromGenesis('reflection')).toBe('zero');
    expect(inferBootModeFromGenesis('full')).toBe('zero');
    expect(inferBootModeFromGenesis('spark', 'zero')).toBe('zero');
    expect(getRouteBootSpec('/zero').mode).toBe('zero');
    expect(getRouteBootSpec('/x').mode).toBe('x');
  });

  it('uses corrected roles only for an explicit new level selection', () => {
    const selection = { explicitSelection: true };
    expect(inferBootModeFromGenesis('spark', 'reploid', selection)).toBe('zero');
    expect(inferBootModeFromGenesis('spark', 'zero', selection)).toBe('zero');
    expect(inferBootModeFromGenesis('spark', 'x', selection)).toBe('x');
    for (const level of ['reflection', 'cognition', 'substrate', 'full']) {
      expect(inferBootModeFromGenesis(level, 'zero', selection)).toBe('x');
      expect(inferBootModeFromGenesis(level, 'x', selection)).toBe('x');
      expect(inferBootModeFromGenesis(level, 'zero')).toBe('zero');
    }
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
  it('derives resources from Zero and preserves ceilings independently of feature availability', async () => {
    const { SURFACE_INTENTS, authorizeSurfaceOperation } = await import('../../self/config/surface-intents.js');
    const { LAB_ROUTE_PROFILES } = await import('../../self/lab/profiles.js');
    const { BOOT_SEED_PROFILES } = await import('../../self/config/boot-seed.js');
    const zero = SURFACE_INTENTS.zero, x = SURFACE_INTENTS.x;
    expect(x.seedPrefixes.every(path => zero.seedPrefixes.includes(path))).toBe(true);
    expect(LAB_ROUTE_PROFILES.x.requiredModules).toEqual(x.requiredModules);
    expect(BOOT_SEED_PROFILES.zero_home).toBe(zero.seedPrefixes);
    expect(x.authorityCeiling).toEqual(zero.authorityCeiling);
    for (const surface of [zero, x]) {
      for (const action of ['candidate.selfApprove', 'candidate.modifyEvaluator', 'permissions.escalate']) {
        expect(await authorizeSurfaceOperation(surface, { action }, () => true)).toBe(false);
      }
      expect(await authorizeSurfaceOperation(surface, { action: 'tool.execute' }, () => false)).toBe(false);
      expect(await authorizeSurfaceOperation(surface, { action: 'tool.execute' })).toBe(false);
      expect(await authorizeSurfaceOperation(surface, { action: 'tool.execute' }, () => true)).toBe(true);
    }
  });
});
