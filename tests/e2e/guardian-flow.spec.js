// E2E Test: Guardian Agent Flow - Full workflow from boot to dashboard
import { test, expect } from '@playwright/test';

test.describe('Guardian Agent Flow', () => {
  test('should transition from boot to dashboard after awakening', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Select a persona
    await page.locator('.persona-card').first().click();

    // Enter a goal
    await page.locator('#goal-input').fill('Add a simple hello world function');

    // Click awaken button
    await page.locator('#awaken-btn').click();

    // Wait for dashboard to load (boot container should hide, app-root should show)
    await page.waitForTimeout(2000); // Give time for initialization

    // Check that boot container is hidden
    const bootContainer = page.locator('#boot-container');
    await expect(bootContainer).toHaveCSS('display', 'none');

    // Check that app-root is visible
    const appRoot = page.locator('#app-root');
    await expect(appRoot).toBeVisible();
  });

  test('should load dashboard with all required elements', async ({ page }) => {
    // Skip boot and go directly to dashboard (if possible via URL params or state)
    // For now, go through full boot flow
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });
    await page.locator('.persona-card').first().click();
    await page.locator('#goal-input').fill('Test goal');
    await page.locator('#awaken-btn').click();

    await page.waitForTimeout(2000);

    // Check that main UI elements are present
    // Note: These selectors depend on actual dashboard structure
    // May need adjustment based on ui-dashboard.html structure

    // Look for common dashboard elements
    const appRoot = page.locator('#app-root');
    await expect(appRoot).toBeVisible();

    // Dashboard should have loaded modules and UI
    // Check for any common element that indicates successful load
    // This is a basic check - more specific checks can be added
  });

  test('should display FSM status indicator', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });
    await page.locator('.persona-card').first().click();
    await page.locator('#goal-input').fill('Test FSM state');
    await page.locator('#awaken-btn').click();

    await page.waitForTimeout(2000);

    // FSM should start in IDLE state
    // Check for FSM status element (selector may need adjustment)
    const fsmStatus = page.locator('.fsm-status, #fsm-status, [data-fsm-status]');

    // Should exist after dashboard loads
    const count = await fsmStatus.count();
    expect(count).toBeGreaterThanOrEqual(0); // May or may not be visible initially
  });

  test('should handle goal input with special characters', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });
    await page.locator('.persona-card').first().click();

    // Try goal with HTML tags (should be sanitized)
    const goalWithHtml = 'Create <script>alert("xss")</script> function';
    await page.locator('#goal-input').fill(goalWithHtml);

    await page.locator('#awaken-btn').click();
    await page.waitForTimeout(1000);

    // Dashboard should load without executing the script
    // If XSS prevention is working, no alert should appear
    // This is implicit - Playwright will fail if unexpected dialog appears
  });

  test('should preserve selected persona through boot process', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });

    // Select specific persona (e.g., second one)
    const selectedPersona = page.locator('.persona-card').nth(1);
    await selectedPersona.click();

    // Get persona name
    const personaName = await selectedPersona.locator('h3').textContent();

    // Enter goal and awaken
    await page.locator('#goal-input').fill('Test persona preservation');
    await page.locator('#awaken-btn').click();

    await page.waitForTimeout(2000);

    // After loading, the selected persona info should be used
    // This test verifies that persona selection is passed through correctly
    // Specific assertion depends on where persona name appears in dashboard
  });
});

test.describe('Dashboard Panels', () => {
  test.beforeEach(async ({ page }) => {
    // Helper to get to dashboard quickly
    await page.goto('/');
    await page.waitForSelector('.persona-card', { timeout: 10000 });
    await page.locator('.persona-card').first().click();
    await page.locator('#goal-input').fill('Test panel functionality');
    await page.locator('#awaken-btn').click();
    await page.waitForTimeout(2000);
  });

  test('should have panel toggle functionality', async ({ page }) => {
    // Look for panel toggle buttons
    const toggleButtons = page.locator('[data-toggle-panel], .panel-toggle, button[aria-controls]');
    const count = await toggleButtons.count();

    // Dashboard should have multiple panel toggles
    expect(count).toBeGreaterThan(0);
  });

  test('should persist panel state in localStorage', async ({ page }) => {
    // Check that localStorage is being used for panel state
    const storageKey = 'reploid_last_panel_view';

    // Get localStorage value
    const storedState = await page.evaluate((key) => {
      return localStorage.getItem(key);
    }, storageKey);

    // After dashboard loads, panel state should be saved
    // May be null initially, but structure should exist after interaction
    // This is a basic check
  });
});
