#!/usr/bin/env node
// Local end-to-end earning demonstration through the UI (non-production; not production code).
//
// Starts a Firestore emulator (the local durable store), the server (server/proxy.js from --repo) with the
// in-repository earning composition, the local test sign-in flow and the test processor, and the native
// contributor process (contributor.mjs). Two headless browser profiles then act as two devices:
//   requester (alice): the app's Settings Credits panel signs in, tops up on the test checkout page and sets a
//     standing limit; the requester harness page (requester-page.mjs) sends three answers that are quoted,
//     bound, executed over the fixture route and settled.
//   contributor (carol): the two native devices claim their stage shares; carol then signs in on this second
//     browser profile, sees the earned credits and spends them on an answer.
// Every request to a non-loopback address is blocked and recorded. Screenshots, balances and journals, the
// server log excerpt and the contributor log are written to --out.
//
// Usage: node demo.mjs --repo <checkout> --work <directory outside the checkout> --out <evidence directory>
//          --server-port <port> --bridge-port <port> --emulator-port <port> --java-home <JDK 21+>
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const { values } = parseArgs({ options: Object.fromEntries(['repo', 'work', 'out', 'server-port', 'bridge-port', 'emulator-port', 'java-home']
  .map((key) => [key, { type: 'string' }])) });
for (const name of ['repo', 'work', 'out', 'server-port', 'bridge-port', 'emulator-port', 'java-home']) if (!values[name]) throw new Error(`--${name} is required`);
const repo = path.resolve(values.repo), work = path.resolve(values.work), out = path.resolve(values.out);
const origin = `http://127.0.0.1:${values['server-port']}`;
const { chromium } = await import(pathToFileURL(path.join(repo, 'node_modules/playwright/index.mjs')).href);
const { CAPACITY_EVIDENCE_SCHEMA } = await import(pathToFileURL(path.join(repo, 'server/rewards/domain.js')).href);
const { MODEL } = await import(pathToFileURL(path.join(repo, 'tests/helpers/reward-fixture.js')).href).catch(() => ({ MODEL: null }));
const { CAPACITY_EVIDENCE_SCHEMA: COMMUNITY_CAPACITY_SCHEMA } = await import(pathToFileURL(path.join(repo, 'server/community-access/domain.js')).href);
const { EVIDENCE_RULES_ID } = await import(pathToFileURL(path.join(repo, 'server/ledger/domain.js')).href);
const { MAX_UNACKNOWLEDGED_OUTPUTS } = await import(pathToFileURL(path.join(repo, 'packages/reploid/src/mesh/partitions/partition-attempt-evidence.js')).href);
const { EARNING_CLIENT_SCHEMA, createEarningClient } = await import(pathToFileURL(path.join(repo, 'self/host/earning/client.js')).href);
const { createSigningIdentity } = await import(pathToFileURL(path.join(repo, 'packages/reploid/src/artifacts/identity.js')).href);
/** The emulator's documents, read directly for evidence of what the scheduler recorded. */
const emulatorFirestore = async () => {
  process.env.FIRESTORE_EMULATOR_HOST = `127.0.0.1:${values['emulator-port']}`;
  const appModule = await import(pathToFileURL(path.join(repo, 'node_modules/firebase-admin/lib/app/index.js')).href);
  const firestoreModule = await import(pathToFileURL(path.join(repo, 'node_modules/firebase-admin/lib/firestore/index.js')).href);
  const app = appModule.getApps().find((row) => row.name === 'demo-reader') ?? appModule.initializeApp({ projectId: 'demo-reploid-earning' }, 'demo-reader');
  return firestoreModule.getFirestore(app);
};
await fs.mkdir(work, { recursive: true, mode: 0o700 });
await fs.mkdir(path.join(out, 'screenshots'), { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const children = [];
const timeline = [];
const mark = (step, detail = {}) => { timeline.push({ at: new Date().toISOString(), step, ...detail }); console.log(`[demo] ${step}`); };

// ---- Inputs (outside the checkout). Pilot values the owner chose are marked; the rest are demonstration values.
const MIN = 60_000;
// Paid and Community Access answers settle from signed stage receipts and the requester's acknowledgments.
const EVIDENCE = { rulesId: EVIDENCE_RULES_ID, windowMs: 2 * MIN, clockSkewMs: 30_000, maxUnacknowledgedOutputs: MAX_UNACKNOWLEDGED_OUTPUTS };
const policy = {
  schema: 'reploid.earning-policy/v1',
  policyVersion: 'local-demo-20261015/1',
  accounts: { audience: 'reploid-earning-local-demo', sessionTtlMs: 60 * MIN, challengeTtlMs: 5 * MIN, recoveryMaxAuthAgeMs: 5 * MIN,
    maxClockSkewMs: 30_000, custodyCertificateMaxLifetimeMs: 120 * MIN },
  ledger: { accountingVersion: 'local-demo-accounting/1', contract: { id: 'reploid.product-economics/1.0.0', documentRevision: 'local-demo' },
    unit: { name: 'credit', minorUnitsPerCredit: 1 }, rounding: 'ceil', lotConsumptionOrder: ['community_access', 'earned', 'subsidized', 'donated', 'purchased'],
    transfers: { enabled: false } },
  reversals: { refund: { spentCredit: 'account_deficit' }, chargeback: { spentCredit: 'account_deficit' } },
  rewards: { rewardPolicyVersion: 'local-demo-rewards/1', validatorId: 'validator_local_demo', enabledCategories: ['demanded_inference'],
    collusion: { rejectLinkKinds: ['shared_payment_instrument'] } },
  issuance: { policyId: 'local-demo-issuance/1', accountingVersion: 'local-demo-accounting/1',
    bases: { settled_demand: { provenance: ['purchased', 'donated', 'community_access', 'earned'], share: { numerator: 9, denominator: 10 } },
      funded_reservation: { funderKinds: ['operator', 'community'] } },
    categoryBases: { demanded_inference: ['settled_demand'], verified_delivery: ['settled_demand'], contracted_storage: ['settled_demand', 'funded_reservation'],
      prepared_readiness: ['funded_reservation', 'settled_demand'] },
    capacity: { coverage: { numerator: 1, denominator: 1 }, evidenceMaxAgeMs: 24 * 60 * MIN } },
  routes: { jsonBytes: 16 * 1024, evidenceJsonBytes: 256 * 1024, idempotencyLeaseMs: 30_000, address: { max: 10_000, windowMs: MIN },
    signIn: { max: 100, windowMs: MIN }, account: { max: 1000, windowMs: MIN }, device: { max: 1000, windowMs: MIN }, operator: { max: 100, windowMs: MIN } },
  // Demonstration conversion: one credit per US cent.
  conversions: { authority: { actorId: 'local_demo_pricing', decisionId: 'decision:local-demo-conversion' },
    records: [{ conversionId: 'conv_local_demo_usd', policyVersion: 'local-demo-pricing/1', currency: 'USD', rate: { credits: 1, perMinorUnits: 1 }, rounding: 'floor', effectiveFrom: 'on_publication' }] },
  // Pilot: a $10 top-up.
  payments: { policyVersion: 'local-demo-payments/1', topUps: [{ topUpId: 'top-up-10-usd', price: { amountMinor: 1000, currency: 'USD' } }],
    polling: { minAgeMs: MIN, reversalWatchMs: 30 * 24 * 60 * MIN } },
  funding: { authorities: ['founder'] },
  services: [{
    request: { modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, operation: 'chat.completion' },
    service: { serviceRecordId: 'svc_local_demo_fixture', model: { modelId: MODEL.modelId, checkpoint: 'fixture', deployedRepresentation: 'fixture', tokenizer: 'fixture', adapters: [] },
      runtime: { runtimeId: 'resident-route-fixture' }, operation: 'chat.completion',
      limits: { context: { max: 4096, unit: 'token', exceedance: 'reject' }, output: { max: 8, unit: 'token', exceedance: 'stop_and_report' } },
      qualityPolicyVersion: 'local-demo-quality/1', recipientScope: { policyId: 'remote-contributor-permission' }, disclosureScope: { scopeId: 'ordered-partition-activations-and-tokens' },
      queueClass: 'standard' },
    // Pilot: first output within 30 s, a complete short answer within 180 s.
    deadlines: { firstOutputMs: 30_000, completeMs: 180_000 },
    // Demonstration price: 4 credits plus 2 per output token, at most 20.
    pricing: { basis: { kind: 'local_demo_base_plus_per_output_token' }, maxCharge: 20 },
    terms: { validForMs: MIN, reservationPeriodMs: 10 * MIN, queue: { behavior: 'fifo_bounded', maxWaitMs: 30_000 }, execution: { maxAttempts: 2, maxDurationMs: 180_000 },
      evidence: { ...EVIDENCE },
      refund: { policyId: 'local-demo-refunds' }, qualityReview: { procedureId: 'local-demo-review' },
      settlement: { full: { kind: 'metered', base: 4, rates: [{ meter: 'output', numerator: 2, denominator: 1 }] }, reduced: null,
        partialDelivery: { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 2, denominator: 1 }] },
        cancellationQueued: { kind: 'fixed', amount: 0 }, cancellationDispatched: { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 2, denominator: 1 }] },
        timeout: { kind: 'fixed', amount: 0 }, providerFailure: { kind: 'fixed', amount: 0 }, failedQuality: { kind: 'fixed', amount: 0 } } }
  }],
  // Pilot rule: measured marginal cost plus a 20% bonus. The fixture route has no measured cost, so the demonstration
  // uses a placeholder marginal cost of 1 credit per output token per stage: 1.2 per token, rounded up.
  offers: [{ category: 'demanded_inference', model: { modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, planId: MODEL.planId }, hosts: ['native'],
    reward: { basis: { kind: 'placeholder_marginal_cost_plus_20_percent', marginalCostPerOutputToken: 1, bonusPercent: 20 },
      formula: { kind: 'metered', base: 0, rates: [{ meter: 'output', numerator: 12, denominator: 10 }] }, maxReward: 50 },
    resourceBounds: { context: { max: 4096, unit: 'token' }, output: { max: 8, unit: 'token' } },
    durationMs: 24 * 60 * MIN, validForMs: 10 * MIN, paymentTiming: { trigger: 'on_validation', claimWindowMs: 24 * 60 * MIN }, failureCompensation: { kind: 'none' } }],
  // Pilot: founder-funded Community Access (the $100 weekly commitment is recorded below). Queue, usage and rate limits
  // are demonstration values; no basic-service guarantee is offered (guarantee mode none).
  communityAccess: { policyVersion: 'local-demo-community/1', poolAccountId: 'pool_community_general', guarantee: { mode: 'none' },
    queue: { maxLength: 16, maxPerAccount: 2, maxWaitMs: 2 * MIN }, usage: { windowMs: 24 * 60 * MIN, maxAdmissions: 5, maxAuthorizedCredits: 100 },
    rateLimits: { account: { windowMs: MIN, maxRequests: 5 }, device: { windowMs: MIN, maxRequests: 5 } }, capacity: { evidenceMaxAgeMs: 24 * 60 * MIN },
    evidence: { ...EVIDENCE } },
  // Demonstration schedule for the durable scheduler the server hosts in-process: every job each 5 s.
  scheduler: { scheduleVersion: 'local-demo-schedule/1', leaseMs: 30_000,
    jobs: Object.fromEntries(['ledger.settleDueEvidence', 'ledger.expireReservations', 'rewards.resumeIssuance', 'community-access.resumeFunding',
      'community-access.expireQueue', 'community-access.admitWaiting', 'payments.pollPending'].map((jobId) => [jobId, { intervalMs: 5000, batchLimit: 20 }])) }
};
const operatorToken = randomBytes(32).toString('base64url');
const files = {
  policy: path.join(work, 'policy.json'), capacity: path.join(work, 'capacity.json'), operators: path.join(work, 'operators.json'),
  firebase: path.join(work, 'firebase.json'), communityCapacity: path.join(work, 'community-capacity.json'), serverLog: path.join(work, 'server.log'), emulatorLog: path.join(work, 'emulator.log'),
  contributorLog: path.join(out, 'contributor-log.jsonl'), blocked: []
};
await fs.writeFile(files.policy, JSON.stringify(policy, null, 2), { mode: 0o600 });
// Operator-declared admitted-capacity evidence; no execution owner publishes it yet.
await fs.writeFile(files.capacity, JSON.stringify({ schema: CAPACITY_EVIDENCE_SCHEMA, evidenceId: 'capacity:local-demo-operator-declared',
  accountingVersion: 'local-demo-accounting/1', serviceCredits: 1_000_000, observedAt: new Date().toISOString() }), { mode: 0o600 });
// Operator-declared Community Access capacity: one admitted slot, so a second request queues.
await fs.writeFile(files.communityCapacity, JSON.stringify({ schema: COMMUNITY_CAPACITY_SCHEMA, evidenceId: 'community-capacity:local-demo-operator-declared',
  observedAt: new Date().toISOString(), admittedSlots: 1 }), { mode: 0o600 });
await fs.writeFile(files.operators, JSON.stringify({ schema: 'reploid.earning-operators/v1',
  operators: [{ actorId: 'founder', roles: ['funding', 'audit'], tokenSha256: createHash('sha256').update(operatorToken).digest('hex') }] }), { mode: 0o600 });
await fs.writeFile(files.firebase, JSON.stringify({ emulators: { firestore: { host: '127.0.0.1', port: Number(values['emulator-port']) }, ui: { enabled: false }, singleProjectMode: true } }));
await fs.rm(files.contributorLog, { force: true });

const start = (name, command, args, options, logFile) => {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push({ name, child });
  const sink = fs.open(logFile, 'a');
  for (const stream of [child.stdout, child.stderr]) stream.on('data', async (chunk) => (await sink).write(chunk));
  return child;
};
const waitFor = async (probe, label, timeoutMs = 120_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { try { if (await probe()) return; } catch { /* retry */ } await sleep(250); }
  throw new Error(`timed out waiting for ${label}`);
};
const stopAll = async () => {
  for (const { child } of children.reverse()) if (child.exitCode === null) child.kill('SIGTERM');
  await sleep(1500);
};
process.on('uncaughtException', async (error) => { console.error(error); await stopAll(); process.exit(1); });

try {
  // ---- The local durable store and the server.
  start('emulator', 'firebase', ['emulators:start', '--only', 'firestore', '--project', 'demo-reploid-earning', '--config', files.firebase],
    { cwd: work, env: { ...process.env, JAVA_HOME: values['java-home'], PATH: `${values['java-home']}/bin:${process.env.PATH}` } }, files.emulatorLog);
  await waitFor(async () => (await fetch(`http://127.0.0.1:${values['emulator-port']}/`)).ok, 'the Firestore emulator');
  mark('firestore-emulator-ready', { port: Number(values['emulator-port']) });
  const serverEnv = { ...process.env, PORT: values['server-port'], REPLOID_EARNING_ROUTES: 'enabled', REPLOID_EARNING_COMPOSITION: 'server/earning-composition/index.js',
    REPLOID_EARNING_POLICY_FILE: files.policy, REPLOID_EARNING_STORE: 'firestore', REPLOID_EARNING_FIRESTORE_PREFIX: 'local_demo_20261015',
    FIRESTORE_EMULATOR_HOST: `127.0.0.1:${values['emulator-port']}`, GCLOUD_PROJECT: 'demo-reploid-earning',
    REPLOID_EARNING_TEST_SIGN_IN: 'enabled', REPLOID_EARNING_TEST_PROCESSOR: 'enabled', REPLOID_EARNING_CAPACITY_FILE: files.capacity,
    REPLOID_EARNING_OPERATORS_FILE: files.operators, REPLOID_EARNING_COMMUNITY_CAPACITY_FILE: files.communityCapacity, NODE_ENV: 'development',
    REPLOID_EARNING_SCHEDULER: 'in-process', REPLOID_EARNING_SCHEDULER_RUNNER_ID: 'local-demo-server' };
  delete serverEnv.K_SERVICE;
  start('server', process.execPath, ['server/proxy.js'], { cwd: repo, env: serverEnv }, files.serverLog);
  await waitFor(async () => (await fetch(`${origin}/v1/client`)).ok, 'the earning service');
  const service = await (await fetch(`${origin}/v1/client`)).json();
  mark('server-ready', { service });

  // ---- Pilot: the founder's $100 weekly Community Access commitment, recorded in the funding register.
  const week = { validFrom: new Date().toISOString(), validUntil: new Date(Date.now() + 7 * 24 * 60 * MIN).toISOString() };
  const commitment = await fetch(`${origin}/v1/operator/funding/commitments`, { method: 'POST', headers: { authorization: `Bearer ${operatorToken}`,
    'content-type': 'application/json', 'idempotency-key': 'founder-community-access-week-1' }, body: JSON.stringify({ commitmentId: 'founder_community_access_week_1',
    funderKind: 'operator', funderId: 'founder', externalRef: 'local-demo:founder-weekly-community-access', amount: 10_000, unit: { kind: 'currency', currency: 'USD' }, ...week }) });
  const commitmentBody = await commitment.json();
  mark('founder-commitment-recorded', { status: commitment.status, commitment: commitmentBody });
  // The commitment funds the general pool: 10,000 credits at one credit per cent.
  const pool = await fetch(`${origin}/v1/operator/funding/community-pools`, { method: 'POST', headers: { authorization: `Bearer ${operatorToken}`,
    'content-type': 'application/json' }, body: JSON.stringify({ fundingId: 'founder_pool_week_1', commitmentId: 'founder_community_access_week_1', quantity: 10_000,
    commitmentAmount: 10_000, poolAccountId: 'pool_community_general', decisionId: 'decision:local-demo-founder-pool-week-1' }) });
  const poolBody = await pool.json();
  mark('community-pool-funded', { status: pool.status, funding: poolBody });

  // ---- The native contributor process.
  const contributor = start('contributor', process.execPath, [path.join(here, 'contributor.mjs'), '--repo', repo, '--work', path.join(work, 'contributor'),
    '--service', `${origin}/v1`, '--bridge-port', values['bridge-port'], '--subject', 'carol', '--log', files.contributorLog], { cwd: repo, env: process.env }, path.join(work, 'contributor.out'));
  void contributor;
  await waitFor(async () => (await fs.readFile(files.contributorLog, 'utf8')).includes('bridge-listening'), 'the contributor bridge');
  mark('contributor-ready');

  // ---- Browsers: every non-loopback request is blocked and recorded; the app's public swarm is switched off.
  const browser = await chromium.launch({ headless: true });
  const pageHtml = `<!doctype html><html lang="en" data-bridge="ws://127.0.0.1:${values['bridge-port']}/route"><head><meta charset="utf-8"><title>Earning demo harness</title>
${['tokens.css', 'primitives/base.css', 'primitives/surfaces.css', 'primitives/controls.css', 'primitives/layout.css', 'primitives/text.css', 'primitives/optical.css',
    'compositions/screens.css', 'compositions/conversation.css', 'compositions/interaction.css'].map((file) => `<link rel="stylesheet" href="/styles/poolday/${file}">`).join('\n')}
</head><body><p role="status">Loading…</p><script type="module" src="/__earning-demo/page.mjs"></script></body></html>`;
  const pageModule = await fs.readFile(path.join(here, 'requester-page.mjs'), 'utf8');
  const device = async (name) => {
    const context = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    await context.addInitScript(() => { try { localStorage.setItem('REPLOID_SWARM_ENABLED', 'false'); } catch { /* storage unavailable */ } });
    await context.route((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (route) => { files.blocked.push({ device: name, url: route.request().url() }); return route.abort(); });
    await context.routeWebSocket((url) => !['127.0.0.1', 'localhost'].includes(url.hostname), (socket) => { files.blocked.push({ device: name, url: socket.url(), websocket: true }); socket.close(); });
    await context.route(`${origin}/__earning-demo`, (route) => route.fulfill({ contentType: 'text/html', body: pageHtml }));
    await context.route(`${origin}/__earning-demo/page.mjs`, (route) => route.fulfill({ contentType: 'text/javascript', body: pageModule }));
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text().slice(0, 300)}`); });
    page.on('response', (response) => { if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`); });
    return { name, context, page, errors };
  };
  const shot = async (device, file) => { await device.page.screenshot({ path: path.join(out, 'screenshots', file), fullPage: true }); mark('screenshot', { device: device.name, file }); };
  const openCredits = async (device) => {
    await device.page.goto(`${origin}/?swarm=off`);
    // The rail's network control opens the inspector; its Settings tab holds the Credits panel.
    await device.page.locator('[data-toggle-inspector]').first().click();
    await device.page.locator('[data-inspector-section="settings"]').first().click();
    await device.page.locator('[data-earning-account]').waitFor({ state: 'visible', timeout: 30_000 });
  };
  const balanceText = (device) => device.page.locator('[data-earning-balance]').first().textContent();
  const send = async (device, text, { allow = false } = {}) => {
    const { page } = device;
    const before = await page.evaluate(() => window.earningDemo.session.getState().threads.flatMap((thread) => thread.attempts).length);
    await page.locator('[data-composer-input]').fill(text);
    await page.locator('[data-composer-send]').click();
    if (allow) {
      await page.locator('[data-remote-permission-allow]').waitFor({ state: 'visible', timeout: 30_000 });
      await page.locator('[data-remote-permission-allow]').click();
    }
    await page.waitForFunction((count) => {
      const attempts = window.earningDemo.session.getState().threads.flatMap((thread) => thread.attempts);
      return attempts.length > count && ['completed', 'failed', 'cancelled'].includes(attempts.at(-1).status);
    }, before, { timeout: 120_000 });
    const attempt = await page.evaluate(() => window.earningDemo.session.getState().threads.flatMap((thread) => thread.attempts).at(-1));
    mark('answer', { device: device.name, status: attempt.status, error: attempt.error ?? null });
    if (attempt.status !== 'completed') throw new Error(`the answer ${attempt.status}: ${attempt.error}`);
    return attempt;
  };
  const openHarness = async (device) => {
    await device.page.goto(`${origin}/__earning-demo`);
    await device.page.waitForFunction(() => window.earningDemo?.ready === true, null, { timeout: 30_000 })
      .catch((error) => { console.error('[demo] harness page errors:', device.errors); throw error; });
    // The fixture route is the only model, so the composer already selects it.
    await device.page.waitForFunction(() => document.querySelector('[data-active-model-select]')?.value === 'model_test', null, { timeout: 30_000 });
  };
  /** The harness page's Settings tab: the same Credits panel the app shows. */
  const harnessCredits = async (device) => {
    if (!(await device.page.locator('[data-earning-account]').isVisible())) {
      await device.page.locator('[data-toggle-inspector]').first().click();
      await device.page.locator('[data-inspector-section="settings"]').first().click();
    }
    await device.page.locator('[data-earning-ready]').waitFor({ state: 'visible', timeout: 30_000 });
    const activity = device.page.locator('[data-earning-activity]');
    if (!(await activity.evaluate((node) => node.open))) await activity.locator('summary').click();
  };
  const session = (device) => device.page.evaluate(() => JSON.parse(localStorage.getItem('reploid.earning:v1:session')));

  // Requester device.
  const alice = await device('requester-alice');
  await openCredits(alice);
  await shot(alice, '01-requester-app-credits-signed-out.png');
  await alice.page.locator('[data-earning-local-subject]').fill('alice');
  await alice.page.locator('[data-earning-local-submit]').click();
  await alice.page.locator('[data-earning-ready]').waitFor({ state: 'visible', timeout: 30_000 });
  await shot(alice, '02-requester-app-signed-in.png');
  await alice.page.locator('[data-earning-top-up="top-up-10-usd"]').click();
  await alice.page.waitForURL(/\/v1\/payments\/test-checkouts\//, { timeout: 30_000 });
  await shot(alice, '03-test-checkout-page.png');
  await alice.page.locator('[data-test-checkout-complete]').click();
  await alice.page.locator('[data-test-checkout-status]').waitFor({ timeout: 30_000 });
  await shot(alice, '04-test-checkout-recorded.png');
  await openCredits(alice);
  await alice.page.waitForFunction(() => /Balance: 1,000 credits/.test(document.querySelector('[data-earning-balance]')?.textContent || ''), null, { timeout: 30_000 });
  await alice.page.locator('[data-earning-limit]').fill('20');
  await alice.page.locator('[data-earning-limit-save]').click();
  await alice.page.locator('[data-earning-activity] summary').click();
  await shot(alice, '05-requester-app-funded-limit-set.png');
  await openHarness(alice);
  await shot(alice, '06-requester-harness-before-send.png');
  await send(alice, 'What is two plus two?', { allow: true });
  await shot(alice, '07-requester-harness-first-answer.png');
  for (const text of ['Name three primary colors.', 'Summarize this in one line.']) await send(alice, text);
  await harnessCredits(alice);
  await shot(alice, '08-requester-harness-three-answers-credits.png');
  await openCredits(alice);
  await alice.page.locator('[data-earning-activity] summary').click();
  await shot(alice, '09-requester-app-journal.png');
  const aliceSession = await session(alice);

  // The contributor devices claim their settled stage shares (contributor.mjs polls).
  await waitFor(async () => ((await fs.readFile(files.contributorLog, 'utf8')).match(/"issuance":"issued"/g) ?? []).length >= 6, 'six issued stage shares', 90_000);
  mark('contributor-claims-issued');

  // The contributor on a second browser profile.
  const carol = await device('contributor-carol');
  await openCredits(carol);
  await carol.page.locator('[data-earning-local-subject]').fill('carol');
  await carol.page.locator('[data-earning-local-submit]').click();
  await carol.page.locator('[data-earning-ready]').waitFor({ state: 'visible', timeout: 30_000 });
  await carol.page.locator('[data-earning-activity] summary').click();
  await shot(carol, '10-contributor-app-earned.png');
  const earnedText = await balanceText(carol);
  await carol.page.locator('[data-earning-limit]').fill('20');
  await carol.page.locator('[data-earning-limit-save]').click();
  await openHarness(carol);
  await send(carol, 'What is the capital of France?', { allow: true });
  await harnessCredits(carol);
  await shot(carol, '11-contributor-harness-spent-credits.png');
  await openCredits(carol);
  await carol.page.locator('[data-earning-activity] summary').click();
  await shot(carol, '12-contributor-app-journal.png');
  const carolSession = await session(carol);

  // A third person with no credits: the app offers Community Access, which the founder's pool pays.
  const dave = await device('community-dave');
  await openCredits(dave);
  await dave.page.locator('[data-earning-local-subject]').fill('dave');
  await dave.page.locator('[data-earning-local-submit]').click();
  await dave.page.locator('[data-earning-ready]').waitFor({ state: 'visible', timeout: 30_000 });
  await shot(dave, '13-community-member-app-no-credits.png');
  await openHarness(dave);
  // Erin, another member on a scripted device, holds the pool's one admitted slot, so dave's request queues.
  const erinIdentity = await createSigningIdentity({ algorithm: 'Ed25519' });
  const erinStorage = new Map();
  const erin = createEarningClient({ config: { schema: EARNING_CLIENT_SCHEMA, enabled: true, baseUrl: `${origin}/v1`, providerId: 'local-test' }, identity: erinIdentity, host: 'browser',
    storage: { get: async (key) => erinStorage.get(key) ?? null, set: async (key, value) => { erinStorage.set(key, value); }, delete: async (key) => { erinStorage.delete(key); } },
    signIn: async () => (await (await fetch(`${origin}/v1/sign-in/local-test/assertions`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subject: 'erin' }) })).json()).assertion });
  const erinRequest = await erin.send({ opId: 'erin-access', path: '/community-access/requests', durable: false,
    body: { request: { modelId: MODEL.modelId, modelIdentity: MODEL.modelIdentity, operation: 'chat.completion' } } });
  mark('community-access-slot-held', { requester: 'erin', state: erinRequest.state });
  const db = await emulatorFirestore();
  const requests = db.collection('local_demo_20261015_community_access_requests');
  const answering = send(dave, 'Explain a closure in one sentence.', { allow: true });
  await waitFor(async () => (await requests.where('state', '==', 'waiting').get()).size === 1, "dave's queued request");
  const [queuedDoc] = (await requests.where('state', '==', 'waiting').get()).docs;
  mark('community-access-queued', { requester: 'dave', requestId: queuedDoc.id });
  // Erin's answer ends before dispatch; only the scheduler's admission sweep frees her slot and admits dave.
  await erin.send({ opId: 'erin-cancel', path: `/reservations/${encodeURIComponent(erinRequest.reservationId)}/reports`,
    body: { report: { schema: 'reploid.attempt-report/v1', result: 'cancelled', attemptId: null } } });
  await answering;
  await harnessCredits(dave);
  await shot(dave, '14-community-member-harness-answer.png');
  const daveSession = await session(dave);
  const admissionPasses = (await db.collection('local_demo_20261015_scheduler_passes').where('jobId', '==', 'community-access.admitWaiting').get()).docs
    .map((doc) => doc.data()).filter((pass) => pass.items.length).sort((left, right) => left.seq - right.seq);
  await fs.writeFile(path.join(out, 'scheduler-admission-passes.json'), `${JSON.stringify(admissionPasses, null, 2)}\n`);
  mark('community-access-admitted-by-sweep', { requestId: queuedDoc.id,
    pass: admissionPasses.find((pass) => pass.items.some((item) => item.ref === queuedDoc.id && item.status === 'admitted'))?.passId ?? null });
  await waitFor(async () => ((await fs.readFile(files.contributorLog, 'utf8')).match(/"issuance":"issued"/g) ?? []).length >= 8, 'two more issued stage shares', 90_000);
  mark('community-access-stage-shares-issued');
  await sleep(5000);

  // ---- The scheduler as its own process (REPLOID_EARNING_SCHEDULER=external path), sharing leases with the server's runner.
  const cliOutput = path.join(out, 'scheduler-cli-round.jsonl');
  await fs.rm(cliOutput, { force: true });
  const cli = start('scheduler-cli', process.execPath, ['server/earning-composition/run-scheduler.js', '--once'],
    { cwd: repo, env: { ...serverEnv, REPLOID_EARNING_SCHEDULER: 'external', REPLOID_EARNING_SCHEDULER_RUNNER_ID: 'local-demo-cli' } }, cliOutput);
  await new Promise((resolve) => cli.on('exit', resolve));
  mark('scheduler-cli-round', { exitCode: cli.exitCode });

  // ---- Evidence: the service's own records for both accounts.
  const read = async (token, route) => (await fetch(`${origin}/v1${route}`, { headers: { authorization: `Bearer ${token}` } })).json();
  const records = {};
  for (const [name, value] of [['requester-alice', aliceSession], ['contributor-carol', carolSession], ['community-dave', daveSession]]) {
    records[name] = { session: { accountId: value.accountId, deviceId: value.deviceId, participantId: value.participantId },
      account: await read(value.token, '/accounts/me'), devices: await read(value.token, '/devices'), balance: await read(value.token, '/balances'),
      journal: await read(value.token, '/journal'), reservations: await read(value.token, '/reservations') };
  }
  const operatorView = await (await fetch(`${origin}/v1/operator/funding/commitments/founder_community_access_week_1`, { headers: { authorization: `Bearer ${operatorToken}` } })).json();
  operatorView.poolAccount = await (await fetch(`${origin}/v1/operator/accounts/pool_community_general/audit`, { headers: { authorization: `Bearer ${operatorToken}` } })).json();
  await fs.writeFile(path.join(out, 'accounts.json'), `${JSON.stringify(records, null, 2)}\n`);
  await fs.writeFile(path.join(out, 'founder-commitment.json'), `${JSON.stringify(operatorView, null, 2)}\n`);
  await fs.writeFile(path.join(out, 'blocked-requests.json'), `${JSON.stringify(files.blocked, null, 2)}\n`);
  await fs.writeFile(path.join(out, 'page-errors.json'), `${JSON.stringify({ alice: alice.errors, carol: carol.errors, dave: dave.errors }, null, 2)}\n`);
  const serverLog = await fs.readFile(files.serverLog, 'utf8');
  await fs.writeFile(path.join(out, 'server-log-excerpt.txt'), serverLog.split('\n').filter((line) => /Earning|earning|Firestore|Listening|HTTP API|error|Error/i.test(line)).slice(0, 200).join('\n') + '\n');
  await fs.writeFile(path.join(out, 'run.json'), `${JSON.stringify({ origin, emulatorPort: Number(values['emulator-port']), bridgePort: Number(values['bridge-port']),
    contributorEarnedText: earnedText, timeline }, null, 2)}\n`);
  await browser.close();
  mark('done');
} finally {
  await stopAll();
}
