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

export async function verifyPeerPackExecution(config) {
  for (const key of ['packPath', 'dopplerRoot', 'referencePath', 'outputPath', 'browserExecutablePath']) {
    assert(typeof config?.[key] === 'string' && config[key].trim(), `Proof requires ${key}`);
  }
  assert(Array.isArray(config.browserArgs) && Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0, 'Proof requires browserArgs and timeoutMs');
  assert(Number.isSafeInteger(config.chunkBytes) && config.chunkBytes > 0 && config.chunkBytes <= config.custodyLimits?.maxChunkBytes, 'Proof requires bounded chunkBytes');
  assert(config.trustedSigners && config.dopplerVersion && config.referenceDigest, 'Proof requires explicit trust, runtime version, and oracle digest');
  const dopplerRoot = resolve(config.dopplerRoot);
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
    config, sources: { reploid: revision(ROOT), doppler: revision(dopplerRoot) }, binding,
    stage: 'supplier-bootstrap', origin: { disabled: false, bootstrapBytes: 0, rejectedRequests: [], receiverBootstrapRequests: 0 },
    browserLogs: [] };
  let browser;
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
        const roots = [['/self/', resolve(ROOT, 'self')], ['/tests/fixtures/', resolve(ROOT, 'tests/fixtures')], ['/doppler/src/', resolve(dopplerRoot, 'src')]];
        const mount = roots.find(([prefix]) => url.pathname.startsWith(prefix));
        if (!mount || url.pathname.endsWith('.wgsl')) {
          report.origin.rejectedRequests.push(url.pathname);
          response.writeHead(403).end();
          return;
        }
        const file = resolve(mount[1], decodeURIComponent(url.pathname.slice(mount[0].length)));
        assert(file.startsWith(mount[1] + sep) && ['.js', '.json', '.wasm'].includes(extname(file)), 'source path denied');
        response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        response.end(await readFile(file));
      } catch { response.writeHead(404).end(); }
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({ executablePath: config.browserExecutablePath, args: config.browserArgs, headless: true });
    report.browserVersion = browser.version();
    const identities = [];
    for (const peerId of ['requester', 'faulty', 'even', 'odd']) {
      const context = await browser.newContext();
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
      identities.push(await page.evaluate(async (id) => {
        globalThis.proofPeer = await import('/tests/fixtures/peer-pack-browser.js');
        return proofPeer.identity(id);
      }, peerId));
      pages.set(peerId, page);
    }
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
    originDisabled = true;
    report.origin.disabled = true;
    const requester = pages.get('requester');
    report.receiverCache = await requester.evaluate(async () => ({ databases: await indexedDB.databases(),
      opfsEntries: await (async () => { const entries = []; for await (const [name] of (await navigator.storage.getDirectory()).entries()) entries.push(name); return entries; })() }));
    assert(report.receiverCache.databases.length === 0 && report.receiverCache.opfsEntries.length === 0, 'Receiver is not fresh');
    await requester.evaluate((options) => proofPeer.configure(options), { limits: config.transportLimits });
    report.stage = 'data-channel-connect';
    for (const peer of authorization.suppliers) {
      const offer = await requester.evaluate((id) => proofPeer.offer(id), peer.peerId);
      const answer = await pages.get(peer.peerId).evaluate(({ id, offer }) => proofPeer.answer(id, offer), { id: 'requester', offer });
      await requester.evaluate(({ id, answer }) => proofPeer.accept(id, answer), { id: peer.peerId, answer });
    }
    await requester.waitForFunction(() => proofPeer.ready());
    report.stage = 'peer-acquire-and-execute';
    const timer = setTimeout(() => browser.close(), config.timeoutMs);
    try {
      report.execution = await requester.evaluate((options) => proofPeer.execute(options), {
        authorization, index, inventories, trustedSigners: config.trustedSigners, sequence: reference.input.sequence,
        options: { includeTokenEmbeddings: true, includeLogits: false,
          assignment: { id: authorization.transferId, attempt: 1, pack: binding, input: reference.input, comparisonPolicyDigest: config.referenceDigest } },
        dopplerVersion: config.dopplerVersion,
      });
    } finally { clearTimeout(timer); }
    report.peers = [];
    for (const page of pages.values()) report.peers.push(await page.evaluate(() => proofPeer.observations()));
    if (report.execution.passed) {
      const output = report.execution.result;
      report.acceptance = evaluateSequenceReference({ manifest: report.execution.manifest, reference,
        result: { ...output, pooledEmbedding: new Float32Array(output.pooledEmbedding), tokenEmbeddings: new Float32Array(output.tokenEmbeddings) } });
      report.passed = report.acceptance.passed && report.origin.receiverBootstrapRequests === 0
        && report.origin.rejectedRequests.length === 0
        && report.execution.custody.completed.length === pack.artifacts.length + 1
        && report.execution.custody.attempts.some((attempt) => attempt.error?.includes('integrity'))
        && report.peers.some((peer) => peer.injectedFaults.some((fault) => fault.type === 'supplier-departure'));
    }
    report.stage = 'complete';
  } catch (error) { report.error = error.message; }
  finally {
    await browser?.close();
    if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); });
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
