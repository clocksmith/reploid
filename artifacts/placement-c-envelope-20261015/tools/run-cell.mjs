// One envelope-matrix cell on the installed application (placement C): N independent requester profiles (1-3;
// separate user data directories, as the journey harness requires) open the app, choose the ordered model,
// grant the one-time contributor permission and send the same prompt at the same moment. Each attempt is
// followed to its terminal state (the harness waits 60 s past the application's own 900 s answer deadline so
// the application, not the harness, ends it). Records per requester: outcome, error, generated tokens (the
// coordinator count when completed, otherwise the durable publication records), time to first visible text,
// the application's timing record, and stream samples. After the cell it waits for the coordinator to report
// no active reservation and records each attempt's coordinator receipt (phase, per-stage cleanup).
// Copy of ../../faster-candidate-20261015/context/run-long-prompt.mjs extended to 3 requesters, longer harness
// deadline, token counts for unfinished attempts and settlement capture; harness functions unchanged.
// Usage: node run-cell.mjs <journey config> <prompt text file> <requesters> <output json> [label]
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const H = '../../signed-completion-journey-20261013/';
const { loadConfig, orderedSelectionId } = await import(new URL(H + 'config.mjs', import.meta.url));
const { openRequesterProfile, appUrl, openApp, chooseOrderedModel, send, followAttempt, attemptIds, now, findPage, sleep } = await import(new URL(H + 'harness.mjs', import.meta.url));
const { observeChat, observeNetwork } = await import(new URL(H + 'observe.mjs', import.meta.url));
const { buildTimingRecord } = await import(new URL(H + 'timing.mjs', import.meta.url));
const { chromium } = await import('/Users/xyz/deco/reploid/node_modules/playwright/index.mjs');
const [configPath, promptPath, countArg, outputPath, label] = process.argv.slice(2);
const { config } = await loadConfig(configPath);
const room = JSON.parse(await fs.readFile(config.application.roomFile, 'utf8'));
const prompt = await fs.readFile(promptPath, 'utf8');
const count = Number(countArg);
if (!(count >= 1 && count <= 3)) throw Error('1 to 3 concurrent requesters');
const out = { schema: 'reploid.placement-c-envelope-cell/v1', label: label ?? null, startedAt: now(), promptFile: promptPath.split('/').at(-1),
  promptSha256: 'sha256:' + createHash('sha256').update(prompt).digest('hex'), promptCharacters: prompt.length, requesters: count, runs: [] };
export async function coordinatorState(ids) {
  const browser = await chromium.connectOverCDP(config.browsers.coordinator.connect.endpoint);
  try {
    const network = await observeNetwork(findPage(browser, config.browsers.coordinator.origin));
    const c = network.contribution || {};
    return { at: now(), phase: c.phase, error: c.error, unsettledOwners: c.unsettledOwners,
      reservations: c.reservations ? { active: c.reservations.active, availableSlots: c.reservations.availableSlots, closed: c.reservations.closed } : null,
      unknownAttempts: c.unknownAttempts ?? null,
      attempts: (c.attempts || []).filter(row => ids.includes(row?.identity?.attemptId)).map(row => ({ attemptId: row.identity.attemptId,
        phase: row.phase, cleanup: row.cleanup, cleanupSettledAt: row.cleanupSettledAt, failure: row.failure })) };
  } finally { await browser.close(); }
}
const profiles = [];
try {
  const url = appUrl(config.browsers.requester.origin, room, config.application.signalingUrl);
  for (let i = 0; i < count; i++) {
    const profile = await openRequesterProfile(config.browsers.requester, `cell-${i}`);
    const page = await profile.context.newPage();
    await openApp(page, url, config.timeouts.readyMs);
    await chooseOrderedModel(page, orderedSelectionId(config.freeze), config.timeouts.readyMs);
    profiles.push({ profile, page, oldIds: attemptIds(await observeChat(page)) });
  }
  out.before = await coordinatorState([]);
  out.sentAt = now();
  const sends = await Promise.all(profiles.map(row => send(row.page, prompt, config.timeouts.readyMs)));
  out.sends = sends.map(row => ({ sentAt: row.sentAt, permissionShown: !!row.permission }));
  out.runs = await Promise.all(profiles.map(async (row, index) => {
    const samples = [];
    const sentAt = sends[index]?.sentAt ?? out.sentAt;
    try {
      const { thread, attempt } = await followAttempt(row.page, { oldIds: row.oldIds, timeout: config.timeouts.answerMs + 60000, poll: 250, samples, modelIdentity: config.freeze.modelIdentity });
      const response = thread.messages.find(message => message.id === attempt.responseId);
      const answer = response?.content ?? null;
      const firstText = samples.find(sample => sample.content?.length > 0);
      const lastText = samples.filter(sample => sample.content?.length > 0).at(-1);
      return { index, attemptId: attempt.id, threadId: thread.id, status: attempt.status, error: attempt.error ?? null,
        stopReason: attempt.execution?.stopReason ?? null, coordinatorTokens: attempt.execution?.stepSummary?.count ?? null,
        publishedRecords: Array.isArray(response?.publicationDigests) ? response.publicationDigests.length : null,
        answerCharacters: answer?.length ?? null, answerHead: answer?.slice(0, 200) ?? null, answerTail: answer?.slice(-120) ?? null,
        attemptCreatedAt: attempt.createdAt, attemptFinishedAt: attempt.finishedAt,
        firstTextAt: firstText?.at ?? null, lastTextAt: lastText?.at ?? null, lastTextCharacters: lastText?.content?.length ?? null,
        timing: buildTimingRecord({ thread, attemptId: attempt.id, samples, sentAt, pollMs: 250 }),
        samples: samples.map(sample => ({ at: sample.at, status: sample.status, characters: sample.content?.length ?? 0 })) };
    } catch (error) { return { index, failure: String(error.stack || error).slice(0, 2000) }; }
  }));
  out.ok = out.runs.every(row => row.status === 'completed');
  const ids = out.runs.map(row => row.attemptId).filter(Boolean);
  out.settlement = [];
  for (let i = 0; i < 24; i++) {
    const state = await coordinatorState(ids);
    out.settlement.push(state);
    if (state.reservations?.active === 0 && state.attempts.every(row => row.cleanupSettledAt || row.phase === 'cleanup-failed')) break;
    await sleep(5000);
  }
} catch (error) { out.failure = String(error.stack || error); }
finally {
  out.finishedAt = now();
  await fs.writeFile(outputPath, JSON.stringify(out, null, 1).replaceAll(room.token, '[REDACTED]') + '\n', { flag: 'wx' });
  for (const row of profiles) await row.profile.close().catch(() => {});
  console.log(JSON.stringify({ label, ok: out.ok ?? false, runs: out.runs.map(row => ({ status: row.status, error: row.error?.slice?.(0, 80),
    tokens: row.coordinatorTokens ?? row.publishedRecords, answerMs: row.timing?.requester?.attemptMs?.value, failure: row.failure?.split('\n')[0] })),
    settled: out.settlement?.at(-1)?.reservations?.active === 0, failure: out.failure?.split('\n')[0] }));
}
