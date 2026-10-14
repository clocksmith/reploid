// Phase-timing measurement driver: one answer per invocation through the actual application.
// A fresh requester profile opens the measurement export, chooses the ordered selection, sends one
// ladder prompt and follows the attempt to a terminal status without cancelling or retrying it. The
// record keeps the coordinator's phase summary (partition-summary.js summarizeOrderedPhases) and the
// journey harness's timing record (timing.mjs v2). Measurement only; no acceptance check is applied.
// Usage: node measure.mjs <measure config json> <rung id> [repeat label]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { redactPrivateAddresses } from '../../signed-completion-journey-20261013/config.mjs';
import { observeChat } from '../../signed-completion-journey-20261013/observe.mjs';
import { buildTimingRecord, timingRecordFailures } from '../../signed-completion-journey-20261013/timing.mjs';
import { openRequesterProfile, appUrl, servedDescriptor, openApp, chooseOrderedModel, send, followAttempt, attemptIds, now }
  from '../../signed-completion-journey-20261013/harness.mjs';

const [configPath, rungId, repeat = null] = process.argv.slice(2);
const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
const room = JSON.parse(await fs.readFile(config.roomFile, 'utf8'));
const prompts = JSON.parse(await fs.readFile(config.promptsFile, 'utf8'));
const rung = prompts.rungs.find(row => row.id === rungId);
if (!rung) throw Error(`Unknown rung ${rungId}`);
const outPath = path.join(config.answersDirectory, `${config.placement}-${rung.id}${repeat ? `-${repeat}` : ''}.json`);
const record = { schema: 'reploid.phase-timing-answer/v1', placement: config.placement, route: config.route, repeat, rung: { id: rung.id,
  userTextTokens: rung.userTextTokens, characters: rung.characters, sha256: rung.sha256 }, startedAt: now(), samples: [] };
const save = () => fs.writeFile(outPath, redactPrivateAddresses(JSON.stringify(record, null, 1).replaceAll(room.token, '[REDACTED]')), { flag: 'w' });
await fs.writeFile(outPath, '{}', { flag: 'wx' });
let requester;
try {
  requester = await openRequesterProfile(config.requester, `${config.placement}-${rung.id}`);
  record.servedBundle = await servedDescriptor(requester.context, config.origin, config.descriptorPath);
  if (record.servedBundle !== config.browserBundle) throw Error('Served bundle differs from the measurement build');
  const page = requester.context.pages()[0] || await requester.context.newPage();
  page.on('pageerror', error => (record.pageErrors ||= []).push(error.message));
  await openApp(page, appUrl(config.origin, room, null), config.readyMs);
  record.selection = await chooseOrderedModel(page, config.selectionId, config.readyMs);
  const oldIds = attemptIds(await observeChat(page));
  record.sentAt = now();
  await send(page, rung.text, config.readyMs);
  const done = await followAttempt(page, { oldIds, timeout: config.answerMs, poll: config.pollMs, samples: record.samples,
    modelIdentity: config.modelIdentity });
  record.finishedAt = now();
  const attempt = done.attempt;
  record.attempt = { id: attempt.id, status: attempt.status, error: attempt.error ?? null, createdAt: attempt.createdAt, finishedAt: attempt.finishedAt,
    stopReason: attempt.execution?.stopReason ?? null };
  record.answer = done.response.content;
  record.answerSha256 = createHash('sha256').update(done.response.content || '').digest('hex');
  record.execution = attempt.execution ? { schema: attempt.execution.schema, stopReason: attempt.execution.stopReason,
    activationBytes: attempt.execution.activationBytes, route: attempt.execution.identity?.route?.stages?.map(stage => stage.participantId),
    stepSummary: attempt.execution.stepSummary } : null;
  record.timing = buildTimingRecord({ thread: done.thread, attemptId: attempt.id, samples: record.samples, sentAt: record.sentAt, pollMs: config.pollMs });
  record.timingFailures = timingRecordFailures(record.timing, { requireComplete: attempt.status === 'completed', stageCount: 3 });
} catch (error) {
  record.failure = String(error.stack || error);
  record.finishedAt ??= now();
} finally {
  // Rendered text samples are large and repeat the answer; keep the first and last only.
  record.sampleCount = record.samples.length;
  record.samples = [record.samples[0], record.samples.at(-1)].filter(Boolean);
  await save();
  await requester?.close();
  const p = record.execution?.stepSummary?.phases;
  console.log(JSON.stringify({ rung: rung.id, status: record.attempt?.status, error: record.attempt?.error, failure: record.failure?.split('\n')[0],
    promptTokens: p?.prompt?.inputTokens, generated: record.execution?.stepSummary?.count,
    prefillMs: p?.prompt?.stages?.map(stage => Math.round(stage.elapsedMs)),
    decodeMsPerStep: p?.decode?.stages?.map(stage => stage.elapsedMs.count ? Math.round(stage.elapsedMs.total / stage.elapsedMs.count) : null) }));
}
