import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// One public question, existing contributors, no weight downloads or service changes.
test('contributor search feeds a cited answer through the prepared 27B split', async ({ browser }, info) => {
  const url = process.env.REPLOID_SEARCH_SPLIT_URL;
  test.skip(!url, 'Set REPLOID_SEARCH_SPLIT_URL for prepared search and split contributors');
  test.setTimeout(240000);
  const model = JSON.parse(await readFile('self/config/chat-models.json', 'utf8')).find(row => row.id === 'qwen3-8-27b-text-q4k-ehaf16');
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [], permissions = [], weightRequests = [];
  const question = 'What is WebGPU used for?';
  let final = null, sentAt = null, firstTextMs = null, phase = null;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) weightRequests.push(new URL(request.url()).pathname); });
  const history = () => page.evaluate(async () => {
    const open = indexedDB.open('reploid-requester-history');
    const db = await new Promise((resolve, reject) => { open.onsuccess = () => resolve(open.result); open.onerror = () => reject(open.error); });
    try {
      if (!db.objectStoreNames.contains('conversations')) return null;
      const request = db.transaction('conversations').objectStore('conversations').get('workspace');
      const record = await new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      if (!record) return null;
      for (const thread of record.workspace.threads) for (const attempt of thread.attempts.filter(row => row.publicationMode === 'canonical')) {
        const message = thread.messages.find(row => row.id === attempt.responseId);
        message.content = (record.publications[thread.id]?.records || []).filter(row => row.publication.attemptId === attempt.id).map(row => row.publication.delta?.text || '').join('');
      }
      return record.workspace;
    } finally { db.close(); }
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-open-model]').click();
    await page.locator(`.chat-model-choices input[value="${model.id}/partition/${model.partitionPlanId}"]`).filter({ visible: true }).check();
    await page.locator('[data-close-inspector]').click();
    await expect(page.locator('[data-search-toggle]')).toBeVisible({ timeout: 60000 });
    await page.locator('[data-search-toggle]').click();
    await page.locator('[data-composer-input]').fill(question);
    await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
    sentAt = performance.now();
    await page.locator('[data-composer-send]').click();
    await expect.poll(async () => {
      for (const kind of ['search', 'remote']) {
        const allow = page.locator(`[data-${kind}-permission-allow]`);
        if (await allow.isVisible()) {
          permissions.push({ kind, text: await page.locator(`[data-${kind}-permission]`).innerText(), elapsedMs: performance.now() - sentAt });
          await allow.click();
        }
      }
      final = (await history())?.threads.at(-1) || null;
      const attempt = final?.attempts.at(-1);
      const next = `${attempt?.status || 'admitting'}:${attempt?.retrieval?.outcome || 'no-retrieval'}`;
      if (next !== phase) { phase = next; console.log(JSON.stringify({ phase, elapsedMs: performance.now() - sentAt })); }
      if (final?.messages.at(-1)?.role === 'assistant' && final.messages.at(-1).content && firstTextMs === null) firstTextMs = performance.now() - sentAt;
      if (['failed', 'cancelled', 'interrupted'].includes(attempt?.status)) throw new Error(JSON.stringify(attempt));
      return attempt?.status;
    }, { timeout: 150000, intervals: [250] }).toBe('completed');
    const attempt = final.attempts.at(-1);
    expect(attempt.retrieval.outcome).toBe('retrieved');
    expect(attempt.retrieval.sources.length).toBeGreaterThan(0);
    expect(attempt.retrieval.provider.id).toContain('contributor');
    const answer = final.messages.at(-1).content;
    const citations = [...answer.matchAll(/\[(\d+)\]/g)].map(match => Number(match[1]));
    expect(citations.length).toBeGreaterThan(0);
    for (const number of citations) {
      const source = attempt.retrieval.sources.find(row => row.number === number);
      expect(source?.passage).toBeTruthy();
      expect(source?.document?.sha256).toMatch(/^[a-f0-9]{64}$|^sha256:[a-f0-9]{64}$/);
    }
    expect(attempt.execution.identity.route.planId).toBe(model.partitionPlanId);
    expect(new Set(attempt.execution.identity.route.stages.map(stage => stage.participantId)).size).toBe(2);
    expect(permissions.some(row => row.kind === 'search')).toBe(true);
    await expect(page.locator('.is-assistant [data-source-reference]').first()).toBeVisible();
    expect(weightRequests).toEqual([]);
    await page.screenshot({ path: info.outputPath('cited-answer.png'), fullPage: true });
  } finally {
    await info.attach('search-split.json', { contentType: 'application/json', body: JSON.stringify({
      question, url, modelIdentity: model.identity, at: new Date().toISOString(), permissions, firstTextMs,
      completeMs: sentAt === null ? null : performance.now() - sentAt, history: final || await history().catch(() => null), errors, weightRequests
    }, null, 2) });
    await context.close();
  }
});
