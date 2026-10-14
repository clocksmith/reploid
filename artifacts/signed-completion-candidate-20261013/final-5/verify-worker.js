// Adapted from ../final-4/verify-worker.js. Differences: `root` is the candidate folder and
// `files` lists every script this pass ran (all reused unchanged from earlier passes), so the
// Verification Worker re-checks them together; the receipt is this folder's worker.json.
// Run from the Reploid checkout root.
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root = 'artifacts/signed-completion-candidate-20261013/';
const files = ['final/prepare-catalog.js', 'final/preflight.js', 'final/verify-delivery.js', 'final/scope-export.js',
  'final-2/check-swarm-label.js', 'final-3/check-room-token-file.js', 'final-4/check-disclosure-files.js'];
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
fs.writeFileSync(root + 'final-5/worker.json', JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
if (!result.passed) throw Error(JSON.stringify(result));
console.log('Actual Verification Worker passed; warnings retained');
