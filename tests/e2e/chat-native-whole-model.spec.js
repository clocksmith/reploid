import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// An operator prepares the exact native model separately. This test neither
// starts a contributor nor downloads weights or changes its resource limits.
const url = process.env.REPLOID_NATIVE_CHAT_URL;
const modelId = process.env.REPLOID_NATIVE_CHAT_MODEL;

test('native whole-model chat streams, follows up, cancels, reuses and reloads', async ({ browser }, info) => {
  test.skip(!url || !modelId, 'Set REPLOID_NATIVE_CHAT_URL and REPLOID_NATIVE_CHAT_MODEL for a prepared native provider');
  test.setTimeout(240000);
  const models = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'));
  const model = models.find(candidate => candidate.id === modelId);
  expect(model, 'The exact model must be present in the tested catalog').toBeTruthy();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], weightRequests = [], turns = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) weightRequests.push(new URL(request.url()).pathname);
  });
  const history = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find(value => value.endsWith('reploid.chat-workspace:v1'));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
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
  try {
    await page.goto(url);
    await page.locator('[data-chat-workspace]').waitFor();
    await page.locator('[data-open-model]').click();
    await page.locator('[data-active-model-select]').selectOption(modelId);
    await page.locator('[data-close-inspector]').click();
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
    await send('Count from one to one hundred, one number per line.');
    await expect.poll(async () => {
      const thread = await current();
      const message = thread?.messages.at(-1);
      return thread?.attempts.length === 3 && message?.role === 'assistant' && message.content.length > 0;
    }, { timeout: 90000 }).toBe(true);
    await page.locator('[data-composer-stop]').click();
    await expect.poll(async () => (await current())?.attempts.at(-1).status).toBe('cancelled');
    await send('What is 6 times 7? Answer with the number only.');
    const final = await completion(4);
    expect(final.messages.at(-1).content.trim()).toBe('42');
    await page.screenshot({ path: info.outputPath('answer.png'), fullPage: true });
    await page.reload();
    await page.locator('[data-chat-workspace]').waitFor();
    const restored = (await history()).threads.find(thread => thread.id === final.id);
    expect(restored.messages).toEqual(final.messages);
    expect(restored.attempts.map(attempt => attempt.status)).toEqual(['completed', 'completed', 'cancelled', 'completed']);
    expect(weightRequests).toEqual([]);
    expect(errors).toEqual([]);
    await info.attach('whole-model-chat.json', { contentType: 'application/json', body: JSON.stringify({
      modelId, modelIdentity: model.identity, browser: browser.version(), at: new Date().toISOString(),
      turns, cancelled: true, reusedAfterCancellation: true, historyPreserved: true, weightRequests, errors
    }, null, 2) });
  } finally {
    await context.close();
  }
});
