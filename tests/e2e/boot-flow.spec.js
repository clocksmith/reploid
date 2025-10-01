// E2E Test: Boot Flow - Persona Selection and Goal Setting
import { test, expect } from '@playwright/test';

test.describe('Boot Flow', () => {
  test('should load boot screen with personas', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Check that boot screen is visible
    await expect(page.locator('h1')).toHaveText('REPLOID');
    await expect(page.locator('#onboarding-title')).toBeVisible();

    // Check that personas are loaded
    const personaCards = page.locator('.persona-card');
    await expect(personaCards).toHaveCount(6); // Should have 6 personas

    // Check that goal input is disabled initially
    const goalInput = page.locator('#goal-input');
    await expect(goalInput).toBeDisabled();

    // Check that awaken button is disabled initially
    const awakenBtn = page.locator('#awaken-btn');
    await expect(awakenBtn).toBeDisabled();
  });

  test('should enable goal input after selecting persona', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Select first persona
    const firstPersona = page.locator('.persona-card').first();
    await firstPersona.click();

    // Check that persona is selected (has 'selected' class)
    await expect(firstPersona).toHaveClass(/selected/);

    // Check that goal input is now enabled
    const goalInput = page.locator('#goal-input');
    await expect(goalInput).toBeEnabled();

    // Check that awaken button is still disabled (no goal yet)
    const awakenBtn = page.locator('#awaken-btn');
    await expect(awakenBtn).toBeDisabled();
  });

  test('should enable awaken button after entering goal', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Select first persona
    await page.locator('.persona-card').first().click();

    // Enter a goal
    const goalInput = page.locator('#goal-input');
    await goalInput.fill('Create a simple test function');

    // Check that awaken button is now enabled
    const awakenBtn = page.locator('#awaken-btn');
    await expect(awakenBtn).toBeEnabled();
  });

  test('should show warning message if awakening without persona', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Try to click awaken button (should be disabled but testing the validation)
    const awakenBtn = page.locator('#awaken-btn');

    // Awaken button should be disabled without selection
    await expect(awakenBtn).toBeDisabled();
  });

  test('should sanitize goal input (maxlength)', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Select first persona
    await page.locator('.persona-card').first().click();

    // Try to enter very long goal (>500 chars)
    const goalInput = page.locator('#goal-input');
    const longGoal = 'a'.repeat(600);
    await goalInput.fill(longGoal);

    // Check that input value is limited to 500 chars (HTML maxlength)
    const actualValue = await goalInput.inputValue();
    expect(actualValue.length).toBeLessThanOrEqual(500);
  });

  test('should support advanced mode toggle', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Check that advanced options are hidden initially
    const advancedOptions = page.locator('#advanced-options');
    await expect(advancedOptions).toHaveClass(/hidden/);

    // Toggle advanced mode
    const advancedToggle = page.locator('#advanced-toggle');
    await advancedToggle.check();

    // Check that advanced options are now visible
    await expect(advancedOptions).not.toHaveClass(/hidden/);

    // Check that goal input is enabled in advanced mode
    const goalInput = page.locator('#goal-input');
    await expect(goalInput).toBeEnabled();
  });

  test('should display all 6 personas with correct structure', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    const personaCards = page.locator('.persona-card');
    const count = await personaCards.count();
    expect(count).toBe(6);

    // Check that each persona has a title and description
    for (let i = 0; i < count; i++) {
      const card = personaCards.nth(i);
      await expect(card.locator('h3')).toBeVisible();
      await expect(card.locator('p')).toBeVisible();
    }
  });

  test('should only allow one persona selected at a time', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Select first persona
    const firstPersona = page.locator('.persona-card').first();
    await firstPersona.click();
    await expect(firstPersona).toHaveClass(/selected/);

    // Select second persona
    const secondPersona = page.locator('.persona-card').nth(1);
    await secondPersona.click();
    await expect(secondPersona).toHaveClass(/selected/);

    // First persona should no longer be selected
    await expect(firstPersona).not.toHaveClass(/selected/);
  });
});
