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
import { ZERO_KATAMARI_GOAL } from '../../self/config/zero-goals.js';

test.describe('Zero runtime UI refresh', () => {
  test('boots with the single selected registry Katamari goal', async ({ page }, testInfo) => {
    const instanceId = sanitizeInstanceId(`zero-default-goal-${testInfo.project.name}-${Date.now()}`);

    await bootRouteWithServiceWorker(page, '/zero', instanceId);

    await expect(page.locator('#goal-input')).toHaveValue(ZERO_KATAMARI_GOAL.text);
    await expect(page.locator('#goal-input')).toHaveAttribute('placeholder', ZERO_KATAMARI_GOAL.text);
  });

  test('keeps the agent runtime usable after manual UI reload', async ({ page }, testInfo) => {
    const instanceId = sanitizeInstanceId(`zero-ui-refresh-${testInfo.project.name}-${Date.now()}`);
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await bootRouteWithServiceWorker(page, '/zero', instanceId);
    await awakenWithoutGoal(page);

    await expect(page.locator('.zero-inspect')).not.toHaveAttribute('open', '');
    await expect(page.locator('.zero-runtime-strip')).toBeHidden();
    await expect(page.locator('.zero-trace')).toBeHidden();
    await expect(page.locator('.zero-goal')).toBeVisible();
    await expect(page.locator('.zero-goal-text')).toHaveCount(1);
    await expect(page.locator('#zero-conversation')).toBeVisible();
    await expect(page.locator('#zero-human-input')).toBeVisible();
    await expect(page.locator('#zero-human-input')).toBeInViewport();
    await page.locator('.zero-inspect > summary').click();
    await expect(page.locator('.zero-runtime-strip')).toBeVisible();
    await expect(page.locator('.zero-trace')).toBeVisible();
    await page.locator('.zero-trace').scrollIntoViewIfNeeded();
    await expect(page.locator('.zero-trace')).toBeInViewport();
    const initialWidths = await page.evaluate(() => {
      const contentWidth = (node) => {
        const style = getComputedStyle(node);
        return node.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      };
      const inspect = document.querySelector('.zero-inspect-content');
      const trace = document.querySelector('.zero-trace');
      const list = document.querySelector('.zero-trace-list');
      return {
        inspectContent: contentWidth(inspect),
        trace: trace.getBoundingClientRect().width,
        traceContent: contentWidth(trace),
        list: list.getBoundingClientRect().width
      };
    });
    expect(initialWidths.trace).toBeCloseTo(initialWidths.inspectContent, 0);
    expect(initialWidths.list).toBeCloseTo(initialWidths.traceContent, 0);

    const beforeVersion = await page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null);
    await page.locator('[data-zero-action="reload-ui"]').click();

    await expect.poll(async () => page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null), {
      timeout: 30000
    }).not.toBe(beforeVersion);
    await expect(page.locator('.zero-inspect')).not.toHaveAttribute('open', '');
    await expect(page.locator('#zero-human-input')).toBeVisible();
    await page.locator('.zero-inspect > summary').click();
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
  activation: {
    checks: [{ name: 'returns ok', args: {}, expected: { ok: true } }]
  },
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

    await expect(page.locator('.zero-goal-text')).toHaveText('Exercise tool metrics.');
    await expect(page.locator('.zero-runtime-strip')).toBeHidden();
    await page.locator('.zero-inspect > summary').click();
    await expect(page.locator('.zero-runtime-strip')).toBeVisible();
    await expect.poll(async () => page.locator('#agent-tools').textContent(), {
      timeout: 30000
    }).toBe('2 ok / 1 err');
    await expect(page.locator('#agent-tool-rate')).toHaveText('33% fail');

    const beforeVersion = await page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null);
    await page.locator('[data-zero-action="reload-ui"]').click();
    await expect.poll(async () => page.evaluate(() => window.REPLOID_UI?.getVersion?.() || null), {
      timeout: 30000
    }).not.toBe(beforeVersion);
    await expect(page.locator('.zero-inspect')).not.toHaveAttribute('open', '');
    await page.locator('.zero-inspect > summary').click();
    await expect(page.locator('#agent-tools')).toHaveText('2 ok / 1 err');
    await expect(page.locator('#agent-tool-rate')).toHaveText('33% fail');
    const traceWidths = await page.evaluate(() => {
      const list = document.querySelector('.zero-trace-list').getBoundingClientRect();
      const entry = document.querySelector('.zero-trace-entry').getBoundingClientRect();
      return { list: list.width, entry: entry.width };
    });
    expect(traceWidths.entry).toBeGreaterThanOrEqual(traceWidths.list * 0.98);
  });
});
