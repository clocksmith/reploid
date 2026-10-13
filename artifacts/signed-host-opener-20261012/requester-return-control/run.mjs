import { observeRequesterCustody, observeRequesterChat } from './reploid-requester-custody-observation.mjs';
import { assessReceipt, projectHistory } from './checks.mjs';
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dir = process.env.REPLOID_SIGNED_APP_DIRECTORY;
if (!dir) throw Error('Explicit frozen application directory required');
const room = JSON.parse(await fs.readFile(dir + '/private-test-room.json', 'utf8'));
const url = new URL(process.env.REPLOID_SIGNED_APP_ORIGIN || 'http://127.0.0.1:29670/');
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw Error('Isolated loopback application required');
url.searchParams.set('swarm', room.roomId.replace(/^reploid-swarm-/, '')); url.searchParams.set('swarmToken', room.token);
const freeze = JSON.parse(await fs.readFile(process.env.REPLOID_REQUESTER_FREEZE, 'utf8'));
for (const key of ['nativeArtifact', 'browserBundle', 'runtimeArchive', 'modelIdentity']) {
  if (!/^(sha256:)?[a-f0-9]{64}$/.test(freeze[key] || '')) throw Error('Missing exact freeze identity: ' + key);
}
const mode = process.env.REPLOID_REQUESTER_MODE || 'plain';
if (!['plain', 'ready'].includes(mode)) throw Error('Unknown explicit requester control mode');
const fixtureBytes = await fs.readFile(new URL(mode === 'plain' ? './plain-chat.json' : './ready-control.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes);
const report = { harness: 'v7 existing host state, useful plain chat and verified return', startedAt: new Date().toISOString(),
  scope: fixture.scope, ...freeze, fixtureSha256: createHash('sha256').update(fixtureBytes).digest('hex'),
  mode, questions: fixture.questions, weights: [], errors: [], turns: [], streamSamples: [], returnSamples: [], semanticAcceptance: null };
const reportPath = process.env.REPLOID_REQUESTER_REPORT;
if (!reportPath) throw Error('Explicit new report path required');
try { await fs.access(reportPath); throw Error('Report already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const save = () => fs.writeFile(reportPath, JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--remote-debugging-port=29672'] });
process.on('SIGTERM', () => void browser.close().finally(() => process.exit(143)));
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: url.origin });
const page = await context.newPage();
page.on('request', request => {
  if (/\/(piece-[a-f0-9]+\.bin|shard[^/]*\.(bin|safetensors))(\?|$)/.test(new URL(request.url()).pathname)) report.weights.push(request.url().split('?')[0]);
});
page.on('pageerror', error => report.errors.push(error.message.replaceAll(room.token, '[REDACTED]')));
const state = () => observeRequesterChat(page);
async function waitForOwner(predicate, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const observed = await state(); if (predicate(observed)) return observed; await sleep(100); }
  throw Error('Host owner observation deadline');
}
try {
  const descriptorResponse = await context.request.get(new URL('/config/browser-bundle-manifest.json', url).href);
  if (!descriptorResponse.ok()) throw Error('Browser descriptor unavailable');
  report.servedDescriptor = (await descriptorResponse.json()).bundleHash;
  if (report.servedDescriptor !== 'sha256:' + freeze.browserBundle.replace(/^sha256:/, '')) throw Error('Served bundle differs from freeze');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-model-control][data-activity="ready"]').waitFor({ state: 'attached', timeout: 300000 });
  report.readyAt = new Date().toISOString(); report.custodyBefore = await observeRequesterCustody(page);
  report.initialState = await state();
  if (report.initialState.threads.some(thread => thread.attempts.length)) throw Error('Fresh requester unexpectedly contains attempts');
  for (const question of fixture.questions) {
    const before = await state(); const oldIds = new Set(before.threads.flatMap(thread => thread.attempts.map(attempt => attempt.id)));
    await page.locator('[data-composer-input]').fill(question); await page.locator('[data-composer-send]').click();
    const started = Date.now(); let completed = false, previous = '';
    while (Date.now() - started < 180000) {
      const observed = await state();
      const thread = observed.threads.find(item => item.attempts.some(attempt => !oldIds.has(attempt.id)));
      const attempt = thread?.attempts.at(-1), response = thread?.messages.find(message => message.id === attempt?.responseId);
      if (attempt && response) {
        if (thread.model.identity !== freeze.modelIdentity) throw Error('Discovered model identity differs from freeze');
        const key = JSON.stringify([attempt.id, attempt.status, response.content]);
        if (key !== previous) {
          previous = key;
          const renderedText = await page.evaluate(id => document.querySelector(`[data-message-id="${CSS.escape(id)}"] .chat-message-content`)?.innerText ?? null, response.id);
          report.streamSamples.push({ at: new Date().toISOString(), attemptId: attempt.id, messageId: response.id,
            status: attempt.status, content: response.content, renderedText });
          console.log(JSON.stringify({ phase: attempt.status, characters: response.content.length })); await save();
        }
        if (['completed', 'failed', 'cancelled', 'interrupted'].includes(attempt.status)) {
          report.turns.push(thread); await save();
          if (attempt.status !== 'completed') throw Error(attempt.error || attempt.status);
          completed = true; break;
        }
      }
      await sleep(100);
    }
    if (!completed) throw Error('Request completion deadline; no automatic cancellation/retry or classification as model failure');
    if (report.turns.length === 1) {
      const thread = report.turns[0], response = thread.messages.find(message => message.id === thread.attempts.at(-1).responseId);
      await page.locator(`[data-message-id="${response.id}"] [data-copy-message]`).click();
      const clipboardText = await Promise.race([(async () => {
        const end = Date.now() + 5000;
        while (Date.now() < end) {
          const value = await page.evaluate(() => navigator.clipboard.readText());
          if (value === response.content) return value;
          await sleep(50);
        }
        throw Error('Clipboard differs from stored answer');
      })(), sleep(5000).then(() => { throw Error('Clipboard observation deadline'); })]);
      report.copy = { messageId: response.id, clipboardText }; await save();
    }
  }
  report.custodyAfter = await observeRequesterCustody(page);
  const threadId = report.turns[0].id;
  await page.locator('[data-composer-input]').fill(fixture.draft);
  report.beforeReload = await waitForOwner(observed => observed.drafts[threadId]?.text === fixture.draft);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-composer-input]').waitFor();
  // Returning users choose their existing conversation. Selection is not assumed persistent.
  const threadButton = page.locator(`[data-thread-item-id="${threadId}"]`);
  if (!await threadButton.isVisible()) await page.locator('[data-toggle-thread-rail]').click();
  await threadButton.click();
  await page.locator('[data-model-control][data-activity="ready"]').waitFor({ state: 'attached', timeout: 300000 });
  await waitForOwner(observed => observed.selectedId === threadId && observed.drafts[threadId]?.text === fixture.draft);
  const returnStart = Date.now();
  do {
    const observed = await state(); report.returnSamples.push({ at: new Date().toISOString(), runningIds: observed.runningIds, history: projectHistory(observed) });
    await sleep(250);
  } while (Date.now() - returnStart < fixture.postRediscoveryObservationMs);
  report.returnObservationMs = Date.now() - returnStart;
  report.restoredState = await state(); report.custodyAfterReload = await observeRequesterCustody(page);
  report.restoration = { draft: await page.locator('[data-composer-input]').inputValue() };
  report.assessment = assessReceipt(report, fixture);
  report.ok = false; report.status = report.assessment.lifecycleAndInteractionPass ? 'awaiting independent code and follow-up review' : 'interaction or lifecycle acceptance failed';
} catch (error) {
  report.ok = false; report.failure = String(error.stack || error).replaceAll(room.token, '[REDACTED]');
  report.body = (await page.locator('body').innerText().catch(() => '')).slice(-5000).replaceAll(room.token, '[REDACTED]');
  report.finalState = await state().catch(() => null);
} finally {
  report.requesterClosedWhileActive = Boolean(report.finalState?.runningIds?.length);
  report.remoteSettlementAfterRequesterClose = report.requesterClosedWhileActive ? 'unknown; controller closure is not cleanup evidence' : 'no active attempt observed before close';
  report.finishedAt = new Date().toISOString(); await save(); await context.close(); await browser.close();
  console.log(JSON.stringify({ status: report.status, interactionPass: report.assessment?.lifecycleAndInteractionPass,
    semanticAcceptance: null, turns: report.turns.length, weights: report.weights.length, failure: report.failure?.split('\n')[0] }));
}
