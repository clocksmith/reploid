import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('three Chrome tabs supply files, execute Doppler and receive independent adapted and base conversations', async ({ browser }, testInfo) => {
  test.skip(process.env.REPLOID_E2E_ACTUAL_INFERENCE !== '1', 'Explicit real GPU/model-download opt-in required');
  test.setTimeout(1200000);
  const requesterContext = await browser.newContext(), supplierContext = await browser.newContext(), filesContext = await browser.newContext();
  const a = await requesterContext.newPage(), b = await supplierContext.newPage(), c = await filesContext.newPage();
  const errors = [], modelRequests = [], executorRequests = [];
  const base = 'qwen-3-5-0-8b-q4k-ehaf16', specialist = base + '/qwen35-0-8b-ner-json-lora';
  const model = JSON.parse(await readFile('self/config/chat-models.json', 'utf8')).find(item => item.id === base);
  b.on('console', message => {
    if (/LoRA|loaded|failed|Error|Memory \(loading\)/i.test(message.text())) console.log('[contributor]', message.text());
  });
  a.on('request', request => { if (/huggingface\.co|shard_\d+\.bin/.test(request.url())) modelRequests.push(request.url()); });
  b.on('request', request => { if (/huggingface\.co|shard_\d+\.bin/.test(request.url())) executorRequests.push(request.url()); });
  for (const page of [a, b, c]) page.on('pageerror', error => errors.push(error.message));
  const history = page => page.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')));
  const send = async (selection, message) => {
    await a.locator('[data-new-thread]').click();
    await a.locator('[data-active-model-select]').selectOption(selection);
    await a.locator('[data-composer-input]').fill(message);
    await a.locator('[data-composer-send]').click();
    await a.locator('[data-chat-approval]').waitFor({ state: 'visible', timeout: 60000 });
    await a.locator('[data-approval-consent]').check();
    await a.locator('[data-approval-send]').click();
  };
  try {
    await Promise.all([a.goto('/'), b.goto('/'), c.goto('/')]);
    for (const page of [a, b, c]) await expect.poll(async () => parseInt(await page.locator('[data-mesh-peers]').textContent()), { timeout: 60000 }).toBeGreaterThanOrEqual(2);
    expect(modelRequests).toEqual([]); expect(executorRequests).toEqual([]);
    await c.locator('[data-toggle-inspector]').click();
    await c.locator('[data-contribution-model]').selectOption(specialist);
    await c.locator('details').filter({ has: c.locator('[data-toggle-file-contribution]') }).locator('summary').click();
    await c.locator('[data-file-contribution-consent]').check();
    await c.locator('[data-toggle-file-contribution]').click();
    await c.waitForFunction(() => !['Not sharing', 'Preparing'].includes(document.querySelector('[data-file-contribution-label]')?.textContent), null, { timeout: 600000 });
    await expect(c.locator('[data-file-contribution-label]')).toHaveText('Sharing');
    await expect(c.locator('[data-contrib-label]')).toHaveText('Not sharing');
    await b.locator('[data-toggle-inspector]').click();
    await b.locator('[data-contribution-model]').selectOption(specialist);
    await b.locator('details').filter({ has: b.locator('[data-toggle-contribution]') }).locator('summary').click();
    await b.locator('[data-contribution-consent]').check();
    await b.locator('[data-toggle-contribution]').click();
    await b.waitForFunction(() => document.querySelector('[data-contrib-label]')?.textContent === 'Ready'
      || document.querySelector('[data-chat-error]')?.textContent
      || document.querySelector('[data-network-message]')?.textContent, null, { timeout: 600000 });
    expect(await b.locator('[data-chat-error]').textContent()).toBe('');
    expect(await b.locator('[data-network-message]').textContent()).toBe('');
    await expect(b.locator('[data-contrib-label]')).toHaveText('Ready');
    await send(specialist, 'Extract people and cities as JSON: Alice visited Bob in Paris.');
    await send(base, 'Reply with a short greeting.');
    await expect.poll(async () => (await history(a)).threads[0].attempts.at(-1).status, { timeout: 120000 }).toBe('completed');
    await expect.poll(async () => (await history(a)).threads[1].attempts.at(-1).status, { timeout: 120000 }).toBe('completed');
    const state = await history(a);
    expect(state.threads[0].attempts.at(-1).execution.adapterIdentities).toEqual([model.availableAdapters[0].identity]);
    expect(state.threads[1].attempts.at(-1).execution.adapterIdentities).toEqual([]);
    for (const thread of state.threads) {
      expect(thread.attempts.at(-1).execution.placement).toBe('peer-whole-request');
      expect(thread.messages.at(-1).content.trim()).not.toBe('');
    }
    expect(modelRequests).toEqual([]); expect(executorRequests).toEqual([]); expect(errors).toEqual([]);
    const acquiredFiles = await b.evaluate(async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
      const files = [];
      for await (const [name, handle] of folder.entries()) files.push({ name, bytes: (await handle.getFile()).size });
      return files;
    });
    expect(acquiredFiles.some(file => file.name === 'sha256-' + model.availableAdapters[0].artifact.hash.slice(7))).toBe(true);
    expect(acquiredFiles.some(file => file.name.startsWith('blake3-'))).toBe(true);
    await a.reload();
    await a.locator('[data-chat-workspace]').waitFor();
    expect((await history(a)).threads).toEqual(state.threads);
    await testInfo.attach('real-chat-evidence', { body: JSON.stringify({ physicalDevices: 1, tabs: 3,
      storageIsolation: 'separate Chrome contexts', execution: 'real WebGPU', state, modelRequests, executorRequests, acquiredFiles, errors }, null, 2), contentType: 'application/json' });
  } finally { await requesterContext.close(); await supplierContext.close(); await filesContext.close(); }
});
