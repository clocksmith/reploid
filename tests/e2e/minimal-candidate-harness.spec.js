/**
 * E2E Test: minimal candidate harness in /shadow.
 */
import { test, expect } from '@playwright/test';
import {
  LAB_ROUTE_CASES,
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

test.describe('minimal candidate harness', () => {
  for (const routeCase of LAB_ROUTE_CASES) {
    test(`${routeCase.route} executes candidate modules from /shadow without mutating /self`, async ({ page }, testInfo) => {
      const instanceId = sanitizeInstanceId(`candidate-harness-${routeCase.label}-${testInfo.project.name}-${Date.now()}`);
      const candidatePath = `/shadow/candidates/${routeCase.label}/candidate-001/probe.js`;
      const failingPath = `/shadow/candidates/${routeCase.label}/candidate-002/probe.js`;
      const selfTarget = '/self/tools/CandidateProbe.js';

      await bootRouteWithServiceWorker(page, routeCase.route, instanceId);
      await awakenWithoutGoal(page);

      const result = await page.evaluate(async ({ candidatePath, failingPath, selfTarget, instanceId }) => {
        await window.REPLOID.vfs.write(candidatePath, 'export const value = "candidate-ok";\nexport default value;\n');
        const candidate = await import(`${candidatePath}?v=ok&instance=${instanceId}`);

        await window.REPLOID.vfs.write(failingPath, 'export const value = ;\n');
        let failureMessage = '';
        try {
          await import(`${failingPath}?v=bad&instance=${instanceId}`);
        } catch (error) {
          failureMessage = error?.message || String(error);
        }

        return {
          candidateValue: candidate.default,
          failureCaught: !!failureMessage,
          selfMutated: await window.REPLOID.vfs.exists(selfTarget).catch(() => false)
        };
      }, { candidatePath, failingPath, selfTarget, instanceId });

      expect(result).toEqual({
        candidateValue: 'candidate-ok',
        failureCaught: true,
        selfMutated: false
      });
    });
  }
});
