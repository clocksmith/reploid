import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';

const url = process.env.REPLOID_NATIVE_CHAT_URL;
const modelId = process.env.REPLOID_NATIVE_CHAT_MODEL;

test('prepared whole-model service completes frozen independent chat tasks', async ({ browser }, info) => {
  test.skip(!url || !modelId, 'Set the prepared native chat URL and model');
  test.setTimeout(240000);
  const suite = JSON.parse(await readFile('tests/fixtures/qwen27b-service-tasks.json', 'utf8'));
  const models = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'));
  const model = models.find(row => row.id === modelId);
  expect(model).toBeTruthy();
  const context = await browser.newContext();
  const page = await context.newPage();
  const results = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.locator('[data-chat-workspace]').waitFor();
    for (const task of suite.tasks) {
      if (results.length) await page.getByRole('button', { name: 'New thread', exact: true }).click();
      await page.locator('[data-open-model]').click();
      await page.locator(`.chat-model-choices input[value="${modelId}"]`).filter({ visible: true }).check();
      await page.locator('[data-close-inspector]').click();
      await page.locator('[data-composer-input]').fill(task.prompt);
      await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
      const start = performance.now();
      await page.locator('[data-composer-send]').click();
      let thread;
      await expect.poll(async () => {
        const allow = page.locator('[data-remote-permission-allow]');
        if (await allow.isVisible()) await allow.click();
        const workspace = await readChatWorkspace(page);
        thread = workspace?.threads.at(-1);
        const attempt = thread?.attempts.at(-1);
        if (['failed', 'cancelled', 'interrupted'].includes(attempt?.status)) throw new Error(JSON.stringify(attempt.error || attempt.status));
        return attempt?.status;
      }, { timeout: 60000, intervals: [100] }).toBe('completed');
      const answer = thread.messages.at(-1).content.trim();
      results.push({ id: task.id, answer, elapsedMs: performance.now() - start, attempt: thread.attempts.at(-1) });
      expect.soft(thread.attempts.at(-1).execution).toMatchObject({ placement: 'peer-whole-request', modelId, modelIdentity: model.identity });
      if ('expectedJson' in task) {
        let parsed;
        try { parsed = JSON.parse(answer); } catch { parsed = answer; }
        expect.soft(parsed, task.id).toEqual(task.expectedJson);
      } else expect.soft(answer, task.id).toBe(task.expected);
    }
    expect(errors).toEqual([]);
  } finally {
    const receiptPath = info.outputPath('service-tasks.json');
    await writeFile(receiptPath, JSON.stringify({
      at: new Date().toISOString(), scope: suite.scope, modelId, modelIdentity: model.identity,
      browser: browser.version(), results, errors
    }, null, 2));
    await info.attach('service-tasks.json', { contentType: 'application/json', path: receiptPath });
    await context.close();
  }
});
