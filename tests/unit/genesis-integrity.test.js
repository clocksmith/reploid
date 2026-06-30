/**
 * Unit Test: Genesis integrity
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveBaseModules } from '../../self/config/module-resolution.js';
import { SHARED_FILE_TOOLS } from '../../self/config/tool-surfaces.js';
import { LAB_ROUTE_PROFILES } from '../../self/config/lab-route-profiles.js';

const genesisConfig = JSON.parse(readFileSync('self/config/genesis-levels.json', 'utf8'));

describe('genesis integrity', () => {
  it('/0 spark resolves the minimal bootstrapping module tier', () => {
    const modules = resolveBaseModules('spark', genesisConfig);

    expect(modules).toEqual(expect.arrayContaining([
      ...LAB_ROUTE_PROFILES.zero.requiredModules
    ]));
    expect(modules).not.toEqual(expect.arrayContaining([
      'ArenaHarness',
      'VFSSandbox',
      'VerificationManager',
      'WebRTCSwarm',
      'WorkerManager'
    ]));
  });

  it('/x full resolves the governed substrate stack', () => {
    const modules = resolveBaseModules('full', genesisConfig);

    expect(modules).toEqual(expect.arrayContaining([
      ...LAB_ROUTE_PROFILES.x.requiredModules,
      'SwarmSync'
    ]));
  });

  it('every declared module has a moduleFiles entry', () => {
    const allModules = new Set();
    for (const level of Object.values(genesisConfig.levels)) {
      for (const moduleName of level.modules || []) {
        allModules.add(moduleName);
      }
    }

    for (const moduleName of allModules) {
      expect(genesisConfig.moduleFiles[moduleName], moduleName).toBeTruthy();
      expect(genesisConfig.moduleFiles[moduleName].length, moduleName).toBeGreaterThan(0);
    }
  });

  it('shared file tool manifest contains the complete writable VFS contract surface', () => {
    const sharedTools = genesisConfig.sharedFiles.tools.map((path) => (
      path.split('/').pop().replace(/\.js$/, '')
    ));

    expect(sharedTools).toEqual(expect.arrayContaining(SHARED_FILE_TOOLS));
  });
});
