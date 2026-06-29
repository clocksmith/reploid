/**
 * E2E Test: /0 and /x boot contract
 * Verifies route, genesis, DI, tools, VFS, and service-worker readiness.
 */
import { test, expect } from '@playwright/test';
import {
  LAB_ROUTE_CASES,
  assertRouteContract,
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  collectBootProbe,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

test.describe('Lab route boot contract', () => {
  for (const routeCase of LAB_ROUTE_CASES) {
    test(`${routeCase.route} resolves expected lab contract and awakened surface`, async ({ page }, testInfo) => {
      const instanceId = sanitizeInstanceId(`boot-contract-${routeCase.label}-${testInfo.project.name}-${Date.now()}`);

      await page.addInitScript(() => {
        localStorage.setItem('REPLOID_MODE', 'reploid');
        localStorage.setItem('REPLOID_GENESIS_LEVEL', 'capsule');
      });

      await bootRouteWithServiceWorker(page, routeCase.route, instanceId);
      await assertRouteContract(page, routeCase);
      await awakenWithoutGoal(page);

      const probe = await collectBootProbe(page, routeCase);

      expect(probe).toMatchObject({
        route: routeCase.route,
        bootProfile: routeCase.bootProfile,
        genesisLevel: routeCase.genesisLevel,
        uiMode: routeCase.uiMode,
        serviceWorkerReady: true,
        vfsReady: true,
        agentLoopReady: true
      });
      expect(probe.writableRoots).toEqual(expect.arrayContaining(['/shadow', '/artifacts']));

      for (const moduleName of routeCase.requiredModules) {
        expect(probe.modulesLoaded[moduleName], `${routeCase.route} module ${moduleName}`).toBe(true);
      }
      for (const moduleName of routeCase.forbiddenModules) {
        expect(probe.modulesLoaded[moduleName], `${routeCase.route} forbidden module ${moduleName}`).toBe(false);
      }
      for (const toolName of routeCase.requiredTools) {
        expect(probe.toolsLoaded, `${routeCase.route} tool ${toolName}`).toContain(toolName);
      }
      for (const toolName of routeCase.forbiddenTools) {
        expect(probe.toolsLoaded, `${routeCase.route} forbidden tool ${toolName}`).not.toContain(toolName);
      }
    });
  }
});
