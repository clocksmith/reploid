import { bindDisclosure } from '../components/disclosure.js';
import { projectThreadContext, renderContextRing, updateContextRing } from './context-indicator.js';

const activityTime = thread => thread.attempts.at(-1)?.finishedAt ?? thread.attempts.at(-1)?.createdAt ?? thread.createdAt;
function relativeTime(timestamp, now) {
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
/** Retain controls and keyboard focus when background conversations change. */
export function createConversationList(list, seen = new Map(), { getSources, now = Date.now } = {}) {
  const rows = new Map(), menus = new Map();
  // Refresh relative times without replacing rows, polling execution, or moving focus.
  const refreshTimes = () => {
    for (const row of rows.values()) {
      const time = row.querySelector('time');
      if (!time.hidden) time.textContent = relativeTime(Number(time.dataset.timestamp), now());
    }
  };
  let timer = null;
  return {
    update(threads, selectedId, { archived = false, models = [] } = {}) {
      const focused = list.contains(list.ownerDocument.activeElement) ? list.ownerDocument.activeElement : null;
      const recent = thread => thread.attempts.at(-1)?.createdAt ?? thread.createdAt ?? 0;
      const visible = threads.filter(thread => !!thread.closed === archived).sort((a, b) => recent(b) - recent(a));
      const workspace = list.closest('[data-chat-workspace]'), total = workspace?.querySelector('[data-thread-count]');
      if (total) {
        total.textContent = String(visible.length); total.hidden = !visible.length;
        total.title = `${visible.length} ${archived ? 'archived ' : ''}threads`;
        workspace.querySelector('[data-toggle-thread-rail]')?.setAttribute('aria-description', total.title);
      }
      for (const [index, thread] of visible.entries()) {
        let row = rows.get(thread.id), button = row?.querySelector('[data-thread-item-id]');
        if (!button) {
          button = list.ownerDocument.createElement('button'); button.type = 'button';
          button.className = 'chat-thread-item pool-button btn-ghost pool-activity-edge'; button.dataset.threadItemId = thread.id;
          button.innerHTML = `<span class="chat-thread-title pool-small"></span><small class="chat-thread-digest pool-caption pool-muted"></small><span class="chat-thread-shortcut pool-caption" aria-hidden="true">${renderContextRing()}<span data-thread-monogram></span></span><span class="chat-thread-mark pool-dot" data-thread-unread aria-hidden="true" hidden></span><span class="chat-thread-mark pool-caption" data-thread-attention aria-hidden="true" hidden>!</span><time class="chat-thread-time pool-caption pool-muted" hidden></time>`;
          row = list.ownerDocument.createElement('div'); row.className = 'chat-thread-row'; row.append(button);
          const menu = list.ownerDocument.createElement('details'); menu.className = 'chat-thread-menu';
          menu.innerHTML = '<summary class="pool-button btn-ghost" aria-label="Thread actions">…</summary><div class="pool-surface"><button class="pool-button" type="button" data-rename-thread>Rename</button><button class="pool-button" type="button" data-archive-thread></button></div>';
          for (const action of menu.querySelectorAll('button')) action.dataset.threadId = thread.id;
          menus.set(thread.id, bindDisclosure({ root: menu, trigger: menu.querySelector('summary'), panel: menu.querySelector('div'), native: true }));
          row.append(menu); rows.set(thread.id, row);
        }
        const attempt = thread.attempts.at(-1), status = attempt?.status || '';
        const completion = `${attempt?.id || ''}:${status}`;
        if (thread.id === selectedId) seen.set(thread.id, completion);
        const label = status === 'completed' ? seen.get(thread.id) === completion ? 'Complete' : 'New answer'
          : ({ queued: 'Queued', loading: 'Loading', executing: 'Generating', approval: 'Permission needed',
            cancelled: 'Stopped', cancelling: 'Stopping', failed: 'Failed', interrupted: 'Interrupted',
            disconnected: 'Disconnected', recovering: 'Recovering' }[status] || status);
        const firstInput = thread.messages.find(message => message.role === 'user')?.content;
        const sources = firstInput && getSources?.(firstInput);
        const title = thread.title || thread.purpose || (sources ? sources.question.split('\n')[0] : firstInput) || 'New thread';
        if (button.firstElementChild.textContent !== title) button.firstElementChild.textContent = title;
        const digest = button.querySelector('.chat-thread-digest');
        const summary = label || thread.model?.name || 'New thread';
        if (digest.textContent !== summary) digest.textContent = summary;
        const words = title.trim().split(/\s+/).filter(Boolean);
        button.querySelector('[data-thread-monogram]').textContent = (words.length > 1
          ? words.slice(0, 2).map(word => Array.from(word)[0]).join('') : Array.from(words[0] || '').slice(0, 2).join('')).toUpperCase() || String(index + 1);
        const context = projectThreadContext(thread, models);
        updateContextRing(button, context.percent);
        button.querySelector('[data-thread-unread]').hidden = label !== 'New answer';
        button.querySelector('[data-thread-attention]').hidden = !['approval', 'failed', 'interrupted', 'disconnected'].includes(status);
        const time = button.querySelector('time'), timestamp = activityTime(thread);
        time.hidden = !Number.isFinite(timestamp);
        if (!time.hidden) {
          time.dataset.timestamp = String(timestamp); time.dateTime = new Date(timestamp).toISOString();
          time.title = `Last activity: ${new Date(timestamp).toLocaleString()}`;
          time.textContent = relativeTime(timestamp, now());
        }
        button.setAttribute('aria-label', `${title}: ${summary}${context.percent === null ? '' : `, last answer ${context.text} of advertised context`}`);
        button.title = [title, summary, time.hidden ? '' : time.title, context.percent === null ? '' : context.usage].filter(Boolean).join('\n');
        button.dataset.activity = status === 'executing' ? 'executing' : 'idle';
        button.setAttribute('aria-current', String(thread.id === selectedId));
        row.querySelector('summary').setAttribute('aria-label', `Actions for ${title}`);
        row.querySelector('[data-archive-thread]').textContent = archived ? 'Restore' : 'Archive';
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      }
      const ids = new Set(visible.map(thread => thread.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); menus.get(id)?.dispose(); menus.delete(id); }
      if (rows.size && timer === null) timer = setInterval(refreshTimes, 60000);
      if (!rows.size && timer !== null) { clearInterval(timer); timer = null; }
      if (focused?.isConnected && list.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
    },
    dispose() { clearInterval(timer); menus.forEach(menu => menu.dispose()); menus.clear(); rows.clear(); }
  };
}
