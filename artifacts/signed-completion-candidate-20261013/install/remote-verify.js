// CPU-only check of the installed native package on a contributor host. It opens no GPU,
// server, peer, checkpoint store or ledger and starts nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const [directory, tarball, tarballSha256, archive, archiveSha256, label] = process.argv.slice(2);
assert(directory && tarball && tarballSha256 && archive && archiveSha256 && label, 'Usage: remote-verify.js DIR TARBALL SHA ARCHIVE SHA LABEL');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(await fs.readFile(tarball)), tarballSha256, 'Native tarball changed');
assert.equal(hash(await fs.readFile(archive)), archiveSha256, 'Runtime archive changed');
const extracted = await fs.mkdtemp(path.join(path.dirname(directory), 'runtime-archive-'));
execFileSync('tar', ['-xzf', archive, '-C', extracted]);
const walk = async root => (await fs.readdir(root, { withFileTypes: true, recursive: true }))
  .filter(entry => entry.isFile()).map(entry => path.relative(root, path.join(entry.parentPath ?? entry.path, entry.name)));
const runtimeRoot = path.join(directory, 'node_modules/doppler-gpu');
const files = await walk(path.join(extracted, 'package'));
for (const file of files) {
  const [expected, actual] = await Promise.all([fs.readFile(path.join(extracted, 'package', file)), fs.readFile(path.join(runtimeRoot, file))]);
  assert(expected.equals(actual), `Installed runtime file differs: ${file}`);
}
const self = path.join(directory, 'self');
const staged = JSON.parse(await fs.readFile(path.join(self, 'config/chat-models.json')));
assert.equal(staged.length, 1);
const model = staged[0];
const manifestFile = model.source.files.find(file => file.role === 'model-manifest');
const manifest = JSON.parse(await fs.readFile(path.join(self, manifestFile.url)));
const installed = relative => import(pathToFileURL(path.join(directory, relative)).href);
const runtime = await installed('node_modules/doppler-gpu/src/partitions.js');
const { createWorkPartitionPlan } = await installed('self/host/work-partition-plan.js');
const admission = [];
for (let index = 0; index < model.partitionPlan.stageCount; index++) {
  const plan = createWorkPartitionPlan(runtime, manifest, model, index);
  admission.push({ index, layerRange: plan.partitions[index].layerRange, planId: runtime.hashLayerPartitionPlan(plan) });
}
const nativeModules = Object.fromEntries(['@roamhq/wrtc', 'ws', 'webgpu'].map(name => {
  const pkg = JSON.parse(execFileSync(process.execPath, ['-e', `process.stdout.write(JSON.stringify(require(require.resolve('${name}/package.json',{paths:['${directory}']}))))`]));
  return [name, pkg.version];
}));
console.log(JSON.stringify({ schema: 'reploid.native-install-verification/v1', host: label, node: process.versions.node,
  tarballSha256, archiveSha256, runtimeFilesEqual: files.length, orderedPlanAdmission: admission, nativeModules,
  scope: 'CPU-only installed-bytes and plan-admission check; no GPU, peer, checkpoint or ledger opened' }, null, 2));
