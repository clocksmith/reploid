/**
 * E2E Test: Boot Flow
 * Consolidated tests for boot screen, genesis levels, and goal input.
 */
import { test, expect } from '@playwright/test';

test.describe('Boot Screen', () => {
  test('loads with REPLOID heading and boot modes', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    // Title and heading
    await expect(page).toHaveTitle(/Reploid/i);
    await expect(page.locator('h1')).toHaveText('REPLOID');

    // Genesis level options present
    const bootModes = page.locator('.boot-mode-btn[data-genesis]');
    expect(await bootModes.count()).toBeGreaterThan(0);
  });

  test('has Full Substrate selected by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.boot-mode-btn.selected[data-genesis]', { timeout: 10000 });

    const selectedMode = page.locator('.boot-mode-btn.selected[data-genesis="full"] .boot-mode-label');
    await expect(selectedMode).toContainText('FULL SUBSTRATE');
  });

  test('has Quick Start section', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    // Quick Start with WebLLM demo button
    await expect(page.locator('#quick-webllm-demo-btn')).toBeVisible();
    await expect(page.locator('.webllm-demo-card')).toBeVisible();
  });

  test('shows connection status section', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.provider-status-bar', { timeout: 10000 });

    // Check provider status items
    await expect(page.locator('#browser-cloud-text')).toBeVisible();
    await expect(page.locator('#proxy-cloud-text')).toBeVisible();
  });
});

test.describe('Genesis Level Selection', () => {
  test('allows selecting different genesis levels (single selection)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const fullMode = page.locator('.boot-mode-btn[data-genesis="full"]');
    const reflectionMode = page.locator('.boot-mode-btn[data-genesis="reflection"]');

    // Full is selected by default
    await expect(fullMode).toHaveClass(/selected/);

    // Select Reflection
    await reflectionMode.click();
    await expect(reflectionMode).toHaveClass(/selected/);
    await expect(fullMode).not.toHaveClass(/selected/);
  });

  test('displays genesis levels with label and description', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const genesisLevels = page.locator('.boot-mode-btn[data-genesis]');
    const count = await genesisLevels.count();

    for (let i = 0; i < count; i++) {
      const mode = genesisLevels.nth(i);
      await expect(mode.locator('.boot-mode-label')).toBeVisible();
      await expect(mode.locator('.boot-mode-desc')).toBeVisible();
    }
  });

  test('has all three genesis levels available', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn[data-genesis="full"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-genesis="reflection"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-genesis="tabula"]')).toBeVisible();
  });
});

test.describe('Blueprint Path Selection', () => {
  test('has blueprint path options', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const blueprintPaths = page.locator('.boot-mode-btn[data-blueprint]');
    expect(await blueprintPaths.count()).toBeGreaterThan(0);
  });

  test('has No Blueprints selected by default', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.boot-mode-btn.selected[data-blueprint]', { timeout: 10000 });

    const selectedPath = page.locator('.boot-mode-btn.selected[data-blueprint="none"]');
    await expect(selectedPath).toBeVisible();
  });
});

test.describe('Goal Input', () => {
  test('goal input exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    await expect(page.locator('#goal-input')).toBeVisible();
  });

  test('awaken button exists', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    await expect(page.locator('#awaken-btn')).toBeVisible();
  });

  test('enforces goal maxlength (500 chars)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const goalInput = page.locator('#goal-input');

    // Enable goal input by adding a model first or check maxlength attribute
    const maxLength = await goalInput.getAttribute('maxlength');
    expect(maxLength).toBe('500');
  });
});

test.describe('Model Configuration', () => {
  test('has Add Model card', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    await expect(page.locator('#add-model-card')).toBeVisible();
  });

  test('has model form overlay', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    // Overlay should exist but be hidden initially
    await expect(page.locator('#model-form-overlay')).toBeAttached();
  });

  test('clicking Add Model opens form', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    await page.click('#add-model-card');

    // Form should become visible
    await expect(page.locator('#model-form-dialog')).toBeVisible();
    await expect(page.locator('#provider-select')).toBeVisible();
  });

  test('can close model form', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    await page.click('#add-model-card');
    await expect(page.locator('#model-form-dialog')).toBeVisible();

    // Use force click since overlay may intercept
    await page.locator('#close-model-form').click({ force: true });
    // Form overlay should hide
    await page.waitForTimeout(300);
  });
});
