import { test, expect, chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { observeCooperativePage, compareObservedLogits } from '../fixtures/cooperative-observer.js';

// Exact catalog bytes may be supplied by a local seed. The requester/executor
// still use the normal page, real WebRTC, signed custody and installed WebGPU.
const directory = process.env.DOPPLER_CHAT_MODEL_DIR;
test('one model executes cooperatively on discovered physical peers from selectively acquired pieces', async ({ browser }, info) => {
  test.skip(!directory, 'DOPPLER_CHAT_MODEL_DIR must contain the exact catalog Qwen 0.8B files');
  test.setTimeout(2400000);
  const model = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'))[0];
  const remote = process.env.REPLOID_EXECUTOR_WS
    ? await chromium.connect(process.env.REPLOID_EXECUTOR_WS) : null;
  const contexts = await Promise.all([browser.newContext(), (remote || browser).newContext(), browser.newContext(), browser.newContext()]);
  if (process.env.REPLOID_E2E_RTC_CONFIG_FILE) {
    const rtc = JSON.parse(await readFile(process.env.REPLOID_E2E_RTC_CONFIG_FILE, 'utf8'));
    for (const context of contexts) await context.addInitScript(config => { globalThis.REPLOID_POOL_RTC_CONFIG = config; }, rtc);
  }
  const [requester, contributor, seed, second] = await Promise.all(contexts.map(context => context.newPage()));
  const observations = [1, 3].map(index => ({ physicalHost: index === 1 && remote ? 'linux-128' : 'mac', loads: [], steps: [], errors: [] }));
  const reference = process.env.DOPPLER_PARTITION_REFERENCE_OUT
    ? JSON.parse(await readFile(process.env.DOPPLER_PARTITION_REFERENCE_OUT, 'utf8')) : null;
  const errors = [], requesterWeights = [], contributorOrigins = [], seedFiles = [];
  let adapterInfo = null;
  const history = page => page.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')));
  const inventory = page => page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
    const result = [];
    for await (const [name, handle] of directory.entries()) result.push({ name, bytes: (await handle.getFile()).size });
    return result;
  });
  for (const page of [requester, contributor, seed, second]) {
    page.on('pageerror', error => { errors.push(error.message); console.log('Page failure', error.message); });
    page.on('console', message => { if (message.type() === 'error') console.log('[browser]', message.text()); });
  }
  const modelRequest = url => /huggingface\.co|shard_\d+\.bin/.test(url);
  requester.on('request', request => { if (modelRequest(request.url())) requesterWeights.push(request.url()); });
  contributor.on('request', request => { if (modelRequest(request.url())) contributorOrigins.push(request.url()); });
  for (const i of [1, 3]) await contexts[i].route('https://huggingface.co/**', route => route.abort('internetdisconnected'));
  second.on('request', request => { if (modelRequest(request.url())) contributorOrigins.push(request.url()); });
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
    await expect.poll(async () => {
      const data = await history(page);
      const attempt = data?.threads.find(thread => thread.id === data.selectedId)?.attempts.at(-1);
      if (attempt?.status === 'failed') throw new Error(attempt.error);
      return await page.locator('[data-chat-approval]').isVisible();
    }, { timeout: 30000 }).toBe(true);
    await page.locator('[data-approval-consent]').check();
    await page.locator('[data-approval-send]').click();
  };
  try {
    // Fixed test quotas exercise bounded cache operation reproducibly; these are
    // browser storage limits, not a claim about physical memory or disk capacity.
    for (const [index, page] of [requester, contributor, seed, second].entries()) {
      const cdp = await contexts[index].newCDPSession(page);
      if ([1, 3].includes(index)) await observeCooperativePage(cdp, observations[index === 1 ? 0 : 1]);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(info.project.use.baseURL).origin,
        quotaSize: (index === 2 ? 1536 : 320) * 1024 * 1024 });
    }
    await Promise.all([requester, contributor, seed, second].map(page => page.goto(info.project.use.baseURL)));
    adapterInfo = await contributor.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('WebGPU adapter unavailable');
      return { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        isFallbackAdapter: adapter.info.isFallbackAdapter, shaderF16: adapter.features.has('shader-f16') };
    });
    if (info.project.name === 'chromium') expect(adapterInfo.isFallbackAdapter).toBe(false);
    for (const page of [requester, contributor, seed, second]) {
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
    for (const executor of [contributor, second]) {
    await openContribution(executor);
    await executor.locator('details').filter({ has: executor.locator('[data-toggle-contribution]') }).locator('summary').click();
    await executor.locator('[data-contribution-consent]').check();
    await executor.locator('[data-toggle-contribution]').click();
    }
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
    }, { timeout: 1800000 }).toBe('Ready');
    console.log('Real contributor ready from peer files with its origin unavailable');
    await expect(requester.locator('[data-active-model-select]')).toHaveValue(new RegExp(model.id));
    await expect(requester.locator('[data-composer-send]')).toBeEnabled();
    await requester.locator('[data-composer-input]').fill('Reply with only the word Hello.');
    await requester.locator('[data-composer-send]').click();
    await approve(requester);
    const executingThread = async () => {
      const thread = (await history(requester)).threads[0];
      const attempt = thread.attempts.at(-1);
      if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) {
        throw new Error(`Real generation ${attempt.status}: ${attempt.error}`);
      }
      return thread;
    };
    await expect.poll(async () => (await executingThread()).messages.at(-1).content, { timeout: 120000 }).not.toBe('');
    await expect.poll(async () => (await executingThread()).attempts.at(-1).status, { timeout: 180000 }).toBe('completed');
    let completed = await history(requester);
    expect(completed.threads[0].messages.at(-1).content.trim()).toBe('Hello');
    expect(completed.threads[0].attempts[0].execution.activationBytes).toBeGreaterThan(0);
    expect(completed.threads[0].attempts[0].execution).toMatchObject({ placement: 'two-device-layer-partition', modelIdentity: model.identity });
    await requester.screenshot({ path: info.outputPath('answer.png'), fullPage: true });
    const firstThreadId = completed.threads[0].id;
    const sendNew = async prompt => {
      await requester.locator('[data-new-thread]').click();
      await requester.locator('[data-composer-input]').fill(prompt);
      await requester.locator('[data-composer-send]').click();
      await approve(requester);
      return (await history(requester)).threads.find(thread => thread.messages[0].content === prompt).id;
    };
    const lastAttempt = async id => (await history(requester)).threads.find(thread => thread.id === id).attempts.at(-1);
    const waitCompleted = async id => expect.poll(async () => {
      const attempt = await lastAttempt(id);
      if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw new Error(attempt.error || attempt.status);
      return attempt.status;
    }, { timeout: 180000 }).toBe('completed');
    const secondId = await sendNew('What is two plus two? Answer briefly.');
    await waitCompleted(secondId);
    expect((await history(requester)).threads.find(thread => thread.id === secondId).messages.at(-1).content.trim()).toBe('4');
    await expect(contributor.locator('[data-contrib-label]')).toHaveText('Ready');
    const cancelledId = await sendNew('Count from one to one hundred, writing every number on its own line.');
    await expect.poll(async () => (await history(requester)).threads.find(thread => thread.id === cancelledId)
      .messages.at(-1).content, { timeout: 120000 }).not.toBe('');
    await requester.locator('[data-composer-stop]').click();
    await expect.poll(async () => (await lastAttempt(cancelledId)).status).toBe('cancelled');
    await requester.locator(`[data-thread-item-id="${firstThreadId}"]`).click();
    await requester.locator('[data-composer-input]').fill('Say goodbye briefly.');
    await requester.locator('[data-composer-send]').click();
    await approve(requester);
    await waitCompleted(firstThreadId);
    expect((await lastAttempt(secondId)).status).toBe('completed');
    expect((await lastAttempt(cancelledId)).status).toBe('cancelled');
    completed = await history(requester);
    // A stopped executor settles the attempt. Retry starts from authorized input.
    const recoveryId = await sendNew('Count from one to twenty, one number per line.');
    await expect.poll(async () => (await history(requester)).threads.find(thread => thread.id === recoveryId)
      .messages.at(-1).content, { timeout: 120000 }).not.toBe('');
    await second.locator('[data-toggle-contribution]').click();
    await expect.poll(async () => (await lastAttempt(recoveryId)).status, { timeout: 30000 }).toBe('failed');
    const failedRecovery = await lastAttempt(recoveryId);
    await expect(second.locator('[data-contrib-label]')).toHaveText('Not sharing');
    await second.locator('[data-toggle-contribution]').click();
    await expect(second.locator('[data-contrib-label]')).toHaveText('Ready', { timeout: 180000 });
    await expect(requester.locator('[data-active-model-select] option:checked')).toContainText('ready');
    await requester.locator('[data-retry-attempt]').click(); await approve(requester); await waitCompleted(recoveryId);
    expect((await lastAttempt(recoveryId)).id).not.toBe(failedRecovery.id);
    completed = await history(requester);
    const recovered = completed.threads.find(thread => thread.id === recoveryId);
    expect(recovered.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
    expect(recovered.messages.at(-1).content).toContain('20');
    const allocations = observations.map(device => device.loads[0]);
    expect(allocations.map(load => load.descriptor.layerRange).sort((a, b) => a[0] - b[0])).toEqual([[0, 11], [12, 23]]);
    const allBytes = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')).shards.reduce((sum, shard) => sum + shard.size, 0);
    for (const allocation of allocations) expect(allocation.acquisition.verifiedBytes).toBeLessThan(allBytes);
    for (const [index, allocation] of allocations.entries()) {
      expect(allocation.acquisition.pieces.some(piece => !allocations[1 - index].acquisition.pieces.includes(piece))).toBe(true);
    }
    const numerical = reference ? compareObservedLogits(observations, completed, reference, 0.001) : null;
    if (reference) expect(numerical).toHaveLength(4);
    expect(observations.flatMap(device => device.errors)).toEqual([]);
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
    expect(acquired.some(file => file.name.startsWith('sha256-'))).toBe(true);
    expect(errors).toEqual([]);
    await info.attach('open-mesh-real.json', { contentType: 'application/json', body: JSON.stringify({
      physicalDevices: remote ? 2 : 1, browserContexts: 4, actualInference: true, origin: 'identified local seed bytes; executor origin blocked',
      automaticDiscovery: true, adapterInfo, completed, acquired, storage, numerical,
      observations: observations.map(({ steps, ...device }) => ({ ...device, steps: steps.map(({ logits, ...step }) => step) })), configuredExecutorQuotaBytes: 320 * 1024 * 1024,
      requesterWeights, contributorOrigins, seedFiles, errors
    }, null, 2) });
  } finally {
    // Retain the actual failed boundary as well as successful run evidence.
    const states = await Promise.all([requester, contributor, seed, second].map(async page => {
      try { return await page.evaluate(async () => ({
        history: JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')),
        error: document.querySelector('[data-network-message]')?.textContent,
        contribution: document.querySelector('[data-contrib-label]')?.textContent,
        progress: document.querySelector('[data-contribution-progress]')?.textContent,
        storage: await navigator.storage.estimate()
      })); } catch (error) { return { diagnosticsError: error.message }; }
    }));
    await info.attach('state-at-exit.json', { contentType: 'application/json', body: JSON.stringify({
      physicalDevices: remote ? 2 : 1, browserContexts: 4, adapterInfo, browser: browser.version(), modelIdentity: model.identity,
      states, requesterWeights, contributorOrigins, seedFiles, errors
    }, null, 2) });
    await Promise.all(contexts.map(context => context.close()));
    await remote?.close();
  }
});
