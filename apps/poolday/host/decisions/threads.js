/**
 * The Threads list of the conversation workspace: one row per thread with its title, status, age and context use,
 * the archived view, rename, and the clock that moves ages on. Moved here from the conversation controller
 * (conversation-controller.js), which composes it; the session owns the threads themselves.
 */
import { projectThreadContext } from '../../ui/pool-home/context-indicator.js';

const THREAD_LABELS = { queued: 'Queued', loading: 'Loading', executing: 'Generating', approval: 'Permission needed', cancelled: 'Stopped',
  cancelling: 'Stopping', failed: 'Failed', interrupted: 'Interrupted', disconnected: 'Disconnected', recovering: 'Recovering' };
const ATTENTION = new Set(['queued', 'loading', 'recovering', 'cancelling', 'approval', 'failed', 'interrupted', 'disconnected']);
const activityTime = thread => thread.attempts.at(-1)?.finishedAt ?? thread.attempts.at(-1)?.createdAt ?? thread.createdAt;
const recent = item => item.attempts.at(-1)?.createdAt ?? item.createdAt ?? 0;
/** A thread's status line: a completed answer is New until the person has seen it. */
const statusLabel = (status, seen) => {
  if (status !== 'completed') return THREAD_LABELS[status] || status;
  return seen ? 'Complete' : 'New answer';
};
const CLOSED_RENAME = Object.freeze({ open: false, id: null, value: '' });
/** A thread's name where it has none of its own: its purpose, else its first question. */
const fallbackTitle = (item, firstInput) => item.title || item.purpose || firstInput || 'New thread';

/** Relative time of the last activity: now, minutes, hours or days. */
export function relativeTime(timestamp, now) {
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

/**
 * `viewState.seen` remembers which completed answer the person has seen, per thread, across remounts. `act` runs a
 * session command and reports its error; `saveDraft` saves the composer before a thread changes.
 */
export function createThreadList({ session, getState, notify, now, act, requestFocus, saveDraft, viewState, disposed }) {
  let archived = false, rename = CLOSED_RENAME, clock = null;
  viewState.seen ??= new Map();
  const tick = () => notify();
  return {
    /** The list as the snapshot shows it. It also marks the selected thread's answer as seen. */
    project(state, catalogModels) {
      const time = now();
      const items = (state.threads || []).filter(item => !!item.closed === archived).sort((a, b) => recent(b) - recent(a)).map(item => {
        const attempt = item.attempts.at(-1), status = attempt?.status || '';
        const completion = `${attempt?.id || ''}:${status}`;
        if (item.id === state.selectedId) viewState.seen.set(item.id, completion);
        const label = statusLabel(status, viewState.seen.get(item.id) === completion);
        const firstInput = item.messages.find(message => message.role === 'user')?.content;
        const sources = firstInput && session.getDocumentSources?.(firstInput);
        const title = fallbackTitle(item, sources ? sources.question.split('\n')[0] : firstInput);
        const summary = label || item.model?.name || 'New thread';
        const timestamp = activityTime(item);
        return { id: item.id, title, summary, current: item.id === state.selectedId, monogram: Array.from(title.trim())[0]?.toUpperCase() || 'N',
          working: status === 'executing', unread: label === 'New answer', attention: ATTENTION.has(status),
          time: Number.isFinite(timestamp) ? relativeTime(timestamp, time) : '', timestamp: Number.isFinite(timestamp) ? timestamp : null,
          // How much of the model's advertised context the last answer used, when the record says.
          context: (({ percent, text }) => percent === null ? null : { percent: Math.round(percent), text })(projectThreadContext(item, catalogModels)) };
      });
      // Ages ("3m") move on while threads are listed, without any other change; nothing ticks with no threads.
      if (items.some(item => item.time) && !clock && !disposed()) clock = setInterval(tick, 60000);
      else if (!items.some(item => item.time) && clock) { clearInterval(clock); clock = null; }
      return { archived, items, empty: archived ? 'No archived threads.' : 'No threads yet.' };
    },
    renameView: () => ({ ...rename }),
    /** Back to the current threads, as New thread does. */
    showCurrent() { archived = false; },
    showArchived(value) { archived = !!value; notify(); },
    archiveThread(id) {
      void act(async () => {
        await saveDraft();
        if (archived) { archived = false; await session.restoreThread(id); } else await session.archiveThread(id);
        requestFocus('threads'); notify();
      });
    },
    openRename(id) {
      const item = getState().threads.find(entry => entry.id === id);
      if (!item) return;
      rename = { open: true, id, value: fallbackTitle(item, item.messages.find(message => message.role === 'user')?.content) };
      notify();
    },
    setRenameValue(value) { rename = { ...rename, value }; notify(); },
    closeRename() { rename = CLOSED_RENAME; notify(); },
    saveRename() {
      const { id, value } = rename;
      void act(async () => { await session.renameThread(id, value); rename = CLOSED_RENAME; notify(); });
    },
    dispose() { if (clock) clearInterval(clock); clock = null; }
  };
}
