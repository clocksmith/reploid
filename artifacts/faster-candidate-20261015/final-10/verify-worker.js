// Copy of ../../signed-completion-candidate-20261013/final-9/verify-worker.js for final-10: the scripts are
// this folder's new copies (preflight.js, verify-delivery.js) and the held-checkpoint reader, plus the
// unchanged precedent scripts it reran; the receipt is final-10/worker.json. Run from the Reploid checkout root.
import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
const root = 'artifacts/';
const files = ['faster-candidate-20261015/final-10/preflight.js', 'faster-candidate-20261015/final-10/verify-delivery.js',
  'faster-candidate-20261015/final-10/read-stage0-checkpoint.mjs',
  'signed-completion-candidate-20261013/final/prepare-catalog.js', 'signed-completion-candidate-20261013/final/scope-export.js',
  'signed-completion-candidate-20261013/final-2/check-swarm-label.js', 'signed-completion-candidate-20261013/final-3/check-room-token-file.js',
  'signed-completion-candidate-20261013/final-6/check-changed-files.js'];
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
fs.writeFileSync(root + 'faster-candidate-20261015/final-10/worker.json', JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
if (!result.passed) throw Error(JSON.stringify(result));
console.log('Actual Verification Worker passed; warnings retained');
