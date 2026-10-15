// Read-only: the release checkpoints the mac-host stage 0 browser profile holds, before final-10 is served.
// Same IndexedDB read as run-7/tools/stage0-checkpoint.mjs (database reploid-pack-releases-v1, store
// checkpoints, readonly transaction; an upgrade is aborted, so nothing is created). Difference: the
// application is not served. A blank page on the application's origin (127.0.0.1:29670) gives the read the
// same storage partition without booting the app, so no contribution, opening or checkpoint advance can
// start. The profile is the run-2 stage 0 profile reused by runs 5 and 7.
// Usage: node read-stage0-checkpoint.mjs <profile dir> <output json>
import fs from 'node:fs/promises';
import http from 'node:http';
const { chromium } = await import('/var/tmp/reploid-faster-candidate-20261015/node_modules/playwright/index.mjs');
const [profile, output] = process.argv.slice(2);
const server = http.createServer((request, response) => { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><title>blank</title>'); });
await new Promise(resolve => server.listen(29670, '127.0.0.1', resolve));
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true });
try {
  const page = context.pages()[0] || await context.newPage();
  await page.goto('http://127.0.0.1:29670/');
  const releaseCheckpoints = await page.evaluate(() => new Promise((resolve, reject) => {
    const opening = indexedDB.open('reploid-pack-releases-v1');
    opening.onupgradeneeded = () => { opening.transaction.abort(); reject(new Error('No release checkpoint store')); };
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result, store = db.transaction('checkpoints', 'readonly').objectStore('checkpoints');
      const keys = store.getAllKeys(), values = store.getAll();
      values.onsuccess = () => { resolve(keys.result.map((namespace, index) => ({ namespace, ...values.result[index] }))); db.close(); };
      values.onerror = () => { reject(values.error); db.close(); };
    };
  }));
  const record = { schema: 'reploid.run-7-browser-signed-state/v1', machine: 'mac-host', at: new Date().toISOString(), releaseCheckpoints };
  await fs.writeFile(output, JSON.stringify(record, null, 1) + '\n', { flag: 'wx' });
  console.log(JSON.stringify(record));
} finally { await context.close(); server.close(); }
