import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';
import { joinFleetByCode } from '../../server/fleet/join.js';
import { startFleetBrowserBridge } from '../../server/fleet/browser-bridge.js';
import { createFleetClient } from '../../server/fleet/service.js';
import { verifyCreditStatement } from '../../server/fleet/credit-statement.js';
import { SELF_SERVE_MODEL, sessionApi, settleAnswer, startSelfServeServer } from '../helpers/self-serve-fleet.js';

// New account → pair a computer by code → earn by serving → spend in the browser → statement. The hosted account
// service, ledger, signatures, `join` and the browser bridge are the real ones on loopback; the native host behind
// the bridge is a fixture whose "model" returns fixed text, so this establishes the self-serve product path only,
// not real inference, WebRTC, GPU cleanup or production deployment.

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});

/** The faked native host: what native-host.js gives its bridge, over the hosted ledger with the joined key. */
function fakeNativeHost({ fleetUrl, identity, computerId, name, provider }) {
  const client = createFleetClient({ url: fleetUrl, identity });
  const route = plaintextExecutionRoute({ model: SELF_SERVE_MODEL }, { recipients: [identity.peerId, provider.peerId],
    route: { schema: 'reploid.paired-whole-route/v1', requester: identity.peerId, providerIdentity: provider.peerId } });
  const generated = [];
  return { generated, host: {
    async browserState() {
      const terms = await client.call('terms', SELF_SERVE_MODEL);
      const own = (await client.call('snapshot', {})).accounts[0];
      const spendable = own.balance - own.held + terms.policy.maxDebt;
      return { schema: 'reploid.fleet-browser/v1', privacyProtocol: 'reploid.paired-route/v3', poolIdentity: 'sha256:' + 'd'.repeat(64),
        requester: { id: computerId, name, participantId: identity.peerId },
        models: [{ ...SELF_SERVE_MODEL, name: 'Qwen 3.5 2B', provider: 'doppler', availability: 'ready',
          creditCap: { maximum: 12, unit: terms.policy.unit, spendable },
          executionRoutes: [{ selection: { ...SELF_SERVE_MODEL }, route }] }],
        computers: [{ id: computerId, name, online: true, participantIds: [identity.peerId], requester: true },
          { id: 'another-person', name: 'Another person', online: true, participantIds: [provider.peerId],
            resident: { modelIdentity: SELF_SERVE_MODEL.identity, mode: 'whole-model' }, activeRequests: 0 }],
        at: Date.now() };
    },
    balances: () => client.call('snapshot', {}),
    statement: () => client.statement(),
    receipt: id => client.call('request', { id }),
    cancel() {},
    async generate(request, onDelta, onDisclosure) {
      generated.push(request);
      onDisclosure({ recipientIdentity: provider.peerId, requestId: 'shown' });
      onDelta('Paris is ');
      onDelta('the capital of France.');
      const answer = await settleAnswer({ fleetUrl, consumer: identity, provider, tokens: 9, maxOutputTokens: 12,
        content: 'Paris is the capital of France.', messages: request.messages });
      return { modelId: SELF_SERVE_MODEL.id, modelIdentity: SELF_SERVE_MODEL.identity, adapterIdentities: [], content: answer.content,
        execution: { placement: 'peer-whole-request', providerIdentity: provider.peerId }, serviceCredit: answer.serviceCredit };
    } } };
}

test('a new account pairs this computer by code, earns by serving, spends in the browser and saves a verifiable statement', async ({ page, baseURL }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'self-serve-journey-'));
  const hosted = await startSelfServeServer(root);
  let bridge = null;
  try {
    // The page's own /v1/fleet goes to the hosted service; sign-in is a scripted Firebase user with a test token.
    await page.route(url => new URL(url).pathname.startsWith('/v1/fleet'), async route => {
      const url = new URL(route.request().url());
      const response = await route.fetch({ url: hosted.origin + url.pathname + url.search });
      await route.fulfill({ response });
    });
    await page.addInitScript(() => {
      globalThis.REPLOID_FIREBASE_AUTH = { currentUser: null, authStateReady: async () => {} };
      globalThis.REPLOID_FIREBASE_SIGN_IN_WITH_GOOGLE = async auth => {
        auth.currentUser = { uid: 'newcomer', isAnonymous: false, getIdToken: async () => 'test:newcomer:verified' };
      };
    });
    await page.goto('/');
    await page.locator('[data-chat-workspace]').waitFor();
    await page.locator('[data-inspector-section="participants"]').filter({ visible: true }).first().click();

    // New account.
    const account = page.locator('[data-fleet-account]');
    await expect(account.locator('[data-fleet-account-status]')).toHaveText('Not signed in');
    await account.locator('[data-fleet-sign-in-google]').click();
    await expect(account.locator('[data-fleet-account-status]')).toHaveText('Signed in · no account yet');
    await account.locator('[data-fleet-create]').click();
    await expect(account.locator('[data-fleet-account-status]')).toHaveText('Balance 0 credits · 40 credits can be spent now');
    await expect(account.locator('[data-fleet-starter]')).toContainText('down to −40');

    // Pair this computer: the code goes to `npx reploid join`, its fingerprint comes back for confirmation.
    await account.locator('[data-fleet-pair]').click();
    const dialog = page.locator('[data-fleet-pair-dialog]');
    await expect(dialog.locator('[data-fleet-pair-code]')).toHaveText(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const code = await dialog.locator('[data-fleet-pair-code]').textContent();
    await expect(dialog.locator('[data-fleet-pair-command]')).toHaveText(`npx reploid join ${code}`);
    const bridgePort = await freePort();
    let printed = null;
    const joining = joinFleetByCode({ code, service: hosted.origin, name: 'Laptop', bridgePort, pollMs: 100,
      stateDirectory: path.join(root, 'laptop'), onClaimed: ({ fingerprint }) => { printed = fingerprint; } });
    await expect(dialog.locator('[data-fleet-pair-computer]')).toHaveText('Laptop', { timeout: 10000 });
    await expect(dialog.locator('[data-fleet-pair-fingerprint]')).toHaveText(printed);
    await dialog.locator('[data-fleet-pair-confirm]').click();
    const joined = await joining;
    await expect(dialog.locator('[data-fleet-pair-status]')).toHaveText('Paired. Start its host, then choose Use for answers.');
    await expect(account.locator('[data-fleet-computers]')).toContainText(printed);

    // The computer earns: another person's account asks it and it serves 32 output tokens.
    const identity = JSON.parse(await readFile(joined.identityFile, 'utf8'));
    const otherApi = sessionApi(hosted.origin, 'test:other:verified');
    await otherApi('POST', '/v1/fleet/account', {});
    const otherPairing = await otherApi('POST', '/v1/fleet/pairings', {});
    const otherJoin = joinFleetByCode({ code: otherPairing.code, service: hosted.origin, name: 'Another person', pollMs: 50,
      stateDirectory: path.join(root, 'other'), bridgePort: await freePort() });
    let claim;
    do { claim = await otherApi('GET', `/v1/fleet/pairings/${otherPairing.id}`); } while (claim.state !== 'claimed');
    await otherApi('POST', `/v1/fleet/pairings/${otherPairing.id}/confirm`, { fingerprint: claim.computer.fingerprint });
    const provider = JSON.parse(await readFile((await otherJoin).identityFile, 'utf8'));
    expect(provider.peerId).not.toBe(identity.peerId);
    await settleAnswer({ fleetUrl: hosted.fleetUrl, consumer: provider, provider: identity, tokens: 20 });

    // Start the (faked) host with the configuration `join` wrote, then let this tab use it for answers.
    const host = JSON.parse(await readFile(joined.hostFile, 'utf8'));
    expect(host.browserBridge.origins).toEqual([hosted.origin]);
    const fake = fakeNativeHost({ fleetUrl: hosted.fleetUrl, identity, computerId: joined.computerId, name: 'Laptop', provider });
    bridge = await startFleetBrowserBridge({ host: fake.host, port: bridgePort, origins: [new URL(baseURL).origin],
      token: (await readFile(host.browserBridge.tokenFile, 'utf8')).trim(), claim: host.browserBridge.claim });
    await dialog.locator('[data-fleet-use]').click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator('[data-private-status]')).toHaveText('2 online · via Laptop');

    // Spend from the same account in the browser.
    await page.locator('[data-open-model]').click();
    const choice = page.locator(`[data-model-picker] .chat-model-choices input[value="private:${identity.peerId}:${SELF_SERVE_MODEL.id}"]`).filter({ visible: true });
    await choice.click();
    await expect(page.locator('[data-model-status]')).toHaveText('This answer costs at most 12 service credits.');
    await page.locator('[data-composer-input]').fill('What is the capital of France?');
    await page.locator('[data-composer-send]').click();
    await expect(page.locator('[data-message-id]').last()).toContainText('Paris is the capital of France.');
    expect(fake.generated).toHaveLength(1);
    await page.locator('[data-execution-trigger]').last().click();
    await expect(page.locator('[data-inspected-activity]')).toContainText('9 credits charged for 9 output tokens');

    // The account shows what it earned and spent; its statement verifies offline.
    await page.locator('[data-inspector-section="participants"]').filter({ visible: true }).first().click();
    await expect(account.locator('[data-fleet-account-status]')).toHaveText('Balance 11 credits · 51 credits can be spent now', { timeout: 15000 });
    await account.locator('[data-fleet-activity-section] > summary').click();
    await expect(account.locator('[data-fleet-activity] li').first()).toContainText('Spent 9 credits asking');
    await expect(account.locator('[data-fleet-activity]')).toContainText('Earned 20 credits serving');
    const download = page.waitForEvent('download');
    await account.locator('[data-fleet-statement]').click();
    const saved = await download;
    expect(saved.suggestedFilename()).toBe('reploid-account-statement.json');
    const statement = JSON.parse(await readFile(await saved.path(), 'utf8'));
    expect(await verifyCreditStatement(statement, { participantIds: [identity.peerId] }))
      .toMatchObject({ ok: true, statedBalance: 11, recomputedBalance: 11, uncheckedCount: 0 });
  } finally {
    await bridge?.close();
    await hosted.close();
    await rm(root, { recursive: true, force: true });
  }
});
