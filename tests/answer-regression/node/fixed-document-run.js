// node tests/answer-regression/node/fixed-document-run.js contract.json new-output-directory
// Uses only an explicitly provisioned local model; never joins a mesh or activates a candidate.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { resolve } from 'node:path';
import { createNativeGpuHost } from '../../../server/native-participant.js';
import { createNativeWholeModel } from '../../../server/native-whole-model.js';
import { compareDocuments, digest, validateComparison } from './fixed-document-comparison.js';

const [contractPath, destination] = process.argv.slice(2);
assert(contractPath && destination, 'Supply contract and a new output directory');
const contract = validateComparison(JSON.parse(await fs.readFile(contractPath, 'utf8')));
const policy = JSON.parse(await fs.readFile(new URL('../../../packages/reploid/src/retrieval/policy.json', import.meta.url)));
assert.equal(digest(policy), contract.policyHash, 'Source policy differs from frozen contract');
const catalog = JSON.parse(await fs.readFile(new URL('../../../self/config/chat-models.json', import.meta.url)));
const model = catalog.find(row => row.id === contract.modelId);
assert(model && model.identity === contract.modelIdentity, 'Exact model required');
assert.equal(digest(model), contract.modelHash, 'Model configuration changed');
const modelDirectory = process.env.REPLOID_COMPARISON_MODEL_DIRECTORY;
assert(modelDirectory, 'Set REPLOID_COMPARISON_MODEL_DIRECTORY to already-provisioned weights');
const profile = JSON.parse(await fs.readFile(new URL('../../../self/config/work-profile.json', import.meta.url)));
assert.equal(digest(model.generation ?? profile.generation), contract.generationHash, 'Generation settings changed');
const paths = ['node_modules/doppler-gpu/package.json', 'package-lock.json', 'self/config/doppler-package.json',
  'self/config/work-profile.json', 'server/native-whole-model.js', 'server/native-participant.js',
  'self/providers/work-resident-provider.js', 'self/infrastructure/doppler-runtime-service.js',
  'packages/reploid/src/retrieval/sources.js', 'tests/answer-regression/node/fixed-document-comparison.js',
  'tests/answer-regression/node/fixed-document-run.js'];
const files = {};
for (const path of paths) files[path] = digest(await fs.readFile(new URL(`../../../${path}`, import.meta.url), 'utf8'));
assert.deepEqual(files, contract.files, 'Frozen executable/configuration identities changed');
await fs.mkdir(resolve(destination)); // Existing evidence must never be overwritten.
const output = resolve(destination, 'receipt.json');
const save = async receipt => {
  const temp = resolve(destination, 'receipt.pending');
  await fs.writeFile(temp, JSON.stringify(receipt, null, 2) + '\n');
  await fs.rename(temp, output);
};
const identity = { model, generation: model.generation ?? profile.generation, files,
  node: process.version, platform: process.platform, architecture: process.arch };
const gpu = createNativeGpuHost(() => import('webgpu'));
const owner = createNativeWholeModel({ model, modelDirectory, nativeGpu: () => gpu.open() });
let receipt = { contract, identity, rows: [], completed: false, qualified: false };
await save(receipt);
try {
  await owner.contribute(true);
  receipt = await compareDocuments({ contract, policy, identity, save: async value => {
    receipt = value; await save(value);
  }, generate: (messages, controls) => owner.generate(messages, () => {}, controls) });
} catch (error) {
  receipt.error = { name: error.name, message: error.message }; process.exitCode = 1;
} finally {
  const settled = await Promise.allSettled([owner.close()]);
  settled.push(...await Promise.allSettled([gpu.close()]));
  receipt.cleanup = settled.every(row => row.status === 'fulfilled') ? 'settled' : 'failed';
  receipt.cleanupErrors = settled.filter(row => row.status === 'rejected').map(row => String(row.reason));
  if (receipt.cleanup !== 'settled' || !receipt.completed) process.exitCode = 1;
  await save(receipt);
}
console.log(JSON.stringify({ completed: receipt.completed, summary: receipt.summary, error: receipt.error,
  cleanup: receipt.cleanup, qualified: false }, null, 2));
