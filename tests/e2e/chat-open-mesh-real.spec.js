import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

// Exact catalog bytes may be supplied by a local seed. The requester/executor
// still use the normal page, real WebRTC, signed custody and installed WebGPU.
const directory = process.env.DOPPLER_CHAT_MODEL_DIR;
test('open chat discovers a real contributor, streams without requester weights, and preserves explicit retries', async ({ browser }, info) => {
  test.skip(!directory, 'DOPPLER_CHAT_MODEL_DIR must contain the exact catalog Qwen 0.8B files');
  test.setTimeout(1200000);
  const model = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'))[0];
  const contexts = await Promise.all([browser.newContext(), browser.newContext(), browser.newContext()]);
  const [requester, contributor, seed] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = [], requesterWeights = [], contributorOrigins = [], seedFiles = [];
  const history = page => page.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')));
  const inventory = page => page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
    const result = [];
    for await (const [name, handle] of directory.entries()) result.push({ name, bytes: (await handle.getFile()).size });
    return result;
  });
  for (const page of [requester, contributor, seed]) {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.log('[browser]', message.text()); });
  }
  const modelRequest = url => /huggingface\.co|shard_\d+\.bin/.test(url);
  requester.on('request', request => { if (modelRequest(request.url())) requesterWeights.push(request.url()); });
  contributor.on('request', request => { if (modelRequest(request.url())) contributorOrigins.push(request.url()); });
  await contexts[1].route('https://huggingface.co/**', route => route.abort('internetdisconnected'));
  await contexts[2].route(model.source.baseUrl + '*', async route => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!/^[\w.-]+$/.test(filename)) throw new Error('Invalid fixture path');
    seedFiles.push(filename);
    await route.fulfill({ body: await readFile(path.join(directory, filename)),
      contentType: filename.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  });
  const openContribution = async page => {
    await page.locator('[data-toggle-inspector]').click();
    await page.locator('[data-contribution-model]').selectOption(model.id);
  };
  const approve = async page => {
    await page.locator('[data-chat-approval]').waitFor({ state: 'visible' });
    await page.locator('[data-approval-consent]').check();
    await page.locator('[data-approval-send]').click();
  };
  try {
    // Fixed test quotas exercise bounded cache operation reproducibly; these are
    // browser storage limits, not a claim about physical memory or disk capacity.
    for (const [index, page] of [requester, contributor, seed].entries()) {
      const cdp = await contexts[index].newCDPSession(page);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(info.project.use.baseURL).origin,
        quotaSize: (index === 2 ? 1536 : 320) * 1024 * 1024 });
    }
    await Promise.all([requester.goto('/'), contributor.goto('/'), seed.goto('/')]);
    for (const page of [requester, contributor, seed]) {
      await page.locator('[data-chat-workspace]').waitFor();
      await expect.poll(async () => parseInt(await page.locator('[data-mesh-peers]').textContent()), { timeout: 60000 }).toBeGreaterThanOrEqual(2);
    }
    await expect(requester.locator('[data-composer-send]')).toBeDisabled();
    await expect(requester.locator('[data-mesh-invite]')).toBeHidden();
    await openContribution(seed);
    await seed.locator('details').filter({ has: seed.locator('[data-toggle-file-contribution]') }).locator('summary').click();
    await seed.locator('[data-file-contribution-consent]').check();
    await seed.locator('[data-toggle-file-contribution]').click();
    await expect(seed.locator('[data-file-contribution-label]')).toHaveText('Sharing', { timeout: 180000 });
    console.log('Exact catalog files cached by the consenting seed', seedFiles.length);
    await openContribution(contributor);
    await contributor.locator('details').filter({ has: contributor.locator('[data-toggle-contribution]') }).locator('summary').click();
    await contributor.locator('[data-contribution-consent]').check();
    await contributor.locator('[data-toggle-contribution]').click();
    let lastProgress = '';
    await expect.poll(async () => {
      const state = await contributor.evaluate(async () => ({
        phase: document.querySelector('[data-contrib-label]').textContent,
        progress: document.querySelector('[data-contribution-progress]').textContent,
        error: document.querySelector('[data-network-message]').textContent,
        storage: await navigator.storage.estimate()
      }));
      if (state.progress !== lastProgress) { console.log('Contributor acquisition', state); lastProgress = state.progress; }
      if (state.error) throw new Error(state.error);
      return state.phase;
    }, { timeout: 600000 }).toBe('Ready');
    console.log('Real contributor ready from peer files with its origin unavailable');
    await expect(requester.locator('[data-active-model-select]')).toHaveValue(model.id);
    await expect(requester.locator('[data-composer-send]')).toBeEnabled();
    await requester.locator('[data-composer-input]').fill('Reply with only the word Hello.');
    await requester.locator('[data-composer-send]').click();
    await approve(requester);
    await expect.poll(async () => (await history(requester)).threads[0].messages.at(-1).content, { timeout: 120000 }).not.toBe('');
    await expect.poll(async () => (await history(requester)).threads[0].attempts.at(-1).status, { timeout: 180000 }).toBe('completed');
    const completed = await history(requester);
    expect(completed.threads[0].attempts[0].execution).toMatchObject({ placement: 'peer-whole-request', modelIdentity: model.identity });
    await requester.screenshot({ path: info.outputPath('answer.png'), fullPage: true });
    // A contributor leaving never erases the completed history or changes models.
    await contributor.locator('[data-toggle-contribution]').click();
    await expect(requester.locator('[data-composer-send]')).toBeDisabled();
    await requester.reload();
    await requester.locator('[data-thread-item-id]').first().click();
    expect((await history(requester)).threads).toEqual(completed.threads);
    expect(requesterWeights).toEqual([]);
    expect(contributorOrigins).toEqual([]);
    const acquired = await inventory(contributor);
    const storage = await contributor.evaluate(() => navigator.storage.estimate());
    expect(storage.usage).toBeLessThanOrEqual(320 * 1024 * 1024);
    expect(acquired.some(file => file.name.startsWith('blake3-'))).toBe(true);
    expect(errors).toEqual([]);
    await info.attach('open-mesh-real.json', { contentType: 'application/json', body: JSON.stringify({
      physicalDevices: 1, browserContexts: 3, actualInference: true, origin: 'identified local seed bytes; executor origin blocked',
      automaticDiscovery: true, completed, acquired, storage, configuredExecutorQuotaBytes: 320 * 1024 * 1024,
      requesterWeights, contributorOrigins, seedFiles, errors
    }, null, 2) });
  } finally { await Promise.all(contexts.map(context => context.close())); }
});
