import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const names = ['artifact-router', 'executable-pack', 'inference-receipt', 'model-contract', 'peer-control-plane',
  'peer-protocol', 'complete-forecast', 'forecast-workload', 'peer-assignment'].map(name => 'self/pool/' + name + '.js');
names.push('sdk/poolday-forecast/index.js', 'scripts/build-poolday-forecast-sdk.js', 'scripts/verify-poolday-forecast-sdk.js',
  'tests/unit/pool-complete-forecast.test.js');
const entries = await Promise.all(names.map(async name => [name, await fs.readFile(path.join(root, name), 'utf8')]));
const snapshot = Object.fromEntries(entries.map(([name, source]) => ['/' + name.replace(/^self\//, ''), source]));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('http://127.0.0.1:5199/**', async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Forecast SDK verification</title>' });
    if (!['/core/verification-worker.js', '/core/vendor/acorn.js'].includes(name)) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'self', name)) });
  });
  await page.goto('http://127.0.0.1:5199/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Verification Worker timeout')); }, 30000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); reject(new Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), snapshot);
  const report = { schema: 'reploid.forecast-sdk-verification/v1', at: new Date().toISOString(),
    kind: 'Actual classic Verification Worker static/AST analysis; no inference or adoption claim',
    sources: entries.map(([name, source]) => ({ path: name, hash: 'sha256:' + createHash('sha256').update(source).digest('hex') })), result };
  const directory = path.join(root, 'artifacts/forecast-sdk'); await fs.mkdir(directory, { recursive: true });
  const output = path.join(directory, 'verification-' + report.at.replace(/[:.]/g, '-') + '.json');
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, passed: result.passed, errors: result.errors, warnings: result.warnings }) + '\n');
  if (!result.passed) throw new Error('Forecast SDK failed Verification Worker analysis');
} finally { await browser.close(); }
