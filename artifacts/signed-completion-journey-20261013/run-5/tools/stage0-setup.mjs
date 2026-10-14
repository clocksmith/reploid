// Run-5 operator setup of the mac-host stage 0 browser contributor through the application's own
// surfaces: the instance storage key reploid.ordered-stage.v1 (self/host/product-context.js:11-22,
// written with getCurrentReploidStorage, self/instance.js:268) and the existing "Help answer requests"
// control (self/ui/pool-home/network-controls.js:163-167). Observation reuses the harness's read-only
// observe.mjs. The room capability is navigated over CDP, never placed on a command line, and never logged.
// Usage: node stage0-setup.mjs <cdp endpoint> <origin> <room file> <stage json> <instance id> <progress jsonl> <receipt json>
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { observeChat, observeNetwork, observeOrderedParticipation } from '../../observe.mjs';
import { SELECTORS, appUrl, openDevicePane, sleep } from '../../harness.mjs';

const [endpoint, origin, roomFile, stageFile, instanceId, progressPath, receiptPath] = process.argv.slice(2);
const room = JSON.parse(await fs.readFile(roomFile, 'utf8'));
const stage = JSON.parse(await fs.readFile(stageFile, 'utf8'));
const redact = text => String(text).replaceAll(room.token, '[REDACTED]');
const progress = await fs.open(progressPath, 'wx');
const record = async row => progress.write(redact(JSON.stringify({ at: new Date().toISOString(), ...row })) + '\n');
const receipt = { schema: 'reploid.run-5-stage0-setup/v1', machine: 'mac-host', instanceId, stage, startedAt: new Date().toISOString() };
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
  const url = new URL(appUrl(origin, room, null)); url.searchParams.set('instance', instanceId);
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.locator(SELECTORS.composerInput).waitFor({ timeout: 120000 });
  receipt.gpu = await page.evaluate(async () => {
    const adapter = await navigator.gpu?.requestAdapter();
    return adapter ? { available: true, isFallbackAdapter: adapter.isFallbackAdapter ?? null,
      info: adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description } : null } : { available: false };
  });
  if (!receipt.gpu.available) throw Error('WebGPU adapter unavailable in the stage 0 browser');
  receipt.participationBefore = await observeOrderedParticipation(page);
  await page.evaluate(async ([key, value]) => {
    const { getCurrentReploidStorage } = await import('/instance.js');
    getCurrentReploidStorage().setItem(key, value);
  }, ['reploid.ordered-stage.v1', JSON.stringify(stage)]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator(SELECTORS.composerInput).waitFor({ timeout: 120000 });
  receipt.participationAfter = await observeOrderedParticipation(page);
  if (receipt.participationAfter?.stage?.index !== stage.index) throw Error('Operator stage assignment not active after reload');
  receipt.instanceIdObserved = (await observeChat(page)).instanceId;
  await openDevicePane(page);
  await page.locator(SELECTORS.contributionModel).selectOption(stage.modelId);
  receipt.contributionToggleBefore = await page.locator('[data-toggle-contribution]').getAttribute('aria-checked');
  receipt.contributionClickedAt = new Date().toISOString();
  await page.locator('[data-toggle-contribution]').click();
  const deadline = Date.now() + Number(process.env.STAGE0_READY_MS || 1500000);
  let last = '';
  for (;;) {
    const network = await observeNetwork(page);
    const c = network.contribution || {};
    const key = JSON.stringify([c.phase, c.error, c.progress?.message, c.progress?.loaded]);
    if (key !== last) { last = key; await record({ phase: c.phase, error: c.error, progress: c.progress, unsettledOwners: c.unsettledOwners, placement: c.placement }); }
    if (c.phase === 'ready' || c.phase === 'failed' || Date.now() > deadline) {
      receipt.final = { phase: c.phase, error: c.error, offering: c.offering, unsettledOwners: c.unsettledOwners, placement: c.placement,
        placementDecision: c.placementDecision ? { reason: c.placementDecision.reason, route: c.placementDecision.route } : null,
        descriptor: c.descriptor, reservations: c.reservations, acquisition: c.acquisition, consumerPeerId: network.consumerPeerId,
        modelIds: (c.models || []).map(model => ({ id: model.id, availability: model.availability, partition: model.partition ? { planId: model.partition.planId, route: model.partition.route } : null })) };
      break;
    }
    await sleep(2000);
  }
  receipt.readyAt = receipt.final.phase === 'ready' ? new Date().toISOString() : null;
} catch (error) {
  receipt.failure = redact(error.stack || error);
} finally {
  receipt.finishedAt = new Date().toISOString();
  await fs.writeFile(receiptPath, redact(JSON.stringify(receipt, null, 1)), { flag: 'wx' });
  await progress.close();
  // Disconnect only; the stage 0 contributor keeps running in its own browser process.
  await browser.close();
  console.log(JSON.stringify({ phase: receipt.final?.phase, error: receipt.final?.error, failure: receipt.failure?.split('\n')[0] }));
}
