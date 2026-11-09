// Opt-in, real hosted requester/provider check. Sends only synthetic test text.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { readChatWorkspace } from './chat-workspace-history.js';

const [url, output] = process.argv.slice(2);
assert(url && output && process.env.REPLOID_CONTEXT_PHYSICAL === '1', 'Explicit URL, receipt and physical opt-in required');
const modelId = 'qwen3-8-27b-text-q4k-ehaf16';
const catalog = JSON.parse(await fs.readFile(new URL('../../shared/config/chat-models.json', import.meta.url)));
const expectedIdentity = catalog.find(model => model.id === modelId)?.identity;
assert(expectedIdentity, 'The exact test model must exist in the catalog');
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext();
const page = await context.newPage();
const receipt = { schema: 'reploid.generation-context-hosted/v1', at: new Date().toISOString(), url,
  browser: browser.version(), passed: false, cases: [], pageErrors: [], weightRequests: [] };
page.on('pageerror', error => receipt.pageErrors.push(error.message));
page.on('request', request => {
  if (/shard_\d+\.bin|tokenizer\.json/.test(request.url())) receipt.weightRequests.push(new URL(request.url()).pathname);
});
const latest = async () => (await readChatWorkspace(page))?.threads.at(-1);
const send = async prompt => {
  const before = (await latest())?.attempts.length || 0;
  await page.locator('[data-composer-input]').fill(prompt);
  await expect(page.locator('[data-composer-send]')).toBeEnabled({ timeout: 90000 });
  await page.locator('[data-composer-send]').click();
  await expect.poll(async () => (await latest())?.attempts.length, { timeout: 20000 }).toBe(before + 1);
};
const complete = async kind => {
  await expect.poll(async () => {
    const attempt = (await latest())?.attempts.at(-1);
    if (['failed', 'interrupted', 'cancelled'].includes(attempt?.status)) throw Error(JSON.stringify(attempt));
    return attempt?.status;
  }, { timeout: 120000, intervals: [200] }).toBe('completed');
  const thread = await latest(), attempt = thread.attempts.at(-1);
  assert.equal(attempt.execution?.modelId, modelId);
  assert.equal(attempt.execution?.modelIdentity, expectedIdentity);
  assert.equal(attempt.execution?.placement, 'peer-whole-request');
  const answer = thread.messages.find(message => message.id === attempt.responseId)?.content;
  const row = { kind, answer, execution: attempt.execution };
  receipt.cases.push(row);
  return row;
};
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.locator('[data-chat-workspace]').waitFor();
  await page.locator('[data-open-model]').click();
  const choice = page.locator(`[data-model-picker] .chat-model-choices input[value="${modelId}"]`).filter({ visible: true });
  await expect(choice).toBeVisible({ timeout: 90000 });
  await choice.click();
  await expect(page.locator('[data-change-model]')).toBeEnabled({ timeout: 90000 });
  await page.locator('[data-change-model]').click();
  await page.locator('[data-inspector-section="settings"]').click();
  const advanced = page.locator('[data-settings-advanced]');
  if (!await advanced.evaluate(node => node.open)) await advanced.locator(':scope > summary').click();
  const permission = page.locator('[data-remote-answers-toggle]');
  if (await permission.getAttribute('aria-checked') !== 'true') await permission.click();
  await page.locator('[data-close-inspector]').click();
  await send('Remember these colors: ' + Array(20).fill('red green blue').join(' ') + '. Name the first color. Reply with only the color.');
  const first = await complete('initial');
  assert.match(first.answer.toLowerCase(), /red/);
  assert.equal(first.execution.timing.reusedPrefixTokens, 0);
  await send('Name the last color. Reply with only the color.');
  const followup = await complete('followup');
  assert.match(followup.answer.toLowerCase(), /blue/);
  assert(followup.execution.timing.reusedPrefixTokens >= 64, 'Real peer follow-up must reuse the prompt prefix');
  const history = await latest();
  await page.reload();
  await page.locator('[data-chat-workspace]').waitFor();
  assert.deepEqual(await latest(), history);
  receipt.historyPreserved = true;
  await send('Count from one to one hundred, one number per line.');
  await expect.poll(async () => {
    const thread = await latest(), attempt = thread?.attempts.at(-1);
    return !!thread?.messages.find(message => message.id === attempt?.responseId)?.content;
  }, { timeout: 90000 }).toBe(true);
  await page.locator('[data-answer-stop]:visible, [data-composer-stop]:visible').first().click();
  await expect.poll(async () => (await latest())?.attempts.at(-1)?.status, { timeout: 30000 }).toBe('cancelled');
  receipt.cancelled = true;
  await send('What is 6 times 7? Answer with the number only.');
  const recovered = await complete('after-cancel');
  assert.equal(recovered.answer.trim(), '42');
  assert.equal(recovered.execution.timing.reusedPrefixTokens, 0);
  assert.deepEqual(receipt.weightRequests, []);
  assert.deepEqual(receipt.pageErrors, []);
  receipt.passed = true;
} catch (error) { receipt.failure = String(error); process.exitCode = 1; }
finally {
  await browser.close();
  await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ passed: receipt.passed, failure: receipt.failure }));
}
