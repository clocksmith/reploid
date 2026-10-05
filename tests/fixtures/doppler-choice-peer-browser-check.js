import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, sep } from 'node:path';
import { chromium } from 'playwright';

const [dopplerArg, reploidArg, capsuleArg, referencePath, archivePath, outputPath] = process.argv.slice(2);
assert(outputPath, 'Expected installed Doppler/Reploid roots, qualified Capsule directory, reference, archive and output');
const doppler = resolve(dopplerArg), reploid = resolve(reploidArg), capsule = resolve(capsuleArg), root = resolve(import.meta.dirname, '../..');
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const metadata = await read(resolve(doppler, 'package.json')), library = await read(resolve(reploid, 'package.json'));
const reference = await read(referencePath), publicKey = await read(resolve(capsule, 'signing-public.json'));
const sha = async path => createHash('sha256').update(await readFile(path)).digest('hex');
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
  if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Real peer decisions</title><script type="importmap">' + JSON.stringify({ imports }) + '</script>'); return; }
  const mapping = mappings.find(([prefix]) => pathname.startsWith(prefix));
  if (!mapping) { response.writeHead(404).end(); return; }
  const file = resolve(mapping[1], pathname.slice(mapping[0].length));
  if (!file.startsWith(mapping[1] + sep) || /signing-private/.test(file)) { response.writeHead(403).end(); return; }
  response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.bin') ? 'application/octet-stream' : 'text/javascript');
  const stream = createReadStream(file); stream.on('error', () => response.destroy()); stream.pipe(response);
});
let browser;
const pages = [], requesterWeights = [];
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.REPLOID_E2E_CHROMIUM_CHANNEL || 'chrome', headless: true,
    args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=vulkan', '--disable-gpu-sandbox'] });
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
  const prepared = await provider.evaluate(input => window.fixture.start(input), { role: 'provider', capsuleUrl: origin + '/capsule/capsule.json', publicKey });
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
  report.passed = true;
} catch (error) { report.failure = String(error.stack || error); }
finally {
  const cleanup = await Promise.allSettled(pages.map(page => page.evaluate(() => window.fixture?.close())));
  report.cleanupErrors = cleanup.filter(row => row.status === 'rejected').map(row => row.reason.message);
  report.passed &&= !report.cleanupErrors.length;
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(outputPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ outputPath, passed: report.passed, cases: report.cases.length, failure: report.failure ?? null, cleanupErrors: report.cleanupErrors }));
if (!report.passed) process.exitCode = 1;
