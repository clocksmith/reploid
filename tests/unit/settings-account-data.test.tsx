// Settings' credits account, email sign-in, data export and import, and stored-model removal on the React Settings
// pane, over the host's real local-data and session modules and stand-in earning ports.
import { act, cleanup, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PooldayRoot } from '@reploid/poolday-ui';
import { createChatSession } from '../../apps/poolday/host/chat-session.js';
import { createComputerPreferences } from '../../apps/poolday/host/computer-preferences.js';
import { LOCAL_DATA_SCHEMA } from '../../apps/poolday/host/local-data.js';
import { createSettingsServices } from '../../apps/poolday-react/src/features/settings/infrastructure/hostSettings';
import { SettingsPanel } from '../../apps/poolday-react/src/features/settings/presentation/SettingsPanel';
import { createChatTestService } from '../fixtures/chat-service.js';

afterEach(cleanup);

const appearance = { getChoice: () => 'system' as const, setChoice: () => undefined, subscribe: () => () => undefined };
const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

function mount(product: { host: object; earning?: Promise<unknown> }) {
  const view = render(<PooldayRoot><SettingsPanel services={createSettingsServices(product)} appearance={appearance} /></PooldayRoot>);
  return { ...view, query: (selector: string) => view.container.querySelector(selector) as HTMLElement };
}

type Listener = (value: Record<string, unknown>) => void;
const store = (initial: Record<string, unknown>) => {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    state: () => state,
    set(next: Record<string, unknown>) { act(() => { state = { ...state, ...next }; listeners.forEach((listener) => listener(state)); }); },
    subscribe(listener: Listener) { listeners.add(listener); listener(state); return () => listeners.delete(listener); },
  };
};
const chat = { getState: () => ({ models: [] }), subscribe: () => () => undefined };

describe('credits account', () => {
  it('stays hidden when the page has no earning service', async () => {
    const { query } = mount({ host: { chat }, earning: Promise.resolve(null) });
    await flush();
    expect(query('[data-earning-account]')).toBeNull();
  });

  it('signs in through the local test form and renders the account', async () => {
    const signIn = Object.assign(store({ phase: 'signed_out', subject: null }), { useSubject: vi.fn(async (subject: string) => signIn.set({ phase: 'signed_in', subject })), signOut: vi.fn() });
    const account = Object.assign(store({ phase: 'signed_out', balance: null, journal: [], topUps: [{ topUpId: 'test-topup', price: { amountMinor: 1000, currency: 'USD' } }],
      checkout: null, spendingLimit: null, lastQuote: null, message: '' }), {
      setSpendingLimit: vi.fn(), topUp: vi.fn(async () => null), signOut: vi.fn(async () => undefined),
    });
    const { query } = mount({ host: { chat }, earning: Promise.resolve({ account, signIn, flow: { providerId: 'local-test', flow: 'local_test_subject' } }) });
    await waitFor(() => expect(query('[data-earning-account]')).not.toBeNull());
    expect(query('[data-earning-ready]')).toBeNull();
    await userEvent.type(query('[data-earning-local-subject]'), 'alice');
    await userEvent.click(query('[data-earning-local-submit]'));
    expect(signIn.useSubject).toHaveBeenCalledWith('alice');
    await waitFor(() => expect(query('[data-earning-local-signed-in]').textContent).toBe('Signed in as alice (local test).'));
    // The balance, journal and quote show once the account is ready; before that it states where it stands.
    account.set({ phase: 'ready', spendingLimit: null, balance: { available: 0, held: 0 }, journal: [], lastQuote: null });
    await waitFor(() => expect(query('[data-earning-quote]').textContent).toBe('No spending limit is set, so answers that cost credits are not sent.'));
    expect(query('[data-earning-journal]').textContent).toContain('No activity yet.');

    account.set({ phase: 'ready', spendingLimit: 60, balance: { available: 988, held: 0, byProvenance: { earned: { available: 4 }, purchased: { available: 984 } } },
      checkout: { phase: 'issued', credits: 1000 },
      lastQuote: { maxCharge: 60, deadline: '2026-10-15T12:03:00.000Z', accepted: true },
      journal: [
        { type: 'issue', amount: 4, lots: [{ provenance: 'earned' }], at: '2026-10-15T12:02:00.000Z' },
        { type: 'charge', amount: 12, lots: [{ provenance: 'purchased' }], at: '2026-10-15T12:01:00.000Z' },
        { type: 'issue', amount: 1000, lots: [{ provenance: 'purchased' }], at: '2026-10-15T12:00:00.000Z' },
      ] });
    await waitFor(() => expect(query('[data-earning-ready]')).not.toBeNull());
    expect(query('[data-earning-balance]').textContent).toBe('Balance: 988 credits · earned 4, bought 984');
    expect(query('[data-earning-checkout]').textContent).toBe('Last top-up: 1,000 credits, credited.');
    expect((query('[data-earning-limit]') as HTMLInputElement).value).toBe('60');
    expect(query('[data-earning-quote]').textContent).toMatch(/^Last quote: up to 60 credits, answer by .+\. Accepted\.$/);
    expect([...document.querySelectorAll('[data-earning-entry]')].map((row) => (row.textContent ?? '').split(' · ')[0]))
      .toEqual(['Earned +4 credits', 'Charged for an answer −12 credits', 'Bought +1,000 credits']);

    await userEvent.click(query('[data-earning-top-up="test-topup"]'));
    expect(account.topUp).toHaveBeenCalledWith('test-topup');
    await userEvent.clear(query('[data-earning-limit]'));
    await userEvent.type(query('[data-earning-limit]'), '80');
    await userEvent.click(query('[data-earning-limit-save]'));
    expect(account.setSpendingLimit).toHaveBeenCalledWith('80');
    account.set({ lastQuote: { maxCharge: 90, deadline: null, accepted: false }, spendingLimit: 80 });
    expect(query('[data-earning-quote]').textContent).toBe('Last quote: up to 90 credits. Not sent: above your limit of 80.');
    account.set({ lastQuote: { maxCharge: 12, deadline: null, accepted: true, funding: 'community_access' } });
    expect(query('[data-earning-quote]').textContent).toBe('Last quote: up to 12 credits. Asked for Community Access, which the pool pays.');
    await userEvent.click(query('[data-earning-sign-out]'));
    expect(account.signOut.mock.calls.length + signIn.signOut.mock.calls.length).toBeGreaterThan(0);
  });

  it('uses the email-link sign-in for Supabase: one link to this address, then where to open it', async () => {
    const signIn = Object.assign(store({ phase: 'signed_out', email: null, message: '' }), {
      start: vi.fn(async () => undefined),
      // The host's sign-in (host/supabase-sign-in.js) states where the link went; the pane shows its message.
      requestLink: vi.fn(async () => signIn.set({ phase: 'signed_out', message: 'Check your email for a sign-in link. Open it on this device.' })),
      signOut: vi.fn(),
    });
    const account = Object.assign(store({ phase: 'signed_out', balance: null, journal: [], topUps: [], checkout: null, spendingLimit: null, lastQuote: null, message: '' }),
      { setSpendingLimit: vi.fn(), topUp: vi.fn(), signOut: vi.fn() });
    const { query } = mount({ host: { chat }, earning: Promise.resolve({ account, signIn, flow: { providerId: 'supabase', flow: 'supabase_magic_link' } }) });
    await waitFor(() => expect(query('[data-account-sign-in-form]')).not.toBeNull());
    expect(signIn.start).toHaveBeenCalled();
    expect(query('[data-earning-sign-out]')).toBeNull();
    expect(query('[data-account-sign-in-summary]').textContent).toBe('Sign in with a one-time link sent to your email. Supabase receives your address to send it.');
    await userEvent.type(query('[data-account-sign-in-email]'), 'person@example.test');
    await userEvent.click(query('[data-account-sign-in-send]'));
    expect(signIn.requestLink).toHaveBeenCalledWith('person@example.test');
    await waitFor(() => expect(query('[data-account-sign-in-status]').textContent).toBe('Check your email for a sign-in link. Open it on this device.'));
    expect(query('[data-account-signed-in]')).toBeNull();
  });
});

describe('data controls', () => {
  const key = (id: string) => 'peer:' + id.repeat(24);
  const memory = () => { const values = new Map(); return { getItem: (name: string) => values.get(name) ?? null, setItem: (name: string, value: string) => values.set(name, value), removeItem: (name: string) => values.delete(name) }; };
  async function profile(conversations: number) {
    const storage = memory();
    const session = createChatSession({ storage, service: createChatTestService() });
    const ids: string[] = [];
    for (let i = 0; i < conversations; i++) {
      const id = session.createThread({ sharingScope: 'local' }); ids.push(id);
      expect((await session.send(id, 'Question ' + i)).status).toBe('completed');
    }
    const computers = createComputerPreferences({ storage, verifyPeer: async () => key('a') });
    return { session, computers, ids, close: async () => { await computers.close(); await session.close(); } };
  }

  it('exports a file, previews an import with its counts in a dialog, and imports only on confirmation', async () => {
    const source = await profile(2), target = await profile(0);
    const blobs: Blob[] = [];
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { blobs.push(blob as Blob); return 'blob:fixture'; });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      const from = mount({ host: { chat: source.session, computers: source.computers } });
      expect(within(from.query('[data-data-export]')).getByText('Export my data')).toBeTruthy();
      await userEvent.click(from.query('[data-data-export]'));
      expect(click).toHaveBeenCalledOnce();
      expect(blobs[0]?.type).toBe('application/json');
      expect(from.query('[data-data-status]').textContent).toBe('Exported 2 conversations.');
      const contents = await (blobs[0] as Blob).text();
      expect(JSON.parse(contents).schema).toBe(LOCAL_DATA_SCHEMA);
      from.unmount();

      const to = mount({ host: { chat: target.session, computers: target.computers } });
      const choose = async (text: string) => { await userEvent.upload(to.query('[data-data-file]') as HTMLInputElement, new File([text], 'export.json', { type: 'application/json' })); await flush(); };
      await choose('{"schema":"other"}');
      expect(to.query('[data-data-status]').textContent).toBe('This file is not a Reploid data export.');
      expect(to.query('[data-data-dialog]').hasAttribute('open')).toBe(false);
      await choose(contents);
      await waitFor(() => expect(to.query('[data-data-dialog]').hasAttribute('open')).toBe(true));
      expect(to.query('[data-data-summary]').textContent).toBe('This file adds 2 conversations, 0 computer names and 0 blocked computers.');
      expect(target.session.getState().threads).toHaveLength(0);
      await userEvent.click(to.query('[data-data-cancel]'));
      expect(to.query('[data-data-dialog]').hasAttribute('open')).toBe(false);
      expect(target.session.getState().threads).toHaveLength(0);
      await choose(contents);
      await userEvent.click(to.query('[data-data-confirm]'));
      expect(target.session.getState().threads.map((thread: { id: string }) => thread.id)).toEqual(source.ids);
      expect(to.query('[data-data-status]').textContent).toBe('Imported 2 conversations, 0 computer names and 0 blocked computers.');
      await choose(contents);
      expect(to.query('[data-data-dialog]').hasAttribute('open')).toBe(false);
      expect(to.query('[data-data-status]').textContent).toContain('Nothing to import.');
    } finally {
      createObjectURL.mockRestore(); revoke.mockRestore(); click.mockRestore();
      await source.close(); await target.close();
    }
  });
});

describe('stored models', () => {
  it('requires a bounded confirmation and keeps removal failures visible', async () => {
    const modelStorage = { list: vi.fn(async () => [{ id: 'one', name: 'Model one', sizeBytes: 1048576 }]), remove: vi.fn(async () => { throw Error('In use by another tab'); }) };
    const { query, getByRole } = mount({ host: { chat, modelStorage } });
    await waitFor(() => expect(query('[data-stored-model="one"]')).not.toBeNull());
    await userEvent.click(getByRole('button', { name: 'Remove Model one download' }));
    expect(query('[data-storage-dialog]').hasAttribute('open')).toBe(true);
    expect(modelStorage.remove).not.toHaveBeenCalled();
    await userEvent.click(query('[data-storage-confirm]'));
    await waitFor(() => expect(query('[data-storage-remove-error]').textContent).toBe('In use by another tab'));
    expect(query('[data-storage-dialog]').hasAttribute('open')).toBe(true);
    expect(modelStorage.remove).toHaveBeenCalledWith('one');
  });
});

describe('file sharing', () => {
  it('shows a failed change in the switch status instead of an uncaught page error', async () => {
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', record);
    const swarm = {
      getFileState: () => ({ sharing: false, preparing: false, enabled: false }),
      allowCachedFiles: vi.fn(async () => { throw new Error('Storage is full'); }),
      shareFiles: vi.fn(async () => undefined),
      stopFiles: vi.fn(async () => undefined),
    };
    const session = createChatSession({ storage: null, service: createChatTestService(), swarm });
    try {
      const { query } = mount({ host: { chat: session } });
      expect(query('[data-file-sharing-row]').textContent).toContain('Not sharing');
      await userEvent.click(query('[data-toggle-file-contribution]'));
      await waitFor(() => expect(query('[data-file-sharing-row]').textContent).toContain('Storage is full'));
      expect(swarm.allowCachedFiles).toHaveBeenCalledWith(true);
      await flush();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', record);
      await session.close();
    }
  });
});
