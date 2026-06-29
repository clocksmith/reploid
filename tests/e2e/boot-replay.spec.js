/**
 * E2E Test: deterministic boot replay across existing browser state.
 */
import { test, expect } from '@playwright/test';
import {
  LAB_ROUTE_CASES,
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  collectBootProbe,
  readVfsJson,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

const stableProbe = (probe) => ({
  route: probe.route,
  bootProfile: probe.bootProfile,
  genesisLevel: probe.genesisLevel,
  uiMode: probe.uiMode,
  serviceWorkerReady: probe.serviceWorkerReady,
  vfsReady: probe.vfsReady,
  agentLoopReady: probe.agentLoopReady
});

test.describe('boot replay', () => {
  for (const routeCase of LAB_ROUTE_CASES) {
    test(`${routeCase.route} replays boot contract with existing IndexedDB and service worker`, async ({ page }, testInfo) => {
      const instanceId = sanitizeInstanceId(`boot-replay-${routeCase.label}-${testInfo.project.name}-${Date.now()}`);
      const markerPath = `/shadow/boot-replay-${routeCase.label}.json`;

      await bootRouteWithServiceWorker(page, routeCase.route, instanceId);
      await awakenWithoutGoal(page);
      const firstProbe = await collectBootProbe(page, routeCase);

      await page.evaluate(async ({ markerPath, instanceId }) => {
        await window.REPLOID.vfs.write(markerPath, JSON.stringify({
          marker: instanceId,
          condition: 'existing-indexeddb-and-sw'
        }));
      }, { markerPath, instanceId });

      await page.reload();
      await bootRouteWithServiceWorker(page, routeCase.route, instanceId);
      await awakenWithoutGoal(page);
      const replayProbe = await collectBootProbe(page, routeCase);
      const marker = await readVfsJson(page, markerPath);

      expect(stableProbe(replayProbe)).toEqual(stableProbe(firstProbe));
      expect(marker).toMatchObject({
        marker: instanceId,
        condition: 'existing-indexeddb-and-sw'
      });
      expect(await page.evaluate(() => !!navigator.serviceWorker?.controller)).toBe(true);
    });
  }
});
