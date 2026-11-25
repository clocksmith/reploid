/**
 * The transcript of the selected thread as records, one per shown message: its text, the answer's activity and
 * measurements, the system note for an answer that did not finish, earlier attempts folded into their retry,
 * retrieved sources and the actions it offers. The same decisions the vanilla message list renders
 * (ui/pool-home/message-list.js, execution-activity.js), without markup.
 *
 * Each record is kept until its own message or attempt changes, so a streaming answer re-projects only itself and
 * the cost of an update does not grow with the length of the conversation or the number of threads.
 */
import { answerPrivacy } from '../../ui/pool-home/privacy-controls.js';
import { failureLabel } from '../../ui/pool-home/message-list.js';
import { projectExecutionActivity, projectSupplyLabel, supplyCaption } from '../../ui/pool-home/execution-activity.js';

const FAILED = new Set(['failed', 'cancelled', 'interrupted']);
const AUTHOR_STATUS = { queued: 'Waiting…', loading: 'Preparing…', executing: 'Thinking…', cancelling: 'Stopping…' };

/** A cheap fingerprint of what a message's record depends on; never the attempt's request or history. */
function attemptSignature(attempt) {
  if (!attempt) return '';
  const execution = attempt.execution, retrieval = attempt.retrieval;
  return JSON.stringify([attempt.id, attempt.status, attempt.error ?? null, attempt.retryOf ?? null, attempt.createdAt ?? null, attempt.finishedAt ?? null,
    execution?.placement ?? null, execution?.peerId ?? null, execution?.timing ?? null, execution?.completion?.generatedTokenCount ?? null,
    execution?.admission?.queuePosition ?? null, execution?.admission?.queuedCount ?? null, execution?.serviceCredit ?? null,
    execution?.receipt?.route ?? null, execution?.stepSummary?.count ?? null, execution?.steps?.length ?? null,
    retrieval?.outcome ?? null, retrieval?.partial ?? null, retrieval?.progress ?? null, retrieval?.sources?.length ?? null,
    attempt.provenance?.supply ?? null]);
}

/** The answer's activity line, as the vanilla execution-activity trigger states it. */
function projectActivity(state) {
  const view = projectExecutionActivity(state), supply = projectSupplyLabel(view.attempt);
  const retrieval = view.attempt?.retrieval, progress = retrieval?.progress;
  const toolStatus = view.active && retrieval?.outcome === 'pending'
    ? progress?.stage === 'extraction' ? `Reading search results · ${progress.completed} of ${progress.total} pages`
      : progress?.stage === 'context' ? 'Preparing search results…' : 'Searching the web…'
    : '';
  const hidden = !view.attempt || !view.active && !toolStatus && !view.nodes.length && !supply.answer && !view.attempt.error && !view.execution?.timing;
  if (hidden) return null;
  const admission = view.execution?.admission;
  const queueLabel = view.status === 'queued' && Number.isSafeInteger(admission?.queuePosition) && admission.queuePosition > 0
    && Number.isSafeInteger(admission?.queuedCount) && admission.queuedCount >= admission.queuePosition
    ? `Queued · ${admission.queuePosition} of ${admission.queuedCount}` : null;
  const summary = [toolStatus || queueLabel || (view.status === 'executing' ? 'Generating' : view.statusLabel),
    ...(view.nodes.length ? [`${view.computerCount} computer${view.computerCount === 1 ? '' : 's'}`] : []),
    ...(view.split ? ['Partitioned'] : []), ...(supply.answer ? [supply.answer] : [])].join(' · ');
  const supplyText = supplyCaption(view, supply);
  const readable = [view.model || (supplyText ? view.thread?.model?.name : ''), supplyText].filter(Boolean).join(' · ');
  const activeText = toolStatus || queueLabel || (view.execution?.privateDelegation && view.nodes.length
    ? `${view.model} · ${view.split ? 'split across ' : view.status === 'executing' ? 'running on ' : 'assigned to '}${view.nodes.map(node => node.label).join(' + ')}`
    : view.status === 'executing' ? 'Generating' : view.statusLabel);
  return {
    active: view.active, stopDisabled: view.status === 'cancelling', summary, label: `${summary}. Execution details`,
    title: summary + (view.nodes.length ? '\n' + view.nodes.map(node => node.label).join(' → ') : '') + (view.attempt.error ? '\n' + view.attempt.error : '') + '\nClick to inspect',
    icon: view.active ? null : toolStatus ? 'search' : view.local ? 'device' : view.nodes.length ? 'peers' : 'activity',
    count: view.computerCount || null, readable, activeText: view.active ? activeText : ''
  };
}

/** The four measurement slots beneath an answer: privacy, speed, tokens and time. An unrecorded one is empty. */
function projectMeasurements(thread, attempt, state) {
  const execution = attempt?.execution, timing = execution?.timing;
  const tokens = timing?.generatedTokenCount ?? execution?.completion?.generatedTokenCount;
  const view = projectExecutionActivity({ ...state, activeThread: { ...thread, attempts: attempt ? [attempt] : [] } });
  const [privacy, privacyDetail] = answerPrivacy(execution, state);
  const counted = Number.isSafeInteger(tokens) && tokens >= 0, timed = Number.isFinite(timing?.totalMs) && timing.totalMs > 0;
  return [
    { metric: 'privacy', icon: 'privacy', text: privacy, title: privacyDetail },
    { metric: 'activity', icon: 'activity', text: view.averageSpeed === null ? '' : `${view.averageSpeed.toFixed(1)} tok/s`,
      title: view.averageSpeed === null ? null : 'Generation average including prompt processing; excludes queue and model loading' },
    { metric: 'tokens', icon: 'tokens', text: counted ? `${tokens} ${tokens === 1 ? 'token' : 'tokens'}` : '', title: counted ? `${tokens} generated tokens` : null },
    { metric: 'clock', icon: 'clock', text: timed ? `${(timing.totalMs / 1000).toFixed(1)} s` : '', title: timed ? 'Generation time including prompt processing' : null }
  ];
}

/** `onProject` is told each time a message record is built, for tests that bound the work per update. */
export function createTranscript({ onProject = null } = {}) {
  let threadId = null, cache = new Map();
  return {
    /** Records for `thread`'s messages; `usable` and `busy` decide whether Retry is offered and enabled. */
    update(thread, { usable, busy, state, getSources = null }) {
      if (thread?.id !== threadId) { threadId = thread?.id ?? null; cache = new Map(); }
      if (!thread) return [];
      const attempts = new Map(thread.attempts.map(attempt => [attempt.id, attempt]));
      const retried = new Set(thread.attempts.map(attempt => attempt.retryOf).filter(Boolean));
      const collapsed = new Set(thread.messages.filter(message => message.role === 'assistant' && !message.content
        && retried.has(message.attemptId) && FAILED.has(attempts.get(message.attemptId)?.status)).map(message => message.attemptId));
      const lastAttemptId = thread.attempts.at(-1)?.id;
      const next = new Map(), rows = [];
      // A supplied document's passages stay linkable from the answers that follow the question that supplied it.
      let documentTargets = [];
      for (const [index, message] of thread.messages.entries()) {
        if (message.role === 'system') continue;
        if (message.role === 'assistant' && collapsed.has(message.attemptId)) continue;
        const id = message.id || `message-${index}`;
        const attempt = attempts.get(message.attemptId);
        const earlier = [], visited = new Set();
        let ancestor = attempt?.retryOf;
        while (collapsed.has(ancestor) && !visited.has(ancestor)) { visited.add(ancestor); earlier.unshift(attempts.get(ancestor)); ancestor = attempts.get(ancestor)?.retryOf; }
        const retryable = message.role === 'assistant' && !!attempt && FAILED.has(attempt.status) && attempt.id === lastAttemptId && !busy;
        const signature = [message.content, attemptSignature(attempt), earlier.map(attemptSignature).join('|'), retryable, usable, message.role,
          message.role === 'assistant' ? JSON.stringify(documentTargets) : ''].join('\u0000');
        const previous = cache.get(id);
        let row;
        if (previous?.signature === signature) { next.set(id, previous); row = previous.row; }
        else {
          row = projectRow({ thread, message, id, attempt, earlier, retryable, usable, state, getSources, documentTargets });
          onProject?.(id);
          next.set(id, { signature, row });
        }
        rows.push(row);
        if (row.role === 'user' && row.documents) documentTargets = row.markdownTargets;
      }
      cache = next;
      return rows;
    }
  };
}

function projectRow({ thread, message, id, attempt, earlier, retryable, usable, state, getSources, documentTargets = [] }) {
  const user = message.role === 'user';
  const source = user ? getSources?.(message.content) : null;
  const targets = [];
  const documents = source ? source.documents.map(document => ({ name: document.name, passages: document.passages.map(passage => {
    const anchor = `source-${message.id}-${passage.id.replace(':', '-')}`; targets.push([passage.id, anchor]);
    return { id: passage.id, anchor, text: passage.text };
  }) })) : null;
  const sources = !user && attempt?.retrieval?.outcome === 'retrieved' ? attempt.retrieval.sources : [];
  const anchor = number => `source-${message.id}-${number}`;
  const failed = !user && attempt && FAILED.has(attempt.status);
  const retrieval = attempt?.retrieval;
  let systemText = failed ? failureLabel(attempt) : '';
  if (!failed && retrieval?.partial) systemText = `Using ${retrieval.sources.length} retrieved source${retrieval.sources.length === 1 ? '' : 's'}. Some pages were unavailable.`;
  const activity = user ? null : projectActivity({ ...state, activeThread: { ...thread, attempts: attempt ? [attempt] : [] } });
  const authorStatus = user || message.content || activity || systemText ? '' : AUTHOR_STATUS[attempt?.status] || '';
  return Object.freeze({
    id, role: user ? 'user' : 'assistant', attemptId: attempt?.id ?? null,
    content: message.content, question: source ? source.question : null, documents,
    markdownTargets: sources.length ? sources.map(item => [String(item.number), anchor(item.number)]) : user ? targets : documentTargets,
    authorStatus, systemText, systemOnly: !user && !message.content,
    measurements: user || !message.content ? null : projectMeasurements(thread, attempt, state),
    activity,
    previousAttempts: earlier.map(item => `System · ${failureLabel(item)}`),
    sources: sources.map(item => ({ number: item.number, title: item.title, url: item.url, anchor: anchor(item.number) })),
    retry: retryable ? { attemptId: attempt.id, disabled: !usable } : null,
    copy: !!message.content,
    error: attempt?.error && failed ? attempt.error : null
  });
}
