import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

assert([4, 5].includes(process.argv.length),
  'Usage: node verify.js <original-archive-extraction> <linux-archive-extraction> [source-archive-extraction]');
const originalRoot = resolve(process.argv[2]);
const linuxRoot = resolve(process.argv[3]);
const digest = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
async function pinned(root, path, expected) {
  const bytes = await readFile(resolve(root, path));
  assert.equal(digest(bytes), expected, path);
  return JSON.parse(bytes);
}
const apple = await pinned(originalRoot,
  'reploid-useful-specialization-20260907/answers-03/execution.json',
  'sha256:5992b11cdcff073f9d90e6bebc916765bb2bde2d5883dff0dca4face9dcab5d5');
const linux = await pinned(linuxRoot, 'answers-linux-01/execution.json',
  'sha256:ece0d5eab6481d09a0ab1f4a4aa2f86e7041a60353877b4f05d8e2757c4d2cd5');
assert.equal(linux.executionPassed, true);
assert.equal(linux.semanticSupportQualified, false);
assert.equal(linux.execution.gpu.vendor, 'intel');
assert.equal(linux.execution.gpu.fallback, false);
assert.equal(linux.capsuleBytesDigest, apple.capsuleBytesDigest);
assert.equal(linux.corpusDigest, apple.corpusDigest);
assert.deepEqual(linux.corpus, apple.corpus);
assert.deepEqual(linux.runtime, apple.runtime);
assert.equal(linux.cases.length, 8);
assert.deepEqual(linux.cases.map(row => row.id), apple.cases.map(row => row.id));
for (const [index, row] of linux.cases.entries()) {
  const control = apple.cases[index];
  assert.equal(row.error, undefined, row.id);
  assert.deepEqual(row.input, control.input, row.id);
  assert.deepEqual(row.options, control.options, row.id);
  assert.deepEqual(row.tokenIds, control.tokenIds, row.id);
  assert.equal(row.output, control.output, row.id);
  assert.equal(row.outputDigest, digest(row.output), row.id);
  assert.equal(row.receipt.targetPlanDigest, control.receipt.targetPlanDigest, row.id);
  assert.deepEqual(row.receipt.capsule, control.receipt.capsule, row.id);
  assert.deepEqual(row.receipt.artifactReceipts, control.receipt.artifactReceipts, row.id);
}
for (const source of linux.servedSources) {
  const bytes = await readFile(resolve(linuxRoot, 'answers-linux-01/runtime', `.${source.path}`));
  assert.equal(bytes.length, source.sizeBytes, source.path);
  assert.equal(digest(bytes), source.digest, source.path);
}
assert.equal(linux.execution.state.metrics.modelLoads, 1);
assert.equal(linux.execution.state.metrics.modelReuses, 7);
assert.equal(linux.execution.state.metrics.completedOperations, 8);
assert.equal(linux.execution.state.metrics.failedOperations, 0);
assert.deepEqual(linux.cleanupErrors, []);
let sourceMatches = null;
if (process.argv[4]) {
  const sourceRoot = resolve(process.argv[4]);
  const source = await pinned(sourceRoot, 'source-reference-02/reference.json',
    'sha256:c58dae96937f926a0c20e0a0f3dbcfde8f5b057019c2782882becbf2980f9a25');
  const inputBytes = await readFile(resolve(sourceRoot, 'source-inputs.json'));
  assert.equal(digest(inputBytes), source.inputDigest);
  const inputs = JSON.parse(inputBytes);
  assert.equal(source.executionDigest, inputs.executionDigest);
  assert.equal(source.executionDigest,
    'sha256:ece0d5eab6481d09a0ab1f4a4aa2f86e7041a60353877b4f05d8e2757c4d2cd5');
  assert.equal(source.complete, true);
  assert.equal(source.semanticSupportQualified, false);
  assert.equal(source.tokenizationMatchedCases, 8);
  assert.equal(source.cases.length, 8);
  assert.equal(inputs.rows.length, 8);
  for (const [index, row] of source.cases.entries()) {
    const observed = linux.cases[index];
    const input = inputs.rows[index];
    assert.equal(row.id, observed.id);
    assert.equal(input.id, observed.id);
    assert.equal(input.prompt, observed.input.prompt);
    assert.deepEqual(row.promptTokenIds, input.tokenIds);
    assert.deepEqual(row.rawGeneratedTokenIds, observed.tokenIds);
    assert.equal(row.output, observed.output);
    assert.equal(row.exactTokens, true);
    assert.equal(row.exactText, true);
    assert.equal(row.boundaries.embeddings.finite, true);
    assert.equal(row.boundaries['layer0-input-norm'].finite, true);
  }
  sourceMatches = source.cases.length;
}
console.log(JSON.stringify({ reproducedCases: 8, exactTokensAndText: true,
  sourceMatches, modelLoads: 1, modelReuses: 7, semanticSupportQualified: false,
  independentOperatorQualification: false }));
