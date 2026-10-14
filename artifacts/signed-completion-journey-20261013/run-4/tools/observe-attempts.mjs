// Read-only: the stage 0 coordinator's attempt receipts (phase, step summary) through observe.mjs.
import { chromium } from 'playwright';
import { observeNetwork } from '../../observe.mjs';
import { findPage } from '../../harness.mjs';
const [endpoint, origin] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const c = (await observeNetwork(findPage(browser, origin))).contribution || {};
  console.log(JSON.stringify((c.attempts || []).map(row => ({ attemptId: row?.identity?.attemptId?.slice(0, 8), phase: row?.phase,
    steps: row?.stepSummary?.count ?? null, stages: row?.stepSummary?.stages?.map(s => [s.partitionIndex, s.steps, Math.round(s.stepMsTotal ?? 0)]) ?? null,
    failure: row?.failure ?? null, cleanup: row?.cleanup?.map(r => r.status) ?? null }))));
} finally { await browser.close(); }
