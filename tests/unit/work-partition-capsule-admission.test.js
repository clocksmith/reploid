import { beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { assertWorkResidentCapsule } from '../../self/host/work-partition-capsule.js';
import { hashDopplerEvidence } from '../../self/pool/executable-pack.js';
vi.stubGlobal('crypto', webcrypto);
const digest = value => 'sha256:' + value.repeat(64);
let model, session;
beforeEach(async () => {
  const artifacts = [
    { artifactId: 'manifest', role: 'manifest', path: 'manifest.json', hash: digest('a'), sizeBytes: 1 },
    { artifactId: 'pieces', role: 'piece-index', path: 'pieces.json', hash: digest('b'), sizeBytes: 2 },
    { artifactId: 'weights', role: 'weight-shard', path: 'weights.bin', hash: digest('c'), sizeBytes: 4 }];
  const identity = { schema: 'doppler.capsule/v3', capsuleId: 'fixture', semanticRoot: digest('d'),
    envelopeDigest: digest('e'), artifactClosureDigest: await hashDopplerEvidence(artifacts) };
  model = { id: 'model', identity: digest('a'), executablePack: { ...identity, artifacts,
    requiredOperation: 'residentPartition', acceptedTargetPlanDigests: [digest('f')] } };
  session = { schema: 'doppler.capsule-session/v1', loaded: true, residentPartition: {},
    capsuleIdentity: identity, selectedTargetPlanDigest: digest('f'), manifestHash: model.identity,
    verification: { capsule: { schema: identity.schema, modelId: model.id,
      program: { pieceIndexArtifactId: 'pieces', weightArtifactIds: ['weights'] } },
      lifecycle: { authorization: { mode: 'managed' } },
      artifactVerificationScope: 'resident-pieces',
      artifactReceipts: artifacts.slice(0, 2).map(({ artifactId, hash, sizeBytes }) => ({ artifactId, hash, sizeBytes })),
      pieceVerification: { mode: 'signed-piece-index', indexArtifactId: 'pieces', indexIdentity: digest('b'),
        manifestIdentity: model.identity, declaredWeightArtifactIds: ['weights'], ranges: [] } } };
});
it('accepts exact synthetic resident metadata without inventing a full-weight receipt', async () => {
  await expect(assertWorkResidentCapsule(model, session)).resolves.toBeUndefined();
});
it.each(['schema', 'capsuleId', 'semanticRoot', 'envelopeDigest', 'artifactClosureDigest'])('rejects changed %s before resident computation', async field => {
  session.capsuleIdentity[field] = 'wrong';
  await expect(assertWorkResidentCapsule(model, session)).rejects.toThrow('identity');
});
it('rejects legacy descriptor selection for a managed Capsule session', async () => {
  model.executablePack.schema = 'doppler.capsule/v2';
  await expect(assertWorkResidentCapsule(model, session)).rejects.toThrow('identity');
});
it.each(['model', 'manifest', 'target', 'retained', 'scope', 'index', 'receipts', 'weights', 'operation', 'closure'])('rejects changed %s admission', async boundary => {
  if (boundary === 'model') session.verification.capsule.modelId = 'other';
  if (boundary === 'manifest') session.manifestHash = digest('0');
  if (boundary === 'target') session.selectedTargetPlanDigest = digest('0');
  if (boundary === 'retained') session.verification.lifecycle.authorization.mode = 'retained-local';
  if (boundary === 'scope') delete session.verification.artifactVerificationScope;
  if (boundary === 'index') session.verification.pieceVerification.indexIdentity = digest('0');
  if (boundary === 'receipts') session.verification.artifactReceipts.pop();
  if (boundary === 'weights') session.verification.pieceVerification.declaredWeightArtifactIds = [];
  if (boundary === 'operation') model.executablePack.requiredOperation = 'generate';
  if (boundary === 'closure') model.executablePack.artifacts[0].sizeBytes++;
  await expect(assertWorkResidentCapsule(model, session)).rejects.toThrow();
});
