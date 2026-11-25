/**
 * @fileoverview Settings view for exporting and importing this browser's conversations and per-computer
 * names and blocks. The file format, validation and merge rules belong to host/local-data.js.
 */
import { bindDialog } from '../components/dialog.js';
import { renderActionRow, renderDialog } from '../components/choices.js';
import { createLocalData, LOCAL_DATA_MAX_BYTES } from '../../host/local-data.js';

export const renderLocalData = () => `<section class="pool-section" data-settings-data hidden>
  <h3 class="pool-section-title">Your data</h3>
  <div class="pool-group">
    ${renderActionRow({ title: 'Export my data', status: 'One file: conversations, computer names and blocks', icon: 'download', attrs: { 'data-data-export': true } })}
    ${renderActionRow({ title: 'Import data', status: 'Adds conversations from an export file', icon: 'upload', attrs: { 'data-data-import': true } })}
  </div>
  <p class="pool-section-note">The file is not encrypted. It holds no private keys and no model files.</p>
  <input type="file" accept=".json,application/json" data-data-file aria-label="Data export file" hidden>
  <p class="pool-status-line pool-section-note" data-data-status role="status" hidden></p>
  ${renderDialog({ titleId: 'data-import-title', title: 'Import data?', attrs: { 'data-data-dialog': true }, closeAttrs: { 'data-dialog-close': true },
    body: '<p class="pool-body" data-data-summary></p><p class="pool-small pool-muted">Imported conversations are added to this browser. Nothing is sent, and sharing permissions are not imported.</p>',
    footer: '<p class="pool-status-line" data-data-error role="alert" hidden></p><button class="pool-button btn-ghost" type="button" data-data-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-data-confirm>Import</button>' })}
</section>`;

export function bindLocalData(root, session, computers = null, { read = file => file.text() } = {}) {
  const section = root.querySelector('[data-settings-data]');
  if (!section || typeof session?.exportThreads !== 'function' || typeof session?.importThreads !== 'function') return { dispose() {} };
  const find = selector => section.querySelector(selector);
  const abort = new AbortController(), options = { signal: abort.signal };
  const data = createLocalData({ chat: session, computers });
  const dialog = bindDialog(find('[data-data-dialog]'));
  let plan = null;
  const status = text => { const node = find('[data-data-status]'); node.textContent = text; node.hidden = !text; };
  const guard = operation => Promise.resolve().then(operation).catch(cause => { if (!abort.signal.aborted) status(cause.message); });
  section.hidden = false;
  find('[data-data-export]').addEventListener('click', () => guard(() => {
    const file = data.export();
    const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    const link = root.ownerDocument.createElement('a'); link.href = url; link.download = 'reploid-data.json';
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(`Exported ${file.conversations.length} conversation${file.conversations.length === 1 ? '' : 's'}.`);
  }), options);
  find('[data-data-import]').addEventListener('click', () => { status(''); find('[data-data-file]').click(); }, options);
  find('[data-data-file]').addEventListener('change', event => guard(async () => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > LOCAL_DATA_MAX_BYTES) throw new Error('This file is too large to be a Reploid data export.');
    const next = data.plan(await read(file));
    if (abort.signal.aborted) return;
    if (next.empty) { plan = null; status(next.summary + ' Nothing to import.'); return; }
    plan = next;
    find('[data-data-summary]').textContent = next.summary;
    find('[data-data-error]').hidden = true;
    dialog.open(find('[data-data-cancel]'), find('[data-data-import]'));
  }), options);
  find('[data-data-cancel]').addEventListener('click', () => { plan = null; dialog.close(); }, options);
  find('[data-data-confirm]').addEventListener('click', () => {
    if (!plan) return;
    try {
      const done = plan.apply();
      plan = null; dialog.close();
      status(`Imported ${done.conversations} conversation${done.conversations === 1 ? '' : 's'}, ${done.names} computer name${done.names === 1 ? '' : 's'} and ${done.blocked} blocked computer${done.blocked === 1 ? '' : 's'}.`);
    } catch (cause) { find('[data-data-error]').textContent = cause.message; find('[data-data-error]').hidden = false; }
  }, options);
  return { dispose() { abort.abort(); plan = null; dialog.dispose(); } };
}
