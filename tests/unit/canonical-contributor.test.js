// @vitest-environment node
// Host wiring only: preparation and provider contracts injected, no inference.
import { beforeEach, expect, it, vi } from 'vitest';
const ports = vi.hoisted(() => ({ generation: vi.fn(), digest: vi.fn(), resident: vi.fn(), signer: vi.fn(), budget: vi.fn() }));
vi.mock('../../self/config/doppler-local-models.js', async original => ({ ...await original(), DOPPLER_MODULE_URL: '../unused.js',
  DOPPLER_PARTITIONS_MODULE_URL: '../vendor/doppler/0.6.27/src/partitions.js', DOPPLER_KERNEL_BASE_URL: '/unused' }));
vi.mock('../../self/vendor/doppler/0.6.27/src/partitions.js', () => ({ canonicalGenerationIdentity: ports.generation,
  metadataDigest: ports.digest, configureDeviceMemoryBudget: ports.budget,
  createLayerPartitionPlan: () => ({ vocabSize: 100 }), hashLayerPartitionPlan: () => 'plan',
  createManifestResidentPartitionFactory: value => value, inspectDeviceMemory: () => ({}) }));
vi.mock('../../self/vendor/reploid/mesh/index.js', () => ({ createResidentPartition: ports.resident,
  createPartitionStageCommitAuthority: ports.signer }));
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
