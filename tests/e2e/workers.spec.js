/**
 * E2E Test: Workers Panel
 * Tests for WorkerManager UI, worker spawning, and status tracking.
 * Requires FULL SUBSTRATE genesis level for WorkerManager access.
 */
import { test, expect } from '@playwright/test';

// Helper to configure model and boot into dashboard with Full Substrate
async function bootWithWorkers(page, goal = 'Test workers') {
  await page.goto('/');
  await page.waitForSelector('#boot-container', { timeout: 10000 });

  // Configure a model via localStorage
  await page.evaluate(() => {
    localStorage.setItem('SELECTED_MODELS', JSON.stringify([{
      id: 'gemini-2.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'gemini',
      hostType: 'browser-cloud'
    }]));
    localStorage.setItem('REPLOID_GENESIS_LEVEL', 'full');
  });

  // Reload to apply config
  await page.reload();
  await page.waitForSelector('#boot-container', { timeout: 10000 });

  // Wait for goal input to be enabled
  await page.waitForSelector('#goal-input:not([disabled])', { timeout: 10000 });

  // Enter goal and awaken
  await page.locator('#goal-input').fill(goal);
  await page.locator('#awaken-btn').click();
  await page.waitForSelector('#app.active', { timeout: 15000 });
}

test.describe('Workers Panel UI', () => {
  test.beforeEach(async ({ page }) => {
    await bootWithWorkers(page);
  });

  test('workers tab exists in sidebar', async ({ page }) => {
    const workersTab = page.locator('#workers-tab-btn');
    await expect(workersTab).toBeVisible();
  });

  test('workers indicator shows in header', async ({ page }) => {
    const indicator = page.locator('#worker-indicator');
    await expect(indicator).toBeVisible();
    await expect(indicator).toContainText('workers');
  });

  test('workers panel has summary section', async ({ page }) => {
    await page.click('#workers-tab-btn');

    const summary = page.locator('.workers-summary');
    await expect(summary).toBeVisible();

    // Check for active/completed counters
    await expect(page.locator('#workers-active-count')).toBeVisible();
    await expect(page.locator('#workers-completed-count')).toBeVisible();
  });

  test('workers panel has active and completed sections', async ({ page }) => {
    await page.click('#workers-tab-btn');

    const activeList = page.locator('#workers-active-list');
    const completedList = page.locator('#workers-completed-list');

    await expect(activeList).toBeVisible();
    await expect(completedList).toBeVisible();
  });

  test('empty state shown when no workers', async ({ page }) => {
    await page.click('#workers-tab-btn');

    const emptyState = page.locator('#workers-active-list .empty-state');
    await expect(emptyState).toContainText('No active workers');
  });
});

test.describe('Worker Indicator', () => {
  test.beforeEach(async ({ page }) => {
    await bootWithWorkers(page);
  });

  test('indicator shows 0 when no active workers', async ({ page }) => {
    const count = page.locator('#worker-indicator-count');
    await expect(count).toHaveText('0');
  });

  test('indicator is clickable and switches to workers tab', async ({ page }) => {
    await page.click('#worker-indicator');

    // Should switch to workers tab
    await expect(page.locator('#tab-workers')).toBeVisible();
  });
});

test.describe('Workers Panel Clear', () => {
  test.beforeEach(async ({ page }) => {
    await bootWithWorkers(page);
  });

  test('clear button hidden when no completed workers', async ({ page }) => {
    await page.click('#workers-tab-btn');

    const clearBtn = page.locator('#workers-clear-completed');
    await expect(clearBtn).toHaveClass(/hidden/);
  });
});

test.describe('Worker Card Structure', () => {
  test('worker card styles loaded', async ({ page }) => {
    await bootWithWorkers(page);

    // Check that worker card CSS classes exist
    const styles = await page.evaluate(() => {
      const styleSheets = Array.from(document.styleSheets);
      const rules = [];
      for (const sheet of styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText?.includes('.worker-card')) {
              rules.push(rule.selectorText);
            }
          }
        } catch (e) {
          // Cross-origin stylesheets will throw
        }
      }
      return rules;
    });

    expect(styles.some(s => s.includes('.worker-card'))).toBe(true);
  });
});
