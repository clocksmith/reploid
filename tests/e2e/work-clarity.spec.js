import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('Home connects agents and tasks with explicit disclosure', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Threads', exact: true })).toBeVisible();
  await expect(page.locator('.pool-connected-heading, [data-goal-preset]')).toHaveCount(0);
  await expect(page.locator('[data-work-output]')).toBeHidden();
  await expect(page.locator('[data-work-history]')).toHaveText('No threads yet');
  await expect(page.getByText('Mesh Node: Active', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Provider: Ready', { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-work-attachments]')).not.toHaveAttribute('open');
  await expect(page.locator('[data-work-peers]')).toBeChecked();
  await expect(page.locator('[data-work-model] option')).not.toContainText(['Cloud']);
  await expect(page.locator('[data-work-model]')).toBeHidden();
  await page.locator('[data-work-goal]').fill('Summarize the attached file.');
  await page.locator('[data-work-attachments] summary').click();
  await expect(page.locator('[data-work-files]')).toBeVisible();
  await page.locator('[data-work-files]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('A short note.') });
  await expect(page.locator('[data-work-file-count]')).toHaveText('1 attached');
  await expect(page.locator('[data-work-peers]')).toBeChecked();
});

test('Network exposes sharing controls and still requires approval', async ({ page }) => {
  await page.goto('/network');
  await expect(page.getByRole('heading', { name: 'Network', exact: true })).toBeVisible();
  await expect(page.locator('[data-operation-status]')).toHaveText('Not sharing');
  await expect(page.locator('[data-operation-approve]')).not.toBeChecked();
  await page.getByText('Specialized model jobs', { exact: true }).click();
  await expect(page.locator('[data-operation-toggle]')).toBeDisabled();
  await expect(page.locator('[data-operation-reason]')).toHaveText('Check the approval above to share this capability.');
  await expect(page.locator('[data-operation-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-work-peer-status]')).toHaveText('Discovery has not run.');
});

test('Improve gives new users a useful empty state', async ({ page }) => {
  // A new visitor's Changes page: nothing to review, no result shown, and tool updates say none exist yet.
  await page.goto('/improve');
  await expect(page.getByRole('heading', { name: 'Changes', exact: true })).toBeVisible();
  await expect(page.locator('[data-work-output]')).toHaveCount(0);
  await expect(page.locator('[data-work-history]')).toHaveCount(0);
  await expect(page.locator('[data-improvement-empty]')).toHaveText('No tool changes yet.');
});

test('mobile network and task controls fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('[data-work-start]')).toBeVisible();
  const geometry = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    viewport: innerWidth,
    startBottom: document.querySelector('[data-work-start]').getBoundingClientRect().bottom,
    height: innerHeight
  }));
  expect(geometry.width).toBeLessThanOrEqual(geometry.viewport);
  await page.locator('[data-work-start]').scrollIntoViewIfNeeded();
  await expect(page.locator('[data-work-start]')).toBeInViewport();
});
