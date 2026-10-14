// Copy of ../final/verify-worker.js. Differences: `root` is this folder and `files` is the one
// new script here. The final/ scripts this pass reuses are unchanged since ../final/worker.json
// (hashes recorded in this folder's binding.json). Run from the Reploid checkout root.
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root = 'artifacts/signed-completion-candidate-20261013/final-2/';
const files = ['check-swarm-label.js'];
const snapshot = Object.fromEntries(files.map(file => ['/testing/' + file, fs.readFileSync(root + file, 'utf8')]));
let result;
const sandbox = { console, setTimeout, clearTimeout };
sandbox.self = sandbox; sandbox.postMessage = value => { result = value; };
const context = vm.createContext(sandbox);
sandbox.importScripts = file => vm.runInContext(fs.readFileSync('self' + file, 'utf8'), context, { filename: file });
vm.runInContext(fs.readFileSync('self/core/verification-worker.js', 'utf8'), context);
await sandbox.onmessage({ data: { type: 'VERIFY', snapshot } });
const evidence = { scope: '/testing/ Node-only installed contract tooling; no production browser capability change',
  files: Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(root + file)).digest('hex')])), result };
fs.writeFileSync(root + 'worker.json', JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
if (!result.passed) throw Error(JSON.stringify(result));
console.log('Actual Verification Worker passed; warnings retained');
