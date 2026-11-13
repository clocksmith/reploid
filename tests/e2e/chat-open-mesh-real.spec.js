import { test, expect } from '@playwright/test';
import { observeMeshProtocol, expectMeshDiscovery } from '../fixtures/mesh-discovery.js';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';
import { privateRoom, expectCachedSharingDefault, contributeModel, waitContributionReady, chooseModel, admitRemote,
  openComputers, networkProblem, stopAnswer, QUEUED_MESSAGE } from '../fixtures/current-contribution.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { resolveServedFile } from '../../server/browser-roots.js';

// The current contributor journey downloads a whole model from its catalog origin
// (Computers → Contribute this computer → Download & share). The origin is served
// here from exact local catalog bytes; requesters, real WebRTC, signed custody and
// installed WebGPU are the ordinary application. Discovery uses a private room on
// the local signaling server so no public computer can answer or see a prompt.
const directory = process.env.DOPPLER_CHAT_MODEL_DIR;
test('open chat discovers a real contributor, delivers a message sent before capacity, streams without requester weights, fails over and retains history', async ({ browser }, info) => {
  test.skip(!directory, 'DOPPLER_CHAT_MODEL_DIR must contain the exact catalog Qwen 0.8B files');
  test.setTimeout(1200000);
  const model = JSON.parse(await readFile(resolveServedFile('config/chat-models.json'), 'utf8'))[0];
  const room = privateRoom('open-mesh');
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  // Bounded actions: a hidden control fails at its step instead of at the test timeout.
  for (const context of contexts) context.setDefaultTimeout(60000);
  const [requester, contributor] = await Promise.all(contexts.map(context => context.newPage()));
  const pages = [requester, contributor];
  const errors = [], requesterWeights = [], contributorOrigin = [], timings = {};
  let adapterInfo = null, queued = null, failover = null, connectionPaths = null;
  const started = Date.now(), log = (...items) => console.log(`[${((Date.now() - started) / 1000).toFixed(1)}s]`, ...items);
  const history = page => readChatWorkspace(page);
  const observe = (page, role) => {
    page.on('pageerror', error => { errors.push(`${role}: ${error.message}`); log('Page failure', role, error.message); });
    page.on('console', message => { if (message.type() === 'error') log(`[${role}]`, message.text()); });
  };
  observe(requester, 'requester'); observe(contributor, 'contributor');
  const modelRequest = url => /huggingface\.co|shard_\d+\.bin|\/model-files\//.test(url);
  requester.on('request', request => { if (modelRequest(request.url())) requesterWeights.push(request.url()); });
  await contexts[1].route('https://huggingface.co/**', route => route.abort('internetdisconnected'));
  await contexts[1].route(model.source.baseUrl + '*', async route => {
    const filename = new URL(route.request().url()).pathname.split('/').at(-1);
    if (!/^[\w.-]+$/.test(filename)) throw new Error('Invalid fixture path');
    contributorOrigin.push(filename);
    await route.fulfill({ body: await readFile(path.join(directory, filename)),
      contentType: filename.endsWith('.json') ? 'application/json' : 'application/octet-stream' });
  });
  const lastAttempt = async (page, id) => (await history(page)).threads.find(thread => thread.id === id).attempts.at(-1);
  // Streamed text of a thread's latest answer; a settled failure stops the wait with its recorded error.
  const streamed = async (page, id) => {
    const thread = (await history(page)).threads.find(item => item.id === id), attempt = thread.attempts.at(-1);
    if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw new Error(`Attempt ${attempt.status}: ${attempt.error}`);
    return thread.messages.find(message => message.id === attempt.responseId)?.content || '';
  };
  const settled = async (page, id, timeout = 180000) => expect.poll(async () => {
    const attempt = await lastAttempt(page, id);
    if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw new Error(`Attempt ${attempt.status}: ${attempt.error}`);
    return attempt.status;
  }, { timeout }).toBe('completed');
  const send = async (page, prompt) => {
    // Starting a thread restores its (empty) draft asynchronously; type once that has settled.
    await expect.poll(async () => {
      await page.locator('[data-composer-input]').fill(prompt);
      await page.waitForTimeout(300);
      return page.locator('[data-composer-input]').inputValue();
    }).toBe(prompt);
    await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
    const before = (await history(page))?.threads.reduce((sum, thread) => sum + thread.attempts.length, 0) || 0;
    await page.locator('[data-composer-send]').click();
    await admitRemote(page, async () => ((await history(page))?.threads.reduce((sum, thread) => sum + thread.attempts.length, 0) || 0) > before);
    return (await history(page)).threads.find(thread => thread.messages.some(message => message.role === 'user' && message.content === prompt)).id;
  };
  const openThread = async (page, id) => {
    const item = page.locator(`[data-thread-item-id="${id}"]`);
    if (!await item.isVisible()) await page.locator('[data-toggle-thread-rail]').first().click();
    await item.click({ timeout: 30000 });
    await expect(page.locator(`[data-thread-item-id="${id}"][aria-current="true"]`)).toHaveCount(1);
  };
  const sendNew = async (page, prompt) => {
    if (!await page.locator('[data-new-thread]').isVisible()) await page.locator('[data-toggle-thread-rail]').click();
    await page.locator('[data-new-thread]').click();
    await expect(page.locator('[data-thread-item-id][aria-current="true"]')).toHaveCount(0);
    return send(page, prompt);
  };
  try {
    for (const [index, page] of pages.entries()) {
      const cdp = await contexts[index].newCDPSession(page);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(info.project.use.baseURL).origin,
        quotaSize: (index === 1 ? 4096 : 320) * 1024 * 1024 });
      await observeMeshProtocol(page);
    }
    await Promise.all(pages.map(page => page.goto(room)));
    adapterInfo = await contributor.evaluate(async () => {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error('WebGPU adapter unavailable');
      return { vendor: adapter.info.vendor, architecture: adapter.info.architecture,
        isFallbackAdapter: adapter.info.isFallbackAdapter, shaderF16: adapter.features.has('shader-f16') };
    });
    if (info.project.name === 'chromium') expect(adapterInfo.isFallbackAdapter).toBe(false);
    for (const page of pages) {
      await page.locator('[data-chat-workspace]').waitFor();
      await expectMeshDiscovery(page, { minimum: 1 });
      await expectCachedSharingDefault(page);
    }
    // Discovered, but nobody serves a model yet: Send stays disabled and nothing is downloaded.
    await expect(requester.locator('[data-composer-send]')).toBeDisabled();

    const size = await contributeModel(contributor, model.id);
    expect(size).toMatch(/^\d+ MB download$/);
    const preparing = Date.now();
    await waitContributionReady(contributor, { log: state => log('Contributor', state) });
    timings.contributorReadyMs = Date.now() - preparing;
    await expect(contributor.locator('[data-toggle-contribution]')).toHaveAttribute('aria-checked', 'true');
    // Only exact catalog files came from the origin; requester bytes stay at zero.
    const catalogFiles = new Set([...model.source.files.map(file => file.path),
      ...JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8')).shards.map(shard => shard.filename)]);
    expect(contributorOrigin.every(file => catalogFiles.has(file))).toBe(true);
    // Computers pane: each connected computer names its connection path (521bcf709).
    await openComputers(requester);
    // The label sits in each row's collapsed Details; it is unhidden once statistics name the path.
    await expect.poll(async () => (connectionPaths = await requester.locator('[data-computer-path]')
      .evaluateAll(nodes => nodes.filter(node => !node.hidden).map(node => node.textContent))).length, { timeout: 30000 }).toBeGreaterThan(0);
    for (const label of connectionPaths) expect(['Direct connection', 'Relayed connection']).toContain(label);
    await requester.locator('[data-close-inspector]').click().catch(() => {});

    await chooseModel(requester, model.id);
    await expect(requester.locator('[data-composer-model-source]')).toHaveText(' · Public network');
    const firstThreadId = await send(requester, 'Reply with only the word Hello.');
    await expect.poll(() => streamed(requester, firstThreadId), { timeout: 120000 }).not.toBe('');
    await settled(requester, firstThreadId);
    let completed = await history(requester);
    expect((await lastAttempt(requester, firstThreadId)).execution).toMatchObject({ placement: 'peer-whole-request', modelIdentity: model.identity });
    await requester.screenshot({ path: info.outputPath('answer.png'), fullPage: true });

    const secondId = await sendNew(requester, 'What is two plus two? Answer briefly.');
    await settled(requester, secondId);
    await expect(contributor.locator('[data-contrib-label]')).toHaveText('Ready');
    const cancelledId = await sendNew(requester, 'Count from one to one hundred, writing every number on its own line.');
    await expect.poll(() => streamed(requester, cancelledId), { timeout: 120000 }).not.toBe('');
    await stopAnswer(requester);
    await expect.poll(async () => (await lastAttempt(requester, cancelledId)).status).toBe('cancelled');
    await openThread(requester, firstThreadId);
    await send(requester, 'Say goodbye briefly.');
    await settled(requester, firstThreadId);
    expect((await lastAttempt(requester, secondId)).status).toBe('completed');
    expect((await lastAttempt(requester, cancelledId)).status).toBe('cancelled');

    // A message sent before any computer is available is kept, then delivered once
    // one is ready (300e38c8f). The ready contributor leaves the network; a new
    // requester sends at once; the contributor rejoins.
    await openComputers(contributor);
    await contributor.locator('[data-mesh-connect]').click();
    await expect(contributor.locator('[data-connection-label]')).toHaveText('Disconnected');
    const lateContext = await browser.newContext(); contexts.push(lateContext); lateContext.setDefaultTimeout(60000);
    const late = await lateContext.newPage(); pages.push(late); observe(late, 'late-requester');
    late.on('request', request => { if (modelRequest(request.url())) requesterWeights.push(request.url()); });
    await observeMeshProtocol(late);
    await late.goto(room);
    await late.locator('[data-chat-workspace]').waitFor();
    const queuedPrompt = 'Reply with only the word Ready.';
    await late.locator('[data-composer-input]').fill(queuedPrompt);
    queued = { sendDisabledBeforeCapacity: await late.locator('[data-composer-send]').isDisabled(), sentAt: Date.now() };
    await late.locator('[data-composer-input]').press('Enter');
    await expect(late.locator('[data-model-status]')).toHaveText(QUEUED_MESSAGE);
    expect((await history(late))?.threads.length || 0).toBe(0);
    await contributor.locator('[data-mesh-connect]').click();
    await expect(contributor.locator('[data-connection-label]')).toHaveText('Connected', { timeout: 30000 });
    await admitRemote(late, async () => ((await history(late))?.threads[0]?.attempts.length || 0) > 0, { timeout: 120000 });
    const queuedThread = (await history(late)).threads[0];
    expect(queuedThread.messages[0].content).toBe(queuedPrompt);
    await settled(late, queuedThread.id);
    queued.deliveredMs = Date.now() - queued.sentAt;
    queued.thread = (await history(late)).threads[0];
    expect(queued.thread.messages.at(-1).content.trim()).not.toBe('');
    expect(queued.thread.attempts.at(-1).execution).toMatchObject({ placement: 'peer-whole-request', modelIdentity: model.identity });
    await expect(late.locator('[data-composer-input]')).toHaveValue('');
    await writeEvidence('queued-before-capacity.json', queued);
    await waitContributionReady(contributor);

    // The contributor leaves during an answer: the attempt fails as a dropped computer and
    // stays recorded; automatic failover (e7ea7aa6c) starts a new attempt that waits for a
    // computer and completes once the contributor returns, without the reader pressing Retry.
    const lostId = await sendNew(requester, 'Count from one to fifty, one number per line.');
    await expect.poll(() => streamed(requester, lostId), { timeout: 120000 }).not.toBe('');
    await openComputers(contributor);
    await contributor.locator('[data-toggle-contribution]').click();
    await expect(contributor.locator('[data-contrib-label]')).toHaveText('Not sharing', { timeout: 60000 });
    const attemptsOf = async () => (await history(requester)).threads.find(thread => thread.id === lostId).attempts;
    await expect.poll(async () => (await attemptsOf()).length, { timeout: 60000 }).toBeGreaterThan(1);
    const dropped = (await history(requester)).threads.find(thread => thread.id === lostId);
    expect(dropped.attempts[0].status).toBe('failed');
    expect(dropped.attempts[0].error).toMatch(/Execution peer disconnected|no longer ready|Failed to send swarm generation request/);
    expect(dropped.attempts[1].retryOf).toBe(dropped.attempts[0].id);
    expect(dropped.attempts.length).toBeLessThanOrEqual(3);
    await contributor.locator('[data-toggle-contribution]').click();
    await expect(contributor.locator('[data-model-dialog]')).toBeVisible();
    await expect(contributor.locator('[data-download-confirm]')).toHaveText('Start sharing');
    await contributor.locator('[data-download-confirm]').click();
    await waitContributionReady(contributor, { timeout: 300000 });
    await expect.poll(async () => (await attemptsOf()).at(-1).status, { timeout: 180000 }).toBe('completed');
    failover = (await history(requester)).threads.find(thread => thread.id === lostId);
    expect(failover.attempts[0]).toEqual(dropped.attempts[0]);
    expect(failover.attempts.at(-1).retryOf).toBeTruthy();
    expect(failover.attempts.at(-1).execution).toMatchObject({ placement: 'peer-whole-request', modelIdentity: model.identity });
    expect(failover.messages.at(-1).content).toContain('50');
    await writeEvidence('contributor-departure.json', { dropped, recovered: failover });

    // A contributor leaving never erases the completed history or changes models.
    completed = await history(requester);
    await contributor.locator('[data-toggle-contribution]').click();
    await expect(contributor.locator('[data-contrib-label]')).toHaveText('Not sharing', { timeout: 60000 });
    await expect(requester.locator('[data-composer-send]')).toBeDisabled({ timeout: 60000 });
    await requester.reload();
    await requester.locator('[data-chat-workspace]').waitFor();
    expect((await history(requester)).threads).toEqual(completed.threads);
    expect(requesterWeights).toEqual([]);
    expect(await networkProblem(requester)).toBe('');
    expect(errors).toEqual([]);
    await info.attach('open-mesh-real.json', { contentType: 'application/json', body: JSON.stringify({
      physicalDevices: 1, browserContexts: contexts.length, actualInference: true, discovery: 'private room on local signaling',
      origin: 'exact catalog bytes served locally for the contributor download', adapterInfo, timings, connectionPaths,
      completed, queued, failover, requesterWeights, contributorOrigin, errors
    }, null, 2) });
  } finally {
    const states = await Promise.all(pages.map(async page => {
      try { return { history: await history(page), ...(await page.evaluate(() => ({
        error: document.querySelector('[data-network-message]')?.textContent,
        contribution: document.querySelector('[data-contrib-label]')?.textContent,
        status: document.querySelector('[data-model-status]')?.textContent,
        progress: document.querySelector('[data-contribution-progress]')?.textContent }))) }; }
      catch (error) { return { diagnosticsError: error.message }; }
    }));
    await info.attach('state-at-exit.json', { contentType: 'application/json', body: JSON.stringify({
      adapterInfo, browser: browser.version(), modelIdentity: model.identity, timings, queued, states, requesterWeights, contributorOrigin, errors
    }, null, 2) });
    await Promise.all(contexts.map(context => context.close()));
  }
  async function writeEvidence(name, value) {
    await info.attach(name, { contentType: 'application/json', body: JSON.stringify(value, null, 2) });
  }
});
