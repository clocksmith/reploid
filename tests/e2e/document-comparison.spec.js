/* global documentSession */
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function installFixture(page, createThread = true) {
  // Served from the page root, where the shared tree is overlaid.
  const service = (await readFile('tests/fixtures/chat-service.js', 'utf8')).replace("'../../shared/config/", "'/config/");
  await page.route('**/diagnostic-chat-service.js', route => route.fulfill({ contentType: 'application/javascript', body: service }));
  // Explicitly injected execution proves UI and lifecycle, never answer quality.
  await page.evaluate(async createThread => {
    const [{ createChatSession, CANONICAL_CHAT_MODELS }, { createChatTestService }, { mountPoolday }] = await Promise.all([
      import('/host/chat-session.js'), import('/diagnostic-chat-service.js'), import('/ui/react/app.js')
    ]);
    const root = document.createElement('div');
    document.body.replaceChildren(root);
    globalThis.documentSession = createChatSession({ storage: localStorage, service: createChatTestService() });
    documentSession.setCachedModels(CANONICAL_CHAT_MODELS);
    if (createThread) documentSession.createThread({ sharingScope: 'local' });
    globalThis.disposeDocumentView = mountPoolday(root, { host: { chat: documentSession, close: async () => {} } });
  }, createThread);
}

test('ordinary attachments, export and persisted draft without sample controls', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installFixture(page);
  await expect(page.locator('[data-comparison-sample], [data-composer-compare]')).toHaveCount(0);
  await page.locator('[data-composer-input]').fill('Explain these notes.');
  await page.locator('[data-composer-files]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Keep contributions optional.') });
  await expect(page.locator('[data-attachments-preview]')).toContainText('notes.txt');
  await page.locator('[data-composer-send]').click();
  await expect.poll(() => page.evaluate(() => documentSession.getState().activeThread.attempts.map(a => a.status))).toEqual(['completed']);
  await expect(page.locator('[data-message-stream]')).toContainText('Keep contributions optional.');
  await page.locator('[data-chat-rail-toolbar] [data-inspector-section="conversation"]').click();
  const download = page.waitForEvent('download');
  await page.locator('[data-conversation-download]').click();
  expect(await readFile(await (await download).path(), 'utf8')).toContain('notes.txt');
  await page.locator('[data-close-inspector]:visible').click();
  await page.locator('[data-composer-input]').fill('Reconsider the deadline.');
  await page.reload(); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installFixture(page, false);
  if (!await page.locator('[data-thread-item-id]').first().isVisible()) await page.locator('[data-toggle-thread-rail]').click();
  await page.locator('[data-thread-item-id]').first().click();
  await expect(page.locator('[data-composer-input]')).toHaveValue('Reconsider the deadline.');
});

test('study collects consented self-report without uploading feedback', async ({ page }) => {
  const mutations = [];
  page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.url()); });
  await page.goto('/document-study.html');
  await page.locator('[name=participant]').fill('P01');
  for (const name of ['completed', 'sources', 'saved', 'returnIntent']) await page.locator(`[name=${name}]`).selectOption('yes');
  await page.locator('[name=hesitations]').fill('Test fixture only.');
  await page.locator('[name=outcome]').fill('Not a human participant.');
  await page.locator('[name=consent]').check();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download feedback' }).click();
  const receipt = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  expect(receipt.answers.participant).toBe('P01'); expect(receipt.consent).toBe(true);
  expect(mutations).toEqual([]);
});
