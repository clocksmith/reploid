// Read-only: the stage 0 coordinator's receipt for one attempt (network.contribution.attempts, through the
// journey harness's observe.mjs), including its per-stage step timings, for attempts that did not complete
// (the requester summary carries phases only on completion).
// Usage: node coordinator-attempt.mjs <cdp endpoint> <origin> <attempt id> <output json>
import fs from 'node:fs/promises';
const H = '../../signed-completion-journey-20261013/';
const { chromium } = await import('/Users/xyz/deco/reploid/node_modules/playwright/index.mjs');
const { observeNetwork } = await import(new URL(H + 'observe.mjs', import.meta.url));
const { findPage } = await import(new URL(H + 'harness.mjs', import.meta.url));
const [endpoint, origin, attemptId, output] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const network = await observeNetwork(findPage(browser, origin));
  const rows = (network.contribution?.attempts || []).filter(row => JSON.stringify(row).includes(attemptId));
  await fs.writeFile(output, JSON.stringify({ at: new Date().toISOString(), attemptId, receipts: rows }, null, 1) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ found: rows.length, keys: rows[0] ? Object.keys(rows[0]) : [] }));
} finally { await browser.close(); }
