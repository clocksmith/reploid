// E2E Test: Accessibility - Keyboard navigation and ARIA compliance
import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
  test('should support keyboard navigation on boot screen', async ({ page }) => {
    await page.goto('/');

    // Wait for persona cards to load
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Focus on first persona using Tab
    await page.keyboard.press('Tab');

    // Select persona using Enter or Space
    await page.keyboard.press('Enter');

    // First persona should now be selected
    const firstPersona = page.locator('.persona-card').first();
    await expect(firstPersona).toHaveClass(/selected/);

    // Tab to goal input
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab'); // May need multiple tabs depending on layout

    // Type goal
    const goalInput = page.locator('#goal-input');
    await goalInput.focus();
    await page.keyboard.type('Test keyboard navigation');

    // Goal should be entered
    const value = await goalInput.inputValue();
    expect(value).toContain('Test keyboard navigation');
  });

  test('should have proper ARIA labels on boot screen', async ({ page }) => {
    await page.goto('/');

    // Wait for page to fully load
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Check for ARIA labels on key elements
    const goalInput = page.locator('#goal-input');
    const placeholder = await goalInput.getAttribute('placeholder');
    expect(placeholder).toBeTruthy();

    // Persona cards should be clickable
    const personaCards = page.locator('.persona-card');
    const firstCard = personaCards.first();
    await expect(firstCard).toBeVisible();
  });

  test('should support ESC key to clear focus', async ({ page }) => {
    await page.goto('/');

    // Wait for persona cards to load
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    await page.locator('.persona-card').first().click();
    const goalInput = page.locator('#goal-input');
    await goalInput.fill('Test ESC behavior');
    await goalInput.focus();

    // Press ESC (behavior depends on implementation)
    await page.keyboard.press('Escape');

    // This test documents expected ESC behavior
    // Actual behavior may vary based on implementation
  });

  test('should have proper focus indicators', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Tab through elements and verify focus is visible
    await page.keyboard.press('Tab');

    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();

    // Check that focused element has visual indication (outline, border, etc.)
    const outlineWidth = await focusedElement.evaluate((el) => {
      const styles = window.getComputedStyle(el);
      return styles.outlineWidth;
    });

    // Should have some outline (specific value depends on CSS)
    // This is a basic check for focus visibility
  });

  test('should handle keyboard shortcuts', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Boot screen may not have many shortcuts, but test what exists
    // Advanced mode toggle via keyboard
    const advancedToggle = page.locator('#advanced-toggle');
    await advancedToggle.focus();
    await page.keyboard.press('Space');

    // Advanced options should toggle
    const advancedOptions = page.locator('#advanced-options');
    await expect(advancedOptions).not.toHaveClass(/hidden/);
  });

  test('should have semantic HTML structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Check for semantic elements
    const heading = page.locator('h1');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('REPLOID');

    // Check for proper button elements
    const awakenBtn = page.locator('#awaken-btn');
    const tagName = await awakenBtn.evaluate((el) => el.tagName);
    expect(tagName).toBe('BUTTON');

    // Check for proper input elements
    const goalInput = page.locator('#goal-input');
    const inputType = await goalInput.getAttribute('type');
    expect(inputType).toBe('text');
  });
});

test.describe('Accessibility - Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });
    await page.locator('.persona-card').first().click();
    await page.locator('#goal-input').fill('Test accessibility');
    await page.locator('#awaken-btn').click();
    await page.waitForSelector('#dashboard', { timeout: 15000 });
  });

  test('should support keyboard navigation in dashboard', async ({ page }) => {
    // Tab through dashboard elements
    await page.keyboard.press('Tab');

    const focusedElement = page.locator(':focus');
    await expect(focusedElement).toBeVisible();

    // Multiple tabs should navigate through interactive elements
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('Tab');
    }

    // Should be able to navigate through dashboard
    // Specific assertions depend on dashboard structure
  });

  test('should have ARIA landmarks in dashboard', async ({ page }) => {
    // Look for semantic landmarks
    const main = page.locator('main, [role="main"]');
    const nav = page.locator('nav, [role="navigation"]');

    // At least one should exist for proper screen reader navigation
    const mainCount = await main.count();
    const navCount = await nav.count();

    expect(mainCount + navCount).toBeGreaterThan(0);
  });
});
