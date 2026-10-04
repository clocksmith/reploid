/** Compare complete captured runs without replacing the frozen acceptance reference. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const [referencePath, capturePath, output] = process.argv.slice(2);
assert(referencePath && capturePath && output, 'Usage: reference.json capture.json comparison.json');
const [referenceBytes, captureBytes] = await Promise.all([readFile(referencePath), readFile(capturePath)]);
const reference = JSON.parse(referenceBytes), capture = JSON.parse(captureBytes);
assert.equal(capture.modelIdentity, reference.modelIdentity);
assert.equal(capture.planId, reference.planId);
assert.deepEqual(capture.generation, reference.generation);
const expected = reference.runs ?? reference.expected;
assert.equal(capture.runs.length, expected.length, 'Every reference prompt must be captured');
const comparison = [];
for (const [prompt, run] of capture.runs.entries()) {
  assert.equal(run.prompt, prompt);
  const target = expected[prompt];
  assert.equal(run.steps.length, target.steps.length, 'Every reference step must be captured');
  for (const [index, step] of run.steps.entries()) {
    const targetStep = target.steps[index];
    assert.equal(step.step, reference.runs ? targetStep.step : index);
    const actual = Buffer.from(step.logits, 'base64'), wanted = Buffer.from(targetStep.logits, 'base64');
    assert.equal(actual.length, wanted.length);
    assert(actual.length > 0 && actual.length % 4 === 0);
    let maxDifference = 0;
    for (let offset = 0; offset < actual.length; offset += 4) {
      const a = actual.readFloatLE(offset), b = wanted.readFloatLE(offset);
      assert(Number.isFinite(a) && Number.isFinite(b), 'All logits must be finite');
      maxDifference = Math.max(maxDifference, Math.abs(a - b));
    }
    comparison.push({ prompt, step: step.step, maxDifference, matches: maxDifference <= 0.001,
      tokenMatches: step.tokenId === targetStep.tokenId, stoppingMatches: step.stopReason === targetStep.stopReason });
  }
}
const result = {
  scope: reference.runs ? 'Same-implementation diagnostic comparison; does not replace acceptance reference' : 'Frozen-reference comparison',
  referenceSha256: createHash('sha256').update(referenceBytes).digest('hex'),
  captureSha256: createHash('sha256').update(captureBytes).digest('hex'),
  tolerance: 0.001, observedSteps: comparison.length,
  failedSteps: comparison.filter(row => !row.matches).length,
  maxDifference: Math.max(...comparison.map(row => row.maxDifference)),
  tokensMatch: comparison.every(row => row.tokenMatches), stoppingMatches: comparison.every(row => row.stoppingMatches),
};
await writeFile(output, JSON.stringify({ ...result, comparison }, null, 2) + '\n');
console.log(JSON.stringify(result));
if (result.failedSteps || !result.tokensMatch || !result.stoppingMatches) process.exitCode = 1;
