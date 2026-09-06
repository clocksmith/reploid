#!/usr/bin/env node
/** Internal physical-browser episode, not independent-operator or history-value proof. */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { hashDopplerEvidence } from '../self/pool/executable-pack.js';
import { sha256Hex } from '../self/pool/inference-receipt.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const revision = (root) => ({ head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }).trim()) });

// Freeze each installed runtime file on first use, so later requests from other
// peers cannot silently execute different bytes under the same URL.
export function createProofSourceSnapshot() {
  const entries = new Map();
  return {
    async read(identity, file) {
      if (!entries.has(identity)) entries.set(identity, (async () => {
        const bytes = await readFile(file);
        return { bytes, receipt: { path: identity, hash: await sha256Hex(bytes), sizeBytes: bytes.length } };
      })().catch((error) => ({ receipt: { path: identity, error: error.message } })));
      const entry = await entries.get(identity);
      if (!entry.bytes) throw new Error(entry.receipt.error);
      return new Uint8Array(entry.bytes);
    },
    async receipts() {
      return (await Promise.all([...entries.values()])).map(({ receipt }) => ({ ...receipt }))
        .sort((a, b) => a.path.localeCompare(b.path, 'en'));
    },
  };
}

export async function readRuntimeBootstrapShaders(dopplerRoot, declarations) {
  assert(Array.isArray(declarations), 'Proof requires explicit runtimeBootstrapShaders');
  const registry = JSON.parse(await readFile(resolve(dopplerRoot, 'src/config/kernels/registry.json'), 'utf8'));
  const probes = new Set(Object.values(registry.operations.runtime_probe.variants).map((variant) => variant.wgsl));
  const sources = {};
  const receipts = [];
  for (const declaration of declarations) {
    assert(probes.has(declaration.file) && !Object.hasOwn(sources, declaration.file), 'Only unique runtime device probes may be bootstrapped');
    const bytes = await readFile(resolve(dopplerRoot, 'src/gpu/kernels', declaration.file));
    assert(await sha256Hex(bytes) === declaration.hash, 'Runtime bootstrap shader digest mismatch');
    sources[declaration.file] = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    receipts.push({ ...declaration, sizeBytes: bytes.length, owner: 'doppler-runtime-device-probe' });
  }
  return { sources, receipts };
}

export async function verifyPeerPackExecution(config) {
  for (const key of ['packPath', 'dopplerRoot', 'referencePath', 'outputPath', 'browserExecutablePath']) {
    assert(typeof config?.[key] === 'string' && config[key].trim(), `Proof requires ${key}`);
  }
  assert(Array.isArray(config.browserArgs) && Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0, 'Proof requires browserArgs and timeoutMs');
  assert(Number.isSafeInteger(config.chunkBytes) && config.chunkBytes > 0 && config.chunkBytes <= config.custodyLimits?.maxChunkBytes, 'Proof requires bounded chunkBytes');
  assert(config.trustedSigners && config.dopplerVersion && config.referenceDigest, 'Proof requires explicit trust, runtime version, and oracle digest');
  if (config.restart) {
    assert(typeof config.restart.profileDirectory === 'string'
      && Number.isSafeInteger(config.restart.afterWeightResponses) && config.restart.afterWeightResponses > 0,
    'Restart proof requires a fresh profile directory and a positive weight-response threshold');
    await mkdir(config.restart.profileDirectory);
  }
  for (const key of ['maxInputBytes', 'maxOutputBytes']) assert(Number.isSafeInteger(config.operationLimits?.[key]) && config.operationLimits[key] > 0, `Proof requires operationLimits.${key}`);
  const dopplerRoot = resolve(config.dopplerRoot);
  const runtimeRoot = config.runtimePackageBundlePath
    ? resolve(config.runtimePackageBundlePath, 'consumer/node_modules/doppler-gpu') : dopplerRoot;
  let installedPackage = null;
  if (config.runtimePackageBundlePath) {
    const installed = JSON.parse(await readFile(resolve(config.runtimePackageBundlePath, 'receipt.json'), 'utf8'));
    assert(installed.passed && await sha256Hex(await readFile(resolve(config.runtimePackageBundlePath, installed.package.filename)))
      === `sha256:${installed.package.sha256}`, 'Installed runtime candidate receipt or tarball mismatch');
    installedPackage = installed.package;
  }
  const runtimeBootstrap = await readRuntimeBootstrapShaders(runtimeRoot, config.runtimeBootstrapShaders);
  const runtimeSources = createProofSourceSnapshot();
  const { getPackIdentity } = await import(pathToFileURL(resolve(dopplerRoot, 'src/pack.js')).href);
  const { hashTargetPlan } = await import(pathToFileURL(resolve(dopplerRoot, 'src/config/target-plan.js')).href);
  const { evaluateSequenceReference } = await import(pathToFileURL(resolve(dopplerRoot, 'tools/lib/sequence-model-qualification.js')).href);
  const envelopeBytes = new Uint8Array(await readFile(config.packPath));
  const pack = JSON.parse(new TextDecoder().decode(envelopeBytes));
  const binding = { ...getPackIdentity(pack), artifacts: pack.artifacts, requiredOperation: 'encodeSequence',
    acceptedTargetPlanDigests: pack.targetPlans.map(hashTargetPlan) };
  const envelopeArtifact = { artifactId: 'pack-envelope', role: 'pack-envelope', path: 'pack.json',
    hash: await sha256Hex(envelopeBytes), sizeBytes: envelopeBytes.length };
  const bytesById = new Map([[envelopeArtifact.artifactId, envelopeBytes]]);
  const index = { schema: 'reploid.pool.pack-custody-index/v1', envelopeDigest: binding.envelopeDigest,
    artifactClosureDigest: binding.artifactClosureDigest, artifacts: [] };
  const packDirectory = resolve(dirname(config.packPath));
  for (const artifact of [...pack.artifacts, envelopeArtifact]) {
    const path = resolve(packDirectory, artifact.path);
    assert(path.startsWith(packDirectory + sep), 'Pack artifact path escapes directory');
    const bytes = bytesById.get(artifact.artifactId) ?? new Uint8Array(await readFile(path));
    assert(bytes.length === artifact.sizeBytes && await sha256Hex(bytes) === artifact.hash, `Source artifact integrity failed: ${artifact.artifactId}`);
    bytesById.set(artifact.artifactId, bytes);
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += config.chunkBytes) {
      const part = bytes.subarray(offset, offset + config.chunkBytes);
      chunks.push({ index: chunks.length, offset, sizeBytes: part.length, hash: await sha256Hex(part) });
    }
    index.artifacts.push({ artifactId: artifact.artifactId, hash: artifact.hash, sizeBytes: bytes.length, chunks });
  }
  const referenceBytes = await readFile(config.referencePath);
  assert(await sha256Hex(referenceBytes) === config.referenceDigest, 'Frozen reference digest mismatch');
  const reference = JSON.parse(referenceBytes.toString('utf8'));
  const report = { schema: 'reploid.pool.peer-pack-browser-episode/v1', passed: false, generatedAt: new Date().toISOString(),
    claimBoundary: { actualModel: true, physicalBrowserRequired: true, internalOperatorCount: 1,
      independentMachines: false, independentOperators: false, historyImprovement: false },
    config, installedPackage, sources: { reploid: revision(ROOT), doppler: revision(dopplerRoot) }, binding,
    stage: 'supplier-bootstrap', origin: { disabled: false, bootstrapBytes: 0, rejectedRequests: [], receiverBootstrapRequests: 0 },
    runtimeBootstrap: { shaders: runtimeBootstrap.receipts, modelArtifacts: 0 }, browserLogs: [] };
  let browser;
  let requesterContext;
  let requesterPid;
  let server;
  let originDisabled = false;
  const allowedChunks = new Map();
  const pages = new Map();
  try {
    server = createServer(async (request, response) => {
      try {
        const url = new URL(request.url, 'http://localhost');
        if (url.pathname === '/proof') {
          response.setHeader('Content-Type', 'text/html');
          response.end('<!doctype html><title>Peer Pack execution proof</title>');
          return;
        }
        if (url.pathname.startsWith('/bootstrap/')) {
          const [, , peerId, encodedId, chunkIndex] = url.pathname.split('/');
          const id = decodeURIComponent(encodedId);
          if (originDisabled || !allowedChunks.get(peerId)?.has(`${id}:${chunkIndex}`)) {
            report.origin.rejectedRequests.push(url.pathname);
            response.writeHead(403).end();
            return;
          }
          const chunk = index.artifacts.find((artifact) => artifact.artifactId === id)?.chunks[Number(chunkIndex)];
          assert(chunk, 'unknown bootstrap chunk');
          const bytes = bytesById.get(id).subarray(chunk.offset, chunk.offset + chunk.sizeBytes);
          report.origin.bootstrapBytes += bytes.length;
          response.setHeader('Content-Type', 'application/octet-stream');
          response.end(bytes);
          return;
        }
        const roots = [['/self/', resolve(ROOT, 'self')], ['/tests/fixtures/', resolve(ROOT, 'tests/fixtures')], ['/doppler/src/', resolve(runtimeRoot, 'src')]];
        const mount = roots.find(([prefix]) => url.pathname.startsWith(prefix));
        if (!mount || url.pathname.endsWith('.wgsl')) {
          report.origin.rejectedRequests.push(url.pathname);
          response.writeHead(403).end();
          return;
        }
        const file = resolve(mount[1], decodeURIComponent(url.pathname.slice(mount[0].length)));
        assert(file.startsWith(mount[1] + sep) && ['.js', '.json', '.wasm'].includes(extname(file)), 'source path denied');
        response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        response.end(await runtimeSources.read(url.pathname, file));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: config.browserExecutablePath, args: config.browserArgs, headless: true });
    report.browserVersion = browser.version();
    const childPids = () => execFileSync('ps', ['-o', 'pid=,comm=', '--ppid', String(process.pid)], { encoding: 'utf8' })
      .trim().split('\n').filter(row => /\s+chrome$/.test(row)).map(row => Number(row.trim().split(/\s+/)[0]));
    const identities = [];
    const openPage = async (peerId, restored = null) => {
      let context;
      if (peerId === 'requester' && config.restart) {
        const before = new Set(childPids());
        context = await chromium.launchPersistentContext(config.restart.profileDirectory,
          { executablePath: config.browserExecutablePath, args: config.browserArgs, headless: true });
        requesterContext = context;
        const added = childPids().filter(pid => !before.has(pid));
        assert(added.length === 1, 'Cannot identify the owned requester browser process');
        requesterPid = added[0];
      } else context = await browser.newContext();
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) { report.origin.rejectedRequests.push(url.href); return route.abort(); }
        if (peerId === 'requester' && url.pathname.startsWith('/bootstrap/')) {
          report.origin.receiverBootstrapRequests += 1;
          return route.abort();
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.setDefaultTimeout(config.timeoutMs);
      page.on('console', (message) => report.browserLogs.push({ peerId, type: message.type(), text: message.text() }));
      page.on('pageerror', (error) => report.browserLogs.push({ peerId, type: 'pageerror', text: error.message }));
      await page.goto(origin + '/proof');
      const identity = await page.evaluate(async ({ id, restored }) => {
        globalThis.proofPeer = await import('/tests/fixtures/peer-pack-browser.js');
        return proofPeer.identity(id, restored);
      }, { id: peerId, restored });
      pages.set(peerId, page);
      return identity;
    };
    for (const peerId of ['requester', 'faulty', 'even', 'odd']) identities.push(await openPage(peerId));
    const authorization = { schema: 'reploid.pool.pack-custody-authorization/v1', pack: binding, envelopeArtifact,
      transferId: `esm2-peer-pack-${crypto.randomUUID()}`, attempt: 1, expiresAt: Date.now() + config.timeoutMs,
      requester: identities[0], suppliers: identities.slice(1), indexDigest: await hashDopplerEvidence(index), limits: config.custodyLimits };
    report.authorization = authorization;
    report.index = index;
    const inventories = [];
    report.suppliers = [];
    for (const [position, peer] of identities.slice(1).entries()) {
      const inventory = { expiresAt: authorization.expiresAt, maxBytes: config.custodyLimits.maxTransferBytes,
        artifacts: index.artifacts.map((artifact) => ({ artifactId: artifact.artifactId,
          chunkIndexes: artifact.chunks.filter((chunk) => position === 0
            ? artifact.artifactId.startsWith('weight-shard:') && chunk.index < 2
            : chunk.index % 2 === position - 1).map((chunk) => chunk.index) })) };
      allowedChunks.set(peer.peerId, new Set(inventory.artifacts.flatMap((artifact) => artifact.chunkIndexes.map((chunk) => `${artifact.artifactId}:${chunk}`))));
      const supplier = await pages.get(peer.peerId).evaluate((options) => proofPeer.configure(options),
        { authorization, index, inventory, limits: config.transportLimits, faulty: position === 0 });
      inventories.push(supplier.inventory);
      report.suppliers.push({ peerId: peer.peerId, ...supplier });
    }
    // These two registry-owned device probes belong to the installed runtime,
    // not the model. Model WGSL remains denied over HTTP and must come from Pack custody.
    await pages.get('requester').evaluate(async (sources) => {
      const { registerShaderSources } = await import('/doppler/src/gpu/kernels/shader-cache.js');
      registerShaderSources(sources);
    }, runtimeBootstrap.sources);
    originDisabled = true;
    report.origin.disabled = true;
    let requester = pages.get('requester');
    report.receiverCache = await requester.evaluate(async () => ({ databases: await indexedDB.databases(),
      opfsEntries: await (async () => { const entries = []; for await (const [name] of (await navigator.storage.getDirectory()).entries()) entries.push(name); return entries; })() }));
    assert(report.receiverCache.databases.length === 0 && report.receiverCache.opfsEntries.length === 0, 'Receiver is not fresh');
    await requester.evaluate((options) => proofPeer.configure(options), { limits: config.transportLimits });
    report.stage = 'data-channel-connect';
    const connect = async () => {
      for (const peer of authorization.suppliers) {
        const offer = await requester.evaluate((id) => proofPeer.offer(id), peer.peerId);
        const answer = await pages.get(peer.peerId).evaluate(({ id, offer }) => proofPeer.answer(id, offer), { id: 'requester', offer });
        await requester.evaluate(({ id, answer }) => proofPeer.accept(id, answer), { id: peer.peerId, answer });
      }
      await requester.waitForFunction(() => proofPeer.ready());
    };
    await connect();
    report.stage = 'peer-acquire-and-execute';
    const timer = setTimeout(() => { requesterContext?.close().catch(() => {}); browser.close().catch(() => {}); }, config.timeoutMs);
    try {
      const executionOptions = {
        authorization, index, inventories, trustedSigners: config.trustedSigners, sequence: reference.input.sequence,
        options: { includeTokenEmbeddings: true, includeLogits: false,
          assignment: { id: authorization.transferId, attempt: 1, pack: binding, input: reference.input, comparisonPolicyDigest: config.referenceDigest } },
        dopplerVersion: config.dopplerVersion,
        operationLimits: config.operationLimits,
      };
      if (config.restart) {
        const retainedKeys = await requester.evaluate(() => proofPeer.retainIdentityForRestart());
        const beforePid = requesterPid;
        const interrupted = await requester.evaluate(options => proofPeer.execute(options),
          { ...executionOptions, interruptAfterWeightResponses: config.restart.afterWeightResponses });
        report.restart = { interrupted, beforePid };
        assert(!interrupted.passed && interrupted.injectedDisconnection
          && interrupted.custody?.storage.storedBytes > 0
          && interrupted.custody.completed.length < pack.artifacts.length + 1, 'The real model transfer was not interrupted after persistent writes');
        await requesterContext.close();
        report.restart.previousProcessExited = !childPids().includes(beforePid);
        assert(report.restart.previousProcessExited, 'The original requester browser process is still present');
        const restoredIdentity = await openPage('requester', retainedKeys);
        assert(JSON.stringify(restoredIdentity) === JSON.stringify(identities[0]), 'Requester identity changed across restart');
        report.restart.afterPid = requesterPid;
        assert(requesterPid !== beforePid, 'Requester process was not replaced');
        requester = pages.get('requester');
        await requester.evaluate(async ({ limits, sources }) => {
          await proofPeer.configure({ limits });
          const { registerShaderSources } = await import('/doppler/src/gpu/kernels/shader-cache.js');
          registerShaderSources(sources);
        }, { limits: config.transportLimits, sources: runtimeBootstrap.sources });
        await connect();
      }
      report.execution = await requester.evaluate((options) => proofPeer.execute(options), executionOptions);
      if (config.restart && report.execution.passed) {
        const accepted = report.restart.interrupted.custody.attempts.filter(row => row.status === 'accepted');
        const fetched = new Set(report.execution.custody.attempts.map(row => `${row.artifactId}:${row.chunkIndex}`));
        report.restart.refetchedVerifiedChunks = accepted.filter(row => fetched.has(`${row.artifactId}:${row.chunkIndex}`)).length;
        report.restart.resumed = report.restart.refetchedVerifiedChunks === 0 && report.execution.custody.cacheBytes > 0;
        assert(report.restart.resumed, 'Previously verified pieces were downloaded again after restart');
      }
    } finally { clearTimeout(timer); }
    report.peers = [];
    for (const page of pages.values()) report.peers.push(await page.evaluate(() => proofPeer.observations()));
    if (report.execution.passed) {
      const output = report.execution.result;
      const transferAttempts = [...(report.restart?.interrupted.custody.attempts ?? []), ...report.execution.custody.attempts];
      report.acceptance = evaluateSequenceReference({ manifest: report.execution.manifest, reference,
        result: { ...output, pooledEmbedding: new Float32Array(output.pooledEmbedding), tokenEmbeddings: new Float32Array(output.tokenEmbeddings) } });
      report.passed = report.acceptance.passed && report.origin.receiverBootstrapRequests === 0
        && report.origin.rejectedRequests.length === 0
        && report.execution.custody.completed.length === pack.artifacts.length + 1
        && transferAttempts.some((attempt) => attempt.error?.includes('integrity'))
        && report.peers.some((peer) => peer.injectedFaults.some((fault) => fault.type === 'supplier-departure'));
    }
    report.stage = 'complete';
  } catch (error) { report.error = error.message; }
  finally {
    for (const cleanup of [() => requesterContext?.close(), () => browser?.close(), () => server && new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); })]) {
      try { await cleanup(); } catch (error) { report.passed = false; report.cleanupError = error.message; }
    }
    report.runtimeBootstrap.files = await runtimeSources.receipts();
    if (report.runtimeBootstrap.files.some((file) => file.error)) report.passed = false;
    report.runtimeBootstrap.sourceSnapshotDigest = await hashDopplerEvidence(report.runtimeBootstrap.files);
    await mkdir(dirname(resolve(config.outputPath)), { recursive: true });
    await writeFile(config.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const main = async () => {
    assert(process.argv.length === 4 && process.argv[2] === '--config', 'Usage: node scripts/verify-peer-pack-execution.js --config <path>');
    const config = JSON.parse(await readFile(process.argv[3], 'utf8'));
    const report = await verifyPeerPackExecution(config);
    console.log(JSON.stringify({ passed: report.passed, stage: report.stage, error: report.error ?? report.execution?.error ?? null, outputPath: config.outputPath }));
    if (!report.passed) process.exitCode = 1;
  };
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
