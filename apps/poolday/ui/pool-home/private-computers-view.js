import { escapeHtml as escape } from '../components/attachments.js';
import { accountText, creditAccounts, creditActivity } from './service-credit-text.js';
const gb = value => Number.isFinite(value) ? `${(value / 1024 ** 3).toFixed(1)} GiB` : 'Not reported';
export const renderPrivateComputers = () => `<section class="pool-stack pool-gap-sm" data-private-computers>
  <h3 class="pool-subheading">Your private computers</h3><p class="pool-small pool-muted" data-private-status>Not connected</p>
  <details class="pool-disclosure" data-private-pair><summary>Connect a native host</summary><form class="pool-stack pool-gap-sm" data-private-connect>
    <p class="pool-small pool-muted">Use the address and pairing secret from your local Reploid host. Private-model chats use its enrolled computers and service credits. Keys stay on the host; this tab remembers the connection.</p>
    <label>Local address<input class="pool-input" name="address" type="url" placeholder="http://127.0.0.1:18784" required></label>
    <label>Pairing secret<input class="pool-input" name="secret" type="password" autocomplete="off" required></label>
    <button class="pool-button btn-primary" type="submit">Connect</button></form></details>
  <ul class="pool-list pool-stack pool-gap-sm" data-private-list></ul>
  <details class="pool-disclosure" data-private-account hidden><summary>Service credits</summary><div class="pool-stack pool-gap-sm">
    <p class="pool-caption pool-muted">Non-cash credits with no cash value. Your computers earn them by answering for others and spend them when you ask other computers. Before Send, each answer shows the most it can cost. Your host’s limit may allow a negative balance. Held credits stay pending until that answer is settled.</p>
    <p data-private-own-account></p><ul class="pool-list pool-stack pool-gap-sm pool-small" data-private-activity></ul>
    <p class="pool-caption pool-muted" data-private-balances></p>
    <button class="pool-button btn-ghost" type="button" data-private-statement>Save statement</button></div></details>
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
      const residentUse = online && Number.isFinite(row.resident?.gpuBytes)
        ? `<dt>Resident GPU use</dt><dd>${gb(row.resident.gpuBytes)}${Number.isSafeInteger(row.resident?.cachedContexts) && row.resident.cachedContexts > 0 ? ` · ${row.resident.cachedContexts} cached ${row.resident.cachedContexts === 1 ? 'thread' : 'threads'}` : ''}</dd>`
        : '';
      return `<li><details class="pool-disclosure"><summary>${escape(row.name)} <span class="pool-muted">${status}</span></summary>
        <dl class="pool-facts"><dt>Model</dt><dd>${escape(online && row.resident ? model?.name || row.resident.modelIdentity : 'None reported')}</dd>
        <dt>Role</dt><dd>${online && row.resident ? row.resident.mode === 'partition' ? `Split model · stage ${row.resident.stageIndex + 1}` : 'Whole model' : row.requester ? 'Requester' : 'No active role'}</dd>
        <dt>Active work</dt><dd>${online ? row.queuedRequests > 0 ? `${row.activeRequests ?? 0} active · ${row.queuedRequests} queued` : row.activeRequests ?? 'Not reported' : 'Unknown'}</dd>
        ${residentUse}<dt>Available GPU budget</dt><dd>${online ? gb(row.freeGpuBytes) : 'Unknown'}</dd><dt>Available system memory</dt><dd>${online ? gb(row.freeHostBytes) : 'Unknown'}</dd></dl></details></li>`;
    }).join('');
    if (list.dataset.markup !== markup) { const opened = [...list.querySelectorAll('details')].map((node, index) => node.open ? index : -1); list.innerHTML = markup; list.dataset.markup = markup;
      for (const index of opened) if (index >= 0 && list.querySelectorAll('details')[index]) list.querySelectorAll('details')[index].open = true; }
  };
  const act = async fn => { pending = true; actionError = ''; render(session.getState()); try { await fn(); }
    catch (error) { actionError = error.message; } finally { pending = false; if (!controller.signal.aborted) render(session.getState()); } };
  find('[data-private-connect]').addEventListener('submit', event => { event.preventDefault(); const form = event.currentTarget;
    void act(async () => { await port.connect(form.elements.address.value, form.elements.secret.value); form.elements.secret.value = ''; }); }, { signal: controller.signal });
  find('[data-private-disconnect]').addEventListener('click', () => void act(() => port.disconnect()), { signal: controller.signal });
  // The account view is read when opened, again when this pool's active work changes, and at most every 10 s while open.
  let loadedAt = 0, loading = false, activeKey = '';
  const loadAccount = () => {
    if (loading || !find('[data-private-account]').open || !port.state().connected) return;
    loading = true; loadedAt = Date.now();
    void act(async () => {
      const fleet = port.state();
      const [snapshot, statement] = await Promise.all([port.accounts(), port.statement?.().catch(() => null) ?? null]);
      const { own, others } = creditAccounts(snapshot, fleet.requester?.id);
      find('[data-private-own-account]').textContent = own ? `Your account (${own.name}): ${accountText(own)}` : 'This host’s account was not reported.';
      const modelName = id => fleet.models?.find(model => model.id === id)?.name || id;
      const rows = creditActivity(statement, { modelName });
      find('[data-private-activity]').innerHTML = statement ? rows.length ? rows.map(row => `<li><span>${escape(row.text)}</span>${Number.isFinite(row.at)
        ? ` <time class="pool-muted" datetime="${escape(new Date(row.at).toISOString())}">${escape(new Date(row.at).toLocaleString())}</time>` : ''}</li>`).join('')
        : '<li class="pool-muted">No credit activity yet.</li>' : '<li class="pool-muted">This host does not report a statement. Update the native host.</li>';
      find('[data-private-balances]').textContent = others.length ? `Other enrolled accounts: ${others.map(row => `${row.name} · ${accountText(row)}`).join('; ')}` : '';
      find('[data-private-statement]').hidden = !statement;
    }).finally(() => { loading = false; });
  };
  find('[data-private-account]').addEventListener('toggle', loadAccount, { signal: controller.signal });
  find('[data-private-statement]').addEventListener('click', () => void act(async () => {
    const statement = await port.statement();
    const url = URL.createObjectURL(new Blob([JSON.stringify(statement, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'reploid-service-statement.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }), { signal: controller.signal });
  return { update(state) {
    render(state);
    const fleet = state?.privateComputers || port.state();
    const key = JSON.stringify((fleet.computers || []).map(row => [row.id, row.activeRequests ?? 0, row.queuedRequests ?? 0]));
    if (key !== activeKey || Date.now() - loadedAt > 10000) { activeKey = key; loadAccount(); }
  }, dispose() { controller.abort(); } };
}
