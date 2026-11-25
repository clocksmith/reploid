import type { AttemptStatus, ChatMessage, Receipt, ThreadSummary } from '../domain/chat';
import type { AnswerDecisions } from '../domain/decisions';
import type { HostAttempt, HostChatState, HostThread } from '../domain/session';

const STATUSES: ReadonlySet<string> = new Set([
  'queued', 'loading', 'executing', 'approval', 'completed', 'cancelled', 'cancelling', 'failed', 'interrupted', 'disconnected', 'recovering',
]);
const asStatus = (value: string | undefined): AttemptStatus | undefined => (value && STATUSES.has(value) ? (value as AttemptStatus) : undefined);

const activityTime = (thread: HostThread) => thread.attempts.at(-1)?.finishedAt ?? thread.attempts.at(-1)?.createdAt ?? thread.createdAt;

/** Relative time of the last activity: now, minutes, hours or days. */
export function relativeTime(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/** A thread's title: its name, its purpose, or its first question. */
export const threadTitle = (thread: HostThread, fallback: string) =>
  thread.title || thread.purpose || thread.messages.find((message) => message.role === 'user')?.content.split('\n')[0] || fallback;

/**
 * Threads for one history view, most recent first. `seen` records the completion each thread
 * last showed while it was selected, so a newer one reads as a new answer.
 */
export function projectThreads(
  state: HostChatState,
  view: 'active' | 'archived',
  seen: ReadonlyMap<string, string>,
  now: number,
  fallbackTitle: string,
): ThreadSummary[] {
  const recent = (thread: HostThread) => thread.attempts.at(-1)?.createdAt ?? thread.createdAt ?? 0;
  return state.threads
    .filter((thread) => Boolean(thread.closed) === (view === 'archived'))
    .slice()
    .sort((a, b) => recent(b) - recent(a))
    .map((thread) => {
      const attempt = thread.attempts.at(-1);
      const completion = `${attempt?.id ?? ''}:${attempt?.status ?? ''}`;
      const unread = attempt?.status === 'completed' && thread.id !== state.selectedId && seen.get(thread.id) !== completion;
      return {
        id: thread.id,
        title: threadTitle(thread, fallbackTitle),
        status: asStatus(attempt?.status) ?? 'new',
        time: relativeTime(activityTime(thread), now),
        unread,
      };
    });
}

/** The completion marker `projectThreads` compares, for the thread the person is looking at. */
export const completionOf = (thread: HostThread) => `${thread.attempts.at(-1)?.id ?? ''}:${thread.attempts.at(-1)?.status ?? ''}`;

const seconds = (ms: number | undefined) => (ms !== undefined && Number.isFinite(ms) && ms > 0 ? `${(ms / 1000).toFixed(1)} s` : '—');

/** Where and how one answer ran, from its recorded execution. Unrecorded facts say so. */
export function projectReceipt(thread: HostThread, attempt: HostAttempt, state: HostChatState, decisions: AnswerDecisions): Receipt {
  const [summary, detail] = decisions.answerPrivacy(attempt, state);
  const execution = attempt.execution;
  const tokens = execution?.timing?.generatedTokenCount ?? execution?.completion?.generatedTokenCount;
  const credit = execution?.serviceCredit;
  const settlement = !credit
    ? 'No service credits'
    : typeof credit.settledAt === 'number'
      ? `Settled${Number.isSafeInteger(credit.chargedCredits) ? `: ${credit.chargedCredits} credits` : ''}`
      : Number.isSafeInteger(credit.heldCredits) && (credit.heldCredits ?? 0) > 0
        ? `${credit.heldCredits} credits held until settled`
        : 'Not settled yet';
  return {
    computer: summary.replace(/^Readable by /, ''),
    model: decisions.modelLabel(thread.model),
    readBy: detail,
    duration: seconds(execution?.timing?.totalMs),
    tokens: Number.isSafeInteger(tokens) && (tokens ?? -1) >= 0 ? `${tokens} generated` : '—',
    settlement,
  };
}

/**
 * The transcript of one thread. A failed attempt that was retried collapses into its retry; a
 * failure keeps any partial text and adds the host's reason as a system note.
 */
export function projectMessages(thread: HostThread | null, state: HostChatState, decisions: AnswerDecisions): ChatMessage[] {
  if (!thread) return [];
  const attempts = new Map(thread.attempts.map((attempt) => [attempt.id, attempt]));
  const retried = new Set(thread.attempts.map((attempt) => attempt.retryOf).filter(Boolean));
  return thread.messages.flatMap((message, index): ChatMessage[] => {
    if (message.role === 'system') return [];
    const id = message.id ?? `message-${index}`;
    if (message.role === 'user') return [{ id, role: 'user', text: message.content }];
    const attempt = message.attemptId ? attempts.get(message.attemptId) : undefined;
    const status = asStatus(attempt?.status);
    const failed = attempt && ['failed', 'cancelled', 'interrupted'].includes(attempt.status);
    if (failed && !message.content && retried.has(attempt.id)) return [];
    return [
      {
        id,
        role: 'assistant',
        text: message.content,
        ...(failed && attempt ? { systemNote: decisions.failureLabel(attempt) } : {}),
        ...(status ? { status } : {}),
        ...(attempt && status === 'completed' ? { receipt: projectReceipt(thread, attempt, state, decisions) } : {}),
      },
    ];
  });
}
