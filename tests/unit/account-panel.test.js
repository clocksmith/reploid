// The credits panel in Settings: hidden without an earning service, the local test sign-in form, and the
// account's balance, journal, top-ups, spending limit and last quote rendered from its state.
import { describe, expect, it, vi } from 'vitest';

import { bindAccountPanel, renderAccountPanel } from '../../self/ui/pool-home/account-panel.js';

const store = (initial) => {
  let state = initial;
  const listeners = new Set();
  return {
    state: () => state,
    set(next) { state = { ...state, ...next }; listeners.forEach((listener) => listener(state)); },
    subscribe(listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); }
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const mount = () => {
  const root = document.createElement('div');
  root.innerHTML = renderAccountPanel();
  document.body.replaceChildren(root);
  return root;
};

describe('credits panel', () => {
  it('stays hidden when the page has no earning service', async () => {
    const root = mount();
    const dispose = bindAccountPanel(root, Promise.resolve(null));
    await flush();
    expect(root.querySelector('[data-earning-account]').hidden).toBe(true);
    dispose();
  });

  it('signs in through the local test form and renders the account', async () => {
    const root = mount();
    const signIn = Object.assign(store({ phase: 'signed_out', subject: null }), { useSubject: vi.fn(async (subject) => signIn.set({ phase: 'signed_in', subject })) });
    const account = Object.assign(store({ phase: 'signed_out', balance: null, journal: [], topUps: [{ topUpId: 'test-topup', price: { amountMinor: 1000, currency: 'USD' } }],
      checkout: null, spendingLimit: null, lastQuote: null, message: '' }), {
      setSpendingLimit: vi.fn(), topUp: vi.fn(async () => null), signOut: vi.fn(async () => {})
    });
    const dispose = bindAccountPanel(root, Promise.resolve({ account, signIn, flow: { providerId: 'local-test', flow: 'local_test_subject' } }));
    await flush();
    const find = (selector) => root.querySelector(selector);
    expect(find('[data-earning-account]').hidden).toBe(false);
    expect(find('[data-earning-ready]').hidden).toBe(true);
    find('[data-earning-local-subject]').value = 'alice';
    find('[data-earning-local-form]').dispatchEvent(new Event('submit', { cancelable: true }));
    await flush();
    expect(signIn.useSubject).toHaveBeenCalledWith('alice');
    expect(find('[data-earning-local-signed-in]').textContent).toBe('Signed in as alice (local test).');
    expect(find('[data-earning-quote]').textContent).toBe('No spending limit is set, so answers that cost credits are not sent.');
    expect(find('[data-earning-journal]').textContent).toBe('No activity yet.');

    account.set({ phase: 'ready', spendingLimit: 60, balance: { available: 988, held: 0, byProvenance: { earned: { available: 4 }, purchased: { available: 984 } } },
      checkout: { phase: 'issued', credits: 1000 },
      lastQuote: { maxCharge: 60, deadline: '2026-10-15T12:03:00.000Z', accepted: true },
      journal: [
        { type: 'issue', amount: 4, lots: [{ provenance: 'earned' }], at: '2026-10-15T12:02:00.000Z' },
        { type: 'charge', amount: 12, lots: [{ provenance: 'purchased' }], at: '2026-10-15T12:01:00.000Z' },
        { type: 'issue', amount: 1000, lots: [{ provenance: 'purchased' }], at: '2026-10-15T12:00:00.000Z' }
      ] });
    expect(find('[data-earning-ready]').hidden).toBe(false);
    expect(find('[data-earning-balance]').textContent).toBe('Balance: 988 credits · earned 4, bought 984');
    expect(find('[data-earning-checkout]').textContent).toBe('Last top-up: 1,000 credits, credited.');
    expect(find('[data-earning-limit]').value).toBe('60');
    expect(find('[data-earning-quote]').textContent).toMatch(/^Last quote: up to 60 credits, answer by .+\. Accepted\.$/);
    expect([...root.querySelectorAll('[data-earning-entry]')].map((row) => row.textContent.split(' · ')[0]))
      .toEqual(['Earned +4 credits', 'Charged for an answer −12 credits', 'Bought +1,000 credits']);

    find('[data-earning-top-up="test-topup"]').click();
    expect(account.topUp).toHaveBeenCalledWith('test-topup');
    find('[data-earning-limit]').value = '80';
    find('[data-earning-limit-form]').dispatchEvent(new Event('submit', { cancelable: true }));
    expect(account.setSpendingLimit).toHaveBeenCalledWith('80');
    account.set({ lastQuote: { maxCharge: 90, deadline: null, accepted: false }, spendingLimit: 80 });
    expect(find('[data-earning-quote]').textContent).toBe('Last quote: up to 90 credits. Not sent: above your limit of 80.');
    account.set({ lastQuote: { maxCharge: 12, deadline: null, accepted: true, funding: 'community_access' } });
    expect(find('[data-earning-quote]').textContent).toBe('Last quote: up to 12 credits. Asked for Community Access, which the pool pays.');
    find('[data-earning-sign-out]').click();
    expect(account.signOut).toHaveBeenCalled();
    dispose();
  });

  it('uses the email-link sign-in for Supabase and its own sign-out', async () => {
    const root = mount();
    const signIn = Object.assign(store({ phase: 'signed_out', email: null, message: '' }), { start: vi.fn(async () => {}), requestLink: vi.fn(), signOut: vi.fn() });
    const account = Object.assign(store({ phase: 'signed_out', balance: null, journal: [], topUps: [], checkout: null, spendingLimit: null, lastQuote: null, message: '' }),
      { setSpendingLimit: vi.fn(), topUp: vi.fn(), signOut: vi.fn() });
    const dispose = bindAccountPanel(root, Promise.resolve({ account, signIn, flow: { providerId: 'supabase', flow: 'supabase_magic_link' } }));
    await flush();
    expect(root.querySelector('[data-account-sign-in-form]')).not.toBeNull();
    expect(root.querySelector('[data-earning-sign-out]').hidden).toBe(true);
    expect(signIn.start).toHaveBeenCalled();
    dispose();
  });
});
