import { expect, test } from '@playwright/test';

test('retains an unmatched Pack request in Recent jobs', async ({ page, baseURL }) => {
  test.setTimeout(30000);
  const roomId = `unmatched-request-${Date.now()}`;
    await page.goto(`${baseURL}/?room=${encodeURIComponent(roomId)}&relay=local`);
    await page.evaluate(() => {
      window.REPLOID_POOL_DISCOVERY_WINDOW_MS = 250;
    });
  await page.locator('#pool-home-ask-prompt').fill('MKTAYIAKQRQISFVKSHFSRQ');
  await page.locator('#pool-home-sequence-public').check();
  await page.locator('#pool-home-run-submit').click();

  await expect(page.locator('[data-pool-run-status]')).toHaveText(
    'No matching provider is currently available',
    { timeout: 15000 }
  );
  await page.getByRole('link', { name: 'Recent jobs', exact: true }).click();

  await expect(page.locator('#pool-record-ledger')).toContainText('Request waiting for provider');
  await expect(page.locator('#pool-record-ledger')).toContainText('No matching provider');
  await expect(page.locator('[data-pool-record-facet="request"]')).toContainText('Requests (1)');
  await expect(page.getByText('Open Research Room-1', { exact: true })).toHaveCount(0);
});
