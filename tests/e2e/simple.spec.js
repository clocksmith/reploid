// Simple E2E Test - Verify Playwright setup works
import { test, expect } from '@playwright/test';

test.describe('Simple Boot Test', () => {
  test('should load the page', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Check title exists
    const title = await page.title();
    expect(title).toContain('REPLOID');
  });

  test('should have REPLOID heading', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    const h1 = await page.locator('h1').textContent();
    expect(h1).toBe('REPLOID');
  });
});
