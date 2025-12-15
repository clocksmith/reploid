/**
 * E2E Test: Dashboard
 * Tests for the Proto dashboard UI after boot completes.
 * Note: These tests require a model to be configured to enable the goal input.
 */
import { test, expect } from '@playwright/test';

// Helper to configure model and boot into dashboard
async function bootToDashboard(page, goal = 'Test dashboard') {
  await page.goto('/');
  await page.waitForSelector('#boot-container', { timeout: 10000 });

  // Configure a model via localStorage (simulates having selected a model)
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

test.describe('Boot to Dashboard Transition', () => {
  test('transitions from boot to dashboard after awakening', async ({ page }) => {
    await bootToDashboard(page, 'Test transition');

    // Boot container should be removed
    await expect(page.locator('#boot-container')).toHaveCount(0, { timeout: 10000 });

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
    await expect(page.locator('.sidebar-btn[data-tab="history"]')).toBeVisible();
    await expect(page.locator('.sidebar-btn[data-tab="reflections"]')).toBeVisible();
    await expect(page.locator('.sidebar-btn[data-tab="status"]')).toBeVisible();
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

  test('history tab is active by default', async ({ page }) => {
    const historyTab = page.locator('.sidebar-btn[data-tab="history"]');
    await expect(historyTab).toHaveClass(/active/);
    await expect(page.locator('#tab-history')).toBeVisible();
  });

  test('can switch to reflections tab', async ({ page }) => {
    await page.click('.sidebar-btn[data-tab="reflections"]');
    await expect(page.locator('#tab-reflections')).toBeVisible();
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
});

test.describe('Control Buttons', () => {
  test.beforeEach(async ({ page }) => {
    await bootToDashboard(page);
  });

  test('has command palette button', async ({ page }) => {
    await expect(page.locator('#btn-palette')).toBeVisible();
  });

  test('has stop button', async ({ page }) => {
    await expect(page.locator('#btn-toggle')).toBeVisible();
  });

  test('has export button', async ({ page }) => {
    await expect(page.locator('#btn-export')).toBeVisible();
  });
});
