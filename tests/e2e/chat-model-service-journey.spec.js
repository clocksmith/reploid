import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { readChatWorkspace } from '../fixtures/chat-workspace-history.js';

// This campaign owns its contributor process and private room. Never stop an
// operator's existing provider to simulate departure.
const configFile = process.env.REPLOID_SERVICE_CAMPAIGN;
test('exact whole-model service survives overlap, cancellation and provider departure', async ({ browser }, info) => {
  test.skip(!configFile, 'Provide a bounded, isolated REPLOID_SERVICE_CAMPAIGN');
  test.setTimeout(600000);
  const config = JSON.parse(await readFile(configFile, 'utf8'));
  expect(config.schema).toBe('reploid.whole-model-service-campaign/v1');
  expect(config.maxConcurrentRequests).toBe(2);
  const model = JSON.parse(await readFile('self/config/chat-models.json', 'utf8')).find(row => row.id === config.modelId);
  expect(model).toBeTruthy();
  const tokenFile = path.join(config.stateDirectory, 'room-token');
  const url = new URL(config.baseUrl);
  url.searchParams.set('swarm', config.room);
  url.searchParams.set('swarmToken', (await readFile(tokenFile, 'utf8')).trim());
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const receipt = { config, modelIdentity: model.identity, browser: browser.version(), at: new Date().toISOString(),
    passed: false, observations: [], providerStarts: [], weightRequests: [], pageErrors: [], permissionDialogs: [] };
  let provider, providerLog = '', providerIdentity;
  const startProvider = async () => {
    const args = [config.participantEntry, '--contribute', '--execution-mode', 'whole-model', '--model', model.id,
      '--model-directory', config.modelDirectory, '--identity-file', path.join(config.stateDirectory, 'identity.json'),
      '--rtc-module', '@roamhq/wrtc', '--ws-module', 'ws', '--gpu-module', 'webgpu',
      '--room', config.room, '--room-token-file', tokenFile,
      '--origin', config.baseUrl, '--signaling-url', config.baseUrl.replace(/^http/, 'ws') + '/swarm'];
    provider = spawn(process.execPath, args, { cwd: path.dirname(config.participantEntry), stdio: ['ignore', 'pipe', 'pipe'] });
    const child = provider;
    child.stdout.on('data', bytes => { providerLog += bytes; });
    child.stderr.on('data', bytes => { providerLog += bytes; });
    child.on('error', error => { providerLog += '\n' + error.stack; });
    receipt.providerStarts.push({ pid: child.pid, at: new Date().toISOString() });
    await expect.poll(async () => {
      if (child.exitCode !== null) throw new Error('Owned contributor exited: ' + providerLog.slice(-3000));
      try { providerIdentity = JSON.parse(await readFile(path.join(config.stateDirectory, 'identity.json'), 'utf8')).peerId; }
      catch { return false; }
      return true;
    }).toBe(true);
  };
  const stopProvider = async signal => {
    const child = provider;
    provider = null;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill(signal);
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15000);
    try { await exited; } finally { clearTimeout(timeout); }
  };
  const thread = async page => (await readChatWorkspace(page))?.threads.at(-1);
  const approve = async page => {
    const allow = page.locator('[data-remote-permission-allow]');
    if (await allow.isVisible()) {
      receipt.permissionDialogs.push(await page.locator('[data-remote-permission]').innerText());
      await allow.click();
    }
  };
  const send = async (page, prompt) => {
    await page.locator('[data-composer-input]').fill(prompt);
    await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 60000 });
    const before = new Set((await readChatWorkspace(page))?.threads.flatMap(item => item.attempts.map(attempt => attempt.id)) ?? []);
    const row = { page: pages.indexOf(page), prompt, started: performance.now(), firstOutputMs: null,
      firstExecutionMs: null, elapsedMs: null, statuses: [], attempt: null };
    receipt.observations.push(row);
    await page.locator('[data-composer-send]').click();
    await expect.poll(async () => {
      await approve(page);
      const workspace = await readChatWorkspace(page);
      for (const current of workspace?.threads ?? []) {
        const attempt = current.attempts.find(item => !before.has(item.id));
        if (attempt) { row.threadId = current.id; row.attemptId = attempt.id; return true; }
      }
      return false;
    }).toBe(true);
    console.log('Service request admitted', row.page, row.prompt);
    return row;
  };
  const observe = async row => {
    const current = (await readChatWorkspace(pages[row.page])).threads.find(item => item.id === row.threadId);
    const attempt = current.attempts.find(item => item.id === row.attemptId);
    const answer = current.messages.find(item => item.id === attempt.responseId)?.content ?? '';
    if (row.statuses.at(-1)?.status !== attempt.status) row.statuses.push({ status: attempt.status, elapsedMs: performance.now() - row.started });
    if (answer && row.firstOutputMs === null) row.firstOutputMs = performance.now() - row.started;
    if (attempt.execution && row.firstExecutionMs === null) row.firstExecutionMs = performance.now() - row.started;
    row.attempt = attempt; row.answer = answer;
    return attempt.status;
  };
  const complete = async (row, expected) => {
    await expect.poll(async () => {
      const status = await observe(row);
      if (['failed', 'interrupted', 'cancelled'].includes(status)) throw new Error(JSON.stringify(row.attempt));
      return status;
    }, { timeout: 120000, intervals: [100] }).toBe('completed');
    row.elapsedMs = performance.now() - row.started;
    expect(row.attempt.execution).toMatchObject({ placement: 'peer-whole-request', modelId: model.id, modelIdentity: model.identity });
    expect(row.attempt.authorization.recipients).toContain(providerIdentity);
    if (expected !== undefined) expect(row.answer.trim()).toBe(expected);
  };
  try {
    await startProvider();
    for (const page of pages) {
      page.on('pageerror', error => receipt.pageErrors.push(error.message));
      page.on('request', request => { if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) receipt.weightRequests.push(new URL(request.url()).pathname); });
      await page.goto(url.href);
      await page.locator('[data-chat-workspace]').waitFor();
      await page.locator('[data-open-model]').click();
      await page.locator(`.chat-model-choices input[value="${model.id}"]`).filter({ visible: true }).check();
      await page.locator('[data-close-inspector]').click();
      await page.locator('[data-inspector-section="settings"]').click();
      const permission = page.locator('[data-remote-answers-toggle]');
      if (await permission.getAttribute('aria-checked') === 'true') await permission.click();
      await page.locator('[data-close-inspector]').click();
      await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 120000 });
    }
    const [a, b] = pages;
    await complete(await send(a, 'What is 17 + 25? Answer with the number only.'), '42');
    await complete(await send(a, 'Subtract 2 from that result. Answer with the number only.'), '40');
    const beforeReload = await readChatWorkspace(a);
    await a.reload(); await a.locator('[data-chat-workspace]').waitFor();
    expect((await readChatWorkspace(a)).threads).toEqual(beforeReload.threads);
    await a.locator(`[data-thread-item-id="${beforeReload.threads.at(-1).id}"]`).click();

    // Both independent conversations are outstanding at once. One ready model
    // may serialize execution; cancellation must release the queued request.
    const cancelled = await send(a, 'Count from one to one hundred, one number per line.');
    await expect.poll(async () => { await observe(cancelled); return cancelled.firstOutputMs !== null; }, { timeout: 90000, intervals: [100] }).toBe(true);
    const unrelated = await send(b, 'What is 9 times 7? Answer with the number only.');
    expect(await observe(cancelled)).not.toBe('completed');
    await observe(unrelated);
    await a.locator('[data-composer-stop]').click();
    await expect.poll(() => observe(cancelled), { timeout: 30000 }).toBe('cancelled');
    cancelled.elapsedMs = performance.now() - cancelled.started;
    await complete(unrelated, '63');
    const unrelatedHistory = await readChatWorkspace(b);
    await complete(await send(a, 'What is 6 times 7? Answer with the number only.'), '42');

    const interrupted = await send(a, 'Count from one to one hundred, one number per line.');
    await expect.poll(async () => { await observe(interrupted); return interrupted.firstOutputMs !== null; }, { timeout: 90000, intervals: [100] }).toBe(true);
    await stopProvider('SIGKILL');
    await expect.poll(() => observe(interrupted), { timeout: 60000 }).toMatch(/failed|interrupted/);
    interrupted.elapsedMs = performance.now() - interrupted.started;
    const partial = interrupted.answer;
    await startProvider();
    const retry = a.locator(`[data-retry-attempt="${interrupted.attemptId}"]`);
    await expect(retry).toBeEnabled({ timeout: 120000 });
    const restarted = { ...interrupted, started: performance.now(), statuses: [], firstOutputMs: null, firstExecutionMs: null, elapsedMs: null, attempt: null };
    await retry.click();
    await expect.poll(async () => { await approve(a); return (await thread(a)).attempts.at(-1).id; }).not.toBe(interrupted.attemptId);
    restarted.attemptId = (await thread(a)).attempts.at(-1).id;
    receipt.observations.push(restarted);
    await complete(restarted);
    expect(restarted.attempt.retryOf).toBe(interrupted.attemptId);
    const history = await readChatWorkspace(a);
    const preserved = history.threads.find(item => item.id === interrupted.threadId).messages.find(item => item.id === interrupted.attempt.responseId);
    expect(preserved.content).toBe(partial);
    expect((await readChatWorkspace(b)).threads).toEqual(unrelatedHistory.threads);
    await a.reload(); await a.locator('[data-chat-workspace]').waitFor();
    expect((await readChatWorkspace(a)).threads).toEqual(history.threads);
    expect(receipt.permissionDialogs.length).toBeGreaterThanOrEqual(2);
    expect(receipt.weightRequests).toEqual([]); expect(receipt.pageErrors).toEqual([]);
    receipt.passed = true;
  } finally {
    receipt.histories = await Promise.all(pages.map(page => readChatWorkspace(page).catch(() => null)));
    await stopProvider('SIGTERM');
    await writeFile(info.outputPath('provider.log'), providerLog);
    await writeFile(info.outputPath('service-journey.json'), JSON.stringify(receipt, null, 2));
    await info.attach('service-journey', { contentType: 'application/json', path: info.outputPath('service-journey.json') });
    await Promise.all(contexts.map(context => context.close()));
  }
});
