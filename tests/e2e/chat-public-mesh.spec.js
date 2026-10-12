import { test, expect } from '@playwright/test';
import { compareCountedLines } from '../fixtures/counted-lines.js';

// Seed operators run separately. This fresh requester uses only the hosted UI,
// automatic discovery, and the ordinary disclosure approval.
test('fresh public browser completes a distributed answer', async ({ browser }, info) => {
  const url = process.env.REPLOID_PUBLIC_URL;
  test.skip(!url, 'REPLOID_PUBLIC_URL identifies the live deployment to qualify');
  test.setTimeout(180000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const weights = [], credentials = [], errors = [];
  page.on('request', request => {
    if (/huggingface\.co|shard_\d+\.bin/.test(request.url())) weights.push(request.url());
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', async response => {
    if (new URL(response.url()).pathname !== '/rtc-config') return;
    const body = await response.json().catch(() => null);
    credentials.push({ status: response.status(), expiresAt: body?.expiresAt ?? null });
  });
  const started = Date.now();
  try {
    await page.goto(url);
    await page.locator('[data-chat-workspace]').waitFor();
    await expect(page.locator('[data-mesh-invite]')).toBeHidden();
    await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
    const discoveredMs = Date.now() - started;
    await page.locator('[data-composer-input]').fill('Reply with only the word Hello.');
    await page.locator('[data-composer-send]').click();
    const sent = Date.now();
    await expect(page.locator('[data-chat-approval]')).toHaveCount(0);
    const history = () => page.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')));
    await expect.poll(async () => {
      const attempt = (await history())?.threads[0]?.attempts[0];
      if (attempt?.status === 'failed') throw Error(attempt.error);
      return attempt?.status;
    }, { timeout: 120000 }).toBe('completed');
    let completed = await history();
    expect(completed.threads[0].messages.at(-1).content.trim()).toBe('Hello');
    expect(completed.threads[0].attempts[0].execution.placement).toBe('two-device-layer-partition');
    const firstAnswerMs = Date.now() - sent;
    const sendNew = async prompt => {
      await page.locator('[data-new-thread]').click();
      await page.locator('[data-composer-input]').fill(prompt);
      await page.locator('[data-composer-send]').click();
      await expect(page.locator('[data-chat-approval]')).toHaveCount(0);
      return (await history()).threads.at(-1).id;
    };
    const waitFor = async id => expect.poll(async () => {
      const attempt = (await history()).threads.find(thread => thread.id === id).attempts.at(-1);
      if (attempt.status === 'failed') throw Error(attempt.error);
      return attempt.status;
    }, { timeout: 120000 }).toBe('completed');
    const warmId = await sendNew('What is two plus two? Answer briefly.');
    await waitFor(warmId);
    const longId = await sendNew('Count from one to twenty, one number per line.');
    const briefId = await sendNew('Return only the word YES.');
    await Promise.all([waitFor(longId), waitFor(briefId)]);
    completed = await history();
    expect(completed.threads.find(thread => thread.id === warmId).messages.at(-1).content.trim()).toBe('4');
    const counting = compareCountedLines(completed.threads.find(thread => thread.id === longId).messages.at(-1).content, 20);
    expect(counting, 'The public answer must include every requested number in order').toMatchObject({ passed: true });
    expect(completed.threads.find(thread => thread.id === briefId).messages.at(-1).content.trim()).toBe('YES');
    expect(weights).toEqual([]);
    expect(errors).toEqual([]);
    expect(credentials.some(item => item.status === 200)).toBe(true);
    const bundle = await (await context.request.get(new URL('/config/browser-bundle-manifest.json', url).href)).json();
    await info.attach('public-answer.json', { contentType: 'application/json', body: JSON.stringify({
      url, at: new Date().toISOString(), browser: browser.version(), discoveredMs,
      firstAnswerMs, journeyMs: Date.now() - started, bundle, completed, weights, credentials, errors
    }, null, 2) });
    await page.screenshot({ path: info.outputPath('public-answer.png'), fullPage: true });
  } finally { await context.close(); }
});
