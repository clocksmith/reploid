// Adapted from ../search-answer-control-20261018/source-grounding.mjs.
// One isolated native owner, fixed documents, paired baseline/candidate, no search.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildMessages, checkAnswer, summarize } from './checks.mjs';
import { createNativeGpuHost } from '../../server/native-participant.js';
import { createNativeWholeModel } from '../../server/native-whole-model.js';
import { createReploidDopplerRuntimeService } from '../../self/infrastructure/doppler-runtime-service.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(here, '../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const read = async name => JSON.parse(await fs.readFile(path.join(root, name), 'utf8'));
const contractBytes = await fs.readFile(path.join(here, 'contract.json'));
const contract = JSON.parse(contractBytes);
const output = path.join(here, 'receipt.json');
assert.equal(contract.schema, 'reploid.fixed-document-comparison/v1');
assert.equal(contract.maxGenerations, contract.cases.length * 2);
const catalog = await read('self/config/chat-models.json');
const model = catalog.find(item => item.id === contract.modelId);
assert.equal(model.identity, contract.modelIdentity);
const profile = await read('self/config/work-profile.json');
assert.deepEqual(model.generation || profile.generation, contract.generation);
assert.deepEqual(model.loadOptions || {}, contract.loadOptions);
assert.equal((await read('packages/reploid/src/retrieval/policy.json')).context.instructions, contract.baselineInstructions);
for (const item of contract.cases) assert.deepEqual(item.sources.map(sha), item.documentSha256);
assert.equal(`sha256:${sha(await fs.readFile(path.join(contract.modelDirectory, 'manifest.json')))}`, contract.modelIdentity);

const runtimeRoot = await fs.realpath(path.join(root, 'node_modules/doppler-gpu'));
async function inventory(directory, prefix = '') {
  const rows = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const name = path.posix.join(prefix, entry.name);
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) rows.push(...await inventory(full, name));
    else if (entry.isFile()) rows.push({ path: name, sha256: sha(await fs.readFile(full)) });
    else throw new Error(`Unrecorded runtime entry: ${name}`);
  }
  return rows;
}
const runtimeFiles = await inventory(runtimeRoot);
const runtimePackage = JSON.parse(await fs.readFile(path.join(runtimeRoot, 'package.json')));
const sourceFiles = ['server/native-whole-model.js', 'self/providers/work-resident-provider.js',
  'self/providers/work-provider.js', 'self/providers/work-generation-completion.js',
  'self/infrastructure/doppler-runtime-service.js',
  'self/config/chat-models.json', 'self/config/work-profile.json',
  'artifacts/source-answer-organization-20261019/run.mjs', 'artifacts/source-answer-organization-20261019/checks.mjs'];
const sourceIdentities = [];
for (const file of sourceFiles) sourceIdentities.push({ path: file, sha256: sha(await fs.readFile(path.join(root, file))) });
const receipt = { schema: 'reploid.fixed-document-comparison-result/v1', startedAt: new Date().toISOString(),
  source: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  contractSha256: sha(contractBytes), sourceIdentities,
  runtime: { name: runtimePackage.name, version: runtimePackage.version, root: runtimeRoot,
    inventorySha256: sha(JSON.stringify(runtimeFiles)), files: runtimeFiles.length },
  node: process.version, host: execFileSync('hostname', { encoding: 'utf8' }).trim(),
  rows: [], completed: false, cleanup: 'pending', productionChanged: false };
await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
await fs.writeFile(path.join(here, 'runtime-inventory.json'), JSON.stringify(runtimeFiles, null, 2) + '\n', { flag: 'wx' });
const save = async () => {
  await fs.writeFile(`${output}.tmp`, JSON.stringify(receipt, null, 2) + '\n');
  await fs.rename(`${output}.tmp`, output);
};
const gpu = createNativeGpuHost(() => import('webgpu'));
const service = createReploidDopplerRuntimeService({ loadModule: () => import('doppler-gpu/compat') });
const owner = createNativeWholeModel({ model, modelDirectory: contract.modelDirectory, nativeGpu: () => gpu.open(), service });
const totalDeadline = AbortSignal.timeout(contract.maxProcessMs);
try {
  await owner.contribute(true);
  receipt.prepared = owner.getState();
  await save();
  for (const [index, item] of contract.cases.entries()) {
    for (const arm of (index % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate'])) {
      totalDeadline.throwIfAborted();
      assert(receipt.rows.length < contract.maxGenerations);
      const messages = buildMessages(contract, item, arm);
      const started = performance.now();
      let firstOutputMs = null;
      const row = { id: item.id, arm, messages, inputSha256: sha(JSON.stringify(messages)) };
      try {
        row.result = await owner.generate(messages, () => { firstOutputMs ??= performance.now() - started; }, {
          signal: AbortSignal.any([totalDeadline, AbortSignal.timeout(contract.perRequestTimeoutMs)]),
          adapterIdentities: [], maxOutputTokens: contract.maxOutputTokens });
        row.checks = checkAnswer(item, row.result);
      } catch (error) {
        row.error = { name: error.name, message: error.message };
      }
      row.elapsedMs = performance.now() - started;
      row.firstUpdateMs = firstOutputMs;
      receipt.rows.push(row);
      receipt.summary = summarize(contract, receipt.rows);
      await save();
      console.log(JSON.stringify({ id: row.id, arm, content: row.result?.content, checks: row.checks, error: row.error }));
      // A failed native session is not silently replaced or retried.
      if (row.error) throw new Error(`Execution failed for ${item.id}/${arm}: ${row.error.message}`);
    }
  }
  receipt.completed = true;
  const { baseline, candidate } = receipt.summary;
  receipt.mechanicalGatePassed = candidate.completeChecksPassed === contract.cases.length
    && candidate.completeChecksPassed > baseline.completeChecksPassed;
  receipt.accepted = false; // Manual support review and fresh confirmation are separate gates.
} catch (error) {
  receipt.error = { message: error.message, stack: error.stack };
  process.exitCode = 1;
} finally {
  receipt.cleanupErrors = [];
  try { await owner.close(); } catch (error) { receipt.cleanupErrors.push(error.message); }
  try { await gpu.close(); } catch (error) { receipt.cleanupErrors.push(error.message); }
  receipt.cleanup = receipt.cleanupErrors.length ? 'failed' : 'settled';
  receipt.finishedAt = new Date().toISOString();
  await save();
}
