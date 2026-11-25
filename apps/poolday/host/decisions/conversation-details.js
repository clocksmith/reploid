/**
 * Conversation details as records, for any shell: the last (or a selected) answer's route, activity, execution facts,
 * timeline and service credits, the thread's grants and its context usage. Framework-free and pure: every value comes
 * from the attempt's own record through the projections the vanilla inspector uses (execution-ribbon.js,
 * execution-activity.js, context-indicator.js); nothing here decides execution, placement or a charge.
 */
import { projectExecutionRibbon, RECORDED_GPU_TITLE } from '../../ui/pool-home/execution-ribbon.js';
import { projectExecutionActivity, projectSupplyLabel } from '../../ui/pool-home/execution-activity.js';
import { projectContextIndicator } from '../../ui/pool-home/context-indicator.js';
import { serviceCreditOutcomeText } from '../../ui/pool-home/service-credit-text.js';
import { withComputerLabels } from '../../ui/pool-home/computer-labels.js';
import contextPolicy from '../../config/chat-context-policy.json' with { type: 'json' };

export { RECORDED_GPU_TITLE };

/** The word caps a context prompt may use. */
export const CONTEXT_WORD_LIMITS = Object.freeze([...contextPolicy.wordLimits]);

/** Recorded steps of a paired private answer, from the route checks to the first character (private-computers.js). */
export const TIMELINE_STEPS = Object.freeze({ 'route-checks': 'Route checks began', 'sent-to-host': 'Sent to your native host',
  'host-received': 'Host received the request', 'route-checked': 'Host checked the route', 'credit-reserved': 'Credits reserved; provider asked to admit',
  'first-delta': 'Host received the first output', 'first-delta-received': 'First output reached this browser' });

const measuredMs = value => Number.isFinite(value) && value >= 0 ? `${Math.round(value)} ms` : 'Not reported';
const seconds = value => `${(value / 1000).toFixed(2)} s`;

/** The state with only the inspected attempt, when one is selected and still in the selected thread. */
export function inspectedState(state, inspected) {
  if (!inspected || inspected.threadId !== state.selectedId) return state;
  const attempt = state.activeThread?.attempts?.find(item => item.id === inspected.attemptId);
  return attempt ? { ...state, activeThread: { ...state.activeThread, attempts: [attempt] } } : state;
}

/** The route as nodes: the requester (unless it executes), then each executor, with the model over the executors. */
function projectRoute(view) {
  if (!view.executors.length) return null; // No invented route before admission.
  return {
    requester: view.requesterExecutes ? null : { label: 'You', caption: 'Request / output' },
    model: view.model,
    executors: view.executors.map(node => ({ id: node.id, label: node.label, caption: node.id === view.requester ? 'Request / output' : '' }))
  };
}

/** The execution facts the vanilla "Execution details" disclosure lists (execution-ribbon.js detailMarkup). */
function projectExecutionFacts(view) {
  const facts = [['Requester / output recipient', view.requester], ['Model', view.model || 'No executor assigned']];
  if (view.adapter) facts.push(['Recorded adapter', view.adapter]);
  facts.push(['Attempt duration', `${measuredMs(view.totalMs)}${view.totalMs === null && view.active ? ' · in progress' : ''}`]);
  facts.push(['Activation transfer', `${view.activationBytes === null ? 'Not reported' : `${view.activationBytes.toLocaleString()} bytes`} · ${measuredMs(view.transferMs)}`]);
  const notes = [];
  if (view.split) notes.push('Output returns through the first executor. Step times include runtime and transport overhead; they are not GPU-only measurements.');
  if (!view.requesterExecutes && view.executors.length) notes.push('Receiving the answer does not require model weights on this device.');
  if (view.execution?.serviceCredit) notes.push(`Service credits: ${serviceCreditOutcomeText(view.execution.serviceCredit)}`);
  return {
    error: view.attempt?.error || null,
    facts,
    executors: view.executors.map(node => ({ id: node.id, label: node.label, facts: [
      ['Assigned layers', node.layers], ['Contribution', node.contribution],
      ...(node.recordedGpu ? [['GPU', node.recordedGpu]] : []),
      [view.split ? 'Recorded step time' : 'Compute time', measuredMs(node.duration)]
    ] })),
    noExecutor: view.executors.length ? null : 'No executing participant has been assigned to this attempt.',
    notes,
    planId: view.planId || null
  };
}

/** The inspected answer's activity: the vanilla inspector's "Last answer" block (execution-activity.js updateExecutionDetail). */
export function projectExecutionDetail(state) {
  const view = projectExecutionActivity(state), supply = projectSupplyLabel(view.attempt);
  if (!view.attempt) return null;
  const summary = [view.statusLabel, ...(view.nodes.length ? [`${view.computerCount} computer${view.computerCount === 1 ? '' : 's'}`] : []),
    ...(view.split ? ['Partitioned'] : []), ...(supply.answer ? [supply.answer] : [])].join(' · ');
  const measured = view.nodes.length > 0 && view.nodes.every(node => node.share !== null);
  const timings = view.execution?.timing;
  const facts = [
    ['First token', timings?.firstTokenMs], ['Prompt processing', timings?.prefillMs],
    ['Decode', timings?.decodeMs], ['Generation total', timings?.totalMs],
    ['Admission wait', view.execution?.admission?.queuedMs], ['Attempt total', view.totalMs]
  ].filter(([, value]) => Number.isFinite(value) && value >= 0).map(([label, value]) => [label, seconds(value)]);
  const outputTokens = timings?.generatedTokenCount ?? view.execution?.completion?.generatedTokenCount;
  if (Number.isSafeInteger(outputTokens) && outputTokens >= 0) facts.push(['Output tokens', outputTokens.toLocaleString()]);
  const phases = view.execution?.stepSummary?.phases;
  const stageTotal = (stages, read) => view.ordered && stages?.length === view.nodes.length
    && view.nodes.every((_, index) => stages.filter(stage => stage.partitionIndex === index).length === 1)
    && stages.every(stage => Number.isFinite(read(stage)) && read(stage) >= 0)
    ? stages.reduce((total, stage) => total + read(stage), 0) : null;
  const promptMs = stageTotal(phases?.prompt?.stages, stage => stage.elapsedMs);
  const decodeMs = stageTotal(phases?.decode?.stages, stage => phases.decode.steps > 0
    && stage.elapsedMs?.count === phases.decode.steps ? stage.elapsedMs.total : null);
  if (promptMs !== null) facts.push(['Recorded prompt-stage time', seconds(promptMs)]);
  if (decodeMs !== null) facts.push(['Recorded decode-stage time', seconds(decodeMs)]);
  const inputTokens = view.execution?.completion?.promptTokenCount ?? phases?.prompt?.inputTokens;
  if (Number.isSafeInteger(inputTokens) && inputTokens >= 0) facts.push(['Prompt tokens', inputTokens.toLocaleString()]);
  if (Number.isSafeInteger(timings?.reusedPrefixTokens) && timings.reusedPrefixTokens > 0) {
    facts.push(['Cached prefix tokens', timings.reusedPrefixTokens.toLocaleString()]);
    if (Number.isSafeInteger(timings?.prefillComputedTokens) && timings.prefillComputedTokens >= 0) {
      facts.push(['Computed prompt tokens', timings.prefillComputedTokens.toLocaleString()]);
    }
  }
  const admission = view.execution?.admission;
  if (view.status === 'queued' && Number.isSafeInteger(admission?.queuePosition) && admission.queuePosition > 0
    && Number.isSafeInteger(admission?.queuedCount) && admission.queuedCount >= admission.queuePosition) {
    facts.push(['Queue position', `${admission.queuePosition} of ${admission.queuedCount}`]);
  }
  const credit = view.execution?.serviceCredit;
  if (credit) facts.push(['Service credits', serviceCreditOutcomeText(credit)]);
  const transfer = view.execution?.stepSummary?.metrics?.transferMs;
  const transferMs = view.transferMs ?? (transfer?.count > 0 && transfer.count === view.execution.stepSummary.count ? transfer.total : null);
  if (Number.isFinite(transferMs) && transferMs >= 0) facts.push(['Activation transfer time', seconds(transferMs)]);
  if (Number.isSafeInteger(view.activationBytes) && view.activationBytes >= 0) facts.push(['Activation data', `${view.activationBytes.toLocaleString()} bytes`]);
  const distribution = measured && view.split ? view.nodes.map(node => ({ label: node.label, share: node.share })) : null;
  return {
    attemptId: view.attempt.id,
    summary,
    distribution,
    distributionLabel: distribution ? `Recorded step time share: ${distribution.map(node => `${node.label} ${Math.round(node.share * 100)}%`).join(', ')}` : null,
    // A hosted or unreported executor has no computers to list; only its supply label is shown.
    nodes: view.nodes.map(node => ({
      id: node.id,
      label: `${node.label}${view.split ? ` · ${node.layers}` : ''}`,
      value: `${measured && view.split ? `${Math.round(node.share * 100)}% · ` : ''}${node.speed === null ? view.split ? 'Timing not recorded' : node.layers : `${node.speed.toFixed(1)} ${view.split ? 'steps/s' : 'tok/s'}`}`,
      gpu: node.recordedGpu || null
    })),
    footnote: !view.nodes.length ? null : measured && !view.split ? 'Generation average · includes prompt processing'
      : measured ? 'Step-time share · includes overhead' : view.active ? 'Timing pending' : 'Timing not recorded',
    footnoteTitle: measured && view.split ? 'Includes runtime and transport overhead, not GPU-only speed or completion progress.' : null,
    attemptSupply: supply.attempt ? `This attempt: ${supply.attempt}` : null,
    adapter: view.adapter ? `Adapter · ${view.adapter}` : null,
    facts,
    error: view.attempt.error || null
  };
}

/** The timeline of the inspected attempt, as the vanilla inspector lists it. */
function projectTimeline(view) {
  const events = [];
  if (Number.isFinite(view.attempt?.createdAt)) events.push(`Started ${new Date(view.attempt.createdAt).toLocaleTimeString()}`);
  for (const { step, at, clock } of Array.isArray(view.execution?.timeline) ? view.execution.timeline : []) {
    if (!TIMELINE_STEPS[step] || !Number.isFinite(at)) continue;
    const since = Number.isFinite(view.attempt?.createdAt) ? ` (+${Math.max(0, at - view.attempt.createdAt).toLocaleString()} ms)` : '';
    events.push(`${TIMELINE_STEPS[step]} ${new Date(at).toISOString().slice(11, 23)} UTC${since}${clock === 'host' ? ' · host clock' : ''}`);
  }
  if (Number.isFinite(view.attempt?.finishedAt)) events.push(`${view.statusLabel} ${new Date(view.attempt.finishedAt).toLocaleTimeString()}`);
  return events.length ? events : ['No recorded attempt events.'];
}

/**
 * Everything the Conversation details pane shows. `labels` is the session whose computer names and blocks label
 * computers (the chat session); `inspected` is { threadId, attemptId } of a selected answer, or null for the last one.
 */
export function projectConversationDetails(snapshot, { labels = snapshot, inspected = null } = {}) {
  const state = withComputerLabels(snapshot, labels);
  const selected = inspectedState(state, inspected);
  const selecting = selected !== state;
  const view = projectExecutionRibbon(selected);
  const contextTitle = projectContextIndicator(selected, labels).title;
  const grants = (state.activeThread?.grants || []).filter(grant => grant.revokedAt === null);
  const serviceCredit = view.execution?.serviceCredit || null;
  return {
    threadId: state.selectedId ?? null,
    hasAttempt: !!view.attempt,
    statusLabel: view.statusLabel,
    route: view.attempt ? projectRoute(view) : null,
    activity: projectExecutionDetail(selected),
    execution: view.attempt ? projectExecutionFacts(view) : null,
    timeline: view.attempt ? projectTimeline(view) : [],
    // The service credit request behind this answer, which a paired host can issue a receipt for.
    creditRequest: serviceCredit?.id || null,
    creditPending: !!serviceCredit && typeof serviceCredit.settledAt !== 'number' && !view.active,
    receiptAvailable: !!serviceCredit?.id && !!state.privateComputers?.connected,
    contextDetail: view.attempt
      ? (selecting ? contextTitle.replace('Last answer', 'Selected answer').replace('Last execution', 'Selected execution') : contextTitle)
      : 'Context usage appears after an answer.',
    grants: grants.map((grant, index) => ({ id: grant.id, title: `Recipient ${index + 1}`, status: state.activeThread.model.name,
      record: JSON.stringify(grant, null, 2) })),
    canDownload: !!state.activeThread?.messages?.length,
    busy: (state.runningIds || []).includes(state.selectedId) || !!state.comparisonPhase,
    closed: !!state.activeThread?.closed
  };
}

/** The ledger's word for a service receipt: a pending hold may have settled or been released since the answer recorded it. */
export function ledgerOutcomeText(receipt, prefix) {
  const outcome = serviceCreditOutcomeText(receipt.state === 'settled' ? receipt.outcome
    : { status: receipt.state === 'abandoned' ? 'abandoned' : 'pending', heldCredits: receipt.binding?.maximum });
  return `${prefix} · ${outcome}`;
}
