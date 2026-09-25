import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const history = page => page.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')));
const send = async (page, text) => {
  await page.locator('[data-composer-input]').fill(text);
  await page.locator('[data-composer-input]').press('Enter');
};
const approve = async (page, remember = false) => {
  await expect(page.locator('[data-chat-approval]')).toBeVisible();
  await page.locator('[data-approval-consent]').check();
  if (remember) await page.locator('[data-approval-remember]').check();
  await page.locator('[data-approval-send]').click();
};
const complete = page => expect.poll(async () => (await history(page))?.threads.at(-1)?.attempts.at(-1)?.status).toBe('completed');

test('real WebRTC proves recipients and retains revocable grants through requester refresh with injected inference', async ({ browser }, info) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [supplier, requester, replacement] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [];
  for (const page of [supplier, requester, replacement]) page.setDefaultTimeout(15000);
  const fixture = (await readFile('self/infrastructure/doppler-runtime-service.js', 'utf8')).replace('export function createReploidDopplerRuntimeService(', 'function unusedRuntimeService(')
    + (await readFile('tests/fixtures/chat-service.js', 'utf8'))
    + '\nexport function createReploidDopplerRuntimeService() { return createChatTestService(); }';
  try {
    for (const page of [supplier, requester, replacement]) {
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/infrastructure/doppler-runtime-service.js', route => route.fulfill({ contentType: 'text/javascript', body: fixture }));
      await page.goto('/'); await page.locator('[data-chat-workspace]').waitFor();
    }
    const contribute = async page => {
      await page.locator('[data-toggle-inspector]').click();
      await page.locator('summary').filter({ hasText: 'Contribution' }).click();
      await page.locator('[data-contribution-consent]').check();
      await page.locator('[data-toggle-contribution]').click();
      await expect(page.locator('[data-contrib-label]')).toHaveText('Ready');
    };
    await contribute(supplier);
    await expect(requester.locator('[data-active-model-select]')).toContainText('ready');
    await send(requester, 'First approved message');
    await expect(requester.locator('[data-approval-remember-label]')).toBeVisible();
    await expect(requester.locator('[data-approval-remember]')).not.toBeChecked();
    await approve(requester, true); await complete(requester);
    const original = (await history(requester)).threads[0], grant = original.grants[0];
    expect(grant.recipientIdentity).toMatch(/^peer:[a-f0-9]{24}$/);
    await send(requester, 'Follow-up without another approval'); await complete(requester);
    await expect(requester.locator('[data-chat-approval]')).toBeHidden();
    await requester.reload(); await requester.locator('[data-thread-item-id]').first().click();
    await send(requester, 'After refresh'); await complete(requester);
    expect((await history(requester)).threads[0].attempts.at(-1).authorization.grantId).toBe(grant.id);
    await requester.locator('[data-toggle-inspector]').click();
    await requester.locator('[data-thread-permissions] summary').click();
    await requester.locator('[data-revoke-grant]').click();
    await requester.locator('[data-close-inspector]').click();
    await send(requester, 'After revocation');
    await approve(requester, true); await complete(requester);
    await supplier.locator('[data-mesh-connect]').click();
    await contribute(replacement);
    await expect(requester.locator('[data-active-model-select]')).toContainText('ready');
    await send(requester, 'A new recipient requires permission');
    await expect(requester.locator('[data-chat-approval]')).toBeVisible();
    await expect(requester.locator('[data-approval-remember-label]')).toBeVisible();
    await approve(requester); await complete(requester);
    const result = (await history(requester)).threads[0];
    expect(result.attempts.at(-1).authorization.recipientIdentity).not.toBe(grant.recipientIdentity);
    expect(result.attempts.at(-1).authorization.kind).toBe('once');
    expect(result.grants[0].revokedAt).not.toBeNull();
    expect(errors).toEqual([]);
    await info.attach('thread-grants.json', { contentType: 'application/json', body: JSON.stringify(result, null, 2) });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
