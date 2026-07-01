/**
 * E2E Test: Zero runtime UI manual refresh.
 */
import { test, expect } from '@playwright/test';
import {
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

test.describe('Zero runtime UI refresh', () => {
  test('keeps the agent runtime usable after manual UI reload', async ({ page }, testInfo) => {
    const instanceId = sanitizeInstanceId(`zero-ui-refresh-${testInfo.project.name}-${Date.now()}`);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await bootRouteWithServiceWorker(page, '/0', instanceId);
    await awakenWithoutGoal(page);

    await expect(page.locator('.zero-runtime-strip')).toBeVisible();
    await expect(page.locator('.zero-trace')).toBeVisible();
    await expect(page.locator('.zero-goal-text')).toBeVisible();

    const beforeVersion = await page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null);
    await page.locator('.zero-more summary').click();
    await page.locator('[data-zero-action="reload-ui"]').click();

    await expect.poll(async () => page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null), {
      timeout: 30000
    }).not.toBe(beforeVersion);
    await expect(page.locator('.zero-runtime-strip')).toBeVisible();
    await expect(page.locator('.zero-trace')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Boot Failure|UI reload failed/i);
    expect(pageErrors).toEqual([]);
  });
});
