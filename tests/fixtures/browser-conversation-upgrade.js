/** Read the deployed serializer in an isolated browser and restore only synthetic
 * conversation data in the candidate UI. No inference or user-profile access. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const sourceUrl = process.env.REPLOID_UPGRADE_FROM;
const targetUrl = process.env.REPLOID_E2E_BASE_URL;
const output = process.env.REPLOID_CAPTURE_OUT;
assert(sourceUrl && targetUrl && output, 'Source, candidate URL and output are required');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const receipt = { scope: 'Synthetic saved conversation and draft across actual old/new host serializers; no inference',
  source: null, target: null, completed: false };
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(sourceUrl);
  receipt.source = await page.evaluate(async () => ({
    package: await (await fetch('/config/doppler-package.json')).json(),
    bundle: (await (await fetch('/config/browser-bundle-manifest.json')).json()).bundleHash
  }));
  const saved = await page.evaluate(async () => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    const { createChatSession, CANONICAL_CHAT_MODELS } = await import('/host/chat-session.js');
    const service = { async open({ source }) {
      return { loaded: true, modelId: source, manifestHash: CANONICAL_CHAT_MODELS[0].identity.slice(7),
        resetGenerationState() {}, async *stream() { yield { type: 'text-delta', text: 'Synthetic saved answer.' }; } };
    }, async close() {} };
    const session = createChatSession({ service, storage: localStorage });
    const id = session.createThread({ model: CANONICAL_CHAT_MODELS[0], sharingScope: 'local', purpose: 'Upgrade check' });
    const answer = await session.send(id, 'Synthetic saved question.');
    if (answer.status !== 'completed') throw Error(answer.error);
    session.saveDraft(id, { text: 'Synthetic follow-up draft.', files: [{ name: 'notes.txt', text: 'Saved attachment.' }] });
    await session.close();
    return { id, storage: Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('reploid.chat-workspace:v1'))) };
  });
  await page.goto(targetUrl);
  receipt.target = await page.evaluate(async () => ({
    package: await (await fetch('/config/doppler-package.json')).json(),
    bundle: (await (await fetch('/config/browser-bundle-manifest.json')).json()).bundleHash
  }));
  assert.equal(receipt.source.package.version, '0.6.11');
  assert.equal(receipt.target.package.version, '0.6.21');
  await page.evaluate(storage => {
    for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
  }, saved.storage);
  await page.reload();
  await page.locator('[data-open-threads]').click();
  await page.locator(`[data-thread-item-id="${saved.id}"]`).click();
  assert.match(await page.locator('[data-message-stream]').innerText(), /Synthetic saved question\./);
  assert.match(await page.locator('[data-message-stream]').innerText(), /Synthetic saved answer\./);
  assert.equal(await page.locator('[data-composer-input]').inputValue(), 'Synthetic follow-up draft.');
  assert.match(await page.locator('[data-attachments-preview]').innerText(), /notes\.txt/);
  receipt.completed = true;
  receipt.checks = ['saved question', 'completed answer', 'selected thread', 'draft', 'draft attachment'];
} catch (error) { receipt.failure = error.message; process.exitCode = 1; }
finally { await browser.close(); await writeFile(output, JSON.stringify(receipt, null, 2) + '\n'); }
console.log(JSON.stringify({ completed: receipt.completed, failure: receipt.failure }));
