// Run-4 settlement after contributor loss: press the application's own "Retry stopping" control
// (network-controls.js:111,169) and record the host owner for up to 120 s. Does not close the browser.
// Usage: node stage0-retry-stop.mjs <cdp endpoint> <origin> <receipt json>
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { observeNetwork } from '../../observe.mjs';
import { findPage, openDevicePane, sleep } from '../../harness.mjs';
const [endpoint, origin, receiptPath] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint), receipt = { schema: 'reploid.run-4-stage0-retry-stop/v1', samples: [] };
const sample = async page => { const c = (await observeNetwork(page)).contribution || {};
  const row = { at: new Date().toISOString(), phase: c.phase, error: c.error, offering: c.offering, unsettledOwners: c.unsettledOwners }; receipt.samples.push(row); return row; };
try {
  const page = findPage(browser, origin); await sample(page); await openDevicePane(page);
  receipt.clickedAt = new Date().toISOString(); await page.locator('[data-retry-contribution-stop]').click({ timeout: 30000 });
  const deadline = Date.now() + 120000; let row;
  do { await sleep(2000); row = await sample(page); } while (!(row.phase === 'idle' && row.unsettledOwners === 0) && Date.now() < deadline);
  receipt.after = row; receipt.settled = row.phase === 'idle' && row.unsettledOwners === 0;
  receipt.ui = await page.evaluate(() => ({ label: document.querySelector('[data-contrib-label]')?.textContent, progress: document.querySelector('[data-contribution-progress]')?.textContent,
    retryStopHidden: document.querySelector('[data-retry-contribution-stop]')?.hidden, toggleDisabled: document.querySelector('[data-toggle-contribution]')?.disabled }));
} catch (error) { receipt.failure = String(error.stack || error); }
finally { await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 1), { flag: 'wx' }); await browser.close(); console.log(JSON.stringify({ settled: receipt.settled, after: receipt.after, ui: receipt.ui, failure: receipt.failure?.split('\n')[0] })); }
