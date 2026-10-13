import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { observeRequesterChat, observeRequesterCustody } from './reploid-requester-custody-observation.mjs';
const target = new URL(process.env.REPLOID_SIGNED_APP_ORIGIN || 'http://127.0.0.1:29670/');
const room = process.env.REPLOID_SIGNED_APP_DIRECTORY ? JSON.parse(await fs.readFile(process.env.REPLOID_SIGNED_APP_DIRECTORY + '/private-test-room.json', 'utf8')) : null;
if (room) { target.searchParams.set('swarm', room.roomId.replace(/^reploid-swarm-/, '')); target.searchParams.set('swarmToken', room.token); }
const origin = target.href;
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname)) throw Error('Isolated origin required');
const out = process.env.REPLOID_OBSERVATION_REPORT;
if (!out) throw Error('Explicit new observation report required');
try { await fs.access(out); throw Error('Report already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
const context = await browser.newContext(), page = await context.newPage();
const report = { scope: 'GPU-disabled host observation and unsent draft only; zero Send/contribution/model invocations requested', startedAt: new Date().toISOString() };
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' }); await page.locator('[data-composer-input]').waitFor();
  report.before = await observeRequesterChat(page); report.custodyBefore = await observeRequesterCustody(page);
  assert.equal(report.before.threads.flatMap(thread => thread.attempts).length, 0);
  const draft = 'Unsent basic-chat observer control'; await page.locator('[data-composer-input]').fill(draft);
  const wait = async predicate => {
    const end = Date.now() + 10000;
    while (Date.now() < end) { const state = await observeRequesterChat(page); if (predicate(state)) return state; await page.waitForTimeout(100); }
    throw Error('Draft observation deadline');
  };
  report.saved = await wait(state => state.drafts.new.text === draft);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-composer-input]').waitFor();
  report.restored = await wait(state => state.drafts.new.text === draft);
  assert.equal(await page.locator('[data-composer-input]').inputValue(), draft);
  assert.equal(report.restored.threads.flatMap(thread => thread.attempts).length, 0);
  report.custodyAfter = await observeRequesterCustody(page);
  assert.equal(report.custodyAfter.state.receivedBytes, 0); assert.equal(report.custodyAfter.receipts.length, 0);
  report.passed = true;
} catch (error) { report.passed = false; report.failure = String(error.stack || error).replaceAll(room?.token || '[NO_ROOM_TOKEN]', '[REDACTED]'); }
finally { report.finishedAt = new Date().toISOString(); await fs.writeFile(out, JSON.stringify(report, null, 2)); await context.close(); await browser.close(); }
console.log(JSON.stringify({ passed: report.passed, mode: report.before?.storageMode, failure: report.failure }));
process.exitCode = report.passed ? 0 : 1;
