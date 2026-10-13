import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';
const root = process.cwd(), directory = 'artifacts/ordered-route-integration-20261013';
const names = ['run.mjs', 'facade.mjs', 'peer.mjs', 'verify-worker.mjs'];
const entries = await Promise.all(names.map(async name => [name, await fs.readFile(path.join(directory, name), 'utf8')]));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.route('http://127.0.0.1:5199/**', async route => {
    const name = new URL(route.request().url()).pathname;
    if (name === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Controller verification</title>' });
    if (!['/core/verification-worker.js', '/core/vendor/acorn.js'].includes(name)) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: await fs.readFile(path.join(root, 'self', name)) });
  });
  await page.goto('http://127.0.0.1:5199/');
  const result = await page.evaluate(snapshot => new Promise((resolve, reject) => {
    const worker = new Worker('/core/verification-worker.js');
    const timeout = setTimeout(() => { worker.terminate(); reject(Error('Worker deadline')); }, 30000);
    worker.onmessage = event => { clearTimeout(timeout); worker.terminate(); resolve(event.data); };
    worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(Error(event.message)); };
    worker.postMessage({ type: 'VERIFY', snapshot });
  }), Object.fromEntries(entries.map(([name, source]) => ['/' + name, source])));
  const receipt = { scope: 'Actual Verification Worker AST analysis of controller tooling; no model execution', at: new Date().toISOString(),
    sources: entries.map(([name, source]) => ({ name, sha256: createHash('sha256').update(source).digest('hex') })), result };
  await fs.writeFile(path.join(directory, 'worker.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ passed: result.passed, errors: result.errors, warnings: result.warnings }));
  if (!result.passed) process.exitCode = 1;
} finally { await browser.close(); }
