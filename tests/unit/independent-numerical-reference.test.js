// @vitest-environment node
import { it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { assembleIndependentReference, decodeReferenceLogits } from '../fixtures/independent-numerical-reference.js';

const encode = values => Buffer.from(values.buffer).toString('base64');
function fixture(change = () => {}) {
  const files = new Map();
  const put = (path, value) => {
    const bytes = gzipSync(JSON.stringify(value)); files.set(path, bytes);
    return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  const historical = { prompts: ['frozen'], expected: [{ steps: [
    { tokenId: 0, stopReason: null, logits: encode(new Float32Array([1, 0])) }
  ] }] };
  const contract = put('contract', { steps: [0] });
  const proposal = put('proposal', { tolerance: 0.001, toolSha256: 'independent-evaluator', contracts: [contract] });
  const report = { tolerance: 0.001, toolSha256: 'independent-evaluator', contractSha256: contract.sha256,
    results: [{ index: 0, step: 0, greedyToken: 0, logitsF64: encode(new Float64Array([1 + 1e-10, 0])) }] };
  change(report);
  const shard = put('shard', report);
  const index = put('index', { shards: [{ ...shard, index: 0, steps: report.results.map(row => row.step) }] });
  return { historical, authority: { kind: 'independent-f64', approved: true, proposal, index }, files };
}
const assemble = f => assembleIndependentReference(f.historical, f.authority, async path => f.files.get(path));

it('preserves independent F64 values, frozen inputs and the original failed capture', async () => {
  const f = fixture(); const original = structuredClone(f.historical);
  const result = await assemble(f);
  expect(decodeReferenceLogits(result.expected[0].steps[0])[0]).toBe(1 + 1e-10);
  expect(result.prompts).toEqual(original.prompts);
  expect(f.historical).toEqual(original);
  expect(result.numericalReference.steps).toBe(1);
});
it('rejects unapproved or changed reference bytes', async () => {
  const f = fixture(); f.authority.approved = false;
  await expect(assemble(f)).rejects.toThrow('approval');
  f.authority.approved = true; f.files.set('shard', Buffer.from('changed'));
  await expect(assemble(f)).rejects.toThrow('identity differs');
});
it('rejects missing and duplicated steps instead of retaining historical scores', async () => {
  await expect(assemble(fixture(report => { report.results = []; }))).rejects.toThrow('Missing');
  await expect(assemble(fixture(report => { report.results.push(report.results[0]); }))).rejects.toThrow('Duplicate');
});
it('rejects the wrong evaluator, shape, nonfinite target or continuation', async () => {
  for (const change of [
    report => { report.toolSha256 = 'runtime-capture'; },
    report => { report.results[0].logitsF64 = encode(new Float64Array([1])); },
    report => { report.results[0].logitsF64 = encode(new Float64Array([NaN, 0])); },
    report => { report.results[0].greedyToken = 1; }
  ]) await expect(assemble(fixture(change))).rejects.toThrow();
});
it('rejects invalid encodings and retains legacy F32 decoding for historical investigations', () => {
  expect(Array.from(decodeReferenceLogits({ logits: encode(new Float32Array([0.25])) }))).toEqual([0.25]);
  expect(() => decodeReferenceLogits({ logits: 'AA==', logitsDtype: 'f64' })).toThrow('Truncated');
  expect(() => decodeReferenceLogits({ logits: '', logitsDtype: 'f16' })).toThrow('precision');
});
