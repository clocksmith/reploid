import { escapeHtml as escape } from '../components/attachments.js';
const gb = value => Number.isFinite(value) ? `${(value / 1024 ** 3).toFixed(1)} GiB` : 'Not reported';
export const renderPrivateComputers = () => `<section class="pool-stack pool-gap-sm" data-private-computers>
  <h3 class="pool-subheading">Your private computers</h3><p class="pool-small pool-muted" data-private-status>Not connected</p>
  <details class="pool-disclosure" data-private-pair><summary>Connect a native host</summary><form class="pool-stack pool-gap-sm" data-private-connect>
    <p class="pool-small pool-muted">Use the address and pairing secret from your local Reploid host. Private-model chats use its enrolled computers and service credits. Keys stay on the host; this tab remembers the connection.</p>
    <label>Local address<input class="pool-input" name="address" type="url" placeholder="http://127.0.0.1:18784" required></label>
    <label>Pairing secret<input class="pool-input" name="secret" type="password" autocomplete="off" required></label>
    <button class="pool-button btn-primary" type="submit">Connect</button></form></details>
  <ul class="pool-list pool-stack pool-gap-sm" data-private-list></ul>
  <details class="pool-disclosure" data-private-account hidden><summary>Service credits</summary><p class="pool-caption pool-muted">Non-cash credits. Negative balances are allowed within your host’s limit. Held credits remain pending until work is reconciled.</p><div data-private-balances></div></details>
  <button class="pool-button btn-ghost" type="button" data-private-disconnect hidden>Disconnect private computers</button>
  <p class="pool-small" role="alert" data-private-error hidden></p></section>`;

export function bindPrivateComputers(root, session) {
  const find = selector => root.querySelector(selector), port = session.privateComputers;
  const container = find('[data-private-computers]'); if (!container) return { update() {}, dispose() {} };
  container.hidden = !port; if (!port) return { update() {}, dispose() {} };
  const controller = new AbortController(); let actionError = '', pending = false;
  const render = state => {
    const fleet = state.privateComputers || port.state();
    find('[data-private-status]').textContent = fleet.connected ? `${fleet.computers.filter(row => row.online).length} online · via ${fleet.requester.name}` : fleet.connecting ? 'Connecting…' : 'Not connected';
    find('[data-private-error]').textContent = actionError || fleet.error || ''; find('[data-private-error]').hidden = !find('[data-private-error]').textContent;
    find('[data-private-pair]').hidden = fleet.connected; find('[data-private-account]').hidden = !fleet.connected;
    find('[data-private-disconnect]').hidden = !fleet.requester; find('[data-private-connect] button').disabled = pending;
    const list = find('[data-private-list]');
    const markup = (fleet.computers || []).map(row => {
      const online = fleet.connected && row.online;
      const queuedSuffix = row.queuedRequests > 0 ? ` · ${row.queuedRequests} queued` : '';
      const status = !online ? 'Offline' : row.requester && !row.resident ? `Online · requester${queuedSuffix}`
        : row.activeRequests > 0 ? `Serving${queuedSuffix}` : row.preparing ? 'Loading'
        : row.preferences?.enabled === false ? 'Paused' : row.resident ? 'Ready' : row.requester ? 'Online · requester' : 'Online · no model loaded';
      const model = fleet.models?.find(model => model.identity === row.resident?.modelIdentity);
      return `<li><details class="pool-disclosure"><summary>${escape(row.name)} <span class="pool-muted">${status}</span></summary>
        <dl class="pool-facts"><dt>Model</dt><dd>${escape(online && row.resident ? model?.name || row.resident.modelIdentity : 'None reported')}</dd>
        <dt>Role</dt><dd>${online && row.resident ? row.resident.mode === 'partition' ? `Split model · stage ${row.resident.stageIndex + 1}` : 'Whole model' : row.requester ? 'Requester' : 'No active role'}</dd>
        <dt>Active work</dt><dd>${online ? row.queuedRequests > 0 ? `${row.activeRequests ?? 0} active · ${row.queuedRequests} queued` : row.activeRequests ?? 'Not reported' : 'Unknown'}</dd>
        <dt>Available GPU budget</dt><dd>${online ? gb(row.freeGpuBytes) : 'Unknown'}</dd><dt>Available system memory</dt><dd>${online ? gb(row.freeHostBytes) : 'Unknown'}</dd></dl></details></li>`;
    }).join('');
    if (list.dataset.markup !== markup) { const opened = [...list.querySelectorAll('details')].map((node, index) => node.open ? index : -1); list.innerHTML = markup; list.dataset.markup = markup;
      for (const index of opened) if (index >= 0 && list.querySelectorAll('details')[index]) list.querySelectorAll('details')[index].open = true; }
  };
  const act = async fn => { pending = true; actionError = ''; render(session.getState()); try { await fn(); }
    catch (error) { actionError = error.message; } finally { pending = false; if (!controller.signal.aborted) render(session.getState()); } };
  find('[data-private-connect]').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget;
    void act(async () => { await port.connect(form.elements.address.value, form.elements.secret.value); form.elements.secret.value = ''; }); }, { signal: controller.signal });
  find('[data-private-disconnect]').addEventListener('click', () => void act(() => port.disconnect()), { signal: controller.signal });
  find('[data-private-account]').addEventListener('toggle', () => { if (!find('[data-private-account]').open) return;
    void act(async () => { const value = await port.accounts(); find('[data-private-balances]').innerHTML = value.accounts.map(row =>
      `<p>${escape(row.name)} · ${row.balance} credits${row.held ? ` · ${row.held} held, pending` : ''}</p>`).join(''); }); }, { signal: controller.signal });
  return { update: render, dispose() { controller.abort(); } };
}
