// Long-prompt workload on the installed application (run 8, placement C). N independent requester profiles
// (separate user data directories, as the journey harness requires) each open the app, choose the ordered
// model, grant the one-time contributor permission and send the same long prompt at the same moment. Each
// attempt is followed to its terminal state, and the application's own timing record is built
// (timing.mjs; prompt tokens and per-stage prompt and decode times come from the coordinator summary). Uses
// the journey harness's functions unchanged; the prompt is the text file's content as one user message.
// Usage: node run-long-prompt.mjs <journey config> <prompt text file> <concurrent requesters> <output json>
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
const H = '../../signed-completion-journey-20261013/';
const { loadConfig, orderedSelectionId } = await import(new URL(H + 'config.mjs', import.meta.url));
const { openRequesterProfile, appUrl, openApp, chooseOrderedModel, send, followAttempt, attemptIds, now } = await import(new URL(H + 'harness.mjs', import.meta.url));
const { observeChat } = await import(new URL(H + 'observe.mjs', import.meta.url));
const { buildTimingRecord } = await import(new URL(H + 'timing.mjs', import.meta.url));
const [configPath, promptPath, countArg, outputPath] = process.argv.slice(2);
const { config } = await loadConfig(configPath);
const room = JSON.parse(await fs.readFile(config.application.roomFile, 'utf8'));
const prompt = await fs.readFile(promptPath, 'utf8');
const count = Number(countArg);
if (!(count >= 1 && count <= 2)) throw Error('1 or 2 concurrent requesters (served limits.maxConcurrentAttempts is 2)');
const out = { schema: 'reploid.faster-candidate-long-prompt/v1', startedAt: now(), promptFile: promptPath.split('/').at(-1),
  promptSha256: 'sha256:' + createHash('sha256').update(prompt).digest('hex'), promptCharacters: prompt.length, requesters: count, runs: [] };
const profiles = [];
try {
  const url = appUrl(config.browsers.requester.origin, room, config.application.signalingUrl);
  for (let i = 0; i < count; i++) {
    const profile = await openRequesterProfile(config.browsers.requester, `long-${i}`);
    const page = await profile.context.newPage();
    await openApp(page, url, config.timeouts.readyMs);
    await chooseOrderedModel(page, orderedSelectionId(config.freeze), config.timeouts.readyMs);
    profiles.push({ profile, page, oldIds: attemptIds(await observeChat(page)) });
  }
  out.sentAt = now();
  const sends = await Promise.all(profiles.map(row => send(row.page, prompt, config.timeouts.readyMs)));
  out.sends = sends.map(row => ({ ...row, text: undefined }));
  out.runs = await Promise.all(profiles.map(async (row, index) => {
    const samples = [];
    const sentAt = sends[index]?.sentAt ?? out.sentAt;
    try {
      const { thread, attempt } = await followAttempt(row.page, { oldIds: row.oldIds, timeout: config.timeouts.answerMs, poll: 500, samples, modelIdentity: config.freeze.modelIdentity });
      const answer = thread.messages.find(message => message.id === attempt.responseId)?.content ?? null;
      return { index, attemptId: attempt.id, status: attempt.status, error: attempt.error ?? null,
        stopReason: attempt.execution?.stepSummary?.stopReason ?? attempt.stopReason ?? null, generatedTokens: attempt.execution?.stepSummary?.count ?? null,
        answerCharacters: answer?.length ?? null, answerHead: answer?.slice(0, 400) ?? null,
        timing: buildTimingRecord({ thread, attemptId: attempt.id, samples, sentAt, pollMs: 500 }) };
    } catch (error) { return { index, failure: String(error.stack || error).slice(0, 2000) }; }
  }));
  out.ok = out.runs.every(row => row.status === 'completed');
} catch (error) { out.failure = String(error.stack || error); }
finally {
  out.finishedAt = now();
  await fs.writeFile(outputPath, JSON.stringify(out, null, 2).replaceAll(room.token, '[REDACTED]') + '\n', { flag: 'wx' });
  for (const row of profiles) await row.profile.close().catch(() => {});
  console.log(JSON.stringify({ ok: out.ok ?? false, runs: out.runs.map(row => ({ status: row.status, stopReason: row.stopReason, tokens: row.generatedTokens, failure: row.failure?.split('\n')[0] })), failure: out.failure?.split('\n')[0] }));
}
