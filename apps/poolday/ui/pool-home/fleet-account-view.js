/**
 * Computers › Your account: sign in, create the service-credit account, pair a computer by code, see the
 * balance, starter credit and recent activity, save the statement, and connect this tab to the paired host
 * so answers spend from the same account. Built from the Poolday primitives (action rows, facts, the dialog
 * shell and reserved status lines). Every number is the server ledger's; this view decides nothing.
 */
import { escapeHtml as escape } from '../components/attachments.js';
import { renderActionRow, renderDialog } from '../components/choices.js';
import { bindDialog } from '../components/dialog.js';
import { creditActivity } from './service-credit-text.js';

const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
const credits = count => plural(count, 'credit');

/** The account line: balance first, then what is held and what can be spent now including starter credit. */
export function fleetAccountText(view) {
  const row = view?.credits;
  if (!row) return '';
  const parts = [`Balance ${credits(row.balance)}`];
  if (row.held) parts.push(`${credits(row.held)} held for unfinished answers`);
  parts.push(`${credits(Math.max(0, row.spendable))} can be spent now`);
  return parts.join(' · ');
}

export function fleetStarterText(view) {
  const limit = view?.credits?.debtLimit ?? 0;
  return limit > 0
    ? `Starter credit: your balance may go down to −${limit.toLocaleString()} before you have earned anything. Serving answers for others pays it back.`
    : 'No starter credit: this sign-in is not verified. Serve answers for others to earn credits first, or sign in with Google.';
}

export const renderFleetAccount = () => `<section class="pool-section" data-fleet-account aria-labelledby="fleet-account-title" hidden>
  <h3 class="pool-section-title" id="fleet-account-title">Your account</h3>
  <p class="pool-status-line pool-small" data-fleet-account-status role="status"></p>
  <div class="pool-stack pool-gap-sm" data-fleet-sign-in hidden>
    <p class="pool-caption pool-muted">An account earns non-cash service credits when your computers answer for others, and spends them when you ask. Credits have no cash value.</p>
    <button class="pool-button btn-primary" type="button" data-fleet-sign-in-google>Sign in with Google</button>
    <button class="pool-button btn-ghost" type="button" data-fleet-sign-in-guest>Continue without an email</button>
  </div>
  <button class="pool-button btn-primary" type="button" data-fleet-create hidden>Create account</button>
  <div class="pool-stack pool-gap-sm" data-fleet-details hidden>
    <p class="pool-caption pool-muted" data-fleet-starter></p>
    <ul class="pool-list pool-stack pool-gap-sm" data-fleet-computers aria-label="Paired computers"></ul>
    ${renderActionRow({ title: 'Pair a computer', status: 'Show a code to run on the computer that will serve', icon: 'peers', attrs: { 'data-fleet-pair': true } })}
    <details class="pool-disclosure pool-disclosure-quiet" data-fleet-activity-section><summary>Recent activity</summary>
      <ul class="pool-list pool-stack pool-gap-sm pool-small" data-fleet-activity></ul>
      <button class="pool-button btn-ghost" type="button" data-fleet-statement>Save statement</button>
      <p class="pool-caption pool-muted">The statement lists each charge and earning with its signed receipts. Check it offline with <code class="pool-mono">node server/fleet/credit-statement.js statement.json</code>.</p>
    </details>
  </div>
  <p class="pool-small" role="alert" data-fleet-error hidden></p>
  ${renderDialog({ titleId: 'fleet-pair-title', title: 'Pair a computer', fixed: true, attrs: { 'data-fleet-pair-dialog': true }, closeAttrs: { 'data-fleet-pair-close': true },
    body: `<ol class="pool-stack pool-gap-sm pool-small">
      <li>On the computer that will serve, run<br><code class="pool-mono" data-fleet-pair-command>npx reploid join ····-····</code></li>
      <li>It prints a fingerprint. Check that it matches the one shown here, then confirm.</li>
      <li>Start its host with the command it prints, then choose Use for answers.</li></ol>
      <dl class="pool-facts"><dt>Code</dt><dd class="pool-mono" data-fleet-pair-code>····-····</dd>
      <dt>Computer</dt><dd data-fleet-pair-computer>Waiting for the computer…</dd>
      <dt>Fingerprint</dt><dd class="pool-mono" data-fleet-pair-fingerprint>—</dd></dl>
      <p class="pool-caption pool-muted">The code works once and expires after ten minutes. Confirm only a fingerprint you can see on your own computer.</p>`,
    footer: `<p class="pool-status-line" data-fleet-pair-status role="status">Waiting for the computer…</p>
      <button class="pool-button btn-ghost" type="button" data-fleet-pair-cancel>Cancel</button>
      <button class="pool-button btn-primary" type="button" data-fleet-pair-confirm disabled>Confirm computer</button>
      <button class="pool-button btn-primary" type="button" data-fleet-use hidden>Use for answers</button>` })}
</section>`;

export function bindFleetAccount(root, session) {
  const find = selector => root.querySelector(selector), port = session.fleetAccount;
  const container = find('[data-fleet-account]');
  if (!container || !port) return { update() {}, dispose() {} };
  const controller = new AbortController(), options = { signal: controller.signal };
  const dialog = find('[data-fleet-pair-dialog]'), modal = bindDialog(dialog);
  const on = (selector, event, fn) => find(selector)?.addEventListener(event, fn, options);
  const quiet = operation => () => void operation().catch(() => {});
  let activityLoaded = '';

  const render = () => {
    const state = port.state();
    container.hidden = !state.available;
    if (!state.available) return;
    const account = state.account;
    find('[data-fleet-account-status]').textContent = state.busy ? 'Working…' : !state.signedIn ? 'Not signed in'
      : !account ? 'Signed in · no account yet' : fleetAccountText(account);
    find('[data-fleet-sign-in]').hidden = state.signedIn;
    find('[data-fleet-create]').hidden = !state.signedIn || !!account;
    find('[data-fleet-details]').hidden = !account;
    for (const button of container.querySelectorAll('button')) if (!dialog.contains(button)) button.disabled = state.busy;
    const error = find('[data-fleet-error]');
    error.textContent = state.error; error.hidden = !state.error;
    if (account) {
      find('[data-fleet-starter]').textContent = fleetStarterText(account);
      const markup = account.computers.length ? account.computers.map(row => `<li class="pool-row pool-row-between pool-gap-sm">
          <span class="pool-row-text"><span class="pool-row-title">${escape(row.name || 'Computer')}</span>
          <span class="pool-row-status pool-mono">${escape(row.fingerprint)}${row.revokedAt ? ' · removed' : ''}</span></span>
          ${row.revokedAt ? '' : `<button class="pool-button btn-ghost" type="button" data-fleet-revoke="${escape(row.participantId)}">Remove</button>`}</li>`).join('')
        : '<li class="pool-muted pool-small">No computers yet. Pair one to earn credits by serving.</li>';
      const list = find('[data-fleet-computers]');
      if (list.dataset.markup !== markup) { list.innerHTML = markup; list.dataset.markup = markup; }
      const key = `${account.credits.balance}:${account.credits.held}`;
      if (find('[data-fleet-activity-section]').open && activityLoaded !== key) { activityLoaded = key; void loadActivity(); }
    }
    const pairing = state.pairing;
    if (pairing) {
      find('[data-fleet-pair-code]').textContent = pairing.code || '····-····';
      find('[data-fleet-pair-command]').textContent = pairing.command || `npx reploid join ${pairing.code}`;
      find('[data-fleet-pair-computer]').textContent = pairing.computer?.name || 'Waiting for the computer…';
      find('[data-fleet-pair-fingerprint]').textContent = pairing.computer?.fingerprint || '—';
      const status = { open: 'Waiting for the computer…', claimed: 'Check the fingerprint on that computer, then confirm.',
        confirmed: 'Paired. Start its host, then choose Use for answers.', expired: 'This code expired. Close and make a new one.',
        cancelled: 'Cancelled.' }[pairing.state] || '';
      find('[data-fleet-pair-status]').textContent = state.error && dialog.open ? state.error : status;
      find('[data-fleet-pair-confirm]').hidden = pairing.state === 'confirmed';
      find('[data-fleet-pair-confirm]').disabled = state.busy || pairing.state !== 'claimed';
      find('[data-fleet-use]').hidden = pairing.state !== 'confirmed';
      find('[data-fleet-use]').disabled = state.busy;
    }
  };
  const loadActivity = async () => {
    const list = find('[data-fleet-activity]');
    try {
      const statement = await port.statement();
      const rows = creditActivity(statement);
      list.innerHTML = rows.length ? rows.map(row => `<li>${escape(row.text)}${Number.isFinite(row.at)
        ? ` <time class="pool-muted" datetime="${escape(new Date(row.at).toISOString())}">${escape(new Date(row.at).toLocaleString())}</time>` : ''}</li>`).join('')
        : '<li class="pool-muted">No credit activity yet.</li>';
    } catch (error) {
      list.innerHTML = `<li class="pool-muted">${escape(error.code === 'no_computers' ? 'No credit activity yet.' : error.message)}</li>`;
    }
  };

  on('[data-fleet-sign-in-google]', 'click', quiet(() => port.signIn('google')));
  on('[data-fleet-sign-in-guest]', 'click', quiet(() => port.signIn('anonymous')));
  on('[data-fleet-create]', 'click', quiet(() => port.createAccount()));
  on('[data-fleet-pair]', 'click', quiet(async () => { await port.startPairing(); render(); modal.open(find('[data-fleet-pair-cancel]')); }));
  on('[data-fleet-pair-confirm]', 'click', quiet(() => port.confirmPairing()));
  on('[data-fleet-use]', 'click', quiet(async () => { await port.useThisComputer(); modal.close(); }));
  on('[data-fleet-pair-cancel]', 'click', quiet(async () => { await port.cancelPairing(); modal.close(); }));
  on('[data-fleet-pair-close]', 'click', () => modal.close());
  dialog.addEventListener('close', () => port.closePairing(), options);
  on('[data-fleet-computers]', 'click', event => {
    const id = event.target.closest?.('[data-fleet-revoke]')?.dataset.fleetRevoke;
    if (id) void port.revoke(id).catch(() => {});
  });
  on('[data-fleet-activity-section]', 'toggle', () => { if (find('[data-fleet-activity-section]').open) { activityLoaded = ''; render(); } });
  on('[data-fleet-statement]', 'click', quiet(async () => {
    const statement = await port.statement();
    const url = URL.createObjectURL(new Blob([JSON.stringify(statement, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'reploid-account-statement.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }));
  // The balance moves as answers settle: re-read when this pool's work changes, and every 5 s while signed in.
  let workKey = '';
  const timer = setInterval(() => { if (!document.hidden) void port.reread(); }, 5000);
  render();
  return { update(state) {
    const key = JSON.stringify((state?.privateComputers?.computers || []).map(row => [row.id, row.activeRequests ?? 0]));
    if (key !== workKey) { workKey = key; void port.reread(); }
    render();
  }, dispose() { clearInterval(timer); controller.abort(); modal.dispose(); } };
}
