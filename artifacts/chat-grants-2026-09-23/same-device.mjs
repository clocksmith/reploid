import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const output = new URL('./same-device.json', import.meta.url);
const evidence = { executionClass: 'same-device-real-model-real-webrtc', physicalDevices: 1, startedAt: new Date().toISOString(), errors: [], requesterModelRequests: 0, contributorModelRequests: 0 };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'] });
const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
const [supplier, requester] = await Promise.all(contexts.map(c => c.newPage()));
const sourceFiles = ['self/config/chat-models.json', 'self/config/doppler-local-models.js', 'self/host/work-swarm.js', 'self/host/chat-session.js', 'self/providers/work-provider.js',
  'self/providers/work-network-provider.js', 'self/providers/work-resident-provider.js', 'self/providers/work-device.js',
  'self/vendor/reploid/chat/workspace.js', 'self/vendor/reploid/chat/thread-grants.js',
  'self/vendor/reploid/mesh/peer-identity.js', 'self/vendor/reploid/transport/room.js', 'self/vendor/reploid/transport/swarm.js',
  'self/vendor/reploid/mesh/remote-generation-requests.js', 'self/vendor/reploid/mesh/legacy-generation.js', 'self/ui/pool-home/conversation-workspace.js'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path,
  createHash('sha256').update(await readFile(path)).digest('hex')])));
evidence.sourceHashes = await sourceHashes();
evidence.observation = 'Runtime service open/close calls are counted by a transparent module wrapper; all loads and inference delegate to the unchanged runtime.';
const save = () => writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
const history = page => page.evaluate(() => Object.keys(localStorage).map(key => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }).find(value => value?.schema === 'reploid.chat-workspace/v1'));
async function poll(label, fn, limit = 60000) {
  const start = Date.now(); let logged = 0;
  while (Date.now() - start < limit) {
    const result = await fn(); if (result) return result;
    if (Date.now() - logged > 10000) { console.log(label, Math.round((Date.now() - start) / 1000)); logged = Date.now(); }
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Timed out: ' + label);
}
async function submit(content) {
  await requester.locator('[data-new-thread]').click();
  await requester.locator('[data-composer-input]').fill(content);
  await requester.locator('[data-composer-input]').press('Enter');
  await requester.locator('[data-chat-approval]').waitFor({ state: 'visible', timeout: 60000 });
  await requester.locator('[data-approval-consent]').check();
  await requester.locator('[data-approval-send]').click();
  return (await history(requester)).threads.at(-1).id;
}
const currentThread = async id => (await history(requester))?.threads.find(thread => thread.id === id);
const streaming = id => poll('real stream started', async () => (await currentThread(id))?.messages.at(-1).content.length > 0);

try {
  for (const [index, page] of [supplier, requester].entries()) {
    await page.addInitScript(() => { window.residencyProbe = { opens: [], closes: [], runs: [] }; });
    await page.route('**/infrastructure/doppler-runtime-service.js', async route => {
      const original = await readFile('self/infrastructure/doppler-runtime-service.js', 'utf8');
      const body = original.replace('    open,', `    open: async (...args) => {
        window.residencyProbe.opens.push({ scope: args[0].scope, source: args[0].source });
        const session = await open(...args);
        return new Proxy(session, { get(target, key) {
          if (key === 'stream') return (...input) => {
            window.residencyProbe.runs.push({ messages: structuredClone(input[0]), modelId: target.modelId, manifestHash: target.manifestHash });
            return target.stream(...input);
          };
          const value = Reflect.get(target, key, target);
          return typeof value === 'function' ? value.bind(target) : value;
        } });
      },`).replace('    close,', `    close: (...args) => {
        window.residencyProbe.closes.push(args[0]); return close(...args);
      },`);
      await route.fulfill({ contentType: 'text/javascript', body });
    });
    page.on('pageerror', error => evidence.errors.push({ index, error: error.message }));
    page.on('request', request => { if (/huggingface|hf\.co|xethub/.test(request.url())) evidence[index === 0 ? 'contributorModelRequests' : 'requesterModelRequests']++; });
    await page.goto('http://localhost:8000/');
    await page.locator('[data-chat-workspace]').waitFor();
  }
  evidence.adapter = await supplier.evaluate(async () => { const a = await navigator.gpu.requestAdapter(); return { vendor: a.info.vendor, architecture: a.info.architecture, device: a.info.device, description: a.info.description, fallback: a.info.isFallbackAdapter }; });
  console.log('adapter', evidence.adapter);
  await poll('peer discovery', async () => /[1-9]/.test(await requester.locator('[data-mesh-peers]').innerText()));
  await supplier.locator('[data-toggle-inspector]').click();
  await supplier.locator('summary').filter({ hasText: 'Contribution' }).click();
  await supplier.locator('[data-contribution-consent]').check();
  await supplier.locator('[data-toggle-contribution]').click();
  const loadStart = Date.now();
  await poll('model preparation', async () => {
    const label = await supplier.locator('[data-contrib-label]').innerText();
    const error = await supplier.locator('[data-chat-error]').textContent();
    if (error) throw new Error(error);
    return label === 'Ready';
  }, 600000);
  evidence.loadMs = Date.now() - loadStart;
  evidence.preparedProbe = await supplier.evaluate(() => window.residencyProbe);
  evidence.requestsAfterPreparation = evidence.contributorModelRequests;
  evidence.catalog = await requester.locator('[data-active-model-select]').innerText();
  await save(); console.log('ready', evidence.loadMs, evidence.catalog);
  for (const word of ['ALPHA', 'BETA']) {
    if (word === 'BETA') await requester.locator('[data-new-thread]').click();
    await requester.locator('[data-composer-input]').fill('Reply with exactly the word ' + word + '. Do not explain. /no_think');
    await requester.locator('[data-composer-input]').press('Enter');
    await requester.locator('[data-chat-approval]').waitFor({ state: 'visible', timeout: 60000 });
    await requester.locator('[data-approval-consent]').check();
    if (word === 'ALPHA') await requester.locator('[data-approval-remember]').check();
    await requester.locator('[data-approval-send]').click();
  }
  evidence.history = await poll('two completions', async () => {
    const state = await history(requester);
    if (!state || state.threads.length !== 2) return false;
    const attempts = state.threads.map(t => t.attempts.at(-1));
    if (attempts.some(a => ['failed', 'cancelled'].includes(a.status))) { evidence.history = state; throw new Error(attempts.map(a => a.error).filter(Boolean).join('; ')); }
    return attempts.every(a => a.status === 'completed') && state;
  }, 120000);
  evidence.completedProbe = await supplier.evaluate(() => window.residencyProbe);
  evidence.requestsAfterGeneration = evidence.contributorModelRequests;
  const [first, second] = evidence.history.threads.map(thread => thread.attempts[0]);
  evidence.overlappingAttempts = second.createdAt < first.finishedAt;
  evidence.exactResponses = evidence.history.threads.map(t => t.messages.at(-1).content).join(',') === 'ALPHA,BETA';
  evidence.beforeReload = evidence.history;
  await requester.reload(); await requester.locator('[data-chat-workspace]').waitFor();
  evidence.afterReload = await history(requester);
  evidence.ok = evidence.requesterModelRequests === 0 && evidence.overlappingAttempts && evidence.exactResponses
    && evidence.completedProbe.opens.length === 1 && evidence.completedProbe.closes.length === 0
    && evidence.requestsAfterGeneration === evidence.requestsAfterPreparation && JSON.stringify(evidence.beforeReload.threads) === JSON.stringify(evidence.afterReload.threads);
  await requester.locator('[data-thread-item-id]').first().click();
  const grantedThreadId = evidence.history.threads[0].id;
  await requester.locator('[data-composer-input]').fill('Reply with exactly the word DELTA. Do not explain. /no_think');
  await requester.locator('[data-composer-input]').press('Enter');
  evidence.grantedFollowup = await poll('remembered grant after refresh', async () => {
    const thread = await currentThread(grantedThreadId), attempt = thread?.attempts.at(-1);
    if (attempt?.status === 'approval' || attempt?.status === 'failed') throw new Error('Remembered grant did not authorize the same recipient: ' + attempt.status);
    return attempt?.status === 'completed' && thread;
  });
  evidence.ok &&= evidence.grantedFollowup.messages.at(-1).content === 'DELTA'
    && evidence.grantedFollowup.attempts.at(-1).authorization.kind === 'thread-grant';
  await requester.locator('[data-toggle-inspector]').click();
  await requester.locator('[data-thread-permissions] summary').click();
  await requester.locator('[data-revoke-grant]').click();
  await requester.locator('[data-close-inspector]').click();
  await requester.locator('[data-composer-input]').fill('Reply with exactly the word EPSILON. Do not explain. /no_think');
  await requester.locator('[data-composer-input]').press('Enter');
  await requester.locator('[data-chat-approval]').waitFor({ state: 'visible', timeout: 60000 });
  evidence.revocationRequiredApproval = true;
  await requester.locator('[data-approval-consent]').check();
  await requester.locator('[data-approval-send]').click();
  evidence.afterRevocation = await poll('one-time approval after revocation', async () => {
    const thread = await currentThread(grantedThreadId); return thread?.attempts.at(-1).status === 'completed' && thread;
  });
  evidence.ok &&= evidence.afterRevocation.messages.at(-1).content === 'EPSILON'
    && evidence.afterRevocation.grants[0].revokedAt !== null
    && evidence.afterRevocation.attempts.at(-1).authorization.kind === 'once';
  const cancelledId = await submit('Count every integer from one to one hundred, one per line. Do not skip any. /no_think');
  await streaming(cancelledId);
  await requester.locator('[data-composer-stop]').click();
  evidence.cancelled = await poll('cancel settlement', async () => {
    const thread = await currentThread(cancelledId); return thread?.attempts.at(-1).status === 'cancelled' && thread;
  });
  await poll('resident reusable after cancel', async () => (await supplier.locator('[data-contrib-label]').innerText()) === 'Ready');
  const recoveredId = await submit('Reply with exactly the word GAMMA. Do not explain. /no_think');
  evidence.recovered = await poll('post-cancel generation', async () => {
    const thread = await currentThread(recoveredId);
    if (thread?.attempts.at(-1).status === 'failed') throw new Error(thread.attempts.at(-1).error);
    return thread?.attempts.at(-1).status === 'completed' && thread;
  });
  const reloadId = await submit('Count every integer from one to one hundred, one per line. Do not skip any. /no_think');
  await streaming(reloadId);
  const runsBeforeReload = await supplier.evaluate(() => window.residencyProbe.runs.length);
  await requester.reload(); await requester.locator('[data-chat-workspace]').waitFor();
  evidence.interrupted = await currentThread(reloadId);
  await poll('settlement after requester reload', async () => (await supplier.locator('[data-contrib-label]').innerText()) === 'Ready');
  evidence.noReloadRedispatch = runsBeforeReload === await supplier.evaluate(() => window.residencyProbe.runs.length);
  const lostId = await submit('Count every integer from one to one hundred, one per line. Do not skip any. /no_think');
  await streaming(lostId);
  await supplier.locator('[data-mesh-connect]').click();
  evidence.peerLoss = await poll('peer loss settlement', async () => {
    const thread = await currentThread(lostId); return thread?.attempts.at(-1).status === 'failed' && thread;
  });
  evidence.recoveryProbe = await supplier.evaluate(() => window.residencyProbe);
  evidence.ok &&= evidence.recovered.messages.at(-1).content === 'GAMMA'
    && ['interrupted', 'cancelled'].includes(evidence.interrupted.attempts.at(-1).status)
    && evidence.noReloadRedispatch && evidence.recoveryProbe.opens.length === 1
    && /peer disconnected/.test(evidence.peerLoss.attempts.at(-1).error);
  await requester.screenshot({ path: new URL('./requester.png', import.meta.url).pathname });
} catch (error) {
  evidence.ok = false; evidence.failure = error.message;
  evidence.history ||= await history(requester).catch(() => null);
  evidence.contribution = await supplier.locator('[data-contrib-label]').textContent().catch(() => null);
  evidence.supplierError = await supplier.locator('[data-chat-error]').textContent().catch(() => null);
  console.error(error.message);
} finally {
  if ((await supplier.locator('[data-toggle-contribution]').innerText().catch(() => '')) === 'Stop sharing') {
    await supplier.locator('[data-toggle-contribution]').click({ timeout: 1000 }).catch(() => {});
  }
  await poll('resident cleanup', async () => (await supplier.evaluate(() => window.residencyProbe.closes.length)) === 1).catch(error => { evidence.cleanupError = error.message; evidence.ok = false; });
  evidence.stoppedProbe = await supplier.evaluate(() => window.residencyProbe).catch(() => null);
  evidence.sourceStable = JSON.stringify(evidence.sourceHashes) === JSON.stringify(await sourceHashes());
  evidence.ok &&= evidence.sourceStable;
  evidence.finishedAt = new Date().toISOString(); await save(); await browser.close();
}
console.log(JSON.stringify({ ok: evidence.ok, failure: evidence.failure, loadMs: evidence.loadMs, requesterModelRequests: evidence.requesterModelRequests, contributorModelRequests: evidence.contributorModelRequests }));
process.exitCode = evidence.ok ? 0 : 1;
