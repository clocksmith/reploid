/**
 * E2E Test: Accessibility
 * Keyboard navigation and ARIA compliance tests.
 */
import { test, expect } from '@playwright/test';

test.describe('Accessibility - Boot Screen', () => {
  test('should have REPLOID heading', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('REPLOID');
  });

  test('should have proper semantic HTML structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    // Check for heading
    await expect(page.locator('h1')).toBeVisible();

    // Check for button elements
    const awakenBtn = page.locator('#awaken-btn');
    const tagName = await awakenBtn.evaluate((el) => el.tagName);
    expect(tagName).toBe('BUTTON');

    // Check for input elements
    const goalInput = page.locator('#goal-input');
    const inputType = await goalInput.getAttribute('type');
    expect(inputType).toBe('text');
  });

  test('should have goal input with placeholder', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const goalInput = page.locator('#goal-input');
    const placeholder = await goalInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
  });

  test('should have clickable boot mode buttons', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    const bootModeButtons = page.locator('.boot-mode-btn[data-genesis]');
    const firstButton = bootModeButtons.first();
    await expect(firstButton).toBeVisible();

    // Should be clickable
    await firstButton.click();
    await expect(firstButton).toHaveClass(/selected/);
  });

  test('should have proper focus indicators', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('#boot-container', { timeout: 10000 });

    // Focus on a boot mode button (always enabled)
    const bootModeBtn = page.locator('.boot-mode-btn[data-genesis]').first();
    await bootModeBtn.focus();
    await expect(bootModeBtn).toBeFocused();
  });
});

test.describe('Accessibility - Dashboard', () => {
  async function bootToDashboard(page) {
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

    await page.reload();
    await page.waitForSelector('#boot-container', { timeout: 10000 });
    await page.waitForSelector('#goal-input:not([disabled])', { timeout: 10000 });

    await page.locator('#goal-input').fill('Test accessibility');
    await page.locator('#awaken-btn').click();
    await page.waitForSelector('#app.active', { timeout: 15000 });
  }

  test('should have ARIA landmarks in dashboard', async ({ page }) => {
    await bootToDashboard(page);

    // Look for semantic landmarks
    const main = page.locator('main, [role="main"]');
    const nav = page.locator('nav, [role="navigation"]');

    const mainCount = await main.count();
    const navCount = await nav.count();

    expect(mainCount + navCount).toBeGreaterThan(0);
  });

  test('should support keyboard navigation in dashboard', async ({ page }) => {
    await bootToDashboard(page);

    // Tab through dashboard elements
    await page.keyboard.press('Tab');

    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();
  });

  test('should have visible sidebar buttons', async ({ page }) => {
    await bootToDashboard(page);

    const sidebarBtns = page.locator('.sidebar-btn');
    const count = await sidebarBtns.count();
    expect(count).toBeGreaterThan(0);
  });
});
