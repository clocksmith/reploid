/**
 * E2E Test: route DI/genesis health.
 */
import { test, expect } from '@playwright/test';
import {
  LAB_ROUTE_CASES,
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

test.describe('DI container route health', () => {
  for (const routeCase of LAB_ROUTE_CASES) {
    test(`${routeCase.route} registers and instantiates its declared route modules`, async ({ page }, testInfo) => {
      const instanceId = sanitizeInstanceId(`di-health-${routeCase.label}-${testInfo.project.name}-${Date.now()}`);

      await bootRouteWithServiceWorker(page, routeCase.route, instanceId);
      await awakenWithoutGoal(page);

      const health = await page.evaluate(async (routeCase) => {
        const container = window.REPLOID.container;
        const result = {
          registered: {},
          resolved: {},
          errors: {}
        };

        for (const moduleName of routeCase.requiredModules) {
          result.registered[moduleName] = container.hasModule(moduleName);
          try {
            result.resolved[moduleName] = !!(await container.resolve(moduleName));
          } catch (error) {
            result.resolved[moduleName] = false;
            result.errors[moduleName] = error?.message || String(error);
          }
        }
        for (const moduleName of routeCase.forbiddenModules) {
          result.registered[moduleName] = container.hasModule(moduleName);
        }
        return result;
      }, routeCase);

      for (const moduleName of routeCase.requiredModules) {
        expect(health.registered[moduleName], `${routeCase.route} registered ${moduleName}`).toBe(true);
        expect(health.resolved[moduleName], `${routeCase.route} resolved ${moduleName}: ${health.errors[moduleName] || ''}`).toBe(true);
      }
      for (const moduleName of routeCase.forbiddenModules) {
        expect(health.registered[moduleName], `${routeCase.route} forbidden ${moduleName}`).toBe(false);
      }
    });
  }
});
