// @vitest-environment node
// Host wiring only: preparation and provider contracts injected, no inference.
import { beforeEach, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ generation: vi.fn(), digest: vi.fn(), resident: vi.fn(), signer: vi.fn(), budget: vi.fn() }));
vi.mock('../../self/config/doppler-local-models.js', async original => ({ ...await original(), DOPPLER_MODULE_URL: '../unused.js',
  DOPPLER_PARTITIONS_MODULE_URL: 'doppler-gpu/partitions', DOPPLER_KERNEL_BASE_URL: '/unused' }));
vi.mock('../../self/vendor/reploid/mesh/index.js', () => ({ createResidentPartition: ports.resident,
  createPartitionStageCommitAuthority: ports.signer }));
vi.mock('doppler-gpu/partitions', () => ({ canonicalGenerationIdentity: ports.generation,
  metadataDigest: ports.digest, configureDeviceMemoryBudget: ports.budget,
  createLayerPartitionPlan: () => ({ vocabSize: 100 }), hashLayerPartitionPlan: () => 'plan',
  createManifestResidentPartitionFactory: value => value, inspectDeviceMemory: () => ({}) }));
vi.mock('../../packages/reploid/src/mesh/index.js', async original => ({ ...await original(),
  createResidentPartition: ports.resident, createPartitionStageCommitAuthority: ports.signer }));
import { openNativePartition } from '../../server/native-participant.js';
import { loadWorkPartition } from '../../self/host/work-partitions.js';
let files, resident, signer;
const selected = { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64), partitionSplitLayer: 2,
  canonicalGeneration: { policy: { explicit: true }, executionIdentity: 'execution' } };
beforeEach(() => {
  vi.resetAllMocks(); ports.generation.mockReturnValue({ executionIdentity: 'execution' }); ports.digest.mockReturnValue('stage');
  signer = { close: vi.fn() }; ports.signer.mockReturnValue(signer);
  resident = { prepare: vi.fn(async () => {}), close: vi.fn(async () => {}) }; ports.resident.mockReturnValue(resident);
  files = { preparePartitionSource: vi.fn(async () => ({ manifest: { modelId: 'fixture', architecture: {},
    inference: { session: { compute: { defaults: { activationDtype: 'f32' } } } } }, storage: { close: vi.fn() }, getReceipt: () => ({}) })) };
});
it('binds explicit generation and signer to the actual participant, resident and plan', async () => {
  const canonical = { identity: { peerId: 'contributor' }, participantEpoch: '0'.repeat(32) };
  const result = await loadWorkPartition(files, selected, 1, { participantId: 'contributor', canonical });
  expect(ports.generation).toHaveBeenCalledWith(selected.canonicalGeneration.policy, 'execution', 100);
  const stage = ports.signer.mock.calls[0][0].stage;
  expect(stage).toMatchObject({ participantId: 'contributor', participantEpoch: canonical.participantEpoch,
    partitionIndex: 1, executionId: 'execution', stageId: 'stage' });
  expect(stage.deviceEpoch).toMatch(/^[a-f0-9]{32}$/); expect(stage.residentId).toBeTruthy();
  expect(ports.digest.mock.calls[0][1]).toMatchObject({ modelIdentity: selected.identity, planId: 'plan', partitionIndex: 1 });
  expect(ports.resident.mock.calls[0][0]).toMatchObject({ canonicalGeneration: selected.canonicalGeneration, canonicalCommitAuthority: signer });
  await result.resident.close(); expect(signer.close).toHaveBeenCalledOnce(); expect(resident.close).toHaveBeenCalledOnce();
});
it.each([
  { identity: { peerId: 'other' }, participantEpoch: '0'.repeat(32) },
  { identity: { peerId: 'contributor' }, participantEpoch: 'bad' }
])('rejects changed participant or invalid epoch before acquisition', async canonical => {
  await expect(loadWorkPartition(files, selected, 0, { participantId: 'contributor', canonical })).rejects.toThrow('provider capability');
  expect(files.preparePartitionSource).not.toHaveBeenCalled(); expect(ports.resident).not.toHaveBeenCalled();
});
it('settles the signer and source owner if preparation rejects', async () => {
  resident.prepare.mockRejectedValue(Error('opening failed'));
  await expect(loadWorkPartition(files, selected, 0, { participantId: 'contributor',
    canonical: { identity: { peerId: 'contributor' }, participantEpoch: '0'.repeat(32) } })).rejects.toThrow('opening failed');
  expect(signer.close).toHaveBeenCalledOnce(); expect(resident.close).toHaveBeenCalledOnce();
  expect((await files.preparePartitionSource.mock.results[0].value).storage.close).toHaveBeenCalledOnce();
});

async function nativeFixture() {
  let current = true;
  const epochs = { participantEpoch: '0'.repeat(32), assertCurrent() { if (!current) throw Error('epoch replaced'); },
    begin: vi.fn(), settle: vi.fn() };
  const canonical = { identity: { peerId: 'contributor' }, participantEpoch: epochs.participantEpoch, epochs };
  const result = await openNativePartition({ model: selected, modelDirectory: '/unused', files,
    nativeGpu: async () => {}, signal: new AbortController().signal, index: 0, participantId: 'contributor', canonical });
  return { result, epochs, replace() { current = false; } };
}
it('native records preparation ownership and fences dispatch after epoch replacement while permitting cleanup', async () => {
  resident.executeCanonicalGroup0 = vi.fn(async () => ({ activation: true }));
  resident.closeAttempt = vi.fn(async () => {});
  const f = await nativeFixture(); expect(f.epochs.begin).toHaveBeenCalledOnce();
  expect(await f.result.resident.executeCanonicalGroup0({})).toEqual({ activation: true });
  f.replace(); expect(() => f.result.resident.executeCanonicalGroup0({})).toThrow('epoch replaced');
  expect(resident.executeCanonicalGroup0).toHaveBeenCalledOnce();
  await f.result.resident.closeAttempt('attempt'); expect(resident.closeAttempt).toHaveBeenCalledWith('attempt');
  await f.result.resident.close(); expect(resident.close).toHaveBeenCalledOnce();
  expect(f.epochs.settle).toHaveBeenCalledWith(f.epochs.begin.mock.calls[0][0]);
});
it('native rejects a completed result if its process epoch changed while work was pending', async () => {
  let finish; resident.executeCanonicalGroup1 = vi.fn(() => new Promise(resolve => { finish = resolve; }));
  const f = await nativeFixture(), pending = f.result.resident.executeCanonicalGroup1({});
  f.replace(); finish({ mustNotPublish: true }); await expect(pending).rejects.toThrow('epoch replaced');
  await f.result.resident.close();
});
it('native keeps durable pending ownership if actual resident cleanup fails', async () => {
  resident.close.mockRejectedValueOnce(Error('GPU ownership unknown'));
  const f = await nativeFixture(); await expect(f.result.resident.close()).rejects.toThrow('GPU ownership unknown');
  expect(f.epochs.settle).not.toHaveBeenCalled();
  await f.result.resident.close(); expect(f.epochs.settle).toHaveBeenCalledOnce();
});
