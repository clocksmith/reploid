/** Assemble approved independent scores; historical data supplies only frozen inputs and stopping. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export function decodeReferenceLogits(step) {
  const bytes = Buffer.from(step.logits, 'base64');
  const dtype = step.logitsDtype ?? 'f32';
  assert(['f32', 'f64'].includes(dtype), 'Unknown reference precision');
  assert.equal(bytes.length % (dtype === 'f64' ? 8 : 4), 0, 'Truncated reference logits');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const values = dtype === 'f64' ? new Float64Array(buffer) : new Float32Array(buffer);
  assert(values.length > 0 && values.every(Number.isFinite), 'Nonfinite or empty reference logits');
  return values;
}

export async function assembleIndependentReference(historical, authority, readArtifact) {
  assert.equal(authority.kind, 'independent-f64');
  assert.equal(authority.approved, true, 'Independent reference needs explicit approval');
  const readBound = async entry => {
    const bytes = await readArtifact(entry.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), entry.sha256, `Reference identity differs: ${entry.path}`);
    return JSON.parse(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes);
  };
  const proposal = await readBound(authority.proposal);
  const index = await readBound(authority.index);
  assert.equal(proposal.tolerance, 0.001);
  assert.equal(proposal.contracts.length, historical.expected.length);
  const contracts = await Promise.all(proposal.contracts.map(readBound));
  const reference = structuredClone(historical);
  const seen = new Set();
  for (const shard of index.shards) {
    const report = await readBound(shard);
    const contract = contracts[shard.index];
    assert(contract, 'Unexpected reference request');
    assert.equal(report.toolSha256, proposal.toolSha256);
    assert.equal(report.contractSha256, proposal.contracts[shard.index].sha256);
    assert.equal(report.tolerance, 0.001);
    assert.deepEqual(report.results.map(row => row.step), shard.steps);
    for (const row of report.results) {
      assert.equal(row.index, shard.index);
      assert(contract.steps.includes(row.step), 'Undeclared reference step');
      const key = `${row.index}:${row.step}`;
      assert(!seen.has(key), 'Duplicate independent reference step');
      seen.add(key);
      const target = reference.expected[row.index]?.steps[row.step];
      assert(target, 'Unexpected independent reference step');
      const oldLength = decodeReferenceLogits(target).length;
      target.logits = row.logitsF64;
      target.logitsDtype = 'f64';
      assert.equal(decodeReferenceLogits(target).length, oldLength, 'Vocabulary shape differs');
      assert.equal(row.greedyToken, target.tokenId, 'Frozen continuation differs from independent greedy token');
    }
  }
  for (const [request, expected] of reference.expected.entries()) {
    assert.deepEqual(contracts[request].steps, expected.steps.map((_, step) => step));
    for (const step of contracts[request].steps) assert(seen.has(`${request}:${step}`), 'Missing independent reference step');
  }
  reference.numericalReference = { kind: authority.kind, proposalSha256: authority.proposal.sha256,
    outputIndexSha256: authority.index.sha256, evaluatorSha256: proposal.toolSha256,
    tolerance: 0.001, steps: seen.size };
  return reference;
}
