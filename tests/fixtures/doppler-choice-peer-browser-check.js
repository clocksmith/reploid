import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { chromium } from 'playwright';
import { physicalWebGpuBrowserOptions } from './physical-webgpu-browser.js';

const [dopplerArg, reploidArg, capsuleArg, referencePath, archivePath, outputPath] = process.argv.slice(2);
assert(outputPath, 'Expected installed Doppler/Reploid roots, qualified Capsule directory, reference, archive and output');
const doppler = resolve(dopplerArg), reploid = resolve(reploidArg), capsule = resolve(capsuleArg), root = resolve(import.meta.dirname, '../..');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const metadata = await read(resolve(doppler, 'package.json')), library = await read(resolve(reploid, 'package.json'));
const reference = await read(referencePath), publicKey = await read(resolve(capsule, 'signing-public.json'));
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const peerAcquisition = process.env.REPLOID_CHOICE_PEER_ACQUISITION === '1';
const envelope = peerAcquisition ? await read(resolve(capsule, 'capsule.json')) : null;
const chunksByArtifact = new Map();
let custodyIndex;
if (peerAcquisition) {
  custodyIndex = { schema: 'reploid.pool.pack-custody-index/v2', artifacts: [] };
  for (const artifact of envelope.artifacts) {
    const file = resolve(capsule, artifact.path);
    assert(file.startsWith(capsule + sep));
    const bytes = await readFile(file), chunks = [];
    assert.equal(bytes.length, artifact.sizeBytes);
    assert.equal('sha256:' + createHash('sha256').update(bytes).digest('hex'), artifact.hash);
    for (let offset = 0; offset < bytes.length; offset += 1048576) {
      const part = bytes.subarray(offset, offset + 1048576);
      chunks.push({ index: chunks.length, offset, sizeBytes: part.length,
        hash: 'sha256:' + createHash('sha256').update(part).digest('hex') });
    }
    chunksByArtifact.set(artifact.artifactId, { file, chunks });
    custodyIndex.artifacts.push({ artifactId: artifact.artifactId, hash: artifact.hash, sizeBytes: artifact.sizeBytes, chunks });
  }
}
const report = { schema: 'reploid.installed-choice-peer-browser/v1', passed: false, cases: [], logs: [],
  archiveSha256: await sha(archivePath), capsuleSha256: await sha(resolve(capsule, 'capsule.json')),
  qualificationSha256: await sha(referencePath), executionClass: 'real-webgpu-real-webrtc-weightless-requester',
  physicalMachines: 1, publicRelease: false };
const imports = Object.fromEntries(['.', './host'].map(key => ['doppler-gpu' + (key === '.' ? '' : '/host'),
  '/installed/' + (metadata.exports[key].browser ?? metadata.exports[key].import).slice(2)]));
imports['reploid/doppler'] = '/reploid/' + library.exports['./doppler'].import.slice(2);
const mappings = [['/installed/', doppler], ['/reploid/', reploid], ['/capsule/', capsule], ['/self/', resolve(root, 'self')], ['/tests/fixtures/', resolve(root, 'tests/fixtures')]];
const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (peerAcquisition && pathname.startsWith('/bootstrap/')) {
    const [, , peerId, artifactId, chunkIndex] = pathname.split('/').map(decodeURIComponent);
    const entry = chunksByArtifact.get(artifactId), chunk = entry?.chunks[Number(chunkIndex)];
    if (!['seed-good', 'seed-bad'].includes(peerId) || !chunk || !/^\d+$/.test(chunkIndex)) {
      response.writeHead(404).end(); return;
    }
    response.setHeader('Content-Type', 'application/octet-stream');
    const stream = createReadStream(entry.file, { start: chunk.offset, end: chunk.offset + chunk.sizeBytes - 1 });
    stream.on('error', () => response.destroy()); stream.pipe(response);
    return;
  }
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Real peer decisions</title><script type="importmap">' + JSON.stringify({ imports }) + '</script>'); return; }
  const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
  if (!mapping) { response.writeHead(404).end(); return; }
  const file = resolve(mapping[1], pathname.slice(mapping[0].length));
  if (!file.startsWith(mapping[1] + sep) || /signing-private/.test(file)) { response.writeHead(403).end(); return; }
  response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.bin') ? 'application/octet-stream' : 'text/javascript');
  const stream = createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response);
});
let browser;
const pages = [], requesterWeights = [], executorOriginRequests = [];
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.browserLaunch = physicalWebGpuBrowserOptions(process.platform, process.env.REPLOID_E2E_CHROMIUM_CHANNEL || 'chrome');
  browser = await chromium.launch(report.browserLaunch);
  report.browserVersion = browser.version();
  const providerContext = await browser.newContext(), requesterContext = await browser.newContext();
  const provider = await providerContext.newPage(), requester = await requesterContext.newPage(); pages.push(provider, requester);
  for (const [role, page] of [['provider', provider], ['requester', requester]]) {
    page.on('console', message => report.logs.push({ role, type: message.type(), message: message.text() }));
    page.on('pageerror', error => report.logs.push({ role, type: 'pageerror', message: error.message }));
    await page.goto(origin);
    await page.evaluate(async () => { window.fixture = await import('/tests/fixtures/doppler-choice-peer-browser.js'); });
  }
  await requester.route('**/capsule/artifacts/**', route => { requesterWeights.push(route.request().url()); return route.abort(); });
  let prepared;
  if (peerAcquisition) {
    const seeds = [];
    await provider.evaluate(async () => { window.custody = await import('/tests/fixtures/peer-pack-browser.js'); });
    const receiverIdentity = await provider.evaluate(() => window.custody.identity('executor'));
    for (const peerId of ['seed-bad', 'seed-good']) {
      const context = await browser.newContext(), page = await context.newPage(); pages.push(page);
      await page.goto(origin);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Storage.overrideQuotaForOrigin', { origin, quotaSize: 1536 * 1024 * 1024 });
      await page.evaluate(async () => { window.custody = await import('/tests/fixtures/peer-pack-browser.js'); });
      seeds.push({ peerId, page, identity: await page.evaluate(id => window.custody.identity(id), peerId) });
    }
    const metadata = await provider.evaluate(async artifacts => {
      const { hashDopplerEvidence } = await import('/self/pool/executable-pack.js');
      return { identity: await hashDopplerEvidence(artifacts) };
    }, envelope.artifacts);
    custodyIndex.artifactSetIdentity = metadata.identity;
    const indexDigest = await provider.evaluate(async index => {
      const { hashDopplerEvidence } = await import('/self/pool/executable-pack.js'); return hashDopplerEvidence(index);
    }, custodyIndex);
    const authorization = { schema: 'reploid.pool.pack-custody-authorization/v2',
      artifactSet: { schema: 'reploid.pool.artifact-set/v1', identity: metadata.identity, artifacts: envelope.artifacts },
      transferId: 'real-choice-custody', attempt: 1, expiresAt: Date.now() + 1200000,
      requester: receiverIdentity, suppliers: seeds.map(seed => seed.identity), indexDigest,
      limits: { maxArtifactBytes: 67108864, maxChunkBytes: 1048576, maxTransferBytes: 1420000000,
        requestTimeoutMs: 30000, maxConcurrentChunks: 4 } };
    const channelLimits = { maxFrameBytes: 65536, maxControlBytes: 65536, maxChunkBytes: 1048576,
      maxBufferedBytes: 2097152, maxPendingRequests: 4, maxTransferBytes: 1420000000, timeoutMs: 30000 };
    await provider.evaluate(options => window.custody.configure(options), { authorization, index: custodyIndex, limits: channelLimits });
    const inventories = [];
    const weightIds = envelope.artifacts.filter(artifact => artifact.role === 'weight-shard').slice(0, 2).map(artifact => artifact.artifactId);
    for (const seed of seeds) {
      const inventory = { expiresAt: authorization.expiresAt,
        maxBytes: seed.peerId === 'seed-good' ? 1420000000 : 134217728,
        artifacts: custodyIndex.artifacts.filter(artifact => seed.peerId === 'seed-good' || weightIds.includes(artifact.artifactId))
          .map(artifact => ({ artifactId: artifact.artifactId, chunkIndexes: artifact.chunks.map(chunk => chunk.index) })) };
      console.log(JSON.stringify({ stage: 'preparing-verified-supplier-storage', peerId: seed.peerId, artifacts: inventory.artifacts.length }));
      const supplied = await seed.page.evaluate(options => window.custody.configure(options), {
        authorization, index: custodyIndex, inventory, limits: channelLimits, faulty: seed.peerId === 'seed-bad', persistent: true });
      inventories.push(supplied.inventory);
      report[seed.peerId] = { heldBytes: supplied.heldBytes, heldChunks: supplied.heldChunks, storage: supplied.storage };
      await seed.page.route('**/bootstrap/**', route => route.abort());
      await seed.page.route('**/capsule/artifacts/**', route => route.abort());
      const offer = await provider.evaluate(id => window.custody.offer(id), seed.peerId);
      const answer = await seed.page.evaluate(offer => window.custody.answer('executor', offer), offer);
      await provider.evaluate(input => window.custody.accept(input.peerId, input.answer), { peerId: seed.peerId, answer });
      await seed.page.waitForFunction(() => window.custody.ready());
    }
    await provider.waitForFunction(() => window.custody.ready());
    await provider.route('**/capsule/artifacts/**', route => { executorOriginRequests.push(route.request().url()); return route.abort(); });
    await provider.route('**/bootstrap/**', route => { executorOriginRequests.push(route.request().url()); return route.abort(); });
    console.log(JSON.stringify({ stage: 'opening-signed-capsule-from-peers', originBlocked: true }));
    prepared = await provider.evaluate(async input => {
      window.custodyStore = await window.custody.createStore(input.custody);
      const host = await import('doppler-gpu/host');
      const session = await host.openCapsule(input.envelope, { artifactStore: window.custodyStore,
        trustedSigners: { 'local-choice-acceptance': input.publicKey }, requiredOperations: ['scoreChoices'] });
      return window.fixture.start({ role: 'provider', preparedSession: session });
    }, { envelope, publicKey, custody: { authorization, index: custodyIndex, inventories, maxConcurrentChunks: 4 } });
    report.custody = await provider.evaluate(() => window.custodyStore.getReceipt());
    report.suppliers = await Promise.all(seeds.map(seed => seed.page.evaluate(() => window.custody.observations())));
    assert(report.suppliers.flatMap(row => row.injectedFaults).some(row => row.type === 'corrupt-contribution'));
    assert(report.suppliers.flatMap(row => row.injectedFaults).some(row => row.type === 'supplier-departure'));
    assert(report.custody.attempts.some(row => row.status === 'rejected'));
    assert.equal(report.custody.source, 'peer');
    assert.deepEqual(executorOriginRequests, []);
    for (const seed of seeds) await seed.page.evaluate(() => window.custody.close());
    report.suppliersClosedBeforeInference = true;
  } else prepared = await provider.evaluate(input => window.fixture.start(input), { role: 'provider', capsuleUrl: origin + '/capsule/capsule.json', publicKey });
  report.deviceProfile = prepared.deviceProfile;
  assert(!/swiftshader|llvmpipe|software/i.test(JSON.stringify(prepared.deviceProfile)));
  const requesterPrepared = await requester.evaluate(input => window.fixture.start(input), { role: 'requester', selectedModel: prepared.model });
  assert.equal(requesterPrepared.hasModelSession, false);
  const offer = await requester.evaluate(() => window.fixture.offer());
  const answer = await provider.evaluate(offer => window.fixture.answer(offer), offer);
  await requester.evaluate(answer => window.fixture.accept(answer), answer);
  for (const row of reference.reference.cases) {
    const advert = await provider.evaluate(() => window.fixture.advert());
    const result = await requester.evaluate(input => window.fixture.run(input), { advert, row, tolerance: reference.reference.maximumAbsoluteLogitError });
    assert.equal(result.accepted, true, row.id);
    assert.equal(result.execution.output.selectedId, row.expectedId, row.id);
    report.cases.push({ id: row.id, ...result });
  }
  report.provider = await provider.evaluate(() => window.fixture.state());
  report.requester = await requester.evaluate(() => window.fixture.state());
  assert.equal(report.provider.calls, reference.reference.cases.length);
  assert.equal(report.requester.hasModelSession, false);
  assert.deepEqual(requesterWeights, []);
  assert.deepEqual([...report.provider.errors, ...report.requester.errors, ...report.logs.filter(row => row.type === 'pageerror')], []);
  report.requesterArtifactFetches = requesterWeights;
  report.executorOriginRequests = executorOriginRequests;
  report.peerAcquisition = peerAcquisition;
  report.browserContexts = pages.length;
  report.passed = true;
} catch (error) { report.failure = String(error.stack || error); }
finally {
  const cleanup = await Promise.allSettled(pages.map(page => page.evaluate(async () => {
    try { await window.fixture?.close(); }
    finally { window.custodyStore?.close(); window.custody?.close(); }
  })));
  report.cleanupErrors = cleanup.filter(row => row.status === 'rejected').map(row => row.reason.message);
  report.passed &&= !report.cleanupErrors.length;
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ outputPath, passed: report.passed, cases: report.cases.length, failure: report.failure ?? null, cleanupErrors: report.cleanupErrors }));
if (!report.passed) process.exitCode = 1;
