/**
 * @fileoverview Settings view for exporting and importing this browser's conversations and per-computer
 * names and blocks. The file format, validation and merge rules belong to host/local-data.js.
 */
import { bindDialog } from '../components/dialog.js';
import { createLocalData, LOCAL_DATA_MAX_BYTES } from '../../host/local-data.js';

export const renderLocalData = () => `<section class="pool-stack pool-gap-sm" data-settings-data hidden>
  <h3 class="pool-subheading">Your data</h3>
  <p class="pool-small pool-muted">Conversations, computer names and blocked computers saved in this browser, as one file. The file is not encrypted. It holds no private keys and no model files.</p>
  <div class="pool-row pool-gap-sm"><button class="pool-button btn-ghost" type="button" data-data-export>Export my data</button><button class="pool-button btn-ghost" type="button" data-data-import>Import data</button></div>
  <input type="file" accept=".json,application/json" data-data-file aria-label="Data export file" hidden>
  <p class="pool-small" data-data-status role="status" hidden></p>
  <dialog class="chat-model-setup pool-surface pool-stack pool-gap-md" data-data-dialog aria-labelledby="data-import-title">
    <h2 class="pool-heading" id="data-import-title">Import data?</h2>
    <p data-data-summary></p>
    <p class="pool-small pool-muted">Imported conversations are added to this browser. Nothing is sent, and sharing permissions are not imported.</p>
    <p class="pool-small" data-data-error role="alert" hidden></p>
    <div class="pool-row"><button class="pool-button btn-ghost" type="button" data-data-cancel>Cancel</button><button class="pool-button btn-primary" type="button" data-data-confirm>Import</button></div>
  </dialog></section>`;

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
