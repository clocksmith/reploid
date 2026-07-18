/**
 * E2E Test: Dashboard
 * Tests for the Proto dashboard UI after boot completes.
 * Note: These tests require a model to be configured to enable the goal input.
 */
import { test, expect } from '@playwright/test';

// Helper to configure model and boot into dashboard
async function bootToDashboard(page, goal = 'Test dashboard') {
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('Failed to load resource')) return;
    console.log(`[BROWSER CONSOLE] ${msg.type()}: ${text}`);
  });
  await page.goto('/x');
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (window.indexedDB && window.indexedDB.databases) {
      const dbs = await window.indexedDB.databases();
      for (const db of dbs) {
        if (db.name && db.name.startsWith('reploid-vfs-v0')) {
          window.indexedDB.deleteDatabase(db.name);
        }
      }
    }
  });
  await page.goto('/x');
  await page.waitForSelector('#wizard-container', { timeout: 10000 });

  // Configure a model via localStorage (simulates having selected a model)
  await page.evaluate(() => {
    const key = 'REPLOID_TAB_INSTANCE_ID:/x';
    const instanceId = sessionStorage.getItem(key);
    const write = (k, v) => {
      localStorage.setItem(k, v);
      if (instanceId) {
        localStorage.setItem(`REPLOID_INSTANCE_${instanceId}::${k}`, v);
      }
    };
    write('SELECTED_MODELS', JSON.stringify([{
      id: 'gemini-3.5-flash',
      name: 'Gemini 2.5 Flash',
      provider: 'gemini',
      hostType: 'browser-cloud'
    }]));
    write('REPLOID_MODE', 'x');
    write('REPLOID_GENESIS_LEVEL', 'full');
  });

  // Reload to apply config
  await page.reload();

  // Wait for goal input to be enabled
  await page.waitForSelector('#goal-input:not([disabled])', { timeout: 10000 });

  // Enter goal and awaken
  await page.locator('#goal-input').fill(goal);
  await page.locator('#awaken-btn').click();
  await page.waitForSelector('#app.active', { timeout: 15000 });
}

test.describe('Boot to Dashboard Transition', () => {
  test('transitions from boot to dashboard after awakening', async ({ page }) => {
    await bootToDashboard(page, 'Test transition');

    // Wizard container should be hidden
    await expect(page.locator('#wizard-container')).toBeHidden({ timeout: 10000 });

    // App should be active
    await expect(page.locator('#app')).toHaveClass(/active/);
  });
});

test.describe('Dashboard Layout', () => {
  test.beforeEach(async ({ page }) => {
    await bootToDashboard(page);
  });

  test('has sidebar with navigation tabs', async ({ page }) => {
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Check for tab buttons
    await expect(page.locator('.sidebar-btn[data-tab="timeline"]')).toBeVisible();
    await expect(page.locator('.sidebar-btn[data-tab="memory"]')).toBeVisible();
    await expect(page.locator('.sidebar-btn[data-tab="status"]')).toBeVisible();
    await expect(page.locator('.sidebar-btn[data-tab="optimization"]')).toBeVisible();
    await expect(page.locator('#workers-tab-btn')).toBeVisible();
  });

  test('has VFS browser panel', async ({ page }) => {
    const vfsPanel = page.locator('#vfs-browser');
    await expect(vfsPanel).toBeVisible();

    await expect(page.locator('#vfs-search')).toBeVisible();
    await expect(page.locator('#vfs-tree')).toBeVisible();
  });

  test('has workspace header with goal', async ({ page }) => {
    const goalDisplay = page.locator('#agent-goal');
    await expect(goalDisplay).toContainText('Test dashboard');
  });

  test('has token budget display', async ({ page }) => {
    const tokenBudget = page.locator('.token-budget');
    await expect(tokenBudget).toBeVisible();
  });

  test('has agent state indicator', async ({ page }) => {
    const stateEl = page.locator('#agent-state');
    await expect(stateEl).toBeVisible();
  });
});

test.describe('Tab Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await bootToDashboard(page);
  });

  test('timeline tab is active by default', async ({ page }) => {
    const timelineTab = page.locator('.sidebar-btn[data-tab="timeline"]');
    await expect(timelineTab).toHaveClass(/active/);
    await expect(page.locator('#tab-timeline')).toBeVisible();
  });

  test('can switch to memory tab', async ({ page }) => {
    await page.click('.sidebar-btn[data-tab="memory"]');
    await expect(page.locator('#tab-memory')).toBeVisible();
  });

  test('can switch to status tab', async ({ page }) => {
    await page.click('.sidebar-btn[data-tab="status"]');
    await expect(page.locator('#tab-status')).toBeVisible();
  });

  test('can switch to workers tab', async ({ page }) => {
    await page.click('#workers-tab-btn');
    await expect(page.locator('#tab-workers')).toBeVisible();
    await expect(page.locator('.workers-panel')).toBeVisible();
  });

  test('can inspect Doppler optimization runs', async ({ page }) => {
    await page.click('.sidebar-btn[data-tab="optimization"]');

    await expect(page.locator('#tab-optimization')).toBeVisible();
    await expect(page.locator('#tab-timeline')).toBeHidden();
    await expect(page.locator('#tab-tools')).toBeHidden();
    await expect(page.locator('#optimization-contract')).toBeVisible();
    await expect(page.locator('#optimization-run')).toBeEnabled();
    await expect(page.locator('#optimization-refresh')).toBeVisible();
    await expect(page.locator('#optimization-stop')).toBeVisible();
    await expect(page.locator('#optimization-candidates')).toBeVisible();
    await expect(page.locator('#optimization-candidate-detail')).toBeVisible();
  });
});

test.describe('Control Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await bootToDashboard(page);
  });

  test('has replay button', async ({ page }) => {
    await expect(page.locator('#btn-replay')).toBeVisible();
  });

  test('has stop button', async ({ page }) => {
    await expect(page.locator('#btn-toggle')).toBeVisible();
  });

  test('has export button', async ({ page }) => {
    await expect(page.locator('#btn-export')).toBeVisible();
  });
});
