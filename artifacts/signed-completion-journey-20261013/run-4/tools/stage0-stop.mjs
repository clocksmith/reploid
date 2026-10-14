// Run-4 settlement of the stage 0 browser contributor: switch "Help answer requests" off through the
// application's own control (network-controls.js:163-167 -> session.setSharing(false)), observe the host
// owner until it settles, then close the browser through CDP Browser.close.
// Usage: node stage0-stop.mjs <cdp endpoint> <origin> <receipt json>
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { observeNetwork } from '../../observe.mjs';
import { findPage, openDevicePane, sleep } from '../../harness.mjs';

const [endpoint, origin, receiptPath] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
const receipt = { schema: 'reploid.run-4-stage0-stop/v1', machine: 'mac-host', samples: [] };
const sample = async page => { const c = (await observeNetwork(page)).contribution || {};
  const row = { at: new Date().toISOString(), phase: c.phase, error: c.error, offering: c.offering, unsettledOwners: c.unsettledOwners,
    descriptor: c.descriptor ? 'present' : null, attempts: (c.attempts || []).map(a => ({ attemptId: a?.identity?.attemptId, phase: a?.phase })) };
  receipt.samples.push(row); return row; };
try {
  const page = findPage(browser, origin);
  receipt.before = await sample(page);
  await openDevicePane(page);
  receipt.toggleBefore = await page.locator('[data-toggle-contribution]').getAttribute('aria-checked');
  receipt.clickedAt = new Date().toISOString();
  if (receipt.toggleBefore === 'true') await page.locator('[data-toggle-contribution]').click();
  const deadline = Date.now() + 120000;
  let row;
  do { await sleep(1000); row = await sample(page); } while (!(row.phase === 'idle' && row.unsettledOwners === 0 && !row.offering) && Date.now() < deadline);
  receipt.after = row; receipt.settled = row.phase === 'idle' && row.unsettledOwners === 0 && !row.offering;
  const cdp = await browser.newBrowserCDPSession();
  receipt.browserCloseAt = new Date().toISOString();
  await cdp.send('Browser.close').catch(error => { receipt.browserCloseError = error.message; });
} catch (error) { receipt.failure = String(error.stack || error); }
finally {
  await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 1), { flag: 'wx' });
  await browser.close().catch(() => {});
  console.log(JSON.stringify({ settled: receipt.settled, before: receipt.before?.phase, after: receipt.after, failure: receipt.failure?.split('\n')[0] }));
}
