// Run-7 read-only diagnostic: the release checkpoints the stage 0 browser profile holds, read from its
// IndexedDB store (self/infrastructure/pack-release-storage.js: database reploid-pack-releases-v1,
// store checkpoints, key = namespace digest) in a readonly transaction. Nothing is advanced.
// Usage: node stage0-checkpoint.mjs <cdp endpoint> <origin> <machine alias>
import { chromium } from 'playwright';
import { findPage } from '../../harness.mjs';
const [endpoint, origin, machine] = process.argv.slice(2);
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = findPage(browser, origin);
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
  console.log(JSON.stringify({ schema: 'reploid.run-7-browser-signed-state/v1', machine, at: new Date().toISOString(), releaseCheckpoints }, null, 1));
} finally { await browser.close(); }
