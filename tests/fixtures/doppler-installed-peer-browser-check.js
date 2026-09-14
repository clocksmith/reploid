// Required installed-candidate check: injected model program, actual browser transport and storage.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { chromium } from 'playwright';

assert(process.env.DOPPLER_TEST_CONSUMER, 'DOPPLER_TEST_CONSUMER must name an installed candidate.');
const consumer = path.resolve(process.env.DOPPLER_TEST_CONSUMER);
const root = path.resolve(import.meta.dirname, '../..');
const bundleRoot = path.dirname(consumer);
const bundle = JSON.parse(await readFile(path.join(bundleRoot, 'receipt.json'), 'utf8'));
assert(bundle.passed);
assert.equal(createHash('sha256').update(await readFile(path.join(bundleRoot, bundle.package.filename))).digest('hex'), bundle.package.sha256);
const metadata = JSON.parse(await readFile(path.join(consumer, 'node_modules/doppler-gpu/package.json'), 'utf8'));
const entry = metadata.exports['.'].browser ?? metadata.exports['.'].import;
assert(entry?.startsWith('./'), 'Candidate must declare a public ESM entry.');
const report = { passed: false, schema: 'reploid.installed-peer-browser/v1', package: bundle.package,
  reploidRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  sourceStatus: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  executionClass: 'installed-doppler-injected-program-real-webrtc-native-indexeddb', operatorCount: 1,
  logs: [], startedAtUtc: new Date().toISOString() };
const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end(`<!doctype html><title>Installed peer streaming</title><script type="importmap">${JSON.stringify({ imports: {
        'doppler-gpu': `/installed/node_modules/doppler-gpu/${entry.slice(2)}`,
      } })}</script>`); return;
    }
    const installed = pathname.startsWith('/installed/');
    const file = path.resolve(installed ? consumer : root, pathname.slice(installed ? '/installed/'.length : 1));
    const allowed = installed
      ? file === path.join(consumer, 'generation-fixture.json') || file.startsWith(path.join(consumer, 'node_modules/doppler-gpu') + path.sep)
      : ['self', 'tests/fixtures'].some(directory => file.startsWith(path.join(root, directory) + path.sep));
    if (!allowed) { response.writeHead(403).end(); return; }
    response.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/javascript');
    response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
let browser;
const contexts = [], pages = [];
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  report.browserVersion = browser.version();
  for (const role of ['requester', 'provider']) {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => report.logs.push({ role, type: 'pageerror', message: error.message }));
    page.on('console', message => report.logs.push({ role, type: message.type(), message: message.text() }));
    await page.goto(origin);
    await page.evaluate(async role => {
      window.fixture = await import('/tests/fixtures/doppler-installed-peer-browser.js');
      await window.fixture.start(role);
    }, role);
  }
  const [requester, provider] = pages;
  const offer = await requester.evaluate(() => window.fixture.offer());
  const answer = await provider.evaluate(offer => window.fixture.answer(offer), offer);
  await requester.evaluate(answer => window.fixture.accept(answer), answer);
  const advert = await provider.evaluate(() => window.fixture.advert());
  report.requester = await requester.evaluate(advert => window.fixture.run(advert), advert);
  report.provider = await provider.evaluate(() => window.fixture.state());
  assert.deepEqual(report.requester.execution.output.tokenIds, [0, 1, 0]);
  assert.equal(report.requester.partials.map(delta => delta.text).join(''), '0,1,0');
  assert.equal(report.requester.partials.length, 3);
  assert.equal(report.requester.execution.receipt.schema, 'doppler.capsule-operation-receipt/v2');
  assert.equal(report.requester.replay.accepted, true);
  assert.equal(report.requester.accounting.deliveries, 2);
  assert.equal(report.provider.calls, 1);
  assert.equal(report.provider.replacements, 1);
  assert.equal(report.provider.connection.state, 'connected');
  assert.equal(report.provider.journal.attempts, 1);
  assert.equal(report.provider.transport.sentFrameBytes, report.requester.transport.receivedFrameBytes);
  assert.deepEqual([...report.requester.errors, ...report.provider.errors,
    ...report.logs.filter(row => row.type === 'pageerror')], []);
  report.passed = true;
} catch (error) { report.error = { message: error.message, stack: error.stack }; }
finally {
  const cleanup = await Promise.allSettled(pages.map(page => page.evaluate(() => window.fixture?.close())));
  report.cleanupErrors = cleanup.filter(row => row.status === 'rejected').map(row => row.reason.message);
  report.passed &&= report.cleanupErrors.length === 0;
  await Promise.all(contexts.map(context => context.close()));
  await browser?.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  report.completedAtUtc = new Date().toISOString();
}
const json = JSON.stringify(report, null, 2);
if (process.env.DOPPLER_TEST_BROWSER_RECEIPT) await writeFile(process.env.DOPPLER_TEST_BROWSER_RECEIPT, json + '\n');
console.log(json);
if (!report.passed) process.exitCode = 1;
