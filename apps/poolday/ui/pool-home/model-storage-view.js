/**
 * @fileoverview Settings storage view: lists measured model downloads and confirms removal.
 * Inventory and guarded removal belong to host/model-storage.js, passed in by the session.
 */
import { bindDialog } from '../components/dialog.js';
import { renderDialog } from '../components/choices.js';

export const renderModelStorage = () => `<div class="pool-stack pool-gap-sm" data-model-storage hidden>
  <ul class="pool-list pool-stack pool-gap-sm" data-stored-models hidden></ul>
  <div class="pool-row pool-row-between pool-gap-sm"><p class="pool-status-line pool-caption pool-muted pool-grow" data-storage-status role="status"></p>
  <button class="pool-button btn-ghost pool-caption" type="button" data-storage-refresh>Refresh</button></div>
  ${renderDialog({ titleId: 'storage-remove-title', title: 'Remove download?', attrs: { 'data-storage-dialog': true }, closeAttrs: { 'data-dialog-close': true },
    body: '<p class="pool-body" data-storage-remove-name></p><p class="pool-small pool-muted">Conversation history stays. Files used by other models stay. Download this model again to run it locally.</p>',
    footer: '<p class="pool-status-line" data-storage-remove-error role="alert" hidden></p><button class="pool-button btn-ghost" type="button" data-storage-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-storage-confirm>Remove download</button>' })}
</div>`;

export function bindModelStorage(root, storage) {
  if (!storage) return { refresh() {}, dispose() {} };
  const find = selector => root.querySelector(selector), list = find('[data-stored-models]');
  const abort = new AbortController(), options = { signal: abort.signal };
  const dialog = bindDialog(find('[data-storage-dialog]'));
  let selected = null, removing = false, revision = 0;
  find('[data-model-storage]').hidden = false;
  const refresh = async () => {
    const current = ++revision;
    find('[data-storage-status]').textContent = 'Checking stored files…';
    try {
      const rows = await storage.list();
      if (abort.signal.aborted || current !== revision) return;
      list.replaceChildren(...rows.map(row => {
        const li = document.createElement('li'); li.className = 'pool-toggle-row';
        const label = document.createElement('span'); label.className = 'pool-row-title';
        label.textContent = `${row.name} · ${(row.sizeBytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'pool-button btn-ghost';
        button.textContent = 'Remove'; button.setAttribute('aria-label', `Remove ${row.name} download`);
        button.addEventListener('click', () => {
          selected = row; find('[data-storage-remove-name]').textContent = row.name;
          find('[data-storage-remove-error]').hidden = true;
          dialog.open(find('[data-storage-cancel]'), button);
        }, options);
        li.append(label, button); return li;
      }));
      list.hidden = !rows.length;
      find('[data-storage-status]').textContent = rows.length
        ? 'Measured stored files, including partial downloads. Shared files may count toward more than one model.' : 'No model downloads stored.';
    } catch (error) {
      if (!abort.signal.aborted && current === revision) find('[data-storage-status]').textContent = error.message;
    }
  };
  find('[data-storage-refresh]').addEventListener('click', refresh, options);
  find('[data-storage-cancel]').addEventListener('click', () => dialog.close(), options);
  find('[data-storage-confirm]').addEventListener('click', async () => {
    if (!selected || removing) return;
    removing = true; find('[data-storage-confirm]').disabled = true;
    try { await storage.remove(selected.id); dialog.close(); await refresh(); }
    catch (error) { if (!abort.signal.aborted) { find('[data-storage-remove-error]').textContent = error.message; find('[data-storage-remove-error]').hidden = false; } }
    finally { removing = false; if (!abort.signal.aborted) find('[data-storage-confirm]').disabled = false; }
  }, options);
  return { refresh, dispose() { abort.abort(); revision++; dialog.dispose(); } };
}
