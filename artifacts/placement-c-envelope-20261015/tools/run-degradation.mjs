// One deliberate network-degradation condition between mac-host and amd-host on the installed application
// (placement C). The amd-host natives run with netshape.so preloaded (native-launch.sh `shape`); this runner
// writes its control file over ssh (destination FC_ENV_SSH_AMD from the environment, never a file) and removes
// it afterwards. An outage may also stop the mac-host end of the signaling tunnel (SIGSTOP/SIGCONT of the
// owned ssh process), so signaling stalls with the media path.
//
// Flow: one fresh requester profile sends the given prompt (the matrix's p56-n24: 56 tokens, 63-token answer).
// The condition is applied either for the whole answer (from before Send until the attempt ends) or, for an
// outage, once 10 characters have streamed. The attempt is followed to its terminal state (harness deadline: the
// application's 900 s answer deadline plus 60 s). The condition is then removed. If the attempt did not
// complete, the runner waits for the model to be ready again, presses the application's own Retry control once
// (explicit retry; no automatic retry) and follows the new attempt. Recorded: shown failure text and technical
// detail, timing records, the coordinator's receipts (phase, per-stage cleanup, unknown attempts, active
// reservations) after each attempt, both natives' last partition state, and the thread history.
// Usage: node run-degradation.mjs <journey config> <label> <mode whole|mid> <delay ms> <jitter ms> <send loss %>
//          <receive loss %> <outage ms> <stall tunnel yes|no> <prompt file> <output json>
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const H = '../../signed-completion-journey-20261013/';
const { loadConfig, orderedSelectionId } = await import(new URL(H + 'config.mjs', import.meta.url));
const { SELECTORS, openRequesterProfile, appUrl, openApp, chooseOrderedModel, send, followAttempt, waitForAttempt, attemptIds, now, findPage, sleep,
  allowPermissionIfAsked } = await import(new URL(H + 'harness.mjs', import.meta.url));
const { observeChat, observeNetwork } = await import(new URL(H + 'observe.mjs', import.meta.url));
const { buildTimingRecord } = await import(new URL(H + 'timing.mjs', import.meta.url));
const { chromium } = await import('/Users/xyz/deco/reploid/node_modules/playwright/index.mjs');
const [configPath, label, mode, delay, jitter, sendLoss, recvLoss, outageMs, stall, promptPath, outputPath] = process.argv.slice(2);
const prompt = await fs.readFile(promptPath, 'utf8');
const { config } = await loadConfig(configPath);
const fixture = JSON.parse(await fs.readFile(new URL(H + 'journey.json', import.meta.url), 'utf8'));
const room = JSON.parse(await fs.readFile(config.application.roomFile, 'utf8'));
const R = '/var/tmp/reploid-placement-c-envelope-20261015';
const SSH = process.env.FC_ENV_SSH_AMD;
if (!SSH) throw Error('FC_ENV_SSH_AMD required');
const ssh = script => execFileSync('ssh', ['-o', 'BatchMode=yes', SSH, script], { encoding: 'utf8', timeout: 30000 }).trim();
const tunnelPid = Number((await fs.readFile(R + '/tunnel-amd.pid', 'utf8')).trim());
const out = { schema: 'reploid.placement-c-degradation/v1', label, mode, condition: { delayMs: +delay, jitterMs: +jitter, sendLossPercent: +sendLoss,
  receiveLossPercent: +recvLoss, outageMs: +outageMs, tunnelStalled: stall === 'yes' }, promptFile: promptPath.split('/').at(-1), mechanism: 'netshape.so LD_PRELOAD in both owned natives (non-loopback UDP only)'
  + (stall === 'yes' ? '; SIGSTOP/SIGCONT of the owned mac-host ssh signaling tunnel for the outage' : ''), startedAt: now(), events: [] };
const event = (kind, extra = {}) => { const row = { at: now(), kind, ...extra }; out.events.push(row); console.log(JSON.stringify(row)); };
function applyControl() {
  const until = +outageMs > 0 ? Number(ssh('date +%s%3N')) + Number(outageMs) : 0;
  ssh(`printf '%s %s %s %s %s\\n' ${+delay} ${+jitter} ${+sendLoss} ${+recvLoss} ${until} > ${R}/netshape.conf.tmp && mv ${R}/netshape.conf.tmp ${R}/netshape.conf && cat ${R}/netshape.conf`);
  event('condition-applied', { outageUntilAmdEpochMs: until || null });
  if (stall === 'yes' && +outageMs > 0) {
    process.kill(tunnelPid, 'SIGSTOP'); event('tunnel-stopped');
    setTimeout(() => { try { process.kill(tunnelPid, 'SIGCONT'); event('tunnel-continued'); } catch (error) { event('tunnel-continue-failed', { error: error.message }); } }, +outageMs);
  }
}
function removeControl() {
  ssh(`rm -f ${R}/netshape.conf; test ! -e ${R}/netshape.conf && echo removed`);
  event('condition-removed');
}
const nativeState = () => {
  try {
    return ssh(`for f in $(ls -t ${R}/fc-env-native-*-$(cat ${R}/natives-suffix 2>/dev/null || echo x).log 2>/dev/null); do echo "$f $(grep -o '"event":"partition-state","phase":"[a-z]*","error":[^,]*,"offering":[a-z]*,"modelId":"[^"]*","unsettledOwners":[0-9]*' $f | tail -1)"; done`)
      .split('\n').map(line => line.replace(/^\S*\//, ''));
  } catch (error) { return [String(error.message).slice(0, 200)]; }
};
async function coordinatorState(ids) {
  const browser = await chromium.connectOverCDP(config.browsers.coordinator.connect.endpoint);
  try {
    const network = await observeNetwork(findPage(browser, config.browsers.coordinator.origin));
    const c = network.contribution || {};
    return { at: now(), phase: c.phase, error: c.error, unsettledOwners: c.unsettledOwners,
      reservations: c.reservations ? { active: c.reservations.active, availableSlots: c.reservations.availableSlots, closed: c.reservations.closed } : null,
      unknownAttempts: c.unknownAttempts ?? null, placement: c.placement ?? null,
      attempts: (c.attempts || []).filter(row => ids.includes(row?.identity?.attemptId)).map(row => ({ attemptId: row.identity.attemptId,
        phase: row.phase, cleanup: row.cleanup, cleanupSettledAt: row.cleanupSettledAt, failure: row.failure })) };
  } finally { await browser.close(); }
}
async function settle(ids) {
  const rows = [];
  for (let i = 0; i < 36; i++) {
    const state = await coordinatorState(ids); rows.push(state);
    if (state.reservations?.active === 0 && state.attempts.length === ids.length && state.attempts.every(row => row.cleanupSettledAt || row.phase === 'cleanup-failed')) break;
    await sleep(5000);
  }
  return { coordinator: rows.at(-1), polls: rows.length, natives: nativeState() };
}
async function shownFailure(page, attemptId) {
  const thread = (await observeChat(page)).threads.find(item => item.attempts.some(a => a.id === attemptId));
  const messageId = thread?.attempts.find(a => a.id === attemptId)?.responseId;
  const text = async selector => { try { return await page.locator(selector).first().textContent({ timeout: 2000 }); } catch { return null; } };
  return { status: await text(SELECTORS.failureStatus(messageId)), technical: (await text(SELECTORS.failureTechnical(messageId)))?.slice(0, 2000) ?? null };
}
const summarize = (thread, attempt, samples, sentAt) => {
  const response = thread.messages.find(message => message.id === attempt.responseId);
  return { attemptId: attempt.id, status: attempt.status, error: attempt.error ?? null, stopReason: attempt.execution?.stopReason ?? null,
    coordinatorTokens: attempt.execution?.stepSummary?.count ?? null,
    publishedRecords: Array.isArray(response?.publicationDigests) ? response.publicationDigests.length : null,
    answerCharacters: response?.content?.length ?? null, answerTail: response?.content?.slice(-80) ?? null,
    createdAt: attempt.createdAt, finishedAt: attempt.finishedAt,
    timing: buildTimingRecord({ thread, attemptId: attempt.id, samples, sentAt, pollMs: 250 }),
    samples: samples.map(sample => ({ at: sample.at, status: sample.status, characters: sample.content?.length ?? 0 })) };
};
let profile = null;
try {
  ssh(`test -f ${R}/netshape.so && ! test -e ${R}/netshape.conf && echo clean`);
  out.nativesBefore = nativeState();
  out.coordinatorBefore = await coordinatorState([]);
  profile = await openRequesterProfile(config.browsers.requester, 'degradation-' + label);
  const page = await profile.context.newPage();
  await openApp(page, appUrl(config.browsers.requester.origin, room, config.application.signalingUrl), config.timeouts.readyMs);
  await chooseOrderedModel(page, orderedSelectionId(config.freeze), config.timeouts.readyMs);
  const oldIds = attemptIds(await observeChat(page));
  if (mode === 'whole') applyControl();
  const sent = await send(page, prompt, config.timeouts.readyMs);
  event('sent', { permissionShown: !!sent.permission });
  const samples = [];
  let applied = mode === 'whole';
  const followed = await followAttempt(page, { oldIds, timeout: config.timeouts.answerMs + 60000, poll: 250, samples, modelIdentity: config.freeze.modelIdentity,
    onSample: async ({ response }) => { if (!applied && response.content.length >= 10) { applied = true; applyControl(); } } });
  event('first-attempt-terminal', { status: followed.attempt.status });
  if (+outageMs > 0 && mode === 'mid') await sleep(Math.max(0, +outageMs - (Date.now() - Date.parse(out.events.find(e => e.kind === 'condition-applied')?.at ?? now()))));
  removeControl();
  out.first = summarize(followed.thread, followed.attempt, samples, sent.sentAt);
  out.first.shown = followed.attempt.status === 'completed' ? null : await shownFailure(page, followed.attempt.id);
  out.first.settlement = await settle([followed.attempt.id]);
  if (followed.attempt.status !== 'completed') {
    await page.locator(SELECTORS.modelReady).waitFor({ state: 'attached', timeout: config.timeouts.capacityReturnMs });
    await page.locator(SELECTORS.retry(followed.attempt.id)).waitFor({ timeout: config.timeouts.capacityReturnMs });
    const retryOldIds = attemptIds(await observeChat(page)), retrySentAt = now();
    event('retry-pressed');
    await page.locator(SELECTORS.retry(followed.attempt.id)).click();
    out.retryPermission = await allowPermissionIfAsked(page, config.timeouts.readyMs);
    const retrySamples = [];
    const retried = await followAttempt(page, { oldIds: retryOldIds, timeout: config.timeouts.answerMs + 60000, poll: 250, samples: retrySamples, modelIdentity: config.freeze.modelIdentity });
    event('retry-terminal', { status: retried.attempt.status });
    out.retry = summarize(retried.thread, retried.attempt, retrySamples, retrySentAt);
    out.retry.retryOf = retried.attempt.retryOf ?? null;
    out.retry.settlement = await settle([followed.attempt.id, retried.attempt.id]);
  }
  const observed = await observeChat(page);
  const thread = observed.threads.find(item => item.attempts.some(a => a.id === followed.attempt.id));
  out.history = { storageMode: observed.storageMode, runningIds: observed.runningIds, attempts: thread.attempts.map(a => ({ id: a.id, status: a.status, retryOf: a.retryOf ?? null, error: a.error ?? null })),
    messages: thread.messages.map(m => ({ id: m.id, role: m.role, status: m.status ?? null, characters: m.content?.length ?? 0, publicationRecords: m.publicationDigests?.length ?? null })),
    firstAnswerPreserved: thread.messages.find(m => m.id === followed.attempt.responseId)?.content?.length === out.first.answerCharacters };
  out.ok = true;
} catch (error) { out.failure = String(error.stack || error).slice(0, 3000); try { removeControl(); } catch {} }
finally {
  try { process.kill(tunnelPid, 'SIGCONT'); } catch {}
  out.finishedAt = now();
  await fs.writeFile(outputPath, JSON.stringify(out, null, 1).replaceAll(room.token, '[REDACTED]') + '\n', { flag: 'wx' });
  await profile?.close();
  console.log(JSON.stringify({ label, first: out.first?.status, firstError: out.first?.error?.slice?.(0, 120), retry: out.retry?.status ?? null, failure: out.failure?.split('\n')[0] }));
}
