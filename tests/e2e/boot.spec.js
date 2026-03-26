/**
 * E2E Test: Boot Flow
 * Covers the current wizard homepage and product mode switch.
 */
import { test, expect } from '@playwright/test';

const APP_PATH = '/src/index.html';

test.describe('Boot Screen', () => {
  test('loads with Zero heading and product modes', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await expect(page).toHaveTitle(/Reploid/i);
    await expect(page.locator('h1')).toHaveText('Zero');

    const bootModes = page.locator('.boot-mode-btn[data-mode]');
    await expect(bootModes).toHaveCount(3);
  });

  test('has Zero selected by default', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('.boot-mode-btn.selected[data-mode="zero"]', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn.selected[data-mode="zero"] .boot-mode-label')).toContainText('Zero');
  });

  test('shows all three product modes', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await expect(page.locator('.boot-mode-btn[data-mode="zero"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="awakened_zero"]')).toBeVisible();
    await expect(page.locator('.boot-mode-btn[data-mode="x"]')).toBeVisible();
  });

  test('allows switching modes with single selection', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    const zeroMode = page.locator('.boot-mode-btn[data-mode="zero"]');
    const xMode = page.locator('.boot-mode-btn[data-mode="x"]');

    await expect(zeroMode).toHaveClass(/selected/);
    await xMode.click();
    await expect(xMode).toHaveClass(/selected/);
    await expect(zeroMode).not.toHaveClass(/selected/);
  });
});

test.describe('Connection Selection', () => {
  test('shows browser, direct, and proxy brain options', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await expect(page.locator('[data-action="choose-browser"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-direct"]')).toBeVisible();
    await expect(page.locator('[data-action="choose-proxy"]')).toBeVisible();
  });
});

test.describe('Advanced Mapping', () => {
  test('defaults Zero to the spark genesis level', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('spark');
  });

  test('maps X to the full genesis level', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await page.click('.boot-mode-btn[data-mode="x"]');
    await page.click('[data-action="advanced-settings"]');
    await expect(page.locator('#advanced-genesis-level')).toHaveValue('full');
  });
});

test.describe('Goal Input', () => {
  test('goal input exists', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await expect(page.locator('#goal-input')).toBeVisible();
  });

  test('preset goal library stays collapsed by default', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await expect(page.locator('.goal-library')).not.toHaveAttribute('open', '');
  });

  test('shows generated-goal action', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await expect(page.locator('[data-action="generate-goal"]')).toBeVisible();
    await expect(page.locator('[data-action="generate-goal"]')).toHaveText('Have the brain generate its own RSI goal');
  });

  test('has 15 preset prompts total', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await page.locator('.goal-library').evaluate((el) => { el.setAttribute('open', ''); });
    await expect(page.locator('.goal-chip')).toHaveCount(15);
  });

  test('awaken button exists', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    await expect(page.locator('#awaken-btn')).toBeVisible();
  });

  test('enforces goal maxlength (500 chars)', async ({ page }) => {
    await page.goto(APP_PATH);
    await page.waitForSelector('#wizard-container', { timeout: 10000 });

    const goalInput = page.locator('#goal-input');
    await expect(goalInput).toHaveAttribute('maxlength', '500');
  });
});
