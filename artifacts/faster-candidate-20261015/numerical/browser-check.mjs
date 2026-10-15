// Whole-model 55-step check in the Mac browser (Chrome, WebGPU on Metal): the browser counterpart of
// substitution-check.mjs, for one configuration per process. browser-check-page.js runs in an owned,
// headless Chrome launched with the physical-WebGPU options of the numerical fixtures
// (tests/fixtures/physical-webgpu-browser.js: --enable-unsafe-webgpu --use-angle=metal, never a
// software GPU). This process serves the package under test, the model directory, the request
// inputs and the approved reference logits (decoded here, one step per request) on a loopback port,
// receives the page's results and K/V cache bytes, and writes report.json and caches/ in the same
// shapes as substitution-check.mjs, so summarize.py reads both.
//
// Usage: node browser-check.mjs <doppler package root> <model dir> <approved-reference.json>
//          <contracts dir> <distributed-observed.json> <config.json> <out dir> <fixture root>
// fixture root: a numerical fixture root holding node_modules/playwright and tests/fixtures.
// macOS has no systemd scopes; the process bounds its own lifetime (RUNTIME_CAP_MS) and closes the
// browser on exit.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash } from 'node:crypto';

const [packageRoot, modelDir, referencePath, contractsDir, observedPath, configPath, outDir, fixtureRoot] = process.argv.slice(2);
if (!fixtureRoot) throw new Error('Usage: browser-check.mjs PACKAGE MODEL REFERENCE CONTRACTS OBSERVED CONFIG OUT_DIR FIXTURE_ROOT');
const RUNTIME_CAP_MS = 45 * 60 * 1000;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const { chromium } = await import(path.join(fixtureRoot, 'node_modules/playwright/index.mjs'));
const { physicalWebGpuBrowserOptions } = await import(path.join(fixtureRoot, 'tests/fixtures/physical-webgpu-browser.js'));

const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
await fs.mkdir(outDir, { recursive: false });
const referenceBytes = await fs.readFile(referencePath);
const reference = JSON.parse(referenceBytes);
const contractBytes = await Promise.all(reference.expected.map((_, index) => fs.readFile(path.join(contractsDir, `request-${index}-contract.json`))));
const observed = JSON.parse(await fs.readFile(observedPath, 'utf8'));
const manifestBytes = await fs.readFile(path.join(modelDir, 'manifest.json'));
const manifestIdentity = 'sha256:' + sha256(manifestBytes);
const report = { schema: 'reploid.plain-substitution-check/v1', label: config.label, startedAt: new Date().toISOString(), machine: 'mac-host',
  surface: 'browser-webgpu', referenceSha256: 'sha256:' + sha256(referenceBytes), referenceModelIdentity: reference.modelIdentity,
  manifestIdentity, manifestMatchesReference: manifestIdentity === reference.modelIdentity, config,
  configSha256: 'sha256:' + sha256(await fs.readFile(configPath)), tolerance: reference.numericalReference.tolerance,
  requiredSteps: reference.numericalReference.steps, requestContractSha256: contractBytes.map(bytes => 'sha256:' + sha256(bytes)),
  harness: { driverSha256: 'sha256:' + sha256(await fs.readFile(new URL(import.meta.url))),
    pageSha256: 'sha256:' + sha256(await fs.readFile(new URL('./browser-check-page.js', import.meta.url))) } };

// Decoded reference logits, one buffer per step, exactly as substitution-check.mjs decodes them.
const referenceSteps = reference.expected.map(target => target.steps.map(step => {
  const bytes = Buffer.from(step.logits, 'base64');
  return { dtype: step.logitsDtype ?? 'f32', bytes };
}));
const inputs = JSON.stringify({ config, modelBase: '/model/', manifestText: manifestBytes.toString('utf8'), manifestIdentity,
  reference: { prompts: reference.prompts, numericalReference: reference.numericalReference,
    expected: reference.expected.map(target => ({ steps: target.steps.map(step => ({ tokenId: step.tokenId })) })) },
  requests: contractBytes.map(bytes => JSON.parse(bytes)), speedTurn: observed.runs['run-5'].turns[0] });

const page = `<!doctype html><meta charset="utf-8"><title>browser-check</title><script type="module" src="/harness/page.js"></script>`;
const types = { '.js': 'text/javascript', '.json': 'application/json', '.wgsl': 'text/plain', '.wasm': 'application/wasm' };
const logLines = [];
let finish;
const done = new Promise(resolve => { finish = resolve; });
const cacheDir = path.join(outDir, 'caches');
const readBody = request => new Promise((resolve, reject) => { const chunks = []; request.on('data', c => chunks.push(c)); request.on('end', () => resolve(Buffer.concat(chunks))); request.on('error', reject); });
const inside = (root, relative) => { const file = path.resolve(root, relative); if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('path'); return file; };

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const p = decodeURIComponent(url.pathname);
    if (request.method === 'POST') {
      const body = await readBody(request);
      if (p === '/log') { const value = JSON.parse(body); logLines.push({ at: new Date().toISOString(), ...value }); console.log(JSON.stringify(value)); }
      else if (p === '/done') finish(JSON.parse(body));
      else if (p.startsWith('/cache/')) {
        const index = Number(p.slice('/cache/'.length));
        const layers = JSON.parse(url.searchParams.get('layers'));
        let cursor = 0;
        for (const row of layers) {
          const size = row.seqLen * row.numHeads * row.headDim * 2;
          row.keySha256 = sha256(body.subarray(cursor, cursor + size)); cursor += size;
          row.valueSha256 = sha256(body.subarray(cursor, cursor + size)); cursor += size;
        }
        if (cursor !== body.length) throw new Error('Cache dump length mismatch');
        await fs.mkdir(cacheDir, { recursive: true });
        await fs.writeFile(path.join(cacheDir, `request-${index}.f16`), body, { flag: 'wx' });
        await fs.writeFile(path.join(cacheDir, `request-${index}.json`), JSON.stringify({ label: config.label, request: index,
          dataSha256: 'sha256:' + sha256(body), layers }, null, 1) + '\n', { flag: 'wx' });
        (report.finalCaches ??= {})[index] = layers;
      } else throw new Error('route');
      response.end('ok');
      return;
    }
    let bytes, file;
    if (p === '/' || p === '/index.html') { response.setHeader('content-type', 'text/html'); response.end(page); return; }
    if (p === '/harness/page.js') file = new URL('./browser-check-page.js', import.meta.url);
    else if (p === '/inputs.json') { response.setHeader('content-type', 'application/json'); response.end(inputs); return; }
    else if (p.startsWith('/ref/')) {
      const [attempt, step] = p.slice(5).split('/').map(Number);
      const row = referenceSteps[attempt][step];
      response.setHeader('x-logits-dtype', row.dtype); response.setHeader('content-type', 'application/octet-stream');
      response.end(row.bytes); return;
    } else if (p.startsWith('/pkg/')) file = inside(packageRoot, p.slice(5));
    else if (p.startsWith('/model/')) file = inside(modelDir, p.slice(7));
    else throw new Error('route');
    bytes = await fs.readFile(file);
    response.setHeader('content-type', types[path.extname(String(file))] ?? 'application/octet-stream');
    response.setHeader('cache-control', 'no-store');
    response.end(bytes);
  } catch (error) {
    response.writeHead(error.message === 'route' || error.code === 'ENOENT' ? 404 : 500).end(String(error.message));
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const options = physicalWebGpuBrowserOptions('darwin');
const browser = await chromium.launch(options);
const cap = setTimeout(() => finish({ ok: false, error: `Runtime cap ${RUNTIME_CAP_MS} ms reached` }), RUNTIME_CAP_MS);
let result;
try {
  report.browserVersion = browser.version();
  report.browserArgs = options.args;
  const context = await browser.newContext();
  const tab = await context.newPage();
  const consoleLines = [];
  tab.on('console', message => { if (['error', 'warning'].includes(message.type())) consoleLines.push({ type: message.type(), text: message.text().slice(0, 2000) }); });
  tab.on('pageerror', error => consoleLines.push({ type: 'pageerror', text: String(error).slice(0, 2000) }));
  await tab.goto(origin + '/');
  result = await done;
  report.console = consoleLines.slice(0, 200);
} finally {
  clearTimeout(cap);
  await browser.close();
  server.closeAllConnections(); server.close();
}
report.log = logLines;
if (!result.ok) report.failure = result.error;
else {
  const page = result.report;
  report.dopplerVersion = page.dopplerVersion; report.gpu = page.gpu; report.speed = page.speed; report.summary = page.summary;
  report.requests = page.requests;
  for (const [index, layers] of Object.entries(report.finalCaches ?? {})) report.requests[Number(index)].finalCaches = layers;
  delete report.finalCaches;
}
report.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ label: config.label, ok: result.ok, ...(report.summary ?? {}), ...(report.speed?.summary ?? {}), failure: report.failure ?? null }));
process.exitCode = result.ok && report.summary?.passed ? 0 : 1;
