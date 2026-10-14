// Per-answer timing. Each boundary keeps its own clock and source. A boundary the
// application does not expose is recorded as not-observable, never estimated.
export const NOT_OBSERVABLE = 'not-observable';

export const TIMING_SOURCES = Object.freeze({
  attemptCreatedAt: 'packages/reploid/src/chat/workspace.js:116',
  attemptFinishedAt: 'packages/reploid/src/chat/workspace.js:248',
  harnessSample: 'harness stream sample (Send click to first nonempty rendered response)',
  stageElapsed: 'packages/reploid/src/mesh/partitions/partition-route-execution.js:167-175 (per stage, includes remote transport); aggregated by partition-summary.js:9-14',
  activationBytes: 'packages/reploid/src/mesh/partitions/partition-route-execution.js:209',
  dopplerStageMetrics: 'doppler src/inference/pipelines/text/resident-partition.js:173-202,230 produces metrics; '
    + 'partition-route-execution.js:182 keeps them per step on the coordinator; partition-summary.js:16-18 drops them from the requester summary; '
    + 'server/native-participant.js:51-63 state log omits them',
  phases: 'packages/reploid/src/mesh/partitions/partition-summary.js summarizeOrderedPhases: step 0 carries the whole prompt '
    + '(prefill plus the first sampled token), later steps decode one token each; per-stage runtime fields are each contributor\'s '
    + 'Doppler resident metrics (doppler resident-partition.js:173-202,230), elapsed is the coordinator stage call',
  scheduler: 'packages/reploid/src/chat/scheduler.js:26,72-73 records queuedMs/loadMs/executionMs only for local scheduling; '
    + 'self/host/chat-execution.js:48-51 sends partition models straight to partitions.generate; chat-execution.js:29 discards observations',
  transport: 'partition-summary.js:43-45 aggregates transportTiming for v1 two-device summaries only; the ordered v2 summary (partition-summary.js:16-18) carries none',
  persistence: 'packages/reploid/src/chat/workspace.js:63-94 saves ordinary history synchronously inside persist() and exposes no timing; '
    + 'partition-ordered-chat.js:45-46 keeps ordered routes on ordinary history'
});

// Only these boundaries may be declared not-observable. An observable boundary
// that is absent is "missing", which fails a completed answer's record.
// Runtime fields and prompt length are observable only from candidates whose
// ordered summary carries phases; earlier candidates record them not-observable.
export const NOT_OBSERVABLE_PATHS = Object.freeze(['coordinator.promptTokens', 'runtime.executionMs', 'runtime.logitsReadbackMs',
  'runtime.samplingMs', 'scheduler.queuedMs', 'scheduler.loadMs', 'scheduler.executionMs', 'transport', 'persistence']);
export const TIMING_SCHEMA = 'reploid.signed-completion-answer-timing/v2';

const measured = (value, unit, clock, source) => Number.isFinite(value) && value >= 0
  ? { status: 'measured', value, unit, clock, source } : { status: 'missing', unit, clock, source };
const notObservable = (reason, source) => ({ status: NOT_OBSERVABLE, reason, source });

// Sum one runtime field over every stage of both phases (or only the final stage).
// It is measured only when every stage reported it for the prompt and every decode step.
function runtimeTotal(phases, key, stageCount, finalOnly) {
  if (!phases?.prompt || !phases.decode) return null;
  const indexes = finalOnly ? [stageCount - 1] : Array.from({ length: stageCount }, (_, index) => index);
  let total = 0;
  for (const index of indexes) {
    const prompt = phases.prompt.stages?.find(row => row.partitionIndex === index)?.runtime?.[key];
    const decode = phases.decode.stages?.find(row => row.partitionIndex === index)?.runtime?.[key];
    if (!Number.isFinite(prompt) || phases.decode.steps > 0 && decode?.count !== phases.decode.steps) return NaN;
    total += prompt + (phases.decode.steps > 0 ? decode.total : 0);
  }
  return total;
}

export function buildTimingRecord({ thread, attemptId, samples = [], sentAt = null, pollMs = null }) {
  const attempt = thread?.attempts?.find(item => item.id === attemptId) || null;
  const execution = attempt?.execution || null, summary = execution?.stepSummary || null;
  const response = thread?.messages?.find(message => message.id === attempt?.responseId) || null;
  const stageCount = Array.isArray(execution?.identity?.route?.stages) ? execution.identity.route.stages.length : 0;
  const first = samples.find(sample => sample.attemptId === attemptId && sample.content?.length > 0 && sample.renderedText?.length > 0);
  const firstMs = sentAt && first ? Date.parse(first.at) - Date.parse(sentAt) : NaN;
  const dopplerReason = 'Doppler per-stage metrics never reach an observable application boundary for ordered routes';
  const phases = summary?.phases ?? null;
  const runtimeField = (key, finalOnly) => phases
    ? measured(runtimeTotal(phases, key, stageCount, finalOnly), 'ms', 'contributor-runtime', TIMING_SOURCES.phases)
    : notObservable(dopplerReason, TIMING_SOURCES.dopplerStageMetrics);
  const schedulerReason = 'Ordered partition attempts bypass the chat scheduler; the host also discards scheduler observations';
  return {
    schema: TIMING_SCHEMA, threadId: thread?.id ?? null, attemptId, status: attempt?.status ?? null,
    requester: {
      attemptMs: measured(attempt?.finishedAt - attempt?.createdAt, 'ms', 'requester-application',
        `${TIMING_SOURCES.attemptFinishedAt} minus ${TIMING_SOURCES.attemptCreatedAt}`),
      firstVisibleTextMs: { ...measured(firstMs, 'ms', 'harness', TIMING_SOURCES.harnessSample), resolutionMs: pollMs },
      outputCharacters: typeof response?.content === 'string' ? response.content.length : null
    },
    coordinator: {
      // Every route step samples one token: step 0 after the prompt prefill, later steps after one-token decode.
      generatedTokens: Number.isSafeInteger(summary?.count) ? summary.count : null,
      promptTokens: phases ? measured(phases.prompt?.inputTokens, 'tokens', 'coordinator', TIMING_SOURCES.phases)
        : notObservable('Ordered summaries before phase timing carry no prompt length', TIMING_SOURCES.dopplerStageMetrics),
      phases: phases ? { source: TIMING_SOURCES.phases, prompt: structuredClone(phases.prompt), decode: structuredClone(phases.decode) } : null,
      stages: Array.from({ length: stageCount }, (_, index) => {
        const row = summary?.stages?.find(item => item.partitionIndex === index);
        return { partitionIndex: index, steps: row?.steps ?? null, stepCount: row?.stepMs?.count ?? null,
          stepMsTotal: measured(row?.stepMs?.total, 'ms', 'coordinator', TIMING_SOURCES.stageElapsed) };
      }),
      activationBytes: measured(execution?.activationBytes, 'bytes', 'coordinator', TIMING_SOURCES.activationBytes)
    },
    runtime: {
      executionMs: runtimeField('executionMs', false),
      logitsReadbackMs: runtimeField('logitsReadbackMs', true),
      samplingMs: runtimeField('samplingMs', true)
    },
    scheduler: {
      queuedMs: notObservable(schedulerReason, TIMING_SOURCES.scheduler),
      loadMs: notObservable(schedulerReason, TIMING_SOURCES.scheduler),
      executionMs: notObservable(schedulerReason, TIMING_SOURCES.scheduler)
    },
    transport: notObservable('Ordered summaries carry no transport timing', TIMING_SOURCES.transport),
    persistence: notObservable('History persistence exposes no timing', TIMING_SOURCES.persistence)
  };
}

/** A completed answer's record must measure every observable boundary. */
export function timingRecordFailures(record, { requireComplete = true, stageCount = null } = {}) {
  const failures = [];
  const label = `timing ${record?.attemptId ?? '(unknown attempt)'}`;
  if (record?.schema !== TIMING_SCHEMA) return [`${label}: record missing`];
  const visit = (value, where) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.status === 'string') {
      if (value.status === 'measured') {
        if (!Number.isFinite(value.value) || value.value < 0) failures.push(`${label}: ${where} measured value invalid`);
        if (!value.source || !value.clock) failures.push(`${label}: ${where} lacks its clock or source`);
      } else if (value.status === NOT_OBSERVABLE) {
        if (!NOT_OBSERVABLE_PATHS.includes(where)) failures.push(`${label}: ${where} is observable and cannot be marked not-observable`);
        if (!value.reason || !value.source) failures.push(`${label}: ${where} not-observable without reason and source`);
      } else if (value.status === 'missing') {
        if (requireComplete) failures.push(`${label}: ${where} observable boundary missing`);
      } else failures.push(`${label}: ${where} has unsupported status ${value.status}; estimates are not recorded`);
      return;
    }
    for (const [key, child] of Object.entries(value)) visit(child, where ? `${where}.${key}` : key);
  };
  for (const key of ['requester', 'coordinator', 'runtime', 'scheduler', 'transport', 'persistence']) {
    if (!record[key]) failures.push(`${label}: ${key} boundary absent`); else visit(record[key], key);
  }
  for (const path of NOT_OBSERVABLE_PATHS) {
    const value = path.split('.').reduce((node, key) => node?.[key], record);
    if (value?.status === 'measured') continue;
    if (value?.status !== NOT_OBSERVABLE) failures.push(`${label}: ${path} must be measured or explicitly not-observable`);
  }
  if (requireComplete) {
    const stages = record.coordinator?.stages || [];
    if (!stages.length || (stageCount !== null && stages.length !== stageCount)) failures.push(`${label}: per-stage coordinator timing does not cover every route stage`);
    const generated = record.coordinator?.generatedTokens;
    if (!Number.isSafeInteger(generated) || generated <= 0) failures.push(`${label}: generated token count missing`);
    if (stages.some(row => row.steps !== generated || row.stepCount !== generated)) {
      failures.push(`${label}: a stage did not time every route step`);
    }
    const phases = record.coordinator?.phases;
    if (phases && (phases.decode?.steps !== generated - 1 || phases.prompt?.stages?.length !== stages.length
      || phases.decode.steps > 0 && phases.decode.stages?.some(row => row.elapsedMs?.count !== phases.decode.steps))) {
      failures.push(`${label}: prompt and decode phases do not cover every stage and step`);
    }
  }
  return failures;
}
