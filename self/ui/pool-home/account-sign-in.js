/** Account sign-in through a one-time link sent to the person's email (self/host/supabase-sign-in.js).
 * The address goes to Supabase, which sends the link; the account service never receives it. */
export function renderAccountSignIn() {
  return `<section class="pool-stack pool-gap-sm" data-account-sign-in aria-labelledby="account-sign-in-title">
    <h3 class="pool-subheading" id="account-sign-in-title">Account</h3>
    <p class="pool-small pool-muted" data-account-sign-in-summary></p>
    <form class="pool-stack pool-gap-xs" data-account-sign-in-form>
      <label class="pool-stack pool-gap-xs pool-small">Email
        <input class="pool-input" type="email" inputmode="email" autocomplete="email" spellcheck="false" required data-account-sign-in-email></label>
      <div class="pool-row"><button class="pool-button" type="submit" data-account-sign-in-send>Email me a sign-in link</button></div>
    </form>
    <div class="pool-row" data-account-signed-in hidden><button class="pool-button btn-ghost" type="button" data-account-sign-out>Sign out</button></div>
    <p class="pool-small pool-muted" role="status" data-account-sign-in-status></p>
  </section>`;
}

const summary = state => state.phase === 'signed_in'
  ? (state.email ? `Signed in as ${state.email}.` : 'Signed in.')
  : state.phase === 'unavailable'
    ? 'Sign-in is not available on this server.'
    : 'Sign in with a one-time link sent to your email. Supabase receives your address to send it.';

export function bindAccountSignIn(root, signIn) {
  const section = root.querySelector('[data-account-sign-in]');
  if (!section || !signIn) return () => {};
  const find = selector => section.querySelector(selector);
  const form = find('[data-account-sign-in-form]'), email = find('[data-account-sign-in-email]'), send = find('[data-account-sign-in-send]');
  const signedIn = find('[data-account-signed-in]'), status = find('[data-account-sign-in-status]');
  const controller = new AbortController(), options = { signal: controller.signal };
  const report = message => { status.textContent = message; };
  const unsubscribe = signIn.subscribe(state => {
    form.hidden = state.phase === 'signed_in' || state.phase === 'unavailable';
    signedIn.hidden = state.phase !== 'signed_in';
    send.disabled = state.phase === 'idle' || state.phase === 'sending';
    find('[data-account-sign-in-summary]').textContent = summary(state);
    report(state.message);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    signIn.requestLink(email.value).catch(error => report(error.message));
  }, options);
  find('[data-account-sign-out]').addEventListener('click', () => { signIn.signOut().catch(error => report(error.message)); }, options);
  signIn.start().catch(() => {});
  return () => { controller.abort(); unsubscribe(); };
}
