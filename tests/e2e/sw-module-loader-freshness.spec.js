/**
 * E2E Test: Service-worker module-loader freshness
 */
import { test, expect } from '@playwright/test';
import {
  LAB_ROUTE_CASES,
  bootRouteWithServiceWorker,
  runTransitiveImportSmoke,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

test.describe('Service-worker module freshness', () => {
  for (const routeCase of LAB_ROUTE_CASES) {
    test(`${routeCase.route} serves updated VFS modules through explicit versioning`, async ({ page }, testInfo) => {
      const instanceId = sanitizeInstanceId(`sw-freshness-${routeCase.label}-${testInfo.project.name}-${Date.now()}`);
      const prefix = `/shadow/sw-freshness-${routeCase.label}-${testInfo.project.name.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;

      await bootRouteWithServiceWorker(page, routeCase.route, instanceId);
      const result = await runTransitiveImportSmoke(page, instanceId, prefix);

      expect(result).toEqual({
        before: 'before',
        after: 'after'
      });
    });
  }
});
