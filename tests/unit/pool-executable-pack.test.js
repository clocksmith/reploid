import { describe, expect, it } from 'vitest';
import { assertPackReceipt, assertPackSession, hashDopplerEvidence, validateExecutablePack, executablePacksMatch } from '../../self/pool/executable-pack.js';
import { exactModelContractKey, LAUNCH_MODEL, validateProviderModelContract } from '../../self/pool/model-contract.js';

const digest = (digit) => `sha256:${digit.repeat(64)}`;
const fixture = async () => {
  const artifacts = [{ artifactId: 'manifest', role: 'manifest', path: 'manifest.json', hash: digest('a'), sizeBytes: 10 }];
  const binding = { schema: 'doppler.pack/v3', packId: 'test-pack', semanticRoot: digest('b'), envelopeDigest: digest('c'), artifactClosureDigest: await hashDopplerEvidence(artifacts), requiredOperation: 'encodeSequence', acceptedTargetPlanDigests: [digest('d')], artifacts };
  const { requiredOperation, acceptedTargetPlanDigests, artifacts: ignored, ...pack } = binding;
  const assignment = { assignmentId: 'job-a' };
  const options = { assignment, includeTokenEmbeddings: false, includeLogits: false };
  const result = { pooledEmbedding: new Float32Array([1, 2]) };
  const payload = { schema: 'doppler.pack-execution-receipt/v1', operation: 'encodeSequence', pack, targetId: 'target', targetPlanDigest: digest('d'), artifactReceipts: artifacts.map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })), releaseEventDigest: digest('e'), assignmentHash: await hashDopplerEvidence(assignment), inputHash: await hashDopplerEvidence({ sequence: 'MKT', options }), outputHash: await hashDopplerEvidence(result) };
  return { binding, assignment, options, result, receipt: { ...payload, receiptDigest: await hashDopplerEvidence(payload) } };
};

describe('Poolday signed executable Pack boundary', () => {
  it('binds exact Pack identity, full artifact closure, plan, assignment, inputs and outputs', async () => {
    const f = await fixture();
    expect(validateExecutablePack(f.binding).ok).toBe(true);
    await assertPackReceipt(f.binding, f.receipt, { assignment: f.assignment, sequence: 'MKT', options: f.options, result: f.result });
    await assertPackSession(f.binding, { schema: 'doppler.pack-session/v1', loaded: true, encodeSequence() {}, packIdentity: f.receipt.pack, selectedTargetPlanDigest: f.receipt.targetPlanDigest, verification: { artifactReceipts: f.receipt.artifactReceipts } });
    for (const field of ['semanticRoot', 'envelopeDigest', 'artifactClosureDigest']) {
      await expect(assertPackReceipt({ ...f.binding, [field]: digest('f') }, f.receipt)).rejects.toThrow();
    }
    await expect(assertPackReceipt(f.binding, { ...f.receipt, artifactReceipts: [] })).rejects.toThrow('close');
    await expect(assertPackReceipt(f.binding, { ...f.receipt, targetPlanDigest: digest('f') })).rejects.toThrow('TargetPlan');
    await expect(assertPackReceipt(f.binding, f.receipt, { assignment: { assignmentId: 'other' } })).rejects.toThrow('assignment');
    await expect(assertPackReceipt(f.binding, f.receipt, { result: { pooledEmbedding: [2, 1] } })).rejects.toThrow('output');
    await expect(assertPackReceipt(f.binding, f.receipt, { sequence: 'MTK', options: f.options })).rejects.toThrow('input');
    await expect(assertPackSession(f.binding, { schema: 'doppler.scoped-session/v1', loaded: true })).rejects.toThrow('public Pack session');
  });

  it('changes exact compatibility and does not self-admit an unqualified catalog override', async () => {
    const { binding } = await fixture();
    expect(executablePacksMatch(binding, { ...binding, envelopeDigest: digest('f') })).toBe(false);
    expect(exactModelContractKey({ ...LAUNCH_MODEL, executablePack: binding })).not.toBe(exactModelContractKey(LAUNCH_MODEL));
    expect(validateProviderModelContract({ ...LAUNCH_MODEL, executablePack: binding }).ok).toBe(false);
    expect(validateProviderModelContract({ ...LAUNCH_MODEL, modelSplit: { layers: [1] } }).ok).toBe(false);
  });
});
