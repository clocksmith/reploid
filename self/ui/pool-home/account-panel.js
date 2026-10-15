/** Settings panel for credits: sign-in, balance, recent journal entries, top-ups, the standing spending limit and the
 * last quote, all from the host's earning account (host/credits/browser.js). Hidden unless the page's server publishes
 * an earning service. The panel shows the service's records; it decides no price, outcome or reward. */
import { escapeHtml as escape } from '../components/attachments.js';
import { renderAccountSignIn, bindAccountSignIn } from './account-sign-in.js';

const number = value => Number.isFinite(value) ? value.toLocaleString('en-US') : '—';
const price = ({ amountMinor, currency }) => `${(amountMinor / 100).toFixed(2)} ${currency}`;
const time = value => { const at = Date.parse(value); return Number.isFinite(at) ? new Date(at).toLocaleString() : ''; };

const ISSUED = { earned: 'Earned', purchased: 'Bought', community_access: 'Community Access', subsidized: 'Reward (subsidized)', donated: 'Donated' };
const ENTRY = { reserve: 'Held for an answer', charge: 'Charged for an answer', release: 'Released', refund: 'Refunded', reverse: 'Reversed' };
const CHECKOUT = { creating: 'starting', open: 'waiting for payment', awaiting_issuance: 'paid, crediting', issued: 'credited', awaiting_reversal: 'reversing',
  reversed: 'reversed', failed: 'failed', expired: 'expired' };

const entryLabel = entry => entry.type === 'issue' ? (ISSUED[entry.lots?.[0]?.provenance] || 'Issued') : (ENTRY[entry.type] || entry.type);
const signed = entry => ['issue', 'release', 'refund'].includes(entry.type) ? `+${number(entry.amount)}` : `−${number(entry.amount)}`;

const balanceText = balance => {
  if (!balance) return '';
  const parts = [`Balance: ${number(balance.available)} credits`];
  if (balance.held) parts.push(`${number(balance.held)} held for answers in progress`);
  const earned = balance.byProvenance?.earned?.available ?? 0, bought = balance.byProvenance?.purchased?.available ?? 0;
  if (earned || bought) parts.push(`earned ${number(earned)}, bought ${number(bought)}`);
  return parts.join(' · ');
};

const quoteText = (quote, limit) => {
  if (!quote) return limit ? '' : 'No spending limit is set, so answers that cost credits are not sent.';
  const head = `Last quote: up to ${number(quote.maxCharge)} credits${quote.deadline ? `, answer by ${new Date(quote.deadline).toLocaleTimeString()}` : ''}.`;
  if (quote.funding === 'community_access') return `${head} Asked for Community Access, which the pool pays.`;
  if (quote.accepted) return `${head} Accepted.`;
  return `${head} Not sent: ${limit ? `above your limit of ${number(limit)}` : 'no spending limit is set'}.`;
};

const LOCAL_FORM = `<form class="pool-stack pool-gap-xs" data-earning-local-form>
    <p class="pool-small pool-muted">Local test sign-in. Anyone who can reach this server can sign in with any name.</p>
    <label class="pool-stack pool-gap-xs pool-small">Name
      <input class="pool-input" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required data-earning-local-subject></label>
    <div class="pool-row"><button class="pool-button" type="submit" data-earning-local-submit>Sign in</button></div>
  </form>
  <p class="pool-small pool-muted" data-earning-local-signed-in hidden></p>`;

export function renderAccountPanel() {
  return `<section class="pool-stack pool-gap-sm" data-earning-account aria-labelledby="earning-account-title" hidden>
    <h3 class="pool-subheading" id="earning-account-title">Credits</h3>
    <div class="pool-stack pool-gap-sm" data-earning-sign-in></div>
    <div class="pool-stack pool-gap-sm" data-earning-ready hidden>
      <p class="pool-small" role="status" data-earning-balance></p>
      <div class="pool-row" data-earning-top-ups></div>
      <p class="pool-small pool-muted" data-earning-checkout hidden></p>
      <form class="pool-stack pool-gap-xs" data-earning-limit-form>
        <label class="pool-stack pool-gap-xs pool-small">Spend up to, per answer (credits)
          <input class="pool-input" type="number" min="1" step="1" inputmode="numeric" data-earning-limit></label>
        <p class="pool-small pool-muted">Answers quoted above this are not sent. Leave empty to send none that cost credits.</p>
        <div class="pool-row"><button class="pool-button" type="submit" data-earning-limit-save>Save limit</button></div>
      </form>
      <p class="pool-small pool-muted" data-earning-quote></p>
      <details data-earning-activity><summary>Recent activity</summary><ol class="pool-list pool-small" data-earning-journal></ol></details>
      <div class="pool-row"><button class="pool-button btn-ghost" type="button" data-earning-sign-out hidden>Sign out</button></div>
    </div>
    <p class="pool-small pool-muted" role="status" data-earning-status></p>
  </section>`;
}

/**
 * Bind the panel inside `root` to the host's earning composition: `opening` resolves to
 * { account, signIn, flow } or null. Returns a dispose function.
 */
export function bindAccountPanel(root, opening) {
  const section = root.querySelector('[data-earning-account]');
  if (!section || !opening) return () => {};
  const find = selector => section.querySelector(selector);
  const controller = new AbortController(), options = { signal: controller.signal };
  let disposed = false, unsubscribe = () => {}, unbindSignIn = () => {};
  Promise.resolve(opening).then(earning => {
    if (disposed || !earning?.account) return;
    const { account, signIn } = earning;
    const local = earning.flow?.flow === 'local_test_subject';
    section.hidden = false;
    const slot = find('[data-earning-sign-in]');
    if (local) {
      slot.innerHTML = LOCAL_FORM;
      const form = find('[data-earning-local-form]'), signedIn = find('[data-earning-local-signed-in]');
      form.addEventListener('submit', event => {
        event.preventDefault();
        signIn.useSubject(find('[data-earning-local-subject]').value).catch(error => { find('[data-earning-status]').textContent = error.message; });
      }, options);
      const stop = signIn.subscribe(state => {
        form.hidden = state.phase === 'signed_in';
        signedIn.hidden = state.phase !== 'signed_in';
        signedIn.textContent = state.subject ? `Signed in as ${state.subject} (local test).` : '';
      });
      unbindSignIn = stop;
      find('[data-earning-sign-out]').hidden = false;
    } else {
      slot.innerHTML = renderAccountSignIn();
      unbindSignIn = bindAccountSignIn(slot, signIn);
    }
    find('[data-earning-sign-out]').addEventListener('click', () => { void account.signOut(); }, options);
    find('[data-earning-limit-form]').addEventListener('submit', event => {
      event.preventDefault();
      account.setSpendingLimit(find('[data-earning-limit]').value);
    }, options);
    find('[data-earning-top-ups]').addEventListener('click', event => {
      const button = event.target.closest('[data-earning-top-up]');
      if (button) { button.disabled = true; void account.topUp(button.dataset.earningTopUp).finally(() => { button.disabled = false; }); }
    }, options);
    let topUpsKey = null, journalKey = null;
    unsubscribe = account.subscribe(state => {
      const ready = state.phase === 'ready';
      find('[data-earning-ready]').hidden = !ready;
      find('[data-earning-balance]').textContent = ready ? balanceText(state.balance) : '';
      const nextTopUps = JSON.stringify(state.topUps);
      if (nextTopUps !== topUpsKey) {
        topUpsKey = nextTopUps;
        find('[data-earning-top-ups]').innerHTML = state.topUps.map(topUp => `<button class="pool-button" type="button" data-earning-top-up="${escape(topUp.topUpId)}">Top up ${escape(price(topUp.price))}</button>`).join('');
      }
      const checkout = find('[data-earning-checkout]');
      checkout.hidden = !state.checkout;
      checkout.textContent = state.checkout ? `Last top-up: ${number(state.checkout.credits)} credits, ${CHECKOUT[state.checkout.phase] || state.checkout.phase}.` : '';
      const limit = find('[data-earning-limit]');
      if (document.activeElement !== limit) limit.value = state.spendingLimit ?? '';
      find('[data-earning-quote]').textContent = quoteText(state.lastQuote, state.spendingLimit);
      const rows = state.journal.map(entry => `<li data-earning-entry="${escape(entry.type)}">${escape(entryLabel(entry))} ${escape(signed(entry))} credits · ${escape(time(entry.at))}</li>`).join('');
      if (rows !== journalKey) { journalKey = rows; find('[data-earning-journal]').innerHTML = rows || '<li>No activity yet.</li>'; }
      find('[data-earning-status]').textContent = state.phase === 'signing_in' ? 'Signing in…' : state.message;
    });
  }).catch(error => { if (!disposed) find('[data-earning-status]').textContent = error?.message || String(error); });
  return () => { disposed = true; controller.abort(); unsubscribe(); unbindSignIn(); };
}
