import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';

const url = process.env.REPLOID_NATIVE_CHAT_URL;
const modelId = process.env.REPLOID_NATIVE_CHAT_MODEL;

test('prepared whole-model service completes frozen independent chat tasks', async ({ browser }, info) => {
  test.skip(!url || !modelId, 'Set the prepared native chat URL and model');
  test.setTimeout(240000);
  const suiteBytes = await readFile(process.env.REPLOID_CHAT_TASK_SUITE || 'tests/fixtures/qwen27b-service-tasks.json');
  const suite = JSON.parse(suiteBytes);
  const models = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'));
  const model = models.find(row => row.id === modelId);
  expect(model).toBeTruthy();
  const context = await browser.newContext();
  const page = await context.newPage();
  const results = [], errors = [], weightRequests = [], permissionDialogs = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) weightRequests.push(new URL(request.url()).pathname); });
  try {
    await page.goto(url);
    await page.locator('[data-chat-workspace]').waitFor();
    await page.locator('[data-inspector-section="settings"]').click();
    const permission = page.locator('[data-remote-answers-toggle]');
    if (await permission.getAttribute('aria-checked') === 'true') await permission.click();
    await page.locator('[data-close-inspector]').click();
    for (const task of suite.tasks) {
      if (results.length) await page.getByRole('button', { name: 'New thread', exact: true }).click();
      await page.locator('[data-open-model]').click();
      await page.locator(`.chat-model-choices input[value="${modelId}"]`).filter({ visible: true }).check();
      await page.locator('[data-close-inspector]').click();
      let threadId = null;
      const expectedHistory = [];
      for (const [turnIndex, turn] of (task.turns || [task]).entries()) {
        const prompt = (turnIndex === 0 ? suite.context || '' : '') + turn.prompt;
        expectedHistory.push({ role: 'user', content: prompt });
        const previousAttempts = new Set((await readChatWorkspace(page))?.threads.flatMap(item => item.attempts.map(attempt => attempt.id)) ?? []);
        await page.locator('[data-composer-input]').fill(prompt);
        await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
        const start = performance.now();
        await page.locator('[data-composer-send]').click();
        let thread, firstOutputMs = null;
        await expect.poll(async () => {
          const allow = page.locator('[data-remote-permission-allow]');
          if (await allow.isVisible()) {
            permissionDialogs.push(await page.locator('[data-remote-permission]').innerText());
            await allow.click();
          }
          const workspace = await readChatWorkspace(page);
          thread = threadId ? workspace?.threads.find(item => item.id === threadId) : workspace?.threads.at(-1);
          const attempt = thread?.attempts.at(-1);
          if (!attempt || previousAttempts.has(attempt.id)) return 'waiting';
          if (firstOutputMs === null && thread?.messages.at(-1)?.role === 'assistant' && thread.messages.at(-1).content) {
            firstOutputMs = performance.now() - start;
          }
          if (['failed', 'cancelled', 'interrupted'].includes(attempt?.status)) throw new Error(JSON.stringify(attempt.error || attempt.status));
          return attempt?.status;
        }, { timeout: 60000, intervals: [100] }).toBe('completed');
        threadId = thread.id;
        const responseText = thread.messages.at(-1).content;
        const answer = responseText.trim();
        const id = task.turns ? `${task.id}/${turnIndex + 1}` : task.id;
        results.push({ id, prompt, expected: turn.expectedJson ?? turn.expected, answer, responseText, firstOutputMs,
          elapsedMs: performance.now() - start, attempt: thread.attempts.at(-1) });
        const system = [thread.systemContext?.content, thread.purpose].filter(Boolean).join('\n\n');
        expect(thread.attempts.at(-1).request.messages).toEqual([
          ...(system ? [{ role: 'system', content: system }] : []), ...expectedHistory
        ]);
        // Carry the actual untrimmed answer, including an incorrect answer, into the next request.
        expectedHistory.push({ role: 'assistant', content: responseText });
        expect.soft(thread.attempts.at(-1).execution).toMatchObject({ placement: 'peer-whole-request', modelId, modelIdentity: model.identity });
        if ('expectedJson' in turn) {
          let parsed;
          try { parsed = JSON.parse(answer); } catch { parsed = answer; }
          expect.soft(parsed, id).toEqual(turn.expectedJson);
        } else expect.soft(answer, id).toBe(turn.expected);
        if (turn.reloadAfter) {
          const before = await readChatWorkspace(page);
          await page.reload(); await page.locator('[data-chat-workspace]').waitFor();
          expect((await readChatWorkspace(page)).threads).toEqual(before.threads);
          await page.locator(`[data-thread-item-id="${threadId}"]`).click();
          await expect(page.locator(`[data-thread-item-id="${threadId}"]`)).toHaveAttribute('aria-current', 'true');
        }
      }
    }
    expect(errors).toEqual([]);
    expect(weightRequests).toEqual([]);
    expect(permissionDialogs.length).toBeGreaterThan(0);
  } finally {
    const receiptPath = info.outputPath('service-tasks.json');
    await writeFile(receiptPath, JSON.stringify({
      at: new Date().toISOString(), scope: suite.scope, suiteDigest: createHash('sha256').update(suiteBytes).digest('hex'),
      modelId, modelIdentity: model.identity,
      browser: browser.version(), results, errors, weightRequests, permissionDialogs
    }, null, 2));
    await info.attach('service-tasks.json', { contentType: 'application/json', path: receiptPath });
    await context.close();
  }
});
