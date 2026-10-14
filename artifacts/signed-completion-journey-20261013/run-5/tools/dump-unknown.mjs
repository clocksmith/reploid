// Read-only: full contribution.unknownAttempts and attempts receipts of the stage 0 coordinator.
import { chromium } from 'playwright';
import { observeNetwork } from '../../observe.mjs';
import { findPage } from '../../harness.mjs';
const [endpoint, origin] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
try { const c = (await observeNetwork(findPage(browser, origin))).contribution || {};
  console.log(JSON.stringify({ at: new Date().toISOString(), phase: c.phase, error: c.error, unsettledOwners: c.unsettledOwners, unknownAttempts: c.unknownAttempts ?? null, attempts: c.attempts ?? null }, null, 1));
} finally { await browser.close(); }
