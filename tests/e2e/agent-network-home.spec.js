import { test, expect } from '@playwright/test';
const evidenceDir = process.env.REPLOID_E2E_ARTIFACT_DIR || 'artifacts/network-home-2026-09-19';

test('home exposes voluntary participation without sending work or loading a model', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-agent-list]')).toContainText('Qwen 3.5 2B');
  await expect(page.locator('[data-agent-list]')).toContainText('Idle · model selected');
  await expect(page.locator('[data-contribution-status]')).toHaveText('Not sharing');
  await expect(page.locator('[data-work-improvement]')).not.toBeChecked();
  await expect(page.locator('[data-work-peers]')).toBeChecked();
  await expect(page.locator('[data-contribution-limits]')).toBeHidden();
  await page.locator('[data-network-disclosure] > summary').click();
  await page.locator('[data-contribution-panel] summary').click();
  await expect(page.locator('[data-contribution-limits]')).toContainText('1 request at a time');
  await page.locator('[data-swarm-share]').click();
  await expect(page.locator('[data-swarm-status]')).toContainText('Approve public prompt execution');
  await expect(page.locator('[data-contribution-status]')).toHaveText('Not sharing');
  await page.locator('[data-swarm-invite]').click();
  const url = new URL(await page.locator('[data-swarm-invitation] a').getAttribute('href'));
  expect(url.pathname).toBe('/');
  expect(url.searchParams.get('swarm')).toBeTruthy();
  expect(url.searchParams.get('swarmToken')).toBeTruthy();
  await expect(page.locator('[data-work-goal]')).toHaveValue('');
});

for (const width of [1440, 390, 320]) {
  test(`network home fits ${width}px and retains direct access to each activity`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto('/');
    await expect(page.locator('[data-agent-list] li')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('[data-work-goal]')).toBeInViewport();
    await page.locator('[data-pool-nav-id="improve"]').click();
    await expect(page.locator('[data-work-experiments]')).toBeInViewport();
    await page.locator('[data-pool-nav-id="home"]').click();
    await page.locator('[data-network-disclosure] > summary').click();
    await expect(page.locator('[data-swarm-connect]')).toBeInViewport();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${evidenceDir}/home-${width}.png`, fullPage: true });
    if (width === 1440) {
      await page.getByRole('button', { name: 'Dark', exact: true }).click();
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: `${evidenceDir}/home-dark.png`, fullPage: true, animations: 'disabled' });
    }
  });
}
