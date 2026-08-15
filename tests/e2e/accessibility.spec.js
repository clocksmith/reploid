/**
 * E2E Test: Accessibility
 * Keyboard navigation and ARIA compliance tests.
 */
import { test, expect } from '@playwright/test';

const BOOT_PATH = '/x';
const DASHBOARD_PATH = '/x';

test.describe('Accessibility - Boot Screen', () => {
  test('should have a route-owned provider heading', async ({ page }) => {
    await page.goto(BOOT_PATH);
    await page.waitForSelector('#goal-input', { timeout: 10000 });

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Choose inference provider');
  });

  test('should have proper semantic HTML structure', async ({ page }) => {
    await page.goto(BOOT_PATH);
    await page.waitForSelector('#goal-input', { timeout: 10000 });

    // Check for heading
    await expect(page.locator('h1')).toBeVisible();

    // Check for button elements
    const awakenBtn = page.locator('.connection-option').first();
    const tagName = await awakenBtn.evaluate((el) => el.tagName);
    expect(tagName).toBe('BUTTON');

    // Check for input elements
    const goalInput = page.locator('#goal-input');
    const tagNameGoal = await goalInput.evaluate((el) => el.tagName);
    expect(tagNameGoal === 'TEXTAREA' || tagNameGoal === 'INPUT').toBe(true);
  });

  test('should have goal input with placeholder', async ({ page }) => {
    await page.goto(BOOT_PATH);
    await page.waitForSelector('#goal-input', { timeout: 10000 });

    const goalInput = page.locator('#goal-input');
    const placeholder = await goalInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();
  });

  test('should have clickable inference provider buttons', async ({ page }) => {
    await page.goto(BOOT_PATH);
    await page.waitForSelector('#goal-input', { timeout: 10000 });

    const providerButtons = page.locator('.connection-option[data-action]');
    const firstButton = providerButtons.first();
    await expect(firstButton).toBeVisible();

    // Should be clickable
    await firstButton.click();
    await expect(firstButton).toHaveAttribute('aria-pressed', 'true');
  });

  test('should have proper focus indicators', async ({ page }) => {
    await page.goto(BOOT_PATH);
    await page.waitForSelector('#goal-input', { timeout: 10000 });

    // Focus on an inference provider button.
    const providerButton = page.locator('.connection-option[data-action]').first();
    await providerButton.focus();
    await expect(providerButton).toBeFocused();
  });
});

test.describe('Accessibility - Dashboard', () => {
  async function bootToDashboard(page) {
    await page.goto(DASHBOARD_PATH);
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(DASHBOARD_PATH);
    await page.waitForSelector('#goal-input', { timeout: 10000 });

    // Configure a model via localStorage
    await page.evaluate(() => {
      localStorage.setItem('SELECTED_MODELS', JSON.stringify([{
        id: 'gemini-3.5-flash',
        name: 'Gemini 2.5 Flash',
        provider: 'gemini',
        hostType: 'browser-cloud'
      }]));
      localStorage.setItem('REPLOID_GENESIS_LEVEL', 'full');
    });

    await page.reload();
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
