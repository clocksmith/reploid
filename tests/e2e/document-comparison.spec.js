import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function installFixture(page, createThread = true) {
  const service = await readFile('tests/fixtures/chat-service.js', 'utf8');
  await page.route('**/diagnostic-chat-service.js', route => route.fulfill({ contentType: 'application/javascript', body: service }));
  // Explicitly injected execution proves UI and lifecycle, never answer quality.
  await page.evaluate(async createThread => {
    const [{ createChatSession }, { createChatTestService }, view] = await Promise.all([
      import('/host/chat-session.js'), import('/diagnostic-chat-service.js'), import('/ui/pool-home/conversation-workspace.js')
    ]);
    const root = document.querySelector('.pool-home');
    root.innerHTML = view.renderConversationWorkspace();
    globalThis.documentSession = createChatSession({ storage: localStorage, service: createChatTestService() });
    if (createThread) documentSession.createThread({ sharingScope: 'local' });
    globalThis.disposeDocumentView = view.bindConversationWorkspace(root, documentSession);
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
  const download = page.waitForEvent('download');
  await page.locator('[data-conversation-download]').click();
  expect(await readFile(await (await download).path(), 'utf8')).toContain('notes.txt');
  await page.locator('[data-composer-input]').fill('Reconsider the deadline.');
  await page.reload(); await expect(page.locator('[data-chat-workspace]')).toBeVisible();
  await installFixture(page, false);
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
