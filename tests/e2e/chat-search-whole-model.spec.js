import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';

// One public query and one answer on an existing prepared whole-model provider.
// No downloads, provider restarts or model-quality acceptance.
test('movie search reaches a whole-model contributor without approval dialogs', async ({ browser, page }, info) => {
  const url = process.env.REPLOID_SEARCH_WHOLE_URL;
  test.skip(!url, 'Set REPLOID_SEARCH_WHOLE_URL for prepared search and whole-model contributors');
  test.setTimeout(240000);
  const model = JSON.parse(await readFile('self/config/chat-models.json', 'utf8')).find(row => row.id === 'qwen3-8-27b-text-q4k-ehaf16');
  const receipt = { at: new Date().toISOString(), browser: browser.version(), url, modelIdentity: model.identity,
    question: '2026 blockbuster movies', passed: false,
    errors: [], weights: [], thread: null, firstTextMs: null, completeMs: null };
  page.on('pageerror', error => receipt.errors.push(error.message));
  page.on('request', request => { if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) receipt.weights.push(new URL(request.url()).pathname); });
  let start;
  try {
    await page.goto(url);
    receipt.bundle = await page.evaluate(async () => (await (await fetch('/config/browser-bundle-manifest.json')).json()).bundleHash);
    await page.locator('[data-open-model]').click();
    await page.locator(`.chat-model-choices input[value="${model.id}"]`).filter({ visible: true }).check();
    await page.locator('[data-close-inspector]').click();
    await expect(page.locator('[data-search-toggle]')).toBeVisible({ timeout: 60000 });
    await page.locator('[data-search-toggle]').click();
    await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 90000 });
    await page.locator('[data-composer-input]').fill(receipt.question);
    start = performance.now();
    await page.locator('[data-composer-send]').click();
    await expect.poll(async () => {
      expect(await page.locator('[data-search-permission], [data-remote-permission]').count()).toBe(0);
      receipt.thread = (await readChatWorkspace(page))?.threads.at(-1) ?? null;
      const attempt = receipt.thread?.attempts.at(-1);
      if (receipt.thread?.messages.at(-1)?.role === 'assistant' && receipt.thread.messages.at(-1).content && receipt.firstTextMs === null) {
        receipt.firstTextMs = performance.now() - start;
      }
      if (['failed', 'cancelled', 'interrupted'].includes(attempt?.status)) throw Error(attempt.error || attempt.status);
      return attempt?.status;
    }, { timeout: 150000, intervals: [200] }).toBe('completed');
    receipt.completeMs = performance.now() - start;
    const attempt = receipt.thread.attempts.at(-1);
    expect(attempt.execution).toMatchObject({ placement: 'peer-whole-request', modelIdentity: model.identity });
    expect(attempt.searchPermission.query).toBe(receipt.question);
    expect(attempt.searchPermission.recipients).toContain(attempt.authorization.recipientIdentity);
    expect(attempt.searchPermission.recipients).not.toContain(attempt.authorization.peerId);
    expect(attempt.retrieval.outcome).toBe('retrieved');
    expect(attempt.retrieval.sources.some(source => /movie|blockbuster/i.test(source.title))).toBe(true);
    expect(receipt.thread.messages.at(-1).content).toMatch(/\[\d+\]/);
    expect(attempt.searchPermission.source).toBe('send');
    expect(receipt.weights).toEqual([]); expect(receipt.errors).toEqual([]);
    receipt.passed = true;
    await page.screenshot({ path: info.outputPath('search-answer.png'), fullPage: true });
  } finally {
    await writeFile(info.outputPath('search-whole-model.json'), JSON.stringify(receipt, null, 2));
  }
});
