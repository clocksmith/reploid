import { test, expect } from '@playwright/test';
import { plaintextExecutionRoute } from '../../packages/reploid/src/chat/execution-policy.js';

// The paired earn-and-spend journey in the product UI, against a scripted native bridge: the account that earned
// by serving sees its credits and receipts, sees the most an answer can cost before Send, gets a streamed answer
// and its charge, and a request it cannot cover is refused with nothing sent. The bridge is a fixture; this
// establishes the browser surface only, not real inference, settlement or physical recovery.
const BRIDGE = 'http://127.0.0.1:18784';
const SECRET = 'paired-browser-secret-for-the-credit-journey-0001';
const requester = 'peer:' + '1'.repeat(24), provider = 'peer:' + '2'.repeat(24);
const model = { id: 'qwen-3-5-2b-q4k-ef16-af32', identity: 'sha256:eb2a48400c975389a4ed8a166228cdc0feeca8c56bc85f36604e26c18e303541', name: 'Qwen 3.5 2B' };
const route = plaintextExecutionRoute({ model }, { recipients: [requester, provider],
  route: { schema: 'reploid.paired-whole-route/v1', requester, providerIdentity: provider } });

function bridgeFixture({ balance, maximum }) {
  const ledger = { balance, entries: [{ sequence: 1, requestId: 'service:earned', delta: 32, at: Date.parse('2026-11-25T01:00:00Z'),
    request: { model: { id: 'qwen-3-5-0-8b-q4k-ef16-af32-vf16' } }, outcome: { outputTokens: 32, charge: 32 } }] };
  const generated = [];
  const state = () => ({ schema: 'reploid.fleet-browser/v1', privacyProtocol: 'reploid.paired-route/v3', poolIdentity: 'sha256:' + 'c'.repeat(64),
    requester: { id: 'computer-you', name: 'Laptop', participantId: requester },
    models: [{ ...model, provider: 'doppler', availability: 'ready', creditCap: { maximum, unit: 'noncash-service-credit', spendable: ledger.balance + 32 },
      executionRoutes: [{ selection: { id: model.id, identity: model.identity }, route }] }],
    computers: [{ id: 'computer-you', name: 'Your computers', online: true, participantIds: [requester], requester: true },
      { id: 'computer-other', name: 'Another person', online: true, participantIds: [provider], resident: { modelIdentity: model.identity, mode: 'whole-model' }, activeRequests: 0 }],
    at: Date.now() });
  const accounts = () => ({ unit: 'noncash-service-credit', accounts: [
    { id: 'computer-you', name: 'Your computers', balance: ledger.balance, held: 0, available: ledger.balance },
    { id: 'computer-other', name: 'Another person', balance: -ledger.balance, held: 0, available: -ledger.balance }] });
  const statement = () => ({ schema: 'reploid.fleet-credit-statement/v1', computerId: 'computer-you', balance: ledger.balance, held: 0,
    entries: structuredClone(ledger.entries), expired: [] });
  const generate = body => {
    generated.push(body);
    if (ledger.balance + 32 < maximum) {
      return [{ error: `Service-credit admission limit reached: not enough service credits. This answer can cost up to ${maximum} and ${ledger.balance + 32} can be spent now. Nothing was sent.`,
        serviceCredit: null, disconnect: { dispatched: false, reservationId: null, finished: { status: 'cancelled_queued', charge: 0, outputTokens: 0, settledAt: Date.now() } } }];
    }
    const id = `service:${requester}:spend`, settledAt = Date.now();
    ledger.balance -= 12;
    ledger.entries.push({ sequence: 2, requestId: id, delta: -12, at: settledAt, request: { model: { id: model.id } }, outcome: { outputTokens: 12, charge: 12 } });
    return [
      { status: 'executing', execution: { provider: 'peer', placement: 'peer-whole-request', peerId: provider, serviceCredit: { status: 'pending', id } } },
      { delta: 'Paris is ' }, { delta: 'the capital of France.' },
      { result: { modelId: model.id, modelIdentity: model.identity, adapterIdentities: [], content: 'Paris is the capital of France.',
        execution: { placement: 'peer-whole-request', providerIdentity: provider }, serviceCredit: { id, charge: 12, outputTokens: 12, settledAt } } }];
  };
  return { generated, ledger, async handle(routeRequest) {
    const request = routeRequest.request(), origin = request.headers().origin || '*';
    const headers = { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Private-Network': 'true', Vary: 'Origin' };
    if (request.method() === 'OPTIONS') return routeRequest.fulfill({ status: 204, headers });
    if (request.headers().authorization !== `Bearer ${SECRET}`) return routeRequest.fulfill({ status: 400, headers, json: { error: 'Pair this browser with the native host first' } });
    const path = new URL(request.url()).pathname, body = JSON.parse(request.postData() || '{}');
    if (path === '/state') return routeRequest.fulfill({ headers, json: state() });
    if (path === '/accounts') return routeRequest.fulfill({ headers, json: accounts() });
    if (path === '/statement') return routeRequest.fulfill({ headers, json: statement() });
    if (path === '/receipt') return routeRequest.fulfill({ headers, json: { state: 'settled', binding: { maximum }, outcome: { charge: 12, outputTokens: 12, settledAt: 1 } } });
    if (path === '/generate') return routeRequest.fulfill({ headers: { ...headers, 'Content-Type': 'application/x-ndjson' },
      body: generate(body).map(line => JSON.stringify(line)).join('\n') + '\n' });
    return routeRequest.fulfill({ status: 400, headers, json: { error: 'Unknown browser bridge operation' } });
  } };
}

async function pairAndOpen(page, fixture) {
  await page.route(`${BRIDGE}/**`, route => fixture.handle(route));
  await page.goto('/');
  await page.locator('[data-chat-workspace]').waitFor();
  await page.locator('[data-inspector-section="participants"]').filter({ visible: true }).first().click();
  const pair = page.locator('[data-private-pair]');
  await pair.locator('summary').click();
  await pair.locator('input[name="address"]').fill(BRIDGE);
  await pair.locator('input[name="secret"]').fill(SECRET);
  await pair.locator('button[type="submit"]').click();
  await expect(page.locator('[data-private-status]')).toHaveText('2 online · via Laptop');
}

async function choosePrivateModel(page) {
  await page.locator('[data-open-model]').click();
  const choice = page.locator(`[data-model-picker] .chat-model-choices input[value="private:${requester}:${model.id}"]`).filter({ visible: true });
  await expect(choice).toBeVisible();
  // A tap, even on the already highlighted choice, is what applies it.
  await choice.click();
  // Choosing a private-pool model chooses that pool; a usable choice commits and closes the sheet.
  await expect(page.locator('[data-model-picker]')).not.toBeVisible();
}

test('an account that earned sees its credits, the quote before Send, the streamed answer, its charge and its statement', async ({ page }) => {
  const fixture = bridgeFixture({ balance: 32, maximum: 48 });
  await pairAndOpen(page, fixture);
  const credits = page.locator('[data-private-account]');
  await credits.locator('summary').click();
  await expect(page.locator('[data-private-own-account]')).toHaveText('Your account (Your computers): 32 credits');
  await expect(page.locator('[data-private-activity]')).toContainText('Earned 32 credits serving qwen-3-5-0-8b-q4k-ef16-af32-vf16 · 32 output tokens');
  await expect(credits).toContainText('no cash value');

  await choosePrivateModel(page);
  await expect(page.locator('[data-model-status]')).toHaveText('This answer costs at most 48 service credits.');
  expect(fixture.generated).toHaveLength(0);
  await page.locator('[data-composer-input]').fill('What is the capital of France?');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-message-id]').last()).toContainText('Paris is the capital of France.');
  expect(fixture.generated).toHaveLength(1);

  await page.locator('[data-execution-trigger]').last().click();
  await expect(page.locator('[data-inspected-activity]')).toContainText('12 credits charged for 12 output tokens');
  await page.locator('[data-attempt-details] > summary').click();
  await expect(page.locator('[data-ribbon-facts]')).toContainText('Service credits: 12 credits charged for 12 output tokens');
  const download = page.waitForEvent('download');
  await page.locator('[data-credit-receipt]').click();
  await expect(page.locator('[data-credit-receipt-status]')).toHaveText('Saved · 12 credits charged for 12 output tokens');
  expect((await download).suggestedFilename()).toBe('reploid-service-receipt.json');

  await page.locator('[data-inspector-section="participants"]').filter({ visible: true }).first().click();
  await expect(page.locator('[data-private-own-account]')).toHaveText('Your account (Your computers): 20 credits', { timeout: 15000 });
  await expect(page.locator('[data-private-activity] li').first()).toContainText('Spent 12 credits asking Qwen 3.5 2B · 12 output tokens');
  const statement = page.waitForEvent('download');
  await page.locator('[data-private-statement]').click();
  expect((await statement).suggestedFilename()).toBe('reploid-service-statement.json');
});

test('an account that cannot cover the quote is told why, and nothing is charged', async ({ page }) => {
  const fixture = bridgeFixture({ balance: 0, maximum: 48 });
  await pairAndOpen(page, fixture);
  await choosePrivateModel(page);
  await expect(page.locator('[data-model-status]')).toHaveText('This answer costs at most 48 service credits. '
    + 'Your account can cover 32 now, so this would be refused before anything is sent. Serving answers for others earns more.');
  await page.locator('[data-composer-input]').fill('What is the capital of France?');
  await page.locator('[data-composer-send]').click();
  await expect(page.locator('[data-message-stream]')).toContainText('Not sent. Not enough service credits: this answer can cost up to 48 and your account can spend 32 now.');
  await page.locator('[data-execution-trigger]').last().click();
  await expect(page.locator('[data-inspected-activity]')).toContainText('Not sent · nothing charged');
  expect(fixture.ledger.balance).toBe(0);
});
