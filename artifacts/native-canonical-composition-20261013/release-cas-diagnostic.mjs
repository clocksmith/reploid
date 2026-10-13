import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { openNativeReleaseCheckpoints } from '../../server/native-release-storage.js';
const module = new URL('../../server/native-release-storage.js', import.meta.url).href;
const namespace = 'sha256:' + 'a'.repeat(64), outcomes = [];
for (let i = 0; i < 20; i++) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'release-cas-diagnostic-'));
  const store = await openNativeReleaseCheckpoints({ directory }); await store.read(namespace);
  const workers = ['b', 'c'].map(char => new Worker(`
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { openNativeReleaseCheckpoints } = await import(workerData.module);
      const store = await openNativeReleaseCheckpoints({ directory: workerData.directory });
      parentPort.once('message', async () => {
        let result;
        try { result = { ok: true, checkpoint: await store.advance(workerData.namespace,
          { sequence: 0, digest: null }, { sequence: 1, digest: workerData.digest }) }; }
        catch (error) { result = { ok: false, error: error.message, code: error.code }; }
        finally { store.close(); }
        parentPort.postMessage(result); parentPort.close();
      });
      parentPort.postMessage('ready');
    })().catch(error => { throw error; });
  `, { eval: true, workerData: { directory, module, namespace, digest: 'sha256:' + char.repeat(64) } }));
  try {
    await Promise.all(workers.map(worker => new Promise((resolve,reject) => { worker.once('error',reject); worker.once('message',resolve); })));
    const pending = workers.map(worker => new Promise((resolve,reject) => { worker.once('error',reject); worker.once('message',resolve); }));
    workers.forEach(worker=>worker.postMessage('advance'));
    outcomes.push({ results: await Promise.all(pending), final: await store.read(namespace) });
  } finally { await Promise.all(workers.map(worker=>worker.terminate())); store.close(); await fs.rm(directory,{recursive:true,force:true}); }
}
await fs.writeFile(new URL('./release-cas-diagnostic.json',import.meta.url),JSON.stringify({scope:'Unchanged production SQLite adapter; exact two-worker control repeated only to retain both actual failure messages.',outcomes},null,2)+'\n');
console.log(JSON.stringify({trials:outcomes.length,zeroSuccessful:outcomes.filter(row=>!row.results.some(x=>x.ok)).length}));
