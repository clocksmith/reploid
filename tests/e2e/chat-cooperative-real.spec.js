import { QUOTE_CASES, extractQuoteCode, evaluateQuoteCode } from '../fixtures/quote-code-evaluation.js';
import { comparisonInput, COMPARISON_CHECK } from '../../self/host/document-comparison.js';
import { test, expect, chromium } from '@playwright/test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLayerPartitionPlan } from 'doppler-gpu/partitions';
import { observeCooperativePage, compareObservedLogits } from '../fixtures/cooperative-observer.js';
import { inspectExecutorMemory, measureStandaloneDenial, measureStandaloneGeneration, routeDiagnosticModel, inspectConnections } from '../fixtures/capacity-observer.js';
import { physicalWebGpuBrowserOptions, connectPhysicalBrowser } from '../fixtures/physical-webgpu-browser.js';

// Exact catalog bytes may be supplied by a local seed. The requester/executor
// still use the normal page, real WebRTC, signed custody and installed WebGPU.
const directory = process.env.DOPPLER_CHAT_MODEL_DIR;
test('one model executes cooperatively on discovered physical peers from selectively acquired pieces', async ({ browser }, info) => {
  test.skip(!directory, 'DOPPLER_CHAT_MODEL_DIR must contain the exact selected catalog files');
  test.setTimeout(3600000);
  const models = JSON.parse(await readFile('self/config/chat-models.json', 'utf8'));
  const model = models.find(model => model.id === (process.env.REPLOID_TEST_MODEL || models[0].id));
  expect(model, 'Selected model must belong to the application catalog').toBeTruthy();
  const remote = process.env.REPLOID_EXECUTOR_WS
    ? await connectPhysicalBrowser(chromium, process.env.REPLOID_EXECUTOR_WS) : null;
  const remoteSeed = process.env.REPLOID_SEED_WS
    ? await connectPhysicalBrowser(chromium, process.env.REPLOID_SEED_WS) : remote;
  const remoteReplacement = process.env.REPLOID_REPLACEMENT_WS
    ? await connectPhysicalBrowser(chromium, process.env.REPLOID_REPLACEMENT_WS) : remote;
  const remoteHosts = new Set([remote, remoteSeed, remoteReplacement].filter(Boolean));
  const isRemote = host => remoteHosts.has(host);
  const fixtureBaseUrl = host => isRemote(host)
    ? process.env.REPLOID_DIAGNOSTIC_PEER_MODEL_BASE_URL || process.env.REPLOID_DIAGNOSTIC_MODEL_BASE_URL
    : process.env.REPLOID_DIAGNOSTIC_MODEL_BASE_URL;
  const contributionHosts = process.env.REPLOID_E2E_REVERSE_HOSTS === '1'
    ? [browser, remote || browser] : [remote || browser, browser];
  // Exercise ordinary application profiles on both physical hosts.
  // Put the file seed on Linux when available so macOS stores assigned pieces.
  const hosts = [browser, contributionHosts[0], remoteSeed || browser, contributionHosts[1]];
  const profiles = [];
  const openApplicationContext = async host => {
    if (isRemote(host) && process.env.REPLOID_EXECUTOR_CDP === '1') return host.contexts()[0];
    if (process.platform !== 'darwin' || host !== browser) return host.newContext();
    const profile = await mkdtemp(path.join(tmpdir(), 'reploid-cooperative-profile-'));
    profiles.push(profile);
    return chromium.launchPersistentContext(profile, physicalWebGpuBrowserOptions('darwin'));
  };
  const opening = await Promise.allSettled(hosts.map(openApplicationContext));
  const contexts = opening.filter(result => result.status === 'fulfilled').map(result => result.value);
  const failedOpening = opening.find(result => result.status === 'rejected');
  if (failedOpening) {
    await Promise.all(contexts.map(context => context.close()));
    await Promise.all(profiles.map(profile => rm(profile, { recursive: true, force: true })));
    await Promise.all([...remoteHosts].map(host => host.close())); throw failedOpening.reason;
  }
  if (process.env.REPLOID_E2E_RTC_CONFIG_FILE) {
    const rtc = JSON.parse(await readFile(process.env.REPLOID_E2E_RTC_CONFIG_FILE, 'utf8'));
    for (const context of contexts) await context.addInitScript(config => { globalThis.REPLOID_POOL_RTC_CONFIG = config; }, rtc);
  }
  const [requester, contributor, seed, second] = await Promise.all(contexts.map(context => context.newPage()));
  const observations = [1, 3].map(index => ({ physicalHost: isRemote(hosts[index]) ? 'linux-128' : 'mac', loads: [], steps: [], errors: [] }));
  const reference = process.env.DOPPLER_PARTITION_REFERENCE_OUT
    ? JSON.parse(await readFile(process.env.DOPPLER_PARTITION_REFERENCE_OUT, 'utf8')) : null;
  const captureCustody = process.env.REPLOID_E2E_CUSTODY_TRACE === '1';
  const seedObservation = { physicalHost: isRemote(hosts[2]) ? 'linux-128' : 'mac', loads: [], steps: [], errors: [] };
  const tokenObservers = [];
  const onInput = input => Promise.all(tokenObservers.map(observer => observer.captureAttempt(input.identity.attemptId)));
  const replicaEnabled = process.env.REPLOID_E2E_REPLICA === '1';
  const seedQuotaMiB = model.id === models[0].id ? 1536 : 3072;
  const executorQuotaMiB = replicaEnabled ? seedQuotaMiB : 320;
  const allPages = [requester, contributor, seed, second];
  const errors = [], requesterWeights = [], contributorOrigins = [], seedFiles = [];
  let adapterInfo = null, replicaObservation = null, seedObserver = null;
  const history = page => page.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')));
  const inventory = page => page.evaluate(async () => {
    const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
    const result = [];
    for await (const [name, handle] of directory.entries()) result.push({ name, bytes: (await handle.getFile()).size });
    return result.sort((a,b) => a.name.localeCompare(b.name));
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
    if (fixtureBaseUrl(hosts[2])) {
      // Use the already streamed, tunneled fixture; never copy whole shards
      // through the remote browser's debugger protocol.
      await route.fulfill({ status: 307, headers: {
        location: new URL(filename, fixtureBaseUrl(hosts[2])).href,
        'access-control-allow-origin': '*' } });
      return;
    }
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
      const activeId = await page.locator('[data-thread-item-id][aria-current="true"]').getAttribute('data-thread-item-id').catch(() => null);
      const attempt = data?.threads.find(thread => thread.id === activeId)?.attempts.at(-1);
      if (attempt?.status === 'failed') throw new Error(attempt.error);
      return await page.locator('[data-chat-approval]').isVisible();
    }, { timeout: 30000 }).toBe(true);
    await page.locator('[data-approval-consent]').check();
    await page.locator('[data-approval-send]').click();
  };
  const standaloneDenials = [];
  let capacityControls = null;
  const runCapacityControls = () => capacityControls ||= (async () => {
    if (process.env.REPLOID_E2E_CAPACITY === '1') {
      for (const [hostIndex, host] of [browser, remote || browser].entries()) {
        let diagnostic = null;
        try {
          diagnostic = await host.newContext();
          await routeDiagnosticModel(diagnostic, model, directory, fixtureBaseUrl(host));
          const page = await diagnostic.newPage(); await page.goto(info.project.use.baseURL);
          const denial = await measureStandaloneDenial(page, model);
          standaloneDenials.push(denial);
          await writeFile(info.outputPath(`standalone-denial-${hostIndex + 1}.json`), JSON.stringify(denial, null, 2));
          expect.soft(denial.error).toContain('GPU memory budget exceeded');
          expect.soft(denial.memory.rejected).toBeGreaterThan(0);
          expect.soft(denial.memory.peakBytes).toBeLessThanOrEqual(denial.maxGpuBufferBytes);
          expect.soft(denial.pool.resources.retainedModel.count, 'Failed loading must release all model weights').toBe(0);

        } catch (error) {
          const failure = { hostIndex, exception: { name: error.name, message: error.message } };
          standaloneDenials.push(failure);
          await writeFile(info.outputPath(`standalone-denial-${hostIndex + 1}.json`), JSON.stringify(failure, null, 2));
          expect.soft(error, `Independent capacity control ${hostIndex}`).toBeNull();
        } finally {
          try { await diagnostic?.close(); }
          catch (error) {
            standaloneDenials.push({ hostIndex, stage: 'cleanup', exception: { name: error.name, message: error.message } });
            expect.soft(error, `Capacity control ${hostIndex} cleanup`).toBeNull();
          }
        }
      }
    }
  })();
  try {
    // Fixed test quotas exercise bounded cache operation reproducibly; these are
    // browser storage limits, not a claim about physical memory or disk capacity.
    for (const [index, page] of [requester, contributor, seed, second].entries()) {
      const cdp = await contexts[index].newCDPSession(page);
      if ([1, 3].includes(index)) tokenObservers.push(await observeCooperativePage(cdp, observations[index === 1 ? 0 : 1], { captureCustody, captureLogits: !!reference, onInput,
        captureTokens: !reference && process.env.REPLOID_E2E_CAPACITY === '1',
        maxLogitSteps: reference?.expected.reduce((sum, item) => sum + item.steps.length, 0) || 4096,
        acceptStep: async identity => {
          const thread = (await history(requester)).threads.find(thread => thread.id === identity.threadId);
          if (!reference) return thread?.messages[0]?.content.includes('chooseQuote');
          return thread?.attempts[0]?.id === identity.attemptId
            && reference.prompts.some(messages => messages.at(-1).content === thread.messages[0].content);
        } }));
      if (index === 2 && captureCustody) seedObserver = await observeCooperativePage(cdp, seedObservation, { captureCustody, captureLogits: false });
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(info.project.use.baseURL).origin,
        quotaSize: (index === 2 ? seedQuotaMiB : executorQuotaMiB) * 1024 * 1024 });
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
    if (remote) {
      // Exercise the requested physical placement with normally generated signed
      // identities. Reconnect before contribution until the first host sorts as
      // input owner; discovery/placement still run entirely in the application.
      await expect.poll(() => observations.every(device => !!device.participantId), { timeout: 30000 }).toBe(true);
      await contributor.locator('[data-toggle-inspector]').click();
      let reconnects = 0;
      while (observations[0].participantId.localeCompare(observations[1].participantId) > 0 && reconnects < 16) {
        const previous = observations[0].participantId;
        await contributor.locator('[data-mesh-connect]').click();
        await expect(contributor.locator('[data-connection-label]')).toHaveText('Disconnected');
        await contributor.locator('[data-mesh-connect]').click();
        await expect.poll(() => observations[0].participantId, { timeout: 30000 }).not.toBe(previous);
        await expect(contributor.locator('[data-connection-label]')).toHaveText('Connected', { timeout: 30000 });
        reconnects++;
      }
      await contributor.locator('[data-close-inspector]').click();
      expect(observations[0].participantId.localeCompare(observations[1].participantId), 'Requested physical placement must be covered').toBeLessThan(0);
    }
    await openContribution(seed);
    await seed.locator('[data-toggle-file-contribution]').click();
    await expect.poll(async () => {
      const state = await seed.evaluate(() => ({
        phase: document.querySelector('[data-file-contribution-label]').textContent,
        error: document.querySelector('[data-network-message]').textContent
      }));
      if (state.error || state.phase === 'Failed') throw Error('Seed preparation failed: ' + state.error);
      return state.phase;
    }, { timeout: 1800000 }).toBe('Sharing');
    console.log('Exact catalog files cached by the consenting seed', seedFiles.length);
    for (const executor of [contributor, second]) {
    await openContribution(executor);
    await executor.locator('[data-toggle-contribution]').click();
    }
    await Promise.all([contributor, second].map(async (page, index) => {
      let lastProgress = '';
      await expect.poll(async () => {
        const state = await page.evaluate(async () => ({
          phase: document.querySelector('[data-contrib-label]').textContent,
          progress: document.querySelector('[data-contribution-progress]').textContent,
          error: document.querySelector('[data-network-message]').textContent,
          storage: await navigator.storage.estimate()
        }));
        if (state.progress !== lastProgress) {
          console.log('Contributor acquisition', observations[index].physicalHost, state); lastProgress = state.progress;
        }
        if (state.error || state.phase === 'Failed') throw Error('Contributor preparation failed: ' + state.error);
        return state.phase;
      }, { timeout: 1800000 }).toBe('Ready');
    }));
    if (remote) expect(observations[0].loads[0].descriptor.index).toBe(0);
    await seedObserver?.armFileProbes();
    console.log('Real contributor ready from peer files with its origin unavailable');
    await expect(requester.locator('[data-active-model-select]')).toHaveValue(new RegExp(model.id), { timeout: 60000 });
    await expect(requester.locator('[data-composer-send]')).toBeEnabled();
    await requester.locator('[data-composer-input]').fill(reference ? 'Reply with only the word Hello.' : 'Greet me briefly.');
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
    const greeting = completed.threads[0].messages.at(-1).content.trim();
    if (reference) expect(greeting).toBe('Hello');
    else { expect(greeting).toMatch(/^(Hello|Hi|Hey)\b/i); expect(greeting.length).toBeLessThan(200); }
    expect(completed.threads[0].attempts[0].execution.stopReason).toBe('eos-token');
    expect(completed.threads[0].attempts[0].execution.activationBytes).toBeGreaterThan(0);
    expect(completed.threads[0].attempts[0].execution).toMatchObject({ placement: 'two-device-layer-partition', modelIdentity: model.identity });
    await requester.screenshot({ path: info.outputPath('answer.png'), fullPage: true });
    const connections = await Promise.all([contributor, second].map(inspectConnections));
    const firstThreadId = completed.threads[0].id;
    const sendNew = async prompt => {
      await requester.locator('[data-new-thread]').click();
      await requester.locator('[data-composer-input]').fill(prompt);
      await requester.locator('[data-composer-send]').click();
      await approve(requester);
      return (await history(requester)).threads.at(-1).id;
    };
    const lastAttempt = async id => (await history(requester)).threads.find(thread => thread.id === id).attempts.at(-1);
    const waitCompleted = async (id, timeout = 180000) => expect.poll(async () => {
      const attempt = await lastAttempt(id);
      if (['failed', 'cancelled', 'interrupted'].includes(attempt.status)) throw new Error(attempt.error || attempt.status);
      return attempt.status;
    }, { timeout }).toBe('completed');
    const returningPages = observations[0].physicalHost === 'mac' ? [contributor, second] : [second, contributor];
    const runDocuments = async () => {
      await requester.locator('[data-new-thread]').click();
      // Preserve the exact long-prompt workload through the ordinary composer.
      const sample = JSON.parse(await readFile('self/config/document-comparison-sample.json', 'utf8'));
      await requester.locator('[data-composer-input]').fill(comparisonInput(sample.question, sample.files));
      await requester.locator('[data-composer-send]').click();
      await approve(requester);
      const documentId = (await history(requester)).threads.at(-1).id;
      await waitCompleted(documentId, 600000);
      await requester.locator('[data-composer-input]').fill(COMPARISON_CHECK);
      await requester.locator('[data-composer-send]').click();
      await approve(requester); await waitCompleted(documentId, 600000);
      const documents = (await history(requester)).threads.find(thread => thread.id === documentId);
      await writeFile(info.outputPath('document-comparison.json'), JSON.stringify({
        modelIdentity: model.identity, physicalDevices: remote ? 2 : 1, thread: documents,
        qualityStatus: 'requires source-grounded evaluation; successful generation is not proof of useful comparison'
      }, null, 2));
      expect(documents.attempts.map(attempt => attempt.status)).toEqual(['completed', 'completed']);
      expect(documents.attempts.map(attempt => attempt.execution.stopReason)).toEqual(['eos-token', 'eos-token']);
      await expect(requester.locator('[data-message-stream] details')).toHaveCount(3);
      const download = requester.waitForEvent('download');
      await requester.locator('[data-conversation-download]').click(); await download;
    };
    if (process.env.REPLOID_E2E_RECOVERY === '1') {
      // Keep the prepared pair and its caches alive across the focused restarts.
      // This is a diagnosis of contribution recovery, not full acceptance.
      const longRecovery = process.env.REPLOID_E2E_DOCUMENTS === '1';
      if (longRecovery) await runDocuments();
      const receipt = { physicalDevices: remote ? 2 : 1, modelIdentity: model.identity, longRecovery, restarts: [] };
      const save = () => writeFile(info.outputPath('contributor-restarts.json'), JSON.stringify(receipt, null, 2));
      const snapshot = async page => ({
        phase: await page.locator('[data-contrib-label]').textContent(),
        error: await page.locator('[data-network-message]').textContent(),
        inventory: await inventory(page).catch(error => ({ exception: { name: error.name, message: error.message } })),
        memory: await inspectExecutorMemory(page)
      });
      await requester.locator(`[data-thread-item-id="${firstThreadId}"]`).click();
      await requester.locator('[data-composer-input]').fill('Preserve this unrelated recovery draft.');
      const preserved = await history(requester);
      const preservedDrafts = await requester.evaluate(() => localStorage.getItem('reploid.chat-workspace:v1:drafts'));
      expect(preservedDrafts).toContain('Preserve this unrelated recovery draft.');
      // Isolate export from the long workload: the original failure followed it.
      const exported = requester.waitForEvent('download');
      await requester.locator('[data-conversation-download]').click(); await exported;
      for (const [pageIndex, returning] of returningPages.entries()) {
        const other = returning === second ? contributor : second;
        const observation = observations[returning === contributor ? 0 : 1];
        const otherObservation = observations[returning === contributor ? 1 : 0];
        const retainedLoads = otherObservation.loads.length;
        const restart = { host: observation.physicalHost,
          descriptor: observation.loads.at(-1).descriptor,
          before: await snapshot(returning), retained: await snapshot(other) };
        receipt.restarts.push(restart); await save();
        if (longRecovery) {
          restart.interruptedThreadId = await sendNew('Count from one to twenty, one number per line.');
          await expect.poll(async () => (await history(requester)).threads.find(thread => thread.id === restart.interruptedThreadId)
            .messages.at(-1).content, { timeout: 120000 }).not.toBe('');
        }
        await returning.locator('[data-toggle-contribution]').click();
        await expect(returning.locator('[data-contrib-label]')).toHaveText('Not sharing');
        if (longRecovery) {
          await expect.poll(async () => (await lastAttempt(restart.interruptedThreadId)).status).toBe('failed');
          restart.interruptedAttempt = await lastAttempt(restart.interruptedThreadId);
        }
        restart.stopped = await snapshot(returning); await save();
        await returning.locator('[data-toggle-contribution]').click();
        try {
          await expect.poll(async () => {
            const state = { phase: await returning.locator('[data-contrib-label]').textContent(),
              error: await returning.locator('[data-network-message]').textContent() };
            if (state.error || state.phase === 'Failed') throw Error('Contributor restart failed: ' + state.error);
            return state.phase;
          }, { timeout: 180000 }).toBe('Ready');
          await expect(requester.locator('[data-active-model-select] option:checked')).toContainText('ready');
          restart.ready = await snapshot(returning); await save();
          if (longRecovery) {
            await requester.locator('[data-retry-attempt]').click(); await approve(requester);
            await waitCompleted(restart.interruptedThreadId);
            restart.retryAttempt = await lastAttempt(restart.interruptedThreadId); await save();
            expect(restart.retryAttempt.id).not.toBe(restart.interruptedAttempt.id);
            expect(restart.retryAttempt.execution.stopReason).toBe('eos-token');
          }
          const id = await sendNew('Return only the word YES.'); await waitCompleted(id);
          restart.thread = (await history(requester)).threads.find(thread => thread.id === id);
          restart.reloaded = observation.loads.at(-1);
          restart.retainedAfter = await snapshot(other); await save();
          expect(restart.reloaded.descriptor.ready).toBe(true);
          expect(restart.thread.attempts.at(-1).execution.stopReason).toBe('eos-token');
          expect(restart.thread.messages.at(-1).content.trim()).toBe('YES');
          expect(otherObservation.loads.length, 'Unchanged contributor must keep its resident weights').toBe(retainedLoads);
          expect(restart.retainedAfter.inventory).toEqual(restart.retained.inventory);
          const current = await history(requester);
          for (const original of preserved.threads) {
            const actual = current.threads.find(thread => thread.id === original.id);
            expect(actual.messages).toEqual(original.messages);
            expect(actual.attempts).toEqual(original.attempts);
          }
          const drafts = await requester.evaluate(() => JSON.parse(localStorage.getItem('reploid.chat-workspace:v1:drafts')));
          const originals = JSON.parse(preservedDrafts);
          for (const [id, draft] of Object.entries(originals)) expect(drafts[id]).toEqual(draft);
          console.log('Focused contributor restart executable', pageIndex, restart.host, restart.descriptor.layerRange);
        } catch (error) {
          restart.exception = { name: error.name, message: error.message };
          restart.failed = await snapshot(returning); await save(); throw error;
        }
      }
      expect(requesterWeights).toEqual([]); expect(contributorOrigins).toEqual([]);
      return;
    }
    let usefulCode = null;
    if (process.env.REPLOID_E2E_CAPACITY === '1') {
      const prompt = 'Write only JavaScript function chooseQuote(quotes, budgetCents, deadline). Each quote has id, subtotalCents, taxPercent, taxIncluded, completionDate (YYYY-MM-DD). Return exactly an object with properties id and totalCents, or null. Use a for-of loop, initialize best to null. For each quote compute const totalCents = quote.taxIncluded ? quote.subtotalCents : Math.round(quote.subtotalCents * (1 + quote.taxPercent / 100)). Skip it if totalCents > budgetCents or quote.completionDate > deadline. Compare totalCents with best.totalCents. Equal totals must compare quote.id with best.id alphabetically. When updating best, assign {id: quote.id, totalCents: totalCents}. At the end return best directly. Keep those exact property names when comparing and returning. Do not return an array or the original quote. Do not mutate quotes. Return only complete function code.';
      const id = await sendNew(prompt); await waitCompleted(id, 600000);
      const thread = (await history(requester)).threads.find(thread => thread.id === id);
      const answer = thread.messages.at(-1).content;
      const code = extractQuoteCode(answer);
      const cases = QUOTE_CASES;
      usefulCode = { prompt, answer, thread, cases, results: [] };
      await writeFile(info.outputPath('useful-code.json'), JSON.stringify(usefulCode, null, 2));
      const attemptId = thread.attempts.at(-1).id;
      const tokenized = observations.flatMap(device => device.inputs || []).find(input => input.identity.attemptId === attemptId);
      const distributedSteps = [...observations, replicaObservation].filter(Boolean)
        .flatMap(device => device.steps).filter(step => step.identity.attemptId === attemptId).sort((a,b) => a.step - b.step);
      usefulCode.tokenized = tokenized;
      usefulCode.generatedTokenIds = distributedSteps.map(step => step.tokenId);
      await writeFile(info.outputPath('useful-code.json'), JSON.stringify(usefulCode, null, 2));
      for (const [caseIndex, sample] of cases.entries()) {
        const actual = await evaluateQuoteCode(requester, code, {
          quotes: sample.quotes, budget: sample.budget, deadline: sample.deadline
        });
        usefulCode.results.push({ caseIndex, ...actual });
        // Retain each result and mutation/exception observation before asserting.
        await writeFile(info.outputPath('useful-code.json'), JSON.stringify(usefulCode, null, 2));
        expect.soft(actual.exception, `Quote case ${caseIndex} execution`).toBeNull();
        expect.soft(actual.mutationPreserved, `Quote case ${caseIndex} must preserve input`).toBe(true);
        if (!actual.exception) {
          expect.soft(actual.value, `Quote case ${caseIndex} result`).toEqual(sample.expected);
          expect.soft(actual.valueIsNull, `Quote case ${caseIndex} null result`).toBe(sample.expected === null);
        }
      }
      // Preserve all code results even if the independent inference diagnostic fails.
      let diagnostic = null;
      try {
        diagnostic = await browser.newContext();
        expect(tokenized, 'Compare the actual distributed prompt tokens').toBeTruthy();
        await routeDiagnosticModel(diagnostic, model, directory);
        const page = await diagnostic.newPage(); await page.goto(info.project.use.baseURL);
        const unsplit = await measureStandaloneGeneration(page, model, tokenized);
        const comparison = { ...unsplit, distributedAnswer: answer,
          distributedGeneratedTokenIds: usefulCode.generatedTokenIds,
          sameAnswer: unsplit.evidence.outputText === answer,
          sameGeneratedTokens: JSON.stringify(unsplit.evidence.tokenIds) === JSON.stringify(usefulCode.generatedTokenIds) };
        await writeFile(info.outputPath('useful-code-unsplit.json'), JSON.stringify(comparison, null, 2));
        usefulCode.unsplit = { sameAnswer: comparison.sameAnswer, sameGeneratedTokens: comparison.sameGeneratedTokens };
        console.log('Code inference comparison', JSON.stringify(usefulCode.unsplit));
      } catch (error) {
        await writeFile(info.outputPath('useful-code-unsplit.json'), JSON.stringify({ exception: { name: error.name, message: error.message } }, null, 2));
        expect.soft(error, 'Unsplit comparison must complete').toBeNull();
      } finally {
        try { await diagnostic?.close(); }
        catch (error) {
          usefulCode.unsplitCleanupException = { name: error.name, message: error.message };
          await writeFile(info.outputPath('useful-code.json'), JSON.stringify(usefulCode, null, 2));
          expect.soft(error, 'Unsplit comparison must release its context').toBeNull();
        }
      }
      expect(thread.attempts.at(-1).execution.stopReason).toBe('eos-token');
      await writeFile(info.outputPath('useful-code.json'), JSON.stringify(usefulCode, null, 2));
      completed = await history(requester);
    }
    const secondId = await sendNew('What is two plus two? Answer briefly.');
    await waitCompleted(secondId);
    expect((await history(requester)).threads.find(thread => thread.id === secondId).messages.at(-1).content.trim()).toBe('4');
    await expect(contributor.locator('[data-contrib-label]')).toHaveText('Ready');
    const concurrentId = await sendNew('Count from one to twenty, one number per line.');
    const concurrentBriefId = await sendNew('Return only the word YES.');
    expect((await lastAttempt(concurrentId)).status).toBe('executing');
    await Promise.all([waitCompleted(concurrentId), waitCompleted(concurrentBriefId)]);
    const concurrent = { long: await lastAttempt(concurrentId), brief: await lastAttempt(concurrentBriefId) };
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
    if (reference) {
      for (const messages of reference.prompts.slice(2)) {
        const id = await sendNew(messages.at(-1).content); await waitCompleted(id);
        const thread = (await history(requester)).threads.find(thread => thread.id === id);
        const index = reference.prompts.indexOf(messages);
        expect(thread.messages.at(-1).content).toBe(reference.expected[index].text);
      }
    }
    if (process.env.REPLOID_E2E_DOCUMENTS === '1') await runDocuments();
    completed = await history(requester);
    // Each contributor role must settle loss and support an explicit retry.
    let recovered;
    for (const returning of returningPages) {
      const recoveryId = await sendNew('Count from one to twenty, one number per line.');
      await expect.poll(async () => (await history(requester)).threads.find(thread => thread.id === recoveryId)
        .messages.at(-1).content, { timeout: 120000 }).not.toBe('');
      await returning.locator('[data-toggle-contribution]').click();
      await expect.poll(async () => (await lastAttempt(recoveryId)).status, { timeout: 30000 }).toBe('failed');
      const failedRecovery = await lastAttempt(recoveryId);
      await expect(returning.locator('[data-contrib-label]')).toHaveText('Not sharing');
      await returning.locator('[data-toggle-contribution]').click();
      await expect.poll(async () => {
        const state = await returning.evaluate(() => ({ phase: document.querySelector('[data-contrib-label]').textContent,
          error: document.querySelector('[data-network-message]').textContent }));
        if (state.error || state.phase === 'Failed') throw new Error('Contributor rejoin failed: ' + state.error);
        return state.phase;
      }, { timeout: 180000 }).toBe('Ready');
      await expect(requester.locator('[data-active-model-select] option:checked')).toContainText('ready');
      await requester.locator('[data-retry-attempt]').click(); await approve(requester); await waitCompleted(recoveryId);
      expect((await lastAttempt(recoveryId)).id).not.toBe(failedRecovery.id);
      completed = await history(requester);
      recovered = completed.threads.find(thread => thread.id === recoveryId);
      expect(recovered.attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
      expect(recovered.messages.at(-1).content).toContain('20');
      console.log('Contributor rejoin and explicit retry completed', observations[returning === contributor ? 0 : 1].physicalHost);
    }
    await writeFile(info.outputPath('pair-completed.json'), JSON.stringify({
      physicalDevices: remote ? 2 : 1, modelIdentity: model.identity, completed, concurrent,
      memory: await Promise.all([contributor, second].map(inspectExecutorMemory)),
      observations: observations.map(({ steps, ...device }) => ({ ...device, steps: steps.map(({ logits, ...step }) => step) })),
      requesterWeights, contributorOrigins, seedFiles, errors
    }, null, 2));
    let replica = null;
    if (replicaEnabled) {
      const originalPlacement = recovered.attempts.at(-1).execution;
      const bIndex = observations.findIndex(device => device.loads[0].descriptor.index === 1);
      const bPage = [contributor, second][bIndex];
      const bHost = isRemote(contributionHosts[bIndex]) ? remoteReplacement : contributionHosts[bIndex];
      // Each executor separately authorizes redistribution of retained pieces.
      for (const executor of [contributor, second]) {
        await executor.locator('[data-toggle-file-contribution]').click();
        await expect(executor.locator('[data-file-contribution-label]')).toHaveText('Sharing', { timeout: 60000 });
      }
      await seed.locator('[data-toggle-file-contribution]').click();
      await expect(seed.locator('[data-file-contribution-label]')).toHaveText('Not sharing');
      const context = await openApplicationContext(bHost); contexts.push(context);
      if (process.env.REPLOID_E2E_RTC_CONFIG_FILE) {
        const rtc = JSON.parse(await readFile(process.env.REPLOID_E2E_RTC_CONFIG_FILE, 'utf8'));
        await context.addInitScript(config => { globalThis.REPLOID_POOL_RTC_CONFIG = config; }, rtc);
      }
      await context.route('https://huggingface.co/**', route => route.abort('internetdisconnected'));
      const page = await context.newPage(); allPages.push(page);
      page.on('request', request => { if (modelRequest(request.url())) contributorOrigins.push(request.url()); });
      page.on('pageerror', error => errors.push(error.message));
      const observation = { physicalHost: observations[bIndex].physicalHost, loads: [], steps: [], errors: [] };
      replicaObservation = observation;
      const cdp = await context.newCDPSession(page);
      tokenObservers.push(await observeCooperativePage(cdp, observation, { captureCustody, captureLogits: false, onInput,
        captureTokens: process.env.REPLOID_E2E_CAPACITY === '1', maxLogitSteps: 4096,
        acceptStep: async identity => (await history(requester)).threads.find(thread => thread.id === identity.threadId)
          ?.messages[0]?.content.includes('chooseQuote') }));
      await cdp.send('Storage.overrideQuotaForOrigin', { origin: new URL(info.project.use.baseURL).origin,
        quotaSize: executorQuotaMiB * 1024 * 1024 });
      await page.goto(info.project.use.baseURL); await page.locator('[data-chat-workspace]').waitFor();
      await openContribution(page);
      await page.locator('[data-toggle-contribution]').click();
      await expect(page.locator('[data-contrib-label]')).toHaveText('Ready', { timeout: 1800000 });
      expect(observation.loads[0].descriptor.index).toBe(1);
      const pinnedId = await sendNew('Reply with only the word Hello.'); await waitCompleted(pinnedId);
      expect((await lastAttempt(pinnedId)).execution.participantB).toBe(originalPlacement.participantB);
      const lostId = await sendNew('Count from one to twenty, one number per line.');
      await expect.poll(async () => (await history(requester)).threads.find(thread => thread.id === lostId)
        .messages.at(-1).content, { timeout: 120000 }).not.toBe('');
      const lostAt = Date.now(); await bPage.locator('[data-toggle-contribution]').click();
      await expect.poll(async () => (await lastAttempt(lostId)).status).toBe('failed');
      await expect(requester.locator('[data-active-model-select] option:checked')).toContainText('ready');
      await requester.locator('[data-retry-attempt]').click(); await approve(requester); await waitCompleted(lostId);
      const replacement = await lastAttempt(lostId);
      expect(replacement.execution.participantA).toBe(originalPlacement.participantA);
      expect(replacement.execution.participantB).not.toBe(originalPlacement.participantB);
      expect((await history(requester)).threads.find(thread => thread.id === lostId).attempts.map(attempt => attempt.status)).toEqual(['failed', 'completed']);
      expect(observation.loads).toHaveLength(1);
      replica = { observation, memory: await inspectExecutorMemory(page), recoveryMs: Date.now() - lostAt,
        originalPlacement: { participantA: originalPlacement.participantA, participantB: originalPlacement.participantB },
        replacementAttempt: replacement, originalSeedStoppedBeforeAcquisition: true };
      completed = await history(requester);
    }
    await runCapacityControls();
    const allocations = observations.map(device => device.loads[0]);
    const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
    const plan = createLayerPartitionPlan({ modelId: manifest.modelId, ...manifest.architecture,
      splitLayer: model.partitionSplitLayer, activationDtype: manifest.inference.session.compute.defaults.activationDtype });
    expect(allocations.map(load => load.descriptor.layerRange).sort((a, b) => a[0] - b[0]))
      .toEqual(plan.partitions.map(partition => partition.layerRange));
    const allBytes = manifest.shards.reduce((sum, shard) => sum + shard.size, 0);
    for (const allocation of allocations) expect(allocation.acquisition.verifiedBytes).toBeLessThan(allBytes);
    for (const [index, allocation] of allocations.entries()) {
      expect(allocation.acquisition.pieces.some(piece => !allocations[1 - index].acquisition.pieces.includes(piece))).toBe(true);
    }
    const numerical = reference ? compareObservedLogits(observations, completed, reference, 0.001) : null;
    if (numerical) await writeFile(info.outputPath('numerical-comparison.json'), JSON.stringify(numerical, null, 2));
    if (reference) expect(numerical).toHaveLength(reference.expected.reduce((sum, item) => sum + item.steps.length, 0));
    expect(observations.flatMap(device => device.errors)).toEqual([]);
    const memory = await Promise.all([contributor, second].map(inspectExecutorMemory));
    for (const snapshot of memory) {
      expect(snapshot.maxBytes).toBeGreaterThan(0);
      expect(snapshot.peakBytes).toBeLessThanOrEqual(snapshot.maxBytes);
      expect(snapshot.rejected).toBe(0);
    }
    // A contributor leaving never erases the completed history or changes models.
    const stoppingPage = replicaEnabled ? [contributor, second][observations.findIndex(device => device.loads[0].descriptor.index === 0)] : contributor;
    await stoppingPage.locator('[data-toggle-contribution]').click();
    await expect(requester.locator('[data-composer-send]')).toBeDisabled();
    await requester.reload();
    await requester.locator('[data-thread-item-id]').first().click();
    expect((await history(requester)).threads).toEqual(completed.threads);
    expect(requesterWeights).toEqual([]);
    expect(contributorOrigins).toEqual([]);
    const acquired = await inventory(contributor);
    const storage = await contributor.evaluate(() => navigator.storage.estimate());
    expect(storage.usage).toBeLessThanOrEqual(executorQuotaMiB * 1024 * 1024);
    expect(acquired.some(file => file.name.startsWith('sha256-'))).toBe(true);
    expect(errors).toEqual([]);
    const cooperativeReceipt = { physicalDevices: remote ? 2 : 1, browserContexts: contexts.length,
      modelIdentity: model.identity, completed, memory, replica, concurrent, connections, usefulCode,
      observations: observations.map(({ steps, ...device }) => ({ ...device, steps: steps.map(({ logits, ...step }) => step) })),
      numerical, requesterWeights, contributorOrigins, storage, acquired, seedFiles, errors };
    await writeFile(info.outputPath('cooperative-completed.json'), JSON.stringify(cooperativeReceipt, null, 2));
    await info.attach('open-mesh-real.json', { contentType: 'application/json', body: JSON.stringify({
      physicalDevices: remote ? 2 : 1, browserContexts: contexts.length, actualInference: true, origin: 'identified local seed bytes; executor origin blocked',
      automaticDiscovery: true, adapterInfo, completed, acquired, storage, numerical, memory, standaloneDenials, replica, concurrent, connections, usefulCode,
      observations: observations.map(({ steps, ...device }) => ({ ...device, steps: steps.map(({ logits, ...step }) => step) })), configuredExecutorQuotaBytes: executorQuotaMiB * 1024 * 1024,
      requesterWeights, contributorOrigins, seedFiles, errors
    }, null, 2) });
    // The operator may track historical score drift without blocking release.
    // Shape, finite values, sampled tokens and stopping remain required above.
    if (numerical && process.env.REPLOID_TRACK_NUMERICAL_DRIFT !== '1') {
      expect(numerical.filter(step => !step.matches), 'Distributed numerical tolerance failures').toEqual([]);
    }
  } catch (error) {
    await writeFile(info.outputPath('failure.json'), JSON.stringify({ name: error.name, message: error.message, stack: error.stack }, null, 2));
    console.log('Conversation failure recorded:', error.message.split('\n')[0]);
    throw error;
  } finally {
    // Retain the actual failed boundary as well as successful run evidence.
    const states = await Promise.all(allPages.map(async page => {
      try { return await page.evaluate(async model => {
        const cache = [];
        try {
          const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('reploid-chat-artifacts-v1');
          const metadata = new Set(model.source.files.map(file => file.hashAlgorithm + '-' + file.hash));
          for await (const [name, handle] of directory.entries()) if (handle.kind === 'file') {
            const entry = { name, stage: 'getFile' }; cache.push(entry);
            try {
              const file = await handle.getFile(); entry.bytes = file.size;
              if (metadata.has(name)) {
                entry.stage = 'arrayBuffer'; entry.readBytes = (await file.arrayBuffer()).byteLength;
              }
              entry.stage = 'readable';
            } catch (error) { entry.exception = { name: error.name, message: error.message }; }
          }
        } catch (error) { cache.push({ stage: 'directory', exception: { name: error.name, message: error.message } }); }
        return {
        history: JSON.parse(localStorage.getItem('reploid.chat-workspace:v1')),
        error: document.querySelector('[data-network-message]')?.textContent,
        contribution: document.querySelector('[data-contrib-label]')?.textContent,
        fileContribution: document.querySelector('[data-file-contribution-label]')?.textContent,
        progress: document.querySelector('[data-contribution-progress]')?.textContent,
        storage: await navigator.storage.estimate(), cache
      }; }, model); } catch (error) { return { diagnosticsError: error.message }; }
    }));
    if (reference && states[0]?.history) {
      let evidence;
      try {
        const comparison = compareObservedLogits(observations, states[0].history, reference, 0.001);
        evidence = { expectedSteps: reference.expected.reduce((sum, item) => sum + item.steps.length, 0),
          observedSteps: comparison.length, comparison,
          scope: 'Retained even when a later lifecycle check fails; incomplete observation is not qualification.' };
      } catch (error) { evidence = { error: error.message, qualified: false }; }
      await info.attach('numerical-at-exit.json', { contentType: 'application/json', body: JSON.stringify(evidence, null, 2) });
    }
    const stateAtExit = JSON.stringify({
      executorQuotaMiB, seedObservation,
      physicalDevices: remote ? 2 : 1, browserContexts: contexts.length,
      applicationProfiles: { mac: process.platform === 'darwin' ? 'ordinary' : 'private', linux: process.env.REPLOID_EXECUTOR_CDP === '1' ? 'ordinary' : 'private' },
      adapterInfo, browser: browser.version(), modelIdentity: model.identity,
      states, replicaObservation, observations: observations.map(({ steps, ...device }) => ({ ...device, steps: steps.map(({ logits, ...step }) => step) })), requesterWeights, contributorOrigins, seedFiles, errors
    }, null, 2);
    await writeFile(info.outputPath('state-at-exit.json'), stateAtExit);
    await info.attach('state-at-exit.json', { contentType: 'application/json', body: stateAtExit });
    // Save the original failure first; independent diagnostics must not delay it.
    await runCapacityControls();
    await writeFile(info.outputPath('capacity-controls.json'), JSON.stringify(standaloneDenials, null, 2));
    await Promise.all(contexts.map(context => context.close()));
    await Promise.all(profiles.map(profile => rm(profile, { recursive: true, force: true })));
    await remote?.close();
  }
});
