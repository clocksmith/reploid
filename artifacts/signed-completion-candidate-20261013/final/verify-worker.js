// Adapted copy of artifacts/basic-signed-candidate-20261013/final/verify-worker.js.
// Every difference from the original:
//  1. `root` is this folder and `files` are this folder's four scripts.
//  2. The receipt is created exclusively instead of overwritten.
// Run from the Reploid checkout root, as the original was.
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root = 'artifacts/signed-completion-candidate-20261013/final/';
const files = ['prepare-catalog.js', 'preflight.js', 'verify-delivery.js', 'scope-export.js'];
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
