import { beforeEach, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({
  budget: vi.fn(), plan: vi.fn(), hash: vi.fn(), factory: vi.fn(), resident: vi.fn(), memory: vi.fn(),
}));
vi.mock('../../self/config/doppler-local-models.js', () => ({
  DOPPLER_PARTITIONS_MODULE_URL: '../vendor/doppler/0.6.27/src/partitions.js',
  DOPPLER_KERNEL_BASE_URL: '/vendor/doppler/0.6.27/src/gpu/kernels',
}));
vi.mock('../../self/vendor/doppler/0.6.27/src/partitions.js', () => ({
  configureDeviceMemoryBudget: ports.budget, createLayerPartitionPlan: ports.plan,
  hashLayerPartitionPlan: ports.hash, createManifestResidentPartitionFactory: ports.factory,
  inspectDeviceMemory: ports.memory,
}));
vi.mock('../../self/vendor/reploid/mesh/index.js', () => ({ createResidentPartition: ports.resident }));
import { loadWorkPartition } from '../../self/host/work-partitions.js';

let files, source, resident, controls;
const selected = { id: 'fixture', identity: 'sha256:' + 'a'.repeat(64), partitionSplitLayer: 2 };
beforeEach(() => {
  vi.resetAllMocks();
  source = { manifest: { modelId: 'fixture', architecture: {},
    inference: { session: { compute: { defaults: { activationDtype: 'f32' } } } } },
  storage: { close: vi.fn().mockResolvedValue() }, getReceipt: () => ({ verifiedBytes: 16 }) };
  resident = { prepare: vi.fn().mockResolvedValue(), close: vi.fn().mockResolvedValue() };
  files = { preparePartitionSource: vi.fn().mockResolvedValue(source) };
  controls = { participantId: 'contributor', signal: new AbortController().signal };
  ports.plan.mockReturnValue({ partitions: [] }); ports.hash.mockReturnValue('plan');
  ports.factory.mockReturnValue({}); ports.resident.mockReturnValue(resident);
  ports.memory.mockReturnValue({ allocatedBytes: 16 });
});

it.each(['plan', 'hash', 'factory', 'resident'])('closes acquired storage when %s setup rejects', async boundary => {
  const failure = new Error(`${boundary} rejected`);
  ports[boundary].mockImplementation(() => { throw failure; });
  await expect(loadWorkPartition(files, selected, 0, controls)).rejects.toBe(failure);
  expect(source.storage.close).toHaveBeenCalledOnce();
  expect(resident.prepare).not.toHaveBeenCalled();
});

it('settles storage even when resident cleanup fails and retains both failures', async () => {
  const failed = new Error('opening rejected'), cleanup = new Error('resident cleanup rejected');
  resident.prepare.mockRejectedValue(failed); resident.close.mockRejectedValue(cleanup);
  await expect(loadWorkPartition(files, selected, 0, controls)).rejects.toMatchObject({
    name: 'AggregateError', errors: [failed, cleanup],
  });
  expect(source.storage.close).toHaveBeenCalledOnce();
});

it('retains storage cleanup failure alongside the original opening failure', async () => {
  const failed = new Error('plan rejected'), cleanup = new Error('storage cleanup rejected');
  ports.plan.mockImplementation(() => { throw failed; }); source.storage.close.mockRejectedValue(cleanup);
  await expect(loadWorkPartition(files, selected, 0, controls)).rejects.toMatchObject({
    name: 'AggregateError', errors: [failed, cleanup],
  });
});

it('honors cancellation after source acquisition before opening a resident', async () => {
  const controller = new AbortController(), reason = new Error('contribution stopped');
  controls.signal = controller.signal;
  files.preparePartitionSource.mockImplementation(async () => { controller.abort(reason); return source; });
  await expect(loadWorkPartition(files, selected, 0, controls)).rejects.toBe(reason);
  expect(ports.resident).not.toHaveBeenCalled();
  expect(source.storage.close).toHaveBeenCalledOnce();
});

it('transfers successful storage ownership to the resident factory', async () => {
  const result = await loadWorkPartition(files, selected, 0, controls);
  expect(result.resident).toBe(resident);
  expect(await ports.factory.mock.calls[0][0].createStorage()).toBe(source.storage);
  expect(source.storage.close).not.toHaveBeenCalled();
  expect(result.getReceipt()).toMatchObject({ verifiedBytes: 16, memory: { allocatedBytes: 16 } });
});
