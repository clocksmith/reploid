import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const root = process.cwd();
const names = ['packages/reploid/src/artifacts/custody/exchange.js', 'tests/unit/custody-exchange.test.js', 'server/native-model-files.js', 'server/native-participant.js', 'tests/unit/native-model-files.test.js', 'self/host/work-partitions.js', 'packages/reploid/src/mesh/partitions/automatic-partitions.js', 'tests/unit/automatic-partition-lifecycle.test.js', 'tests/unit/work-partitions-lifecycle.test.js'];
const entries = await Promise.all(names.map(async name => [name, await fs.readFile(path.join(root, name), 'utf8')]));
const snapshot = Object.fromEntries(entries.map(([name, source]) => ['/' + name.replace(/^self\//, ''), source]));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.route('http://127.0.0.1:5199/**', async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Native status verification</title>' });
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
  const report = { schema: 'reploid.native-status-verification/v1', at: new Date().toISOString(),
    kind: 'Actual classic Verification Worker static/AST analysis; no inference or adoption claim',
    sources: entries.map(([name, source]) => ({ path: name, hash: 'sha256:' + createHash('sha256').update(source).digest('hex') })), result };
  const directory = path.join(root, 'artifacts/capacity-failover-20261012'); await fs.mkdir(directory, { recursive: true });
  const output = path.join(directory, 'worker-verification.json');
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ output, passed: result.passed, errors: result.errors, warnings: result.warnings }) + '\n');
  if (!result.passed) throw new Error('Native status failed Verification Worker analysis');
} finally { await browser.close(); }
