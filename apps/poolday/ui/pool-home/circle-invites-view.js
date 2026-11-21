import { escapeHtml as escape } from '../components/attachments.js';

export const renderCircleInviteControls = () => `
  <details class="pool-disclosure" data-circle-invites hidden>
    <summary>Guest invites</summary>
    <p class="pool-caption" data-circle-invite-policy>Revoking blocks new requests and removes queued turns before prompts are shared. Answers already running can finish with no duplicate settlement.</p>
    <form class="pool-stack pool-gap-sm" data-circle-invite-create>
      <label>Expires in hours<input class="pool-input" name="hours" type="number" min="1" max="720" value="24" required></label>
      <label>Requests per invite<input class="pool-input" name="maxRequests" type="number" min="1" max="1000" value="10" required></label>
      <label>Output tokens per request<input class="pool-input" name="maxOutputTokens" type="number" min="1" max="32768" value="256" required></label>
      <button class="pool-button btn-primary" type="submit">Create invite</button>
    </form>
    <div class="pool-stack pool-gap-sm" data-circle-invite-share hidden>
      <label>Guest link<input class="pool-input" data-circle-invite-link type="url" readonly></label>
      <button class="pool-button btn-ghost" type="button" data-circle-invite-copy>Copy link</button>
    </div>
    <ul class="pool-list pool-stack pool-gap-sm" data-circle-invite-list></ul>
    <button class="pool-button btn-ghost" type="button" data-circle-invite-refresh>Refresh invite usage</button>
    <p class="pool-caption" role="status" data-circle-invite-status></p>
  </details>`;

export function bindCircleInviteControls(root, getPort) {
  const panel = root.querySelector('[data-circle-invites]');
  const find = selector => panel.querySelector(selector);
  const form = find('[data-circle-invite-create]');
  const submit = form.querySelector('button');
  const share = find('[data-circle-invite-share]');
  const link = find('[data-circle-invite-link]');
  const list = find('[data-circle-invite-list]');
  const status = find('[data-circle-invite-status]');
  const controller = new AbortController();
  const options = { signal: controller.signal };
  let port, busy = false, sharedInviteId = null;

  function clearLink() {
    sharedInviteId = null;
    link.value = '';
    share.hidden = true;
  }
  function renderInvites(rows) {
    if (!rows.some(row => row.inviteId === sharedInviteId && row.status === 'active')) clearLink();
    list.innerHTML = rows.map(row => {
      const expiry = new Date(row.expiresAt).toLocaleString();
      const recipient = row.guestPeerId || 'Waiting for guest';
      const hostName = row.hostLabel && row.hostLabel !== row.hostPeerId ? ` · ${escape(row.hostLabel)}` : '';
      const activeText = row.activeRequests ? ` · ${escape(row.activeRequests)} running` : '';
      return `<li class="pool-stack pool-gap-sm" data-circle-invite-row="${escape(row.inviteId)}" data-circle-invite-state="${escape(row.status)}">
        <span>${escape(recipient)} · ${escape(row.status)}${hostName}</span>
        <span>${escape(row.usedRequests)} of ${escape(row.maxRequests)} requests used · expires ${escape(expiry)}${activeText}</span>
        ${row.queuedRequests == null ? '' : `<span>${escape(row.queuedRequests)} queued</span>`}
        ${row.status === 'active' ? `<button class="pool-button btn-ghost" type="button" data-circle-invite-revoke="${escape(row.inviteId)}">Revoke invite</button>` : ''}
      </li>`;
    }).join('');
  }
  function update() {
    const next = getPort();
    if (next === port) return;
    port = next;
    panel.hidden = !port;
    busy = false;
    submit.disabled = false;
    clearLink();
    list.textContent = '';
    status.textContent = '';
    if (port && panel.open) void run(() => {});
  }
  async function run(action) {
    const current = port;
    if (!current || busy || controller.signal.aborted) return;
    const stillCurrent = () => current === port && current === getPort() && !controller.signal.aborted;
    busy = true;
    submit.disabled = true;
    status.textContent = '';
    try {
      await action(current, stillCurrent);
      if (!stillCurrent()) return;
      const rows = await current.list();
      if (stillCurrent()) renderInvites(rows);
    } catch (error) {
      if (stillCurrent()) status.textContent = error.message;
    } finally {
      if (stillCurrent()) {
        busy = false;
        submit.disabled = false;
      }
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const values = new FormData(form);
    void run(async (current, stillCurrent) => {
      const invite = await current.issue({
        expiresAt: Date.now() + Number(values.get('hours')) * 3600000,
        maxRequests: Number(values.get('maxRequests')),
        maxOutputTokens: Number(values.get('maxOutputTokens'))
      });
      if (!stillCurrent()) return;
      sharedInviteId = invite.inviteId;
      link.value = invite.link;
      share.hidden = false;
      status.textContent = 'Guest link ready';
    });
  }, options);
  panel.addEventListener('toggle', () => { if (panel.open) void run(() => {}); }, options);
  find('[data-circle-invite-refresh]').addEventListener('click', () => { void run(() => {}); }, options);
  find('[data-circle-invite-copy]').addEventListener('click', async () => {
    if (!link.value) return;
    const copied = link.value;
    try {
      await navigator.clipboard.writeText(copied);
      if (link.value === copied) status.textContent = 'Guest link copied';
    } catch {
      if (link.value !== copied) return;
      link.select();
      status.textContent = 'Select and copy the guest link';
    }
  }, options);
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-circle-invite-revoke]');
    if (button) void run(async (current, stillCurrent) => {
      const result = await current.revoke(button.dataset.circleInviteRevoke);
      if (!stillCurrent()) return;
      if (sharedInviteId === button.dataset.circleInviteRevoke) clearLink();
      status.textContent = result?.revocationPolicy === 'stop'
        ? 'Invite revoked. Running answers were stopped with no duplicate settlement.'
        : 'Invite revoked. Answers already running can finish.';
    });
  }, options);
  update();
  return { update, dispose: () => { controller.abort(); clearLink(); } };
}
