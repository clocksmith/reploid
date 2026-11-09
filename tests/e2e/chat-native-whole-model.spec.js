import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';
import { resolveServedFile } from '../../server/browser-roots.js';

// An operator prepares the exact native model separately. This test neither
// starts a contributor nor downloads weights or changes its resource limits.
const url = process.env.REPLOID_NATIVE_CHAT_URL;
const modelId = process.env.REPLOID_NATIVE_CHAT_MODEL;

test('native whole-model chat streams, follows up, cancels, reuses and reloads', async ({ browser }, info) => {
  test.skip(!url || !modelId, 'Set REPLOID_NATIVE_CHAT_URL and REPLOID_NATIVE_CHAT_MODEL for a prepared native provider');
  test.setTimeout(240000);
  const models = JSON.parse(await readFile(resolveServedFile('config/chat-models.json'), 'utf8'));
  const model = models.find(candidate => candidate.id === modelId);
  expect(model, 'The exact model must be present in the tested catalog').toBeTruthy();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], weightRequests = [], turns = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) weightRequests.push(new URL(request.url()).pathname);
  });
  const history = () => readChatWorkspace(page);
  const current = async () => (await history())?.threads.at(-1);
  const send = async prompt => {
    await page.locator('[data-composer-input]').fill(prompt);
    await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
    await page.locator('[data-composer-send]').click();
  };
  const completion = async count => {
    await expect.poll(async () => {
      const thread = await current();
      const attempt = thread?.attempts.at(-1);
      if (thread?.attempts.length !== count) return 'awaiting-attempt';
      if (['failed', 'interrupted', 'cancelled'].includes(attempt.status)) {
        throw new Error(`Attempt ${attempt.id} ${attempt.status}: ${attempt.error || 'no completed answer'}`);
      }
      return attempt.status;
    }, { timeout: 90000 }).toBe('completed');
    const thread = await current();
    const attempt = thread.attempts.at(-1);
    expect(attempt.execution).toMatchObject({ placement: 'peer-whole-request', modelId, modelIdentity: model.identity });
    expect(thread.messages.at(-1).content).not.toContain('\uFFFD');
    turns.push({ attempt, answer: thread.messages.at(-1).content });
    return thread;
  };
  let providerHardware = null, recordedHardware = null, retriedFrom = null, draftPreserved = false;
  try {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(url);
    await page.locator('[data-chat-workspace]').waitFor();
    await page.locator('[data-open-model]').click();
    await expect(page.locator('[data-model-picker]')).toBeVisible();
    const choice = page.locator(`[data-model-picker] .chat-model-choices input[value="${modelId}"]`).filter({ visible: true });
    await expect(choice).toBeVisible({ timeout: 60000 });
    await choice.click();
    const details = page.locator('[data-model-picker] [data-model-details]');
    if (!await details.evaluate(node => node.open)) await details.locator(':scope > summary').click();
    const providers = page.locator('[data-model-picker] [data-model-providers]');
    if (!await providers.evaluate(node => node.open)) await providers.locator(':scope > summary').click();
    await expect(page.locator('[data-model-picker] [data-provider-list]')).toContainText('Whole model', { timeout: 60000 });
    providerHardware = (await page.locator('[data-model-picker] .chat-model-route-people small').first().textContent())?.trim() || null;
    await expect(page.locator('[data-change-model]')).toBeEnabled({ timeout: 60000 });
    await page.locator('[data-change-model]').click();
    await expect(page.locator('[data-model-picker]')).toBeHidden();
    await expect(page.locator('[data-model-digest]')).toContainText(model.name);
    await send('What is 17 + 25? Answer with the number only.');
    // Current default network permission may already admit the request. Older
    // deployments ask once; neither case is a reason to bypass the normal UI.
    await expect.poll(async () => {
      const allow = page.locator('[data-remote-permission-allow]');
      if (await allow.isVisible()) await allow.click();
      return (await current())?.attempts.length || 0;
    }).toBe(1);
    expect((await completion(1)).messages.at(-1).content.trim()).toBe('42');
    await send('Subtract 2 from that result. Answer with the number only.');
    expect((await completion(2)).messages.at(-1).content.trim()).toBe('40');
    await send('Count from 1 to 10, one number per line. Add nothing else.');
    await expect.poll(async () => {
      const thread = await current();
      const message = thread?.messages.at(-1);
      return thread?.attempts.length === 3 && message?.role === 'assistant' && message.content.length > 0;
    }, { timeout: 90000 }).toBe(true);
    // The visible answer owns Stop while its progress is in view; otherwise it
    // stays in the composer. Exercise the offered control rather than a hidden copy.
    await page.locator('[data-answer-stop]:visible, [data-composer-stop]:visible').first().click();
    await expect.poll(async () => (await current())?.attempts.at(-1).status).toBe('cancelled');
    const cancelledId = (await current()).attempts.at(-1).id;
    const retryButton = page.locator(`[data-retry-attempt="${cancelledId}"]`);
    await expect(retryButton).toBeEnabled({ timeout: 60000 });
    await retryButton.click();
    const final = await completion(4);
    retriedFrom = final.attempts.at(-1).retryOf;
    expect(retriedFrom).toBe(cancelledId);
    expect(final.messages.at(-1).content.match(/\d+/g)?.map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    const lastAssistant = page.locator('.chat-message-row.is-assistant').last();
    await lastAssistant.locator('[data-execution-trigger]').click();
    const hardwareNode = page.locator('[data-inspector-pane="conversation"] [data-recorded-hardware]');
    await expect(hardwareNode).toBeVisible();
    recordedHardware = (await hardwareNode.textContent())?.trim() || null;
    expect(recordedHardware).toMatch(/^Recorded GPU · .+/);
    await page.locator('[data-context-indicator]').click();
    await expect(page.locator('[data-chat-inspector-slot]')).toBeVisible();
    await expect(page.locator('[data-conversation-area]')).toBeVisible();
    await page.locator('[data-inspector-pane="conversation"] > details > summary').click();
    await expect(page.locator('[data-ribbon-facts]')).toContainText(recordedHardware);
    await page.locator('[data-close-inspector]').click();

    const draftText = 'Keep this draft while switching threads and reloading';
    await page.locator('[data-composer-input]').fill(draftText);
    if (!await page.locator('[data-new-thread]').isVisible()) await page.locator('[data-toggle-thread-rail]').click();
    await page.locator('[data-new-thread]').click();
    await expect(page.locator('[data-composer-input]')).toHaveValue('');
    await page.locator('[data-toggle-thread-rail]').click();
    await expect(page.locator('[data-threads-dialog]')).toBeVisible();
    await page.locator(`[data-thread-item-id="${final.id}"]`).click();
    await expect(page.locator('[data-threads-dialog]')).toBeHidden();
    await expect(page.locator('[data-composer-input]')).toHaveValue(draftText);
    await page.screenshot({ path: info.outputPath('answer.png'), fullPage: true });
    await page.reload();
    await page.locator('[data-chat-workspace]').waitFor();
    await expect(page.locator('[data-composer-input]')).toHaveValue(draftText);
    draftPreserved = true;
    const restored = (await history()).threads.find(thread => thread.id === final.id);
    expect(restored.messages).toEqual(final.messages);
    expect(restored.attempts.map(attempt => attempt.status)).toEqual(['completed', 'completed', 'cancelled', 'completed']);
    expect(restored.attempts.at(-1).retryOf).toBe(cancelledId);
    expect(weightRequests).toEqual([]);
    expect(errors).toEqual([]);
    const receiptPath = info.outputPath('whole-model-chat.json');
    await writeFile(receiptPath, JSON.stringify({
      modelId, modelIdentity: model.identity, browser: browser.version(), at: new Date().toISOString(),
      providerHardware, recordedHardware, turns, cancelled: true, retriedFrom, reusedAfterCancellation: true,
      historyPreserved: true, draftPreserved, weightRequests, errors
    }, null, 2));
    await info.attach('whole-model-chat.json', { contentType: 'application/json', path: receiptPath });
  } finally {
    await info.attach('retained-history.json', { contentType: 'application/json', body: JSON.stringify({ turns, history: await history().catch(() => null), errors, weightRequests }) });
    await context.close();
  }
});
