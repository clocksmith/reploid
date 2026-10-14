// Run-5 supplementary observation OUTSIDE the loss harness (whose verdict stays as recorded): call the same
// control module restoreContributor the harness would have called, then poll the stage 0 coordinator
// read-only until it offers a ready ordered route that includes the restored native, recording the time.
// No conversation is sent and no Retry is clicked. Usage: node supplementary-restore.mjs <cdp> <origin> <out json>
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { observeNetwork } from '../../observe.mjs';
import { findPage, sleep } from '../../harness.mjs';
import { restoreContributor } from './contributor-control.mjs';
const [endpoint, origin, out] = process.argv.slice(2);
const stage = { machine: 'amd-host', stage: 1, participantId: 'peer:9af15d884eba51b0c0540e2a',
  orderedConfig: '/var/tmp/reploid-signed-completion-journey-run5-20261013/amd-host-stage-1.json', nativeArtifact: null };
const record = { schema: 'reploid.run-5-supplementary-capacity-return/v1', scope: 'outside the loss harness; observation only', samples: [] };
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = findPage(browser, origin);
  record.restore = await restoreContributor(stage); record.restoreReturnedAt = new Date().toISOString();
  const deadline = Date.now() + 600000;
  for (;;) {
    const c = (await observeNetwork(page)).contribution || {};
    const row = { at: new Date().toISOString(), phase: c.phase, error: c.error, unsettledOwners: c.unsettledOwners, decision: c.placementDecision?.reason ?? null,
      routeTransports: c.placementDecision?.route?.stages?.map(s => s.transportId) ?? null, ready: (c.models || []).some(m => m.availability === 'ready'), unknownAttempts: (c.unknownAttempts || []).length };
    if (JSON.stringify(row.slice) !== '') { const last = record.samples.at(-1); if (!last || JSON.stringify({ ...last, at: 0 }) !== JSON.stringify({ ...row, at: 0 })) record.samples.push(row); }
    if (row.ready) { record.capacityReturnedAt = row.at; break; }
    if (Date.now() > deadline) { record.capacityReturnedAt = null; break; }
    await sleep(1000);
  }
  record.capacityReturnMs = record.capacityReturnedAt ? Date.parse(record.capacityReturnedAt) - Date.parse(record.restore.restoredAt) : null;
} catch (error) { record.failure = String(error.stack || error); }
finally { await fs.writeFile(out, JSON.stringify(record, null, 1), { flag: 'wx' }); await browser.close();
  console.log(JSON.stringify({ restoredAt: record.restore?.restoredAt, unit: record.restore?.detail?.unit, capacityReturnedAt: record.capacityReturnedAt, capacityReturnMs: record.capacityReturnMs, failure: record.failure?.split('\n')[0] })); }
