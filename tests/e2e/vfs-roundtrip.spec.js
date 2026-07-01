/**
 * E2E Test: VFS round-trip, persistence, and write boundary
 */
import { test, expect } from '@playwright/test';
import {
  LAB_ROUTE_CASES,
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  executeToolResult,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

async function bootAndAwaken(page, route, instanceId) {
  await bootRouteWithServiceWorker(page, route, instanceId);
  await awakenWithoutGoal(page);
}

test.describe('VFS round-trip and boundary', () => {
  for (const routeCase of LAB_ROUTE_CASES) {
    test(`${routeCase.route} persists writable roots and blocks direct /self mutation`, async ({ page }, testInfo) => {
      const instanceId = sanitizeInstanceId(`vfs-roundtrip-${routeCase.label}-${testInfo.project.name}-${Date.now()}`);
      const shadowPath = `/shadow/${routeCase.label}-${testInfo.project.name}-probe.json`;
      const artifactPath = `/artifacts/${routeCase.label}-${testInfo.project.name}-probe.json`;
      const content = JSON.stringify({
        route: routeCase.route,
        project: testInfo.project.name,
        marker: instanceId
      });

      await bootAndAwaken(page, routeCase.route, instanceId);

      const shadowWrite = await executeToolResult(page, 'WriteFile', { path: shadowPath, content });
      const artifactWrite = await executeToolResult(page, 'WriteFile', { path: artifactPath, content });
      expect(shadowWrite.ok).toBe(true);
      expect(artifactWrite.ok).toBe(true);

      const shadowRead = await executeToolResult(page, 'ReadFile', { path: shadowPath });
      const artifactRead = await executeToolResult(page, 'ReadFile', { path: artifactPath });
      expect(shadowRead).toMatchObject({ ok: true });
      expect(artifactRead).toMatchObject({ ok: true });
      expect(JSON.parse(shadowRead.value.content)).toMatchObject({ marker: instanceId });
      expect(JSON.parse(artifactRead.value.content)).toMatchObject({ marker: instanceId });
      const listedTools = await executeToolResult(page, 'ListTools');
      expect(listedTools.ok).toBe(true);
      const canDelete = listedTools.value.includes('DeleteFile');

      const blockedSelfWrite = await executeToolResult(page, 'WriteFile', {
        path: '/self/core/agent-loop.js',
        content: 'export default null;\n'
      });
      expect(blockedSelfWrite.ok).toBe(false);
      expect(blockedSelfWrite.message).toContain('Write candidates under /shadow');

      const blockedSelfDelete = await executeToolResult(page, 'DeleteFile', {
        path: '/self/core/agent-loop.js'
      });
      expect(blockedSelfDelete.ok).toBe(false);
      if (canDelete) {
        expect(blockedSelfDelete.message).toContain('Delete candidates under /shadow');
      } else {
        expect(blockedSelfDelete.message).toMatch(/Tool (not found|not available)/);
      }

      await page.reload();
      await bootAndAwaken(page, routeCase.route, instanceId);

      const persistedRead = await executeToolResult(page, 'ReadFile', { path: shadowPath });
      expect(persistedRead.ok).toBe(true);
      expect(JSON.parse(persistedRead.value.content)).toMatchObject({ marker: instanceId });

      if (!canDelete) return;

      const shadowDelete = await executeToolResult(page, 'DeleteFile', { path: shadowPath });
      const artifactDelete = await executeToolResult(page, 'DeleteFile', { path: artifactPath });
      expect(shadowDelete.ok).toBe(true);
      expect(artifactDelete.ok).toBe(true);
      await page.reload();
      await bootAndAwaken(page, routeCase.route, instanceId);

      const deletedRead = await executeToolResult(page, 'ReadFile', { path: shadowPath });
      expect(deletedRead.ok).toBe(false);
    });
  }
});
