import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = 'artifacts/messages-browser-delivery-20261013/';
const inventory = JSON.parse(fs.readFileSync('self/vendor/reploid/package-assets.json'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const entry of inventory.files) {
  const source = fs.readFileSync('packages/reploid/src/' + entry.path);
  const copy = fs.readFileSync('self/vendor/reploid/' + entry.path);
  assert(source.equals(copy), entry.path);
  assert.equal(copy.length, entry.bytes, entry.path);
  assert.equal(hash(copy), entry.sha256, entry.path);
}
const changed = execFileSync('git', ['diff', '--name-only', '--', 'self/vendor/reploid'], { encoding: 'utf8' });
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', 'self/vendor/reploid'], { encoding: 'utf8' });
const files = [...new Set((changed + added).trim().split('\n'))].filter(file => file.endsWith('.js'));
assert(files.length > 0, 'Run this receipt before committing generated delivery');
const snapshot = Object.fromEntries(files.map(file => ['/' + file.slice('self/'.length), fs.readFileSync(file, 'utf8')]));
let result;
const sandbox = { console, setTimeout, clearTimeout };
sandbox.self = sandbox; sandbox.postMessage = value => { result = value; };
const context = vm.createContext(sandbox);
sandbox.importScripts = file => vm.runInContext(fs.readFileSync('self' + file, 'utf8'), context, { filename: file });
vm.runInContext(fs.readFileSync('self/core/verification-worker.js', 'utf8'), context);
await sandbox.onmessage({ data: { type: 'VERIFY', snapshot } });
fs.writeFileSync(root + 'verification.json', JSON.stringify({
  sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  matchedFiles: inventory.files.length,
  files: Object.fromEntries(files.map(file => [file, hash(fs.readFileSync(file))])),
  browserBundle: JSON.parse(fs.readFileSync('self/config/browser-bundle-manifest.json')).bundleHash,
  runtimePin: JSON.parse(fs.readFileSync('self/config/doppler-package.json')),
  deployed: false, result
}, null, 2) + '\n');
assert.equal(result.passed, true, JSON.stringify(result.errors));
console.log(`Matched ${inventory.files.length} source files; actual Worker passed ${files.length} changed browser modules`);
