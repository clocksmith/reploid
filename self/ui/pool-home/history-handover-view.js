/** Tab handover for conversation history (host/history-handover.js). Shows where the
 * history is open and offers to use it here; it never claims to switch tabs. */
const TEXT = Object.freeze({
  elsewhere: 'Active in another tab.',
  moved: 'Moved to another tab.',
  failed: 'The other tab didn\'t respond.'
});

export function renderHistoryHandover() {
  return `<div class="chat-history-handover pool-well pool-row pool-row-between pool-gap-sm" data-history-handover hidden>
    <span class="pool-small" role="status" data-history-handover-text></span>
    <button class="pool-button btn-primary" type="button" data-history-handover-take>Use this tab</button>
  </div>`;
}

/** Binds a rendered handover notice; visible only while another tab holds the history. */
export function bindHistoryHandover(root, handover) {
  const node = root?.querySelector('[data-history-handover]');
  if (!node || !handover) return () => {};
  const text = node.querySelector('[data-history-handover-text]'), take = node.querySelector('[data-history-handover-take]');
  const update = ({ state, failed }) => {
    const away = ['elsewhere', 'moved', 'waiting'].includes(state);
    node.hidden = !away;
    take.disabled = state === 'waiting';
    if (away) text.textContent = failed ? TEXT.failed : state === 'moved' ? TEXT.moved : TEXT.elsewhere;
  };
  take.onclick = () => { void handover.request(); };
  const unsubscribe = handover.subscribe(update);
  return () => { unsubscribe(); take.onclick = null; };
}

/** The page a tab shows after handing its history to another tab. */
export function renderHandedOver(mount, handover, theme) {
  mount.innerHTML = `<main class="pool-home pool-boot-failure">${renderHistoryHandover()}</main>`;
  const page = mount.querySelector('.pool-home');
  if (theme) page.dataset.poolTheme = theme;
  return bindHistoryHandover(page, handover);
}
