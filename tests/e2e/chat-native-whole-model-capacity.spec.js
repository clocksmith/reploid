import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';

// Uses an already prepared provider. No downloads, service restarts or GPU limits change.
const url = process.env.REPLOID_NATIVE_CHAT_URL;
const modelId = process.env.REPLOID_NATIVE_CHAT_MODEL;

test('whole-model browser conversation preserves the qualified long prompt', async ({ browser }, info) => {
  test.skip(!url || !modelId, 'Set the prepared native chat URL and model');
  test.setTimeout(240000);
  const models = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'));
  const model = models.find(row => row.id === modelId);
  const fixture = JSON.parse(await readFile('tests/fixtures/qwen27b-capacity-case.json', 'utf8'));
  expect(model).toBeTruthy();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], weightRequests = [];
  let firstTextMs = null, elapsedMs = null, final = null;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) weightRequests.push(new URL(request.url()).pathname);
  });
  try {
    await page.goto(url);
    await page.locator('[data-chat-workspace]').waitFor();
    await page.locator('[data-open-model]').click();
    await page.locator(`.chat-model-choices input[value="${modelId}"]`).filter({ visible: true }).check();
    await page.locator('[data-close-inspector]').click();
    await page.locator('[data-composer-input]').fill(fixture.messages[0].content);
    await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
    const started = performance.now();
    await page.locator('[data-composer-send]').click();
    await expect.poll(async () => {
      const allow = page.locator('[data-remote-permission-allow]');
      if (await allow.isVisible()) await allow.click();
      final = (await readChatWorkspace(page))?.threads.at(-1);
      const attempt = final?.attempts.at(-1);
      if (!attempt) return 'waiting';
      if (firstTextMs === null && final.messages.at(-1)?.role === 'assistant' && final.messages.at(-1).content) {
        firstTextMs = performance.now() - started;
      }
      if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw new Error(JSON.stringify(attempt.error || attempt.status));
      return attempt.status;
    }, { timeout: 180000, intervals: [250] }).toBe('completed');
    elapsedMs = performance.now() - started;
    expect(final.messages.find(row => row.role === 'user').content).toBe(fixture.messages[0].content);
    expect(final.messages.at(-1).content.trim()).toBe(fixture.expected);
    expect(final.attempts.at(-1).execution).toMatchObject({ placement: 'peer-whole-request', modelId, modelIdentity: model.identity });
    const completion = final.attempts.at(-1).execution.completion;
    expect(completion.promptTokenCount).toBeGreaterThanOrEqual(fixture.minPromptTokens);
    expect(completion.promptTokenCount).toBeLessThanOrEqual(fixture.maxPromptTokens);
    expect(completion.stopReason).toBe('stop-token');
    await page.reload();
    await page.locator('[data-chat-workspace]').waitFor();
    const restored = (await readChatWorkspace(page)).threads.find(row => row.id === final.id);
    expect(restored.messages).toEqual(final.messages);
    expect(weightRequests).toEqual([]);
    expect(errors).toEqual([]);
  } finally {
    const receiptPath = info.outputPath('long-context-chat.json');
    await writeFile(receiptPath, JSON.stringify({
      at: new Date().toISOString(), modelId, modelIdentity: model.identity, firstTextMs, elapsedMs,
      browser: browser.version(), history: await readChatWorkspace(page).catch(() => null), errors, weightRequests
    }, null, 2));
    await info.attach('long-context-chat.json', { contentType: 'application/json', path: receiptPath });
    await context.close();
  }
});
