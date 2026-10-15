// The latency-breakdown requests on the installed application (placement C): the journey's 56-token first
// question and its 189-token history-aware follow-up in one requester profile, then the journey's retry
// prompt (31 tokens, the 171-token longest answer) in a second fresh profile, one at a time. Uses the run-7
// journey harness functions unchanged (open, model choice, one-time permission, send, follow) and records the
// application's own timing record (timing.mjs) plus each attempt's coordinator receipt (settlement).
// Usage: node run-turns.mjs <journey config> <output json>
import fs from 'node:fs/promises';
const H = '../../signed-completion-journey-20261013/';
const { loadConfig, orderedSelectionId } = await import(new URL(H + 'config.mjs', import.meta.url));
const { openRequesterProfile, appUrl, openApp, chooseOrderedModel, send, followAttempt, attemptIds, now, findPage } = await import(new URL(H + 'harness.mjs', import.meta.url));
const { observeChat, observeNetwork } = await import(new URL(H + 'observe.mjs', import.meta.url));
const { buildTimingRecord } = await import(new URL(H + 'timing.mjs', import.meta.url));
const { chromium } = await import('/Users/xyz/deco/reploid/node_modules/playwright/index.mjs');
const [configPath, outputPath] = process.argv.slice(2);
const { config } = await loadConfig(configPath);
const fixture = JSON.parse(await fs.readFile(new URL(H + 'journey.json', import.meta.url), 'utf8'));
const room = JSON.parse(await fs.readFile(config.application.roomFile, 'utf8'));
const out = { schema: 'reploid.placement-c-latency-turns/v1', startedAt: now(), turns: [] };
const coordinatorReceipts = async ids => {
  const browser = await chromium.connectOverCDP(config.browsers.coordinator.connect.endpoint);
  try {
    const network = await observeNetwork(findPage(browser, config.browsers.coordinator.origin));
    const c = network.contribution || {};
    return { unsettledOwners: c.unsettledOwners, reservations: c.reservations ? { active: c.reservations.active, availableSlots: c.reservations.availableSlots } : null,
      unknownAttempts: c.unknownAttempts ?? null,
      attempts: (c.attempts || []).filter(row => ids.includes(row?.identity?.attemptId)).map(row => ({ attemptId: row.identity.attemptId,
        phase: row.phase, cleanup: row.cleanup, cleanupSettledAt: row.cleanupSettledAt, failure: row.failure })) };
  } finally { await browser.close(); }
};
const profiles = [];
async function turn(page, label, text) {
  const oldIds = attemptIds(await observeChat(page));
  const sent = await send(page, text, config.timeouts.readyMs);
  const samples = [];
  const { thread, attempt } = await followAttempt(page, { oldIds, timeout: config.timeouts.answerMs + 60000, poll: 250, samples, modelIdentity: config.freeze.modelIdentity });
  const response = thread.messages.find(message => message.id === attempt.responseId);
  const row = { label, sentAt: sent.sentAt, permissionShown: !!sent.permission, attemptId: attempt.id, threadId: thread.id, status: attempt.status,
    error: attempt.error ?? null, generatedTokens: attempt.execution?.stepSummary?.count ?? null, stopReason: attempt.execution?.stopReason ?? null,
    answerCharacters: response?.content?.length ?? null, answer: response?.content ?? null, finishedObservedAt: now(),
    attemptCreatedAt: attempt.createdAt, attemptFinishedAt: attempt.finishedAt,
    timing: buildTimingRecord({ thread, attemptId: attempt.id, samples, sentAt: sent.sentAt, pollMs: 250 }) };
  out.turns.push(row);
  console.log(JSON.stringify({ label, status: row.status, tokens: row.generatedTokens, answerMs: row.timing.requester.attemptMs.value }));
  return row;
}
try {
  const url = appUrl(config.browsers.requester.origin, room, config.application.signalingUrl);
  const open = async label => {
    const profile = await openRequesterProfile(config.browsers.requester, label);
    profiles.push(profile);
    const page = await profile.context.newPage();
    await openApp(page, url, config.timeouts.readyMs);
    await chooseOrderedModel(page, orderedSelectionId(config.freeze), config.timeouts.readyMs);
    return page;
  };
  const first = await open('turns-a');
  await turn(first, 'first-answer', fixture.questions[0]);
  await turn(first, 'follow-up', fixture.questions[1]);
  const second = await open('turns-b');
  await turn(second, 'longest-answer', fixture.retry.prompt);
  await new Promise(resolve => setTimeout(resolve, 3000));
  out.settlement = await coordinatorReceipts(out.turns.map(row => row.attemptId));
  out.ok = out.turns.every(row => row.status === 'completed');
} catch (error) { out.failure = String(error.stack || error); }
finally {
  out.finishedAt = now();
  await fs.writeFile(outputPath, JSON.stringify(out, null, 1).replaceAll(room.token, '[REDACTED]') + '\n', { flag: 'wx' });
  for (const profile of profiles) await profile.close();
  console.log(JSON.stringify({ ok: out.ok ?? false, failure: out.failure?.split('\n')[0] }));
}
