#!/usr/bin/env node
// Two local browser processes; injected inference is not physical-model evidence.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
assert(process.env.DOPPLER_TEST_CONSUMER, 'DOPPLER_TEST_CONSUMER must name an installed Doppler + Reploid consumer with generation-fixture.json');
const consumer = path.resolve(process.env.DOPPLER_TEST_CONSUMER);
const evidence = path.join(root, 'artifacts/agent-peer-local', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(evidence, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const resolveEntry = name => fileURLToPath(execFileSync(process.execPath, ['--input-type=module', '-e',
  `process.stdout.write(import.meta.resolve(${JSON.stringify(name)}))`], { cwd: consumer, encoding: 'utf8' }).trim());
const imports = Object.fromEntries(['doppler-gpu', 'reploid', 'reploid/config', 'reploid/doppler', 'reploid/browser'].map(name => {
  const entry = resolveEntry(name);
  assert(entry.startsWith(path.join(consumer, 'node_modules') + path.sep), 'Public imports must resolve to installed files');
  return [name, '/installed/' + path.relative(consumer, entry)];
}));
const report = { schema: 'reploid.agent-peer-local-acceptance/v1', passed: false,
  executionClass: 'installed-public-runtime-injected-programs', physicalComputers: 1, localBrowserProcesses: 2,
  exclusions: ['Physical model execution', 'Independent peer hardware', 'Publication', 'Deployment', 'Agent quality'],
  sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceDiffSha256: hash(execFileSync('git', ['diff', 'HEAD'], { cwd: root })), imports,
  fixtureSha256: hash(await readFile(path.join(consumer, 'generation-fixture.json'))),
  packageLockSha256: hash(await readFile(path.join(consumer, 'package-lock.json'))), packages: {}, sourceFiles: {} };
const lock = JSON.parse(await readFile(path.join(consumer, 'package-lock.json')));
for (const name of ['reploid', 'doppler-gpu']) {
  const manifest = JSON.parse(await readFile(path.join(consumer, 'node_modules', name, 'package.json')));
  const entry = lock.packages['node_modules/' + name];
  assert(entry?.integrity && entry.resolved, `Lockfile must identify installed ${name}`);
  report.packages[name] = { version: manifest.version, integrity: entry.integrity, resolved: entry.resolved };
  if (entry.resolved.startsWith('file:')) report.packages[name].archiveSha256 = hash(
    await readFile(path.resolve(consumer, entry.resolved.slice(5))));
}
for (const name of ['self/pool/peer-room.js', 'self/pool/peer-pack-requester.js', 'self/pool/provider-client.js', 'self/pool/config-contract.js',
  'self/pool/pool-config.json', 'self/infrastructure/pack-job-storage.js', 'tests/agent-peer-acceptance.js',
  'tests/fixtures/agent-peer-browser.js']) report.sourceFiles[name] = hash(await readFile(path.join(root, name)));
const profile = await mkdtemp(path.join(tmpdir(), 'agent-peer-provider-'));
let server, requesterBrowser, requesterContext, providerContext, requester, provider;
const pageErrors = [];
async function stage(name, operation) {
  console.log(name);
  report.stage = name;
  let timer;
  try { return await Promise.race([operation(), new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${name} timed out`)), 30000);
  })]); } finally { clearTimeout(timer); }
}
async function poll(read, check, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { const value = await read(); if (check(value)) return value;
    await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error(`${label} timed out: ${JSON.stringify(await read())}`);
}
async function connect(recovery = false) {
  const offer = await stage('requester offer', () => requester.evaluate(() => window.fixture.offer()));
  const answer = await stage('provider answer', () => provider.evaluate(value => window.fixture.answer(value), offer));
  await stage('requester connected', () => requester.evaluate(({ answer, recovery }) => window.fixture.accept(answer, recovery), { answer, recovery }));
}
try {
  server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(
        '<!doctype html><title>Local installed agent recovery</title><pre id="progress"></pre><script type="importmap">' +
        JSON.stringify({ imports }) + '</script>'); return; }
      let file, allowed;
      if (pathname.startsWith('/installed/')) { allowed = consumer; file = path.resolve(consumer, pathname.slice('/installed/'.length)); }
      else { allowed = root; file = path.resolve(root, pathname.startsWith('/core/') ? 'self' + pathname : pathname.slice(1)); }
      assert(file.startsWith(allowed + path.sep));
      response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const launch = { headless: true };
  requesterBrowser = await chromium.launch(launch);
  report.browserVersion = requesterBrowser.version();
  requesterContext = await requesterBrowser.newContext();
  requester = await requesterContext.newPage();
  requester.on('pageerror', error => pageErrors.push(error.message));
  await requester.goto(origin);
  const startProvider = async () => {
    providerContext = await chromium.launchPersistentContext(profile, launch);
    provider = await providerContext.newPage();
    provider.on('pageerror', error => pageErrors.push(error.message));
    await provider.goto(origin);
    await stage('provider setup', () => provider.evaluate(async () => { window.fixture = await import('/tests/fixtures/agent-peer-browser.js'); await window.fixture.start('provider'); }));
  };
  await startProvider();
  await stage('requester setup', () => requester.evaluate(async () => { window.fixture = await import('/tests/fixtures/agent-peer-browser.js'); await window.fixture.start('requester'); }));
  await connect();
  const advert = await provider.evaluate(() => window.fixture.advert());
  await requester.evaluate(value => { window.agentRun = window.fixture.runAgent(value); window.agentRun.catch(error => { window.agentFailure = error.stack; }); }, advert);
  report.beforeRestart = await poll(() => provider.evaluate(() => window.fixture.state()), value => value.dropped && !value.active, 'committed dropped completion');
  assert.equal(report.beforeRestart.calls, 1);
  assert.equal(await requester.locator('#progress').textContent(), 'Saved peer answer.');
  await providerContext.close(); providerContext = null;
  await poll(() => requester.evaluate(() => window.fixture.state()), value => value.order.includes('disconnected'), 'requester disconnect');
  await startProvider();
  await requester.evaluate(() => window.fixture.openConnection());
  await connect(true);
  report.agent = await stage('agent uses recovered result', () => requester.evaluate(() => window.agentRun));
  report.afterRestart = await provider.evaluate(() => window.fixture.state());
  assert.equal(report.afterRestart.providerId, report.beforeRestart.providerId);
  assert.equal(report.afterRestart.calls, 0, 'Restart must replay without executing inference');
  assert.equal(report.agent.signed, 1, 'Only one signed attempt may be created');
  assert.equal(report.agent.resumed, true);
  assert.equal(report.agent.result.assessment.accepted, true);
  assert.equal(report.agent.text, report.agent.result.execution.output.text);
  assert.deepEqual(report.agent.progress, ['Saved ', 'peer ', 'answer.'], 'Replay must not append duplicate display text');
  assert(report.agent.order.indexOf('persisted') < report.agent.order.indexOf('connected'));
  assert(JSON.stringify(report.agent.state).includes('IDLE: Used verified Saved peer answer.'));
  assert.equal(await requester.locator('#progress').textContent(), 'Saved peer answer.');
  assert.deepEqual(pageErrors, []); assert.deepEqual(report.beforeRestart.errors, []); assert.deepEqual(report.afterRestart.errors, []);
  const snapshot = Object.fromEntries(await Promise.all(['pool/peer-room.js', 'pool/peer-pack-requester.js', 'pool/provider-client.js', 'infrastructure/pack-job-storage.js']
    .map(async name => ['/' + name, await readFile(path.join(root, 'self', name), 'utf8')])));
  report.verificationWorker = await requester.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 10000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  assert.equal(report.verificationWorker.passed, true, JSON.stringify(report.verificationWorker));
  await Promise.all([requester, provider].map(page => page.evaluate(() => window.fixture.close())));
  report.passed = true;
} catch (error) { report.error = String(error.stack || error);
  if (requester) report.agentFailure = await requester.evaluate(() => window.agentFailure || null).catch(() => null);
  if (requester) report.requesterFailureState = await requester.evaluate(() => window.fixture?.state()).catch(() => null);
  if (provider) report.providerFailureState = await provider.evaluate(() => window.fixture?.state()).catch(() => null);
  throw error;
} finally {
  await providerContext?.close(); await requesterBrowser?.close();
  if (server) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await rm(profile, { recursive: true, force: true });
  await writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, evidence: path.join(evidence, 'report.json') }));
}
