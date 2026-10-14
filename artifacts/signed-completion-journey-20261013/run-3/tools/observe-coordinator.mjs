// Read-only snapshot of the stage 0 coordinator's host state through the harness's observe.mjs.
// Usage: node observe-coordinator.mjs <cdp endpoint> <origin> [until-ready-ms]
// With until-ready-ms, polls until the coordinator offers a ready ordered route model or the deadline passes.
import { chromium } from 'playwright';
import { observeNetwork } from '../../observe.mjs';
import { findPage, sleep } from '../../harness.mjs';

const [endpoint, origin, untilMs] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
const summarize = network => {
  const c = network.contribution || {};
  return { at: new Date().toISOString(), phase: c.phase, error: c.error, offering: c.offering, unsettledOwners: c.unsettledOwners,
    placement: c.placement, decision: c.placementDecision?.reason ?? null,
    routeTransports: c.placementDecision?.route?.stages?.map(stage => stage.transportId) ?? null,
    readyModels: (c.models || []).filter(model => model.availability === 'ready').map(model => model.partition?.route?.stages?.map(stage => stage.participantId)),
    reservations: c.reservations ? { active: c.reservations.active, availableSlots: c.reservations.availableSlots, closed: c.reservations.closed } : null,
    attempts: (c.attempts || []).map(row => ({ attemptId: row?.identity?.attemptId ?? null, phase: row?.phase })) };
};
try {
  const page = findPage(browser, origin);
  const deadline = Date.now() + Number(untilMs || 0);
  let last = null;
  for (;;) {
    last = summarize(await observeNetwork(page));
    if (!untilMs || last.readyModels.length > 0 || Date.now() > deadline) break;
    await sleep(2000);
  }
  console.log(JSON.stringify(last));
} finally { await browser.close(); }
