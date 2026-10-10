/** Retain controls and keyboard focus when background conversations change. */
export function createConversationList(list, seen = new Map()) {
  const rows = new Map();
  return {
    update(threads, selectedId) {
      const visible = threads.filter(thread => !thread.closed);
      for (const [index, thread] of visible.entries()) {
        let button = rows.get(thread.id);
        if (!button) {
          button = list.ownerDocument.createElement('button'); button.type = 'button';
          button.className = 'chat-thread-item'; button.dataset.threadItemId = thread.id;
          button.append(list.ownerDocument.createElement('span'), list.ownerDocument.createElement('small'));
          rows.set(thread.id, button);
        }
        const attempt = thread.attempts.at(-1), status = attempt?.status || '';
        const completion = `${attempt?.id || ''}:${status}`;
        if (thread.id === selectedId) seen.set(thread.id, completion);
        const label = status === 'completed' ? seen.get(thread.id) === completion ? 'Complete' : 'New answer' : status;
        const title = thread.purpose || thread.messages.find(message => message.role === 'user')?.content || 'New thread';
        if (button.firstElementChild.textContent !== title) button.firstElementChild.textContent = title;
        if (button.lastElementChild.textContent !== label) button.lastElementChild.textContent = label;
        button.lastElementChild.hidden = !label;
        button.setAttribute('aria-current', String(thread.id === selectedId));
        if (list.children[index] !== button) list.insertBefore(button, list.children[index] || null);
      }
      const ids = new Set(visible.map(thread => thread.id));
      for (const [id, row] of rows) if (!ids.has(id)) { row.remove(); rows.delete(id); seen.delete(id); }
    },
    dispose() { rows.clear(); }
  };
}
