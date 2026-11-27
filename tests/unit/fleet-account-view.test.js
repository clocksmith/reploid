import { describe, expect, it, vi } from 'vitest';
import { createFleetAccount } from '../../apps/poolday/host/fleet-account.js';
import { fleetAccountText, fleetStarterText } from '../../apps/poolday/ui/pool-home/fleet-account-view.js';

const view = (balance, held, debtLimit) => ({ schema: 'reploid.fleet-self-serve/v1', account: { id: 'acct-1', label: 'Reploid account 1', verified: debtLimit > 0 },
  credits: { unit: 'noncash-service-credit', balance, held, available: balance - held, debtLimit, spendable: balance - held + debtLimit }, computers: [], pairings: [] });

/** A scripted /v1/fleet service: just enough state for the browser's account flow. */
function service() {
  let token = null, account = null, pairing = null;
  const calls = [];
  const reply = (status, value) => ({ ok: status < 300, status, json: async () => value });
  const fetchImpl = async (url, init = {}) => {
    const route = new URL(url, 'https://replo.id').pathname, method = init.method || 'GET';
    calls.push(`${method} ${route}`);
    if (url.startsWith('http://127.0.0.1:')) return reply(200, { token: 'bridge-secret-'.padEnd(40, 'x') });
    if (route === '/v1/fleet/client') return reply(200, { schema: 'reploid.fleet-self-serve/v1', available: true });
    if (!init.headers?.Authorization) return reply(401, { code: 'sign_in_required', error: 'Sign in first.' });
    if (route === '/v1/fleet/account' && method === 'GET') return account ? reply(200, account) : reply(404, { code: 'account_required', error: 'Create your Reploid account first.' });
    if (route === '/v1/fleet/account') { account = view(0, 0, 40); return reply(200, account); }
    if (route === '/v1/fleet/pairings') { pairing = { id: 'pair-1', state: 'open', code: 'ABCD-EFGH', command: 'npx reploid join ABCD-EFGH' }; return reply(200, pairing); }
    if (route === '/v1/fleet/pairings/pair-1' && method === 'GET') return reply(200, { id: 'pair-1', state: pairing.state, ...(pairing.computer ? { computer: pairing.computer } : {}) });
    if (route.endsWith('/confirm')) {
      if (JSON.parse(init.body).fingerprint !== '5C0E-CD2F') return reply(409, { code: 'fingerprint_mismatch', error: 'Mismatch' });
      pairing.state = 'confirmed';
      account = { ...account, computers: [{ participantId: 'peer:5c0ecd2fd5fd8a105a4f8068', fingerprint: '5C0E-CD2F', name: 'Laptop' }] };
      return reply(200, { id: 'pair-1', state: 'confirmed', computer: pairing.computer });
    }
    return reply(404, { error: 'Unknown' });
  };
  return { fetchImpl, calls, signIn: async () => { token = 'test:alice:verified'; }, getToken: async () => token,
    claimBy: computer => { pairing.state = 'claimed'; pairing.computer = computer; } };
}

describe('self-serve account in the browser', () => {
  it('signs in, creates the account, pairs a computer by confirming its fingerprint, then connects the local host', async () => {
    const remote = service(), privateComputers = { connect: vi.fn(async () => {}) };
    const port = createFleetAccount({ fetchImpl: remote.fetchImpl, getToken: remote.getToken, signIn: remote.signIn, privateComputers, setTimer: () => 1, clearTimer: () => {} });
    await port.load();
    expect(port.state()).toMatchObject({ available: true, signedIn: false, account: null });
    await port.signIn('google');
    expect(port.state()).toMatchObject({ signedIn: true, account: null });
    await port.createAccount();
    expect(port.state().account.credits.spendable).toBe(40);
    await port.startPairing();
    await expect(port.confirmPairing()).rejects.toThrow('No computer has claimed');
    remote.claimBy({ name: 'Laptop', participantId: 'peer:5c0ecd2fd5fd8a105a4f8068', fingerprint: '5C0E-CD2F', bridgePort: 18800 });
    await port.refreshPairing();
    await port.confirmPairing();
    expect(port.state().account.computers).toHaveLength(1);
    await port.useThisComputer();
    expect(privateComputers.connect).toHaveBeenCalledWith('http://127.0.0.1:18800', expect.stringMatching(/^bridge-secret-/));
    expect(port.state().pairing).toBeNull();
  });

  it('renders the balance, held credits, what can be spent, and the starter credit', () => {
    expect(fleetAccountText(view(12, 4, 40))).toBe('Balance 12 credits · 4 credits held for unfinished answers · 48 credits can be spent now');
    expect(fleetAccountText(view(-50, 0, 40))).toBe('Balance -50 credits · 0 credits can be spent now');
    expect(fleetStarterText(view(0, 0, 40))).toContain('down to −40');
    expect(fleetStarterText(view(0, 0, 0))).toContain('No starter credit');
  });
});
