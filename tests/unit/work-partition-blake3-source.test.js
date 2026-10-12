import { expect, it } from 'vitest';
import { resolvePartitionArtifactSource } from '../../self/host/work-partition-artifact-source.js';

const digest = value => value.repeat(64);
function fixture() {
  const manifest = { hashAlgorithm: 'blake3', shards: [{ filename: 'weights.bin', size: 4, hash: digest('b') }] };
  const manifestArtifact = { artifactId: 'manifest', role: 'manifest', path: 'artifacts/model/manifest.json',
    hash: 'sha256:' + digest('a'), sizeBytes: 100 };
  const artifact = { artifactId: 'weights', role: 'weight-shard', path: 'artifacts/model/weights.bin',
    hash: 'sha256:' + digest('c'), sizeBytes: 4 };
  const model = { identity: manifestArtifact.hash, capsule: { program: { manifestArtifactId: 'manifest',
    weightArtifactIds: ['weights'] }, artifacts: [manifestArtifact, artifact] } };
  const file = { path: 'weights.bin', role: 'model-weights', sizeBytes: 4, hashAlgorithm: 'blake3', hash: digest('b') };
  return { manifest, artifact, model, file };
}
it('maps signed SHA256 artifacts to exact BLAKE3 source descriptors without comparing different digests', () => {
  const { model, manifest, artifact, file } = fixture();
  expect(resolvePartitionArtifactSource(model, manifest, [file], artifact)).toEqual(file);
  expect(resolvePartitionArtifactSource(model, manifest, [], artifact)).toEqual(file);
});
it.each(['changed artifact', 'changed source hash', 'changed size', 'wrong algorithm', 'undeclared weight', 'wrong role', 'unsigned'])
('rejects %s before selective acquisition', boundary => {
  const f = fixture(); let argument = f.artifact;
  if (boundary === 'changed artifact') argument = { ...argument, hash: 'sha256:' + digest('d') };
  if (boundary === 'changed source hash') f.file.hash = digest('d');
  if (boundary === 'changed size') f.file.sizeBytes++;
  if (boundary === 'wrong algorithm') f.file.hashAlgorithm = 'sha1';
  if (boundary === 'undeclared weight') f.model.capsule.program.weightArtifactIds = [];
  if (boundary === 'wrong role') f.artifact.role = 'tokenizer';
  if (boundary === 'unsigned') delete f.model.capsule;
  expect(() => resolvePartitionArtifactSource(f.model, f.manifest, [f.file], argument)).toThrow('pinned catalog');
});
