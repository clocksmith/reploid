// @vitest-environment node
// The physical adapter end to end with mocked hosts: the real host agent runs as local processes behind an injected
// spawn, over real TLS, WebRTC and the credit ledger. No SSH runs, no GPU opens and no weight exists; the earning
// machine's whole-model answer is fake. A `physical` receipt here shows the adapter's plumbing and judgment only; it is
// not evidence about any machine.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawn as spawnProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { createSigningIdentity } from '../../packages/reploid/src/artifacts/identity.js';
import { resolveServedFile } from '../../server/browser-roots.js';
import { createSshTransport } from '../../scripts/stage1/command-transport.js';
import { loadStage1Expectations, STAGE1_FIXTURE_FILE, STAGE1_MODEL_ID } from '../../scripts/stage1/expectations.js';
import { LABEL_POOLED } from '../../scripts/stage1/receipt-check.js';
import { verifyCoordinatorTls } from '../../scripts/stage1/physical-coordinator.js';
import { DEFAULT_BOOKKEEPING_MS } from '../../scripts/stage1/physical-adapter.js';
import { checkStageDirectories, prepareStageDirectories, runPhysicalStage1 } from '../../scripts/stage1/run.js';
import { harnessDigest } from '../../scripts/stage1/host-agent.js';

const EARN_NOT_CONFIGURED = ['phase-not-completed:earn', 'earn-missing'];
const EARN_MODEL_ID = 'qwen-3-5-0-8b-q4k-ef16-af32-vf16';

let wrtc;
try {
  ({ default: wrtc } = await import('@roamhq/wrtc'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('@roamhq/wrtc')) throw error;
}
const AGENT = fileURLToPath(new URL('../fixtures/stage1-mock-host-agent.mjs', import.meta.url));
const REAL_AGENT = fileURLToPath(new URL('../../scripts/stage1/host-agent.js', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
const LABELS = { 'mock-requester': 'requester', 'mock-host-a': 'host-a', 'mock-host-b': 'host-b', 'mock-earner': 'earner' };
const freePort = () => new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); });
});

describe.runIf(wrtc)('the physical adapter against mocked hosts', () => {
  let root, tls, loaded, spawned;
  const openssl = (...args) => execFileSync('openssl', args, { stdio: 'ignore' });
  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-physical-mock-')));
    tls = { keyFile: path.join(root, 'tls-key.pem'), certFile: path.join(root, 'tls-cert.pem'), caFile: path.join(root, 'tls-ca.pem') };
    const caKey = path.join(root, 'ca-key.pem'), request = path.join(root, 'tls.csr'), extensions = path.join(root, 'tls.ext');
    openssl('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', caKey, '-out', tls.caFile, '-days', '2', '-subj', '/CN=stage1-test-ca');
    openssl('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', tls.keyFile, '-out', request, '-subj', '/CN=stage1-test');
    await fs.writeFile(extensions, 'subjectAltName=IP:127.0.0.1\n');
    openssl('x509', '-req', '-in', request, '-CA', tls.caFile, '-CAkey', caKey, '-CAcreateserial', '-out', tls.certFile, '-days', '2', '-extfile', extensions);
    await fs.chmod(tls.keyFile, 0o600);
    loaded = await loadStage1Expectations({ runtimeClass: 'physical' });
  }, 60000);
  afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

  /** Answers every `ssh` invocation by starting the mock agent locally. Anything else is a test failure. */
  const mockTransport = scenarioFile => createSshTransport({ spawn(command, args) {
    if (command !== 'ssh') throw Error(`Unexpected command ${command}`);
    const separator = args.indexOf('--'), alias = args[separator + 1], remote = args[separator + 2];
    if (!LABELS[alias] || !remote.includes(REAL_AGENT)) throw Error('Unexpected remote command');
    const mode = remote.includes('--control') ? '--control' : '--session';
    spawned.push({ alias, mode });
    return spawnProcess(process.execPath, [AGENT, mode], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: root, NODE_ENV: 'test', STAGE1_MOCK_SCENARIO: scenarioFile, STAGE1_MOCK_LABEL: LABELS[alias],
        ...(process.env.NODE_OPTIONS ? { NODE_OPTIONS: process.env.NODE_OPTIONS } : {}) } });
  } });

  async function setUp(name, { service = false, earner = true, strayCopy = false } = {}) {
    const base = path.join(root, name), manifest = await fs.readFile(resolveServedFile(model.source.files.find(file => file.role === 'model-manifest').url, { roots: ['shared'] }));
    const pieces = model.source.files.find(file => file.role === 'model-piece-index');
    const pieceBytes = await fs.readFile(resolveServedFile(pieces.url, { roots: ['shared'] }));
    const shard = JSON.parse(manifest).shards[0].filename;
    const [requesterKey, keyA, keyB, earnerKey] = await Promise.all([0, 1, 2, 3].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    const write = async (file, identity) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(identity), { mode: 0o600 }); };
    const host = async (label, index, identity) => {
      const home = path.join(base, label), stage = path.join(home, 'models', 'stage'), full = path.join(home, 'tmp', 'full');
      for (const directory of [stage, full]) {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'manifest.json'), manifest);
        await fs.writeFile(path.join(directory, shard), 'mock');
      }
      await fs.writeFile(path.join(stage, pieces.path), pieceBytes);
      // Another stage's ranges in a cache, outside the declared full copy.
      if (strayCopy && label === 'host-b') { await fs.mkdir(path.join(home, 'cache', 'full'), { recursive: true }); await fs.writeFile(path.join(home, 'cache', 'full', shard), 'mock'); }
      await write(path.join(home, 'identity.json'), identity);
      return { label, machineId: 'm-' + 'ab'[index].repeat(16), participantId: identity.peerId, ssh: `mock-${label}`, node: process.execPath, releaseRoot: REPOSITORY,
        identityFile: path.join(home, 'identity.json'), stateDirectory: path.join(home, 'state'), stageDirectory: stage, fullCopyDirectory: full,
        weightRoots: { model: [path.join(home, 'models')], cache: [path.join(home, 'cache')], temporary: [path.join(home, 'tmp')] },
        memoryPressure: { maxAvg10: 20, pollMs: 200 },
        standingService: service ? { manager: 'systemd-user', unit: 'mock-worker.service', approveStopForSolo: true } : null };
    };
    await write(path.join(base, 'requester', 'identity.json'), requesterKey);
    await write(path.join(base, 'earner', 'identity.json'), earnerKey);
    const hosts = [await host('host-a', 0, keyA), await host('host-b', 1, keyB)];
    const config = { schema: 'reploid.stage1-hosts/v1',
      coordinator: { listenHost: '127.0.0.1', publicHost: '127.0.0.1', servicePort: await freePort(), signalingPort: await freePort(), tls },
      // A short request deadline and release window so the dropped hold expires inside the test.
      credit: { weights: [16, 84], maxDebt: 1000, maxRequestMs: 20000, partitionUnclaimedReleaseMs: 2000, maxClockSkewMs: 1000 },
      limits: { phaseMs: 45000, abortGraceMs: 3000, hardStopMs: 20000, stopMarginMs: 25000, serviceRestoreMs: 5000 },
      requester: { machineId: 'm-' + 'c'.repeat(16), participantId: requesterKey.peerId, ssh: 'mock-requester', node: process.execPath, releaseRoot: REPOSITORY,
        identityFile: path.join(base, 'requester', 'identity.json'), modelDirectory: path.join(base, 'requester', 'empty'), stateDirectory: path.join(base, 'requester', 'state'),
        weightRoots: { model: [path.join(base, 'requester', 'models')], cache: [path.join(base, 'requester', 'cache')], temporary: [path.join(base, 'requester', 'tmp')] } },
      hosts,
      // The earner shares the requester's machine under its own participant key, identity file and state directory.
      ...(earner ? { earner: { machineId: 'm-' + 'c'.repeat(16), participantId: earnerKey.peerId, ssh: 'mock-earner', node: process.execPath, releaseRoot: REPOSITORY,
        identityFile: path.join(base, 'earner', 'identity.json'), stateDirectory: path.join(base, 'earner', 'state'),
        modelDirectory: path.join(base, 'earner', 'model'), modelId: EARN_MODEL_ID } } : {}) };
    await fs.mkdir(config.requester.modelDirectory, { recursive: true });
    const scenarioRoot = path.join(base, 'scenario');
    await fs.mkdir(scenarioRoot, { recursive: true });
    if (service) for (const label of ['host-a', 'host-b']) await fs.writeFile(path.join(scenarioRoot, `${label}-service-state`), 'active');
    const scenarioFile = path.join(base, 'scenario.json');
    await fs.writeFile(scenarioFile, JSON.stringify({ root: scenarioRoot, hosts: {}, stageKeys: {
      'host-a': loaded.stageRanges[0].map(range => `${range.path}:${range.offset}`), 'host-b': loaded.stageRanges[1].map(range => `${range.path}:${range.offset}`) } }));
    spawned = [];
    return { config, scenarioFile, scenarioRoot, directory: path.join(base, 'work') };
  }
  /** The window-free preparation first, as on real hosts: it records the fingerprints the window's searches compare to. */
  const prepare = setup => prepareStageDirectories({ config: setup.config, transport: mockTransport(setup.scenarioFile), action: 'verify', hash: true, timeoutMs: 30000 });
  const run = async (setup, { prepared = true, ...options } = {}) => {
    if (prepared) {
      const results = await prepare(setup);
      expect(Object.values(results.weights).every(row => row.ok)).toBe(true);
    }
    return runPhysicalStage1({ config: setup.config, transport: mockTransport(setup.scenarioFile),
      windowUntil: new Date(Date.now() + 240000).toISOString(), directory: setup.directory, ...options });
  };
  const exists = file => fs.stat(file).then(() => true, () => false);

  it('produces a passing pooled capacity receipt, keeps both full copies locked during the stages and restores them and both services', async () => {
    const setup = await setUp('good', { service: true });
    const { receipt, verdict } = await run(setup);
    expect(verdict).toMatchObject({ ok: true, label: LABEL_POOLED, reasons: [] });
    expect(receipt.earn.earner.machine).toBe(receipt.requester.machine);
    expect(receipt.requester.preflight).toMatchObject({ weightBytes: 0, otherModelBytes: 0, heldRanges: { rangeCount: 0, bytes: 0, scannedRanges: 5512 } });
    expect(verdict.solo).toMatchObject({ 'host-a': { outcome: 'memory' }, 'host-b': { outcome: 'memory' } });
    expect(receipt.runtimeClass).toBe('physical');
    for (const label of ['host-a', 'host-b']) {
      expect(receipt.soloControls[label]).toMatchObject({ claimedFailure: 'memory', failure: { evidence: 'device-out-of-memory', operatorCapped: false,
        requiredBytes: 16941875200, failedBufferBytes: 536870912, allocatedBeforeFailureBytes: 11811160064, during: 'whole-model-load' } });
    }
    // The full copies stay, readable again after the run; while stage processes ran they were locked and not entered.
    for (const host of setup.config.hosts) expect(await fs.readdir(host.fullCopyDirectory)).toContain('manifest.json');
    expect(receipt.cleanup.fullCopyLocks).toEqual(['host-a', 'host-b'].map(host => ({ host, locked: true, restored: true })));
    for (const [index, host] of receipt.hosts.entries()) {
      // In the window nothing is re-hashed: every search rests on the preparation's hash and unchanged fingerprints.
      for (const when of ['preflight', 'beforeSplit', 'afterSplit']) {
        expect(host.inventory[when]).toMatchObject({ source: 'hashed-on-host', scope: 'stage-directory', scannedRanges: 5512, outsideStageRanges: 0,
          evidence: 'unchanged-since-hash', baseline: { action: 'compare', unchangedDirectories: 1, hashedDirectories: 0 } });
        expect(Date.parse(host.inventory[when].hashedAt)).toBeLessThan(Date.parse(receipt.startedAt));
      }
      expect(host.hostWeights.beforeSplit).toMatchObject({ scope: 'host-weight-directories', heldRanges: loaded.expectations.stages[index].rangeCount,
        outsideElsewhere: 0, fullCopy: 'declared-not-searched', evidence: 'unchanged-since-hash', baseline: { hashedDirectories: 0 } });
      expect(host.hostWeights.afterSplit).toMatchObject({ outsideElsewhere: 0, fullCopy: 'locked-not-searched', evidence: 'unchanged-since-hash' });
      const stage = loaded.expectations.stages[index];
      // The tokenizer came through the loader as metadata; the loaded weight ranges are exactly the stage's.
      expect(host.loaded).toEqual({ source: 'stage-loader', rangeCount: stage.rangeCount, bytes: stage.bytes, rangesDigest: stage.rangesDigest,
        outsideStageRanges: 0, outsideStageBytes: 0, metadata: { roles: ['tokenizer'], pieceCount: 3, bytes: 9089356 } });
    }
    expect(receipt.hosts.map(host => host.assignedLayers)).toEqual([[0, 0], [1, 63]]);
    expect(receipt.requester.machine).toBe(setup.config.requester.machineId);
    expect(receipt.split.tokens.outputIds).toEqual([17, 17, 248046]);
    expect(receipt.split.parityExact).toBe(true);
    // Operator weights of 16:84 on three credits pay the first stage nothing and the final stage all three.
    expect(receipt.split.settlement.credits.map(row => row.amount)).toEqual([0, 3]);
    // Earned from zero on a separate machine, then spent.
    expect(receipt.earn).toMatchObject({ accountBefore: 0, runtime: 'fake-whole-model', earner: { machine: setup.config.earner.machineId } });
    expect(receipt.split.account.before).toBeGreaterThanOrEqual(receipt.split.settlement.charge);
    // The drop: host-a's process killed by exact PID, partial answer kept, nothing resent or charged, hold released.
    expect(receipt.drop).toMatchObject({ killed: { host: 'host-a', how: 'exact-process-kill', confirmedGone: true }, completed: false,
      resend: { requesterApprovals: 1, requesterAttemptsOnThread: 1, ledgerReservations: 1 },
      settlement: { state: 'settled', status: 'expired', charge: 0, heldAfter: 0 } });
    expect(receipt.drop.accountAfter).toBe(receipt.drop.accountBefore);
    for (const [name, status] of [['split', 'settled'], ['cancel', 'settled'], ['drop', 'expired']]) {
      expect(receipt[name].settlementReplay).toMatchObject({ termsCollectedBy: 'stage1-harness', problems: [] });
      expect(receipt[name].settlementReplay.result.reservations.map(row => row.status)).toEqual([status]);
    }
    expect(receipt.serviceRestores).toEqual(['host-a', 'host-b'].map(host => ({ host, stopped: true, restored: true, verifiedActive: true })));
    for (const label of ['host-a', 'host-b']) expect(await fs.readFile(path.join(setup.scenarioRoot, `${label}-service-state`), 'utf8')).toBe('active');
    expect(spawned.every(row => LABELS[row.alias])).toBe(true);
    // Every step is timed; the split's bookkeeping ran under its own budgets, apart from the generation's.
    const steps = Object.fromEntries(receipt.steps.map(row => [row.step, row]));
    expect(receipt.steps.every(row => row.status === 'done' && Number.isSafeInteger(row.ms))).toBe(true);
    expect(steps['split host weights after']).toMatchObject({ budget: 'split-after' });
    expect(steps['split generate']).toMatchObject({ budget: 'split-answer' });
    expect(steps['split requester weights after']).toMatchObject({ budget: 'split-after' });
    expect(receipt.phaseTimings.split.boundMs).toBe(setup.config.limits.phaseMs + 2 * DEFAULT_BOOKKEEPING_MS);
    const text = JSON.stringify(receipt);
    for (const value of [root, os.homedir(), 'mock-host-a', 'mock-earner', 'mock-worker.service', '127.0.0.1', 'access_token']) expect(text).not.toContain(value);
  }, 180000);

  it('stops in preflight, before any solo control, when the window-free preparation was not run', async () => {
    const { receipt, verdict } = await run(await setUp('unprepared'), { prepared: false });
    expect(receipt.phases.preflight.status).toBe('failed');
    expect(receipt.phases.preflight.reason).toContain('weight-baseline-missing');
    expect(receipt.phases['solo-a'].status).toBe('skipped');
    expect(verdict.ok).toBe(false);
  }, 90000);

  it('checks the window\'s compare-only searches without a window: unchanged passes, a changed file is re-hashed and named, no baseline fails', async () => {
    const setup = await setUp('check');
    const release = { sha: null, harnessDigest: await harnessDigest() };
    const check = () => checkStageDirectories({ config: setup.config, transport: mockTransport(setup.scenarioFile), release, timeoutMs: 30000 });
    const missing = await check();
    expect(missing.ok).toBe(false);
    for (const label of ['host-a', 'host-b', 'requester']) expect(missing.reasons.some(row => row.startsWith(`${label}:`) && row.includes('weight-baseline-missing'))).toBe(true);
    await prepare(setup);
    const unchanged = await check();
    // The mock hosts have no RELEASE_SHA; everything else holds and nothing is hashed.
    expect(unchanged.reasons.every(row => row.includes('release-sha'))).toBe(true);
    expect(unchanged).toMatchObject({ schema: 'reploid.stage1-weight-check/v1', release, scanRelease: { commit: expect.stringMatching(/^[0-9a-f]{40}$/) } });
    for (const label of ['host-a', 'host-b', 'requester']) {
      expect(unchanged.machines[label]).toMatchObject({ rehashedDirectories: 0, matchedBaseline: true, release: { harnessDigest: release.harnessDigest } });
      for (const row of Object.values(unchanged.machines[label].scans)) expect(row).toMatchObject({ ok: true, hashedDirectories: 0, goneDirectories: 0 });
    }
    expect(unchanged.machines['host-b'].scans['stage-directory']).toMatchObject({ evidence: 'unchanged-since-hash', rangeCount: loaded.expectations.stages[1].rangeCount });
    expect(unchanged.machines['host-a'].stageDirectoryRecord).toMatchObject({ ok: true, verified: 'record' });
    const shard = (await fs.readdir(setup.config.hosts[1].stageDirectory)).find(name => name.endsWith('.bin'));
    await fs.appendFile(path.join(setup.config.hosts[1].stageDirectory, shard), '');
    await fs.utimes(path.join(setup.config.hosts[1].stageDirectory, shard), new Date(), new Date());
    const changed = await check();
    expect(changed.machines['host-b']).toMatchObject({ matchedBaseline: false, rehashedDirectories: 2,
      rehashed: [{ scope: 'stage-directory', path: '.', reason: 'changed' }, { scope: 'host-weight-directories', reason: 'changed' }] });
    expect(changed.reasons).toContain('host-b: baseline-differs: 1 directories re-hashed, 0 gone');
    expect(changed.machines['host-a'].matchedBaseline).toBe(true);
    expect(spawned.every(row => row.mode === '--control')).toBe(true);
    expect(JSON.stringify(changed)).not.toContain(root);
  }, 90000);

  it('refuses the earn phase, and so the receipt, when no earning machine is configured', async () => {
    const { receipt, verdict } = await run(await setUp('no-earner', { earner: false }));
    expect(receipt.phases.earn).toEqual({ status: 'skipped', reason: 'this adapter has no earn phase' });
    expect(verdict.reasons.map(row => row.code)).toEqual(EARN_NOT_CONFIGURED);
    expect(verdict.ok).toBe(false);
  }, 180000);

  it('stops before the split when another stage\'s ranges sit outside the declared full copy', async () => {
    const setup = await setUp('stray', { strayCopy: true });
    const { receipt, verdict } = await run(setup);
    expect(verdict.ok).toBe(false);
    expect(receipt.phases.split).toMatchObject({ status: 'failed' });
    expect(receipt.phases.split.reason).toContain('host-stage-check-refused: host-b');
    expect(receipt.phases.cancel.status).toBe('skipped');
    expect(receipt.phases.cleanup.status).toBe('completed');
    for (const host of setup.config.hosts) expect(await fs.readdir(host.fullCopyDirectory)).toContain('manifest.json');
  }, 90000);

  it('runs a 72-token reference through the gate on the physical path', async () => {
    const source = JSON.parse(await fs.readFile(STAGE1_FIXTURE_FILE, 'utf8'));
    const outputText = Array.from({ length: 71 }, (_, index) => `word${index} `).join('');
    const fixtureFile = path.join(root, 'long-physical.json');
    await fs.writeFile(fixtureFile, JSON.stringify({ ...source, maxOutputTokens: 80, reference: { ...source.reference,
      visibleOutputIds: Array.from({ length: 71 }, (_, index) => 1000 + index), outputText } }));
    const { receipt, verdict } = await run(await setUp('long'), { fixtureFile });
    expect(verdict).toMatchObject({ ok: true, label: LABEL_POOLED, reasons: [] });
    expect(receipt.split.settlement).toMatchObject({ charge: 72, outputTokens: 72 });
    expect(receipt.split.settlement.credits.map(row => row.amount)).toEqual([11, 61]);
    expect(receipt.cancel.stoppedBeforeCompletion).toBe(true);
    expect(receipt.cancel.settlement.outputTokens).toBeLessThan(72);
    expect(receipt.cancel.settlement.outputTokens).toBeGreaterThanOrEqual(1);
    expect(receipt.drop.outputsReceived).toBeGreaterThanOrEqual(1);
    expect(receipt.drop.outputsReceived).toBeLessThan(72);
  }, 180000);

  it('refuses a coordinator certificate outside the pinned CA or for another address', async () => {
    const [key, cert, ca] = await Promise.all([tls.keyFile, tls.certFile, tls.caFile].map(file => fs.readFile(file)));
    expect(() => verifyCoordinatorTls({ key, cert, ca, publicHost: '127.0.0.1' })).not.toThrow();
    expect(() => verifyCoordinatorTls({ key, cert, ca, publicHost: '127.0.0.2' })).toThrow('does not name');
    expect(() => verifyCoordinatorTls({ key, cert, ca: cert, publicHost: '127.0.0.1' })).toThrow('not issued');
    expect(() => verifyCoordinatorTls({ key, cert, ca, publicHost: '127.0.0.1', now: Date.now() + 30 * 86400000 })).toThrow('validity');
  });
});
