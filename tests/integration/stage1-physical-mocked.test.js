// @vitest-environment node
// The physical adapter end to end with mocked hosts: the real host agent runs as local processes behind an injected
// spawn, over real TLS, WebRTC and the credit ledger. No SSH runs, no GPU opens and no weight exists. A `physical`
// receipt here shows the adapter's plumbing and judgment only; it is not evidence about any machine.
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
import { runPhysicalStage1 } from '../../scripts/stage1/run.js';

const EARN_NOT_WIRED = ['phase-not-completed:earn', 'earn-missing'];

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
const LABELS = { 'mock-requester': 'requester', 'mock-host-a': 'host-a', 'mock-host-b': 'host-b' };
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

  async function setUp(name, { service = false } = {}) {
    const base = path.join(root, name), manifest = await fs.readFile(resolveServedFile(model.source.files.find(file => file.role === 'model-manifest').url, { roots: ['shared'] }));
    const pieces = model.source.files.find(file => file.role === 'model-piece-index');
    const pieceBytes = await fs.readFile(resolveServedFile(pieces.url, { roots: ['shared'] }));
    const shard = JSON.parse(manifest).shards[0].filename;
    const [requesterKey, keyA, keyB] = await Promise.all([0, 1, 2].map(() => createSigningIdentity({ algorithm: 'Ed25519' })));
    const write = async (file, identity) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(identity), { mode: 0o600 }); };
    const host = async (label, index, identity) => {
      const home = path.join(base, label), stage = path.join(home, 'models', 'stage'), full = path.join(home, 'tmp', 'full');
      for (const directory of [stage, full]) {
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(path.join(directory, 'manifest.json'), manifest);
        await fs.writeFile(path.join(directory, shard), 'mock');
      }
      await fs.writeFile(path.join(stage, pieces.path), pieceBytes);
      await write(path.join(home, 'identity.json'), identity);
      return { label, machineId: 'm-' + 'ab'[index].repeat(16), participantId: identity.peerId, ssh: `mock-${label}`, node: process.execPath, releaseRoot: REPOSITORY,
        identityFile: path.join(home, 'identity.json'), stateDirectory: path.join(home, 'state'), stageDirectory: stage, fullCopyDirectory: full,
        weightRoots: { model: [path.join(home, 'models')], cache: [path.join(home, 'cache')], temporary: [path.join(home, 'tmp')] },
        memoryPressure: { maxAvg10: 20, pollMs: 200 },
        standingService: service ? { manager: 'systemd-user', unit: 'mock-worker.service', approveStopForSolo: true } : null };
    };
    await write(path.join(base, 'requester', 'identity.json'), requesterKey);
    const hosts = [await host('host-a', 0, keyA), await host('host-b', 1, keyB)];
    const config = { schema: 'reploid.stage1-hosts/v1',
      coordinator: { listenHost: '127.0.0.1', publicHost: '127.0.0.1', servicePort: await freePort(), signalingPort: await freePort(), tls },
      credit: { weights: [16, 84], maxDebt: 1000, maxRequestMs: 60000 },
      limits: { phaseMs: 45000, abortGraceMs: 3000, hardStopMs: 20000, stopMarginMs: 25000, serviceRestoreMs: 5000 },
      requester: { machineId: 'm-' + 'c'.repeat(16), participantId: requesterKey.peerId, ssh: 'mock-requester', node: process.execPath, releaseRoot: REPOSITORY,
        identityFile: path.join(base, 'requester', 'identity.json'), modelDirectory: path.join(base, 'requester', 'empty'), stateDirectory: path.join(base, 'requester', 'state') },
      hosts };
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
  const run = (setup, options = {}) => runPhysicalStage1({ config: setup.config, transport: mockTransport(setup.scenarioFile),
    windowUntil: new Date(Date.now() + 240000).toISOString(), directory: setup.directory, ...options });
  const exists = file => fs.stat(file).then(() => true, () => false);

  it('produces a passing pooled capacity receipt, removes both full copies and restores both services', async () => {
    const setup = await setUp('good', { service: true });
    const { receipt, verdict } = await run(setup, { approveDeleteFullCopy: true });
    // Physical hosts have no earning control yet: everything else passes, and the checker refuses the missing earn phase.
    expect(verdict.reasons.map(row => row.code)).toEqual(EARN_NOT_WIRED);
    expect(receipt.phases.earn).toEqual({ status: 'skipped', reason: 'this adapter has no earn phase' });
    expect(verdict.solo).toMatchObject({ 'host-a': { outcome: 'memory' }, 'host-b': { outcome: 'memory' } });
    expect(receipt.runtimeClass).toBe('physical');
    for (const label of ['host-a', 'host-b']) {
      expect(receipt.soloControls[label]).toMatchObject({ claimedFailure: 'memory', failure: { evidence: 'device-out-of-memory', operatorCapped: false,
        requiredBytes: 16941875200, failedBufferBytes: 536870912, allocatedBeforeFailureBytes: 11811160064, during: 'whole-model-load' } });
    }
    for (const host of setup.config.hosts) expect(await exists(host.fullCopyDirectory)).toBe(false);
    for (const host of receipt.hosts) {
      for (const when of ['preflight', 'beforeSplit', 'afterSplit']) expect(host.inventory[when]).toMatchObject({ source: 'hashed-on-host', scannedRanges: 5512, outsideStageRanges: 0 });
      expect(host.inventory.afterSplit.scope).toBe('host-weight-directories');
    }
    expect(receipt.hosts.map(host => host.assignedLayers)).toEqual([[0, 0], [1, 63]]);
    expect(receipt.requester.machine).toBe(setup.config.requester.machineId);
    expect(receipt.split.tokens.outputIds).toEqual([17, 17, 248046]);
    expect(receipt.split.parityExact).toBe(true);
    // Operator weights of 16:84 on three credits pay the first stage nothing and the final stage all three.
    expect(receipt.split.settlement.credits.map(row => row.amount)).toEqual([0, 3]);
    expect(receipt.serviceRestores).toEqual(['host-a', 'host-b'].map(host => ({ host, stopped: true, restored: true, verifiedActive: true })));
    for (const label of ['host-a', 'host-b']) expect(await fs.readFile(path.join(setup.scenarioRoot, `${label}-service-state`), 'utf8')).toBe('active');
    expect(spawned.every(row => LABELS[row.alias])).toBe(true);
    const text = JSON.stringify(receipt);
    for (const value of [root, os.homedir(), 'mock-host-a', 'mock-worker.service', '127.0.0.1', 'access_token']) expect(text).not.toContain(value);
  }, 150000);

  it('stops before the split and keeps both copies without the delete approval', async () => {
    const setup = await setUp('unapproved');
    const { receipt, verdict } = await run(setup);
    expect(verdict.ok).toBe(false);
    expect(receipt.phases.split).toMatchObject({ status: 'failed' });
    expect(receipt.phases.split.reason).toContain('full-copy-present-delete-not-approved');
    expect(receipt.phases.cancel.status).toBe('skipped');
    expect(receipt.phases.cleanup.status).toBe('completed');
    for (const host of setup.config.hosts) expect(await exists(path.join(host.fullCopyDirectory, 'manifest.json'))).toBe(true);
  }, 90000);

  it('runs a 72-token reference through the gate on the physical path', async () => {
    const source = JSON.parse(await fs.readFile(STAGE1_FIXTURE_FILE, 'utf8'));
    const outputText = Array.from({ length: 71 }, (_, index) => `word${index} `).join('');
    const fixtureFile = path.join(root, 'long-physical.json');
    await fs.writeFile(fixtureFile, JSON.stringify({ ...source, maxOutputTokens: 80, reference: { ...source.reference,
      visibleOutputIds: Array.from({ length: 71 }, (_, index) => 1000 + index), outputText } }));
    const { receipt, verdict } = await run(await setUp('long'), { approveDeleteFullCopy: true, fixtureFile });
    // Physical hosts have no earning control yet: everything else passes, and the checker refuses the missing earn phase.
    expect(verdict.reasons.map(row => row.code)).toEqual(EARN_NOT_WIRED);
    expect(receipt.phases.earn).toEqual({ status: 'skipped', reason: 'this adapter has no earn phase' });
    expect(receipt.split.settlement).toMatchObject({ charge: 72, outputTokens: 72 });
    expect(receipt.split.settlement.credits.map(row => row.amount)).toEqual([11, 61]);
    expect(receipt.cancel.stoppedBeforeCompletion).toBe(true);
    expect(receipt.cancel.settlement.outputTokens).toBeLessThan(72);
    expect(receipt.cancel.settlement.outputTokens).toBeGreaterThanOrEqual(1);
  }, 150000);

  it('refuses a coordinator certificate outside the pinned CA or for another address', async () => {
    const [key, cert, ca] = await Promise.all([tls.keyFile, tls.certFile, tls.caFile].map(file => fs.readFile(file)));
    expect(() => verifyCoordinatorTls({ key, cert, ca, publicHost: '127.0.0.1' })).not.toThrow();
    expect(() => verifyCoordinatorTls({ key, cert, ca, publicHost: '127.0.0.2' })).toThrow('does not name');
    expect(() => verifyCoordinatorTls({ key, cert, ca: cert, publicHost: '127.0.0.1' })).toThrow('not issued');
    expect(() => verifyCoordinatorTls({ key, cert, ca, publicHost: '127.0.0.1', now: Date.now() + 30 * 86400000 })).toThrow('validity');
  });
});
