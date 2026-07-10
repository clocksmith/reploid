/**
 * E2E Test: Zero runtime UI manual refresh.
 */
import { test, expect } from '@playwright/test';
import {
  awakenWithMockGoal,
  awakenWithoutGoal,
  bootRouteWithServiceWorker,
  sanitizeInstanceId
} from './reploid-lab-helpers.js';

test.describe('Zero runtime UI refresh', () => {
  test('keeps the agent runtime usable after manual UI reload', async ({ page }, testInfo) => {
    const instanceId = sanitizeInstanceId(`zero-ui-refresh-${testInfo.project.name}-${Date.now()}`);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await bootRouteWithServiceWorker(page, '/zero', instanceId);
    await awakenWithoutGoal(page);

    await expect(page.locator('.zero-runtime-strip')).toBeVisible();
    await expect(page.locator('.zero-trace')).toBeVisible();
    await expect(page.locator('.zero-goal-text')).toHaveCount(0);

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

  test('shows successful and errored tool call counters', async ({ page }, testInfo) => {
    const instanceId = sanitizeInstanceId(`zero-tool-stats-${testInfo.project.name}-${Date.now()}`);
    const createToolResponse = `REPLOID/0

TOOL: CreateTool
name: CounterProbe
code <<EOF
export const tool = {
  name: 'CounterProbe',
  description: 'Tool counter probe',
  inputSchema: { type: 'object', properties: {} }
};

export default async function() {
  return { ok: true };
}
EOF`;
    const toolBatchResponse = `REPLOID/0

TOOL: CounterProbe

TOOL: MissingCounterProbe`;

    await awakenWithMockGoal(page, '/zero', instanceId, 'Exercise tool metrics.', [
      createToolResponse,
      toolBatchResponse,
      'DONE: tool metrics observed'
    ], { maxIterations: 2 });

    await expect(page.locator('.zero-runtime-strip')).toBeVisible();
    await expect.poll(async () => page.locator('#agent-tools').textContent(), {
      timeout: 30000
    }).toBe('2 ok / 1 err');
    await expect(page.locator('#agent-tool-rate')).toHaveText('33% fail');

    const beforeVersion = await page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null);
    await page.locator('.zero-more summary').click();
    await page.locator('[data-zero-action="reload-ui"]').click();
    await expect.poll(async () => page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null), {
      timeout: 30000
    }).not.toBe(beforeVersion);
    await expect(page.locator('#agent-tools')).toHaveText('2 ok / 1 err');
    await expect(page.locator('#agent-tool-rate')).toHaveText('33% fail');
  });
});
