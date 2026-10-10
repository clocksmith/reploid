import { bindDisclosure } from '../components/disclosure.js';
/** Retain controls and keyboard focus when background conversations change. */
export function createConversationList(list, seen = new Map()) {
  const rows = new Map(), menus = new Map();
  return {
    update(threads, selectedId, { archived = false } = {}) {
      const visible = threads.filter(thread => !!thread.closed === archived);
      for (const [index, thread] of visible.entries()) {
        let row = rows.get(thread.id), button = row?.querySelector('[data-thread-item-id]');
        if (!button) {
          button = list.ownerDocument.createElement('button'); button.type = 'button';
          button.className = 'chat-thread-item'; button.dataset.threadItemId = thread.id;
          button.append(list.ownerDocument.createElement('span'), list.ownerDocument.createElement('small'));
          row = list.ownerDocument.createElement('div'); row.className = 'chat-thread-row'; row.append(button);
          const menu = list.ownerDocument.createElement('details'); menu.className = 'chat-thread-menu';
          menu.innerHTML = '<summary class="pool-button" aria-label="Thread actions">…</summary><div><button class="pool-button" type="button" data-rename-thread>Rename</button><button class="pool-button" type="button" data-archive-thread></button></div>';
          for (const action of menu.querySelectorAll('button')) action.dataset.threadId = thread.id;
          menus.set(thread.id, bindDisclosure({ root: menu, trigger: menu.querySelector('summary'), panel: menu.querySelector('div'), native: true }));
          row.append(menu); rows.set(thread.id, row);
        }
        const attempt = thread.attempts.at(-1), status = attempt?.status || '';
        const completion = `${attempt?.id || ''}:${status}`;
        if (thread.id === selectedId) seen.set(thread.id, completion);
        const label = status === 'completed' ? seen.get(thread.id) === completion ? 'Complete' : 'New answer' : status;
        const title = thread.title || thread.purpose || thread.messages.find(message => message.role === 'user')?.content || 'New thread';
        if (button.firstElementChild.textContent !== title) button.firstElementChild.textContent = title;
        if (button.lastElementChild.textContent !== label) button.lastElementChild.textContent = label;
        button.lastElementChild.hidden = !label;
        button.setAttribute('aria-current', String(thread.id === selectedId));
        row.querySelector('summary').setAttribute('aria-label', `Actions for ${title}`);
        row.querySelector('[data-archive-thread]').textContent = archived ? 'Restore' : 'Archive';
        if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      }
      const ids = new Set(visible.map(thread => thread.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); menus.get(id)?.dispose(); menus.delete(id); }
    },
    dispose() { menus.forEach(menu => menu.dispose()); menus.clear(); rows.clear(); }
  };
}
