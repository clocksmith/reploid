import fs from 'node:fs';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const files = ['self/ui/pool-home/conversation-workspace.js', 'tests/unit/conversation-workspace.test.js',
  'tests/e2e/first-use-preparation.spec.js', 'tests/e2e/chat-material.spec.js',
  'artifacts/first-use-preparation-20261013/playwright.config.js'];
const snapshot = Object.fromEntries(files.map(file => [
  file.startsWith('self/') ? '/' + file.slice(5) : '/testing/' + file,
  fs.readFileSync(file, 'utf8')
]));
let result;
const sandbox = { console, setTimeout, clearTimeout };
sandbox.self = sandbox;
sandbox.postMessage = value => { result = value; };
const context = vm.createContext(sandbox);
sandbox.importScripts = file => vm.runInContext(fs.readFileSync('self' + file, 'utf8'), context, { filename: file });
vm.runInContext(fs.readFileSync('self/core/verification-worker.js', 'utf8'), context);
await sandbox.onmessage({ data: { type: 'VERIFY', snapshot } });
const evidence = {
  scope: 'Unchanged actual Verification Worker; production UI path and focused unit regression',
  files: Object.fromEntries(files.map(file => [file, createHash('sha256').update(fs.readFileSync(file)).digest('hex')])),
  result
};
fs.writeFileSync('artifacts/first-use-preparation-20261013/worker.json', JSON.stringify(evidence, null, 2) + '\n');
if (!result.passed) throw Error(JSON.stringify(result));
console.log('Verification Worker passed; warnings retained');
