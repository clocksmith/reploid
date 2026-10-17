/** Per-answer permission for a search-backed answer. The host supplies the approved wording and the execution
 * contributors this answer may reach; this view shows the wording exactly, lists the contributors with the
 * session's computer labels, and reports the person's choice. It is asked for every search-backed answer and
 * stores nothing; the remote-contributor permission stays separate. */
import { withComputerLabels, computerLabel } from './computer-labels.js';

export function renderSearchPermissionDialog() {
  return `<dialog class="chat-model-setup pool-surface pool-small" data-search-permission aria-labelledby="chat-search-permission-title" aria-describedby="chat-search-permission-body">
    <h2 class="pool-heading" id="chat-search-permission-title">Search for this answer?</h2>
    <div id="chat-search-permission-body"><p data-search-permission-text></p>
      <label>Search query<textarea class="pool-input" rows="3" maxlength="512" data-search-query></textarea></label>
      <label class="pool-row pool-gap-sm" data-search-context-choice hidden><input type="checkbox" data-search-context><span>Include my previous question as context</span></label>
      <p class="pool-muted">Search sends the query shown above. The model receives your question, this query, and retrieved sources. Review the query before allowing search.</p>
      <p data-search-permission-server hidden>Search server: <span data-search-permission-server-host></span></p>
      <p data-search-permission-peer hidden>Search contributor: <span data-search-permission-peer-label></span></p>
      <p data-search-permission-recipients-label>Execution contributors:</p><ul data-search-permission-recipients></ul></div>
    <div class="chat-network-actions"><button class="pool-button" type="button" data-search-permission-decline>Don't search</button>
      <button class="pool-button btn-primary" type="button" data-search-permission-allow>Allow</button></div>
  </dialog>`;
}

/** `ask(request)` shows `request.wording.text`, any person-chosen search server and the recipients; resolves true only on Allow. */
export function bindSearchPermissionDialog(dialog, session) {
  const find = selector => dialog.querySelector(selector), controller = new AbortController(), options = { signal: controller.signal };
  let pending = null, opener = null;
  const validQuery = () => { const input = find('[data-search-query]'); return !!input.value.trim() && input.value.trim().length <= input.maxLength; };
  const updateAllow = () => { find('[data-search-permission-allow]').disabled = !validQuery(); };
  const finish = value => { const done = pending; pending = null; if (dialog.open) dialog.close(); done?.(value); };
  find('[data-search-permission-decline]').addEventListener('click', () => finish(false), options);
  find('[data-search-permission-allow]').addEventListener('click', () => { if (validQuery()) finish(true); }, options);
  find('[data-search-query]').addEventListener('input', updateAllow, options);
  dialog.addEventListener('close', () => { opener?.isConnected && opener.focus({ preventScroll: true }); finish(false); }, options);
  return {
    get open() { return dialog.open; },
    get query() { return find('[data-search-query]').value.trim(); },
    ask({ wording, recipients, searchServer = null, searchPeer = null, query = '', previousQuestion = null }) {
      if (pending) return Promise.resolve(false);
      find('[data-search-permission-text]').textContent = wording.text;
      const input = find('[data-search-query]'), context = find('[data-search-context]');
      input.value = query; context.checked = false;
      const contextual = previousQuestion ? `${previousQuestion}\nFollow-up: ${query}` : '';
      find('[data-search-context-choice]').hidden = !previousQuestion || contextual.length > input.maxLength;
      context.onchange = () => { input.value = context.checked ? contextual : query; updateAllow(); };
      updateAllow();
      // A person-chosen search server is named; the permission covers that server only.
      find('[data-search-permission-server]').hidden = !searchServer;
      find('[data-search-permission-server-host]').textContent = searchServer || '';
      const state = withComputerLabels(session.getState(), session), list = find('[data-search-permission-recipients]');
      find('[data-search-permission-peer]').hidden = !searchPeer;
      find('[data-search-permission-peer-label]').textContent = searchPeer ? `${computerLabel(state, searchPeer)} (${searchPeer})` : '';
      list.replaceChildren(...(recipients.length ? recipients : [null]).map(id => {
        const item = dialog.ownerDocument.createElement('li');
        item.textContent = id === null ? 'None. This answer runs on this device.' : computerLabel(state, id);
        return item;
      }));
      opener = dialog.ownerDocument.activeElement;
      return new Promise(resolve => { pending = resolve; dialog.showModal(); find('[data-search-permission-allow]').focus(); });
    },
    dispose() { controller.abort(); finish(false); }
  };
}
