import { beforeEach, expect, it, vi } from 'vitest';

const ports = vi.hoisted(() => ({
  signedFactory: vi.fn(), openCapsule: vi.fn(), release: vi.fn(), budget: vi.fn(), plan: vi.fn(), hash: vi.fn(), factory: vi.fn(), resident: vi.fn(), memory: vi.fn(),
}));
vi.mock('../../self/config/doppler-local-models.js', () => ({
  DOPPLER_MODULE_URL: '../vendor/doppler/0.6.27/src/index.js',
  DOPPLER_PARTITIONS_MODULE_URL: '../vendor/doppler/0.6.27/src/partitions.js',
  DOPPLER_KERNEL_BASE_URL: '/vendor/doppler/0.6.27/src/gpu/kernels',
}));
vi.mock('../../self/vendor/doppler/0.6.27/src/partitions.js', () => ({
  createResidentPartitionFactory: ports.signedFactory, configureDeviceMemoryBudget: ports.budget, createLayerPartitionPlan: ports.plan,
  hashLayerPartitionPlan: ports.hash, createManifestResidentPartitionFactory: ports.factory,
  inspectDeviceMemory: ports.memory,
}));
vi.mock('../../self/host/work-partition-capsule.js', () => ({ assertWorkResidentCapsule: async () => {} }));
vi.mock('../../self/vendor/doppler/0.6.27/src/index.js', () => ({ openCapsule: ports.openCapsule }));
vi.mock('../../self/pool/pack-release-policy.js', () => ({ prepareLocalPackRelease: ports.release }));
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


const signed = () => ({ ...selected, capsule: { schema: 'doppler.capsule/v3' },
  packOpenOptions: { acceptedTargetPlanDigests: ['plan'] }, executablePack: { schema: 'doppler.capsule/v3' } });
function signedPorts() {
  source.artifactStore = { readArtifact: vi.fn(), readArtifactRange: vi.fn() };
  const release = { options: { trustedSigners: { fixture: {} } }, assertCurrent: vi.fn().mockResolvedValue(), close: vi.fn() };
  const partition = { tokenize: vi.fn().mockResolvedValue([1]), executeGroup0: vi.fn(), executeGroup1: vi.fn(), closeAttempt: vi.fn() };
  const session = { residentPartition: partition, verification: { artifactVerificationScope: 'resident-pieces' }, close: vi.fn().mockResolvedValue() };
  ports.release.mockResolvedValue(release); ports.openCapsule.mockResolvedValue(session); ports.signedFactory.mockReturnValue({});
  return { release, partition, session };
}
it('uses signed opening only when explicitly configured and passes pinned custody without changing trust', async () => {
  const { release, session } = signedPorts();
  const result = await loadWorkPartition(files, signed(), 0, controls);
  expect(ports.factory).not.toHaveBeenCalled();
  const binding = ports.signedFactory.mock.calls[0][0];
  expect(binding.capsuleOptions).toEqual({ ...release.options, artifactStore: source.artifactStore });
  const opened = await binding.openCapsule(signed().capsule, binding.capsuleOptions);
  expect(release.assertCurrent).toHaveBeenCalledWith(session);
  expect(await opened.residentPartition.tokenize({})).toEqual([1]);
  expect(result.getReceipt()).toMatchObject({ openingMode: 'signed-capsule', capsuleVerification: session.verification });
  await opened.residentPartition.close();
  expect(session.close).toHaveBeenCalledOnce(); expect(source.storage.close).toHaveBeenCalledOnce(); expect(release.close).toHaveBeenCalledOnce();
});
it('never falls back to manifest execution for incomplete signed configuration', async () => {
  await expect(loadWorkPartition(files, signed(), 0, controls)).rejects.toThrow('Signed resident requires');
  expect(ports.factory).not.toHaveBeenCalled(); expect(source.storage.close).toHaveBeenCalledOnce();
});
it('rejects changed release authorization before resident computation', async () => {
  const { release, partition } = signedPorts();
  await loadWorkPartition(files, signed(), 0, controls);
  const binding = ports.signedFactory.mock.calls[0][0], opened = await binding.openCapsule(signed().capsule, {});
  release.assertCurrent.mockRejectedValue(new Error('release checkpoint changed'));
  await expect(opened.residentPartition.executeGroup0({})).rejects.toThrow('checkpoint changed');
  expect(partition.executeGroup0).not.toHaveBeenCalled();
  await opened.residentPartition.close();
});
it('closes a signed session rejected by current release admission', async () => {
  const { release, session } = signedPorts();
  await loadWorkPartition(files, signed(), 0, controls);
  release.assertCurrent.mockRejectedValue(new Error('eligibility revoked'));
  await expect(ports.signedFactory.mock.calls[0][0].openCapsule(signed().capsule, {})).rejects.toThrow('revoked');
  expect(session.close).toHaveBeenCalledOnce();
});
it('settles signed source and release owners even when GPU session cleanup fails', async () => {
  const { release, session } = signedPorts();
  await loadWorkPartition(files, signed(), 0, controls);
  const opened = await ports.signedFactory.mock.calls[0][0].openCapsule(signed().capsule, {});
  session.close.mockRejectedValue(new Error('GPU cleanup failed'));
  source.storage.close.mockRejectedValue(new Error('storage cleanup failed'));
  await expect(opened.residentPartition.close()).rejects.toMatchObject({ name: 'AggregateError', errors: [
    expect.objectContaining({ message: 'GPU cleanup failed' }), expect.objectContaining({ message: 'storage cleanup failed' })] });
  expect(release.close).toHaveBeenCalledOnce();
});

it('preserves operation failure and post-operation revocation together', async () => {
  const { release, partition } = signedPorts();
  await loadWorkPartition(files, signed(), 0, controls);
  const opened = await ports.signedFactory.mock.calls[0][0].openCapsule(signed().capsule, {});
  partition.executeGroup0.mockRejectedValue(new Error('device lost'));
  release.assertCurrent.mockResolvedValueOnce().mockRejectedValueOnce(new Error('grant revoked'));
  await expect(opened.residentPartition.executeGroup0({})).rejects.toMatchObject({ name: 'AggregateError', errors: [
    expect.objectContaining({ message: 'device lost' }), expect.objectContaining({ message: 'grant revoked' })] });
  await opened.residentPartition.close();
});
it('settles signed source and release exactly once after failed preparation cleanup', async () => {
  const { release } = signedPorts();
  resident.prepare.mockImplementation(async () => {
    const opened = await ports.signedFactory.mock.calls[0][0].openCapsule(signed().capsule, {});
    resident.close.mockImplementation(() => opened.residentPartition.close());
    throw new Error('consumer admission rejected');
  });
  await expect(loadWorkPartition(files, signed(), 0, controls)).rejects.toThrow('admission rejected');
  expect(source.storage.close).toHaveBeenCalledOnce(); expect(release.close).toHaveBeenCalledOnce();
});

it('concurrent signed close callers await the same settled cleanup', async () => {
  const { session } = signedPorts();
  await loadWorkPartition(files, signed(), 0, controls);
  const opened = await ports.signedFactory.mock.calls[0][0].openCapsule(signed().capsule, {});
  let settle;
  session.close.mockImplementation(() => new Promise(resolve => { settle = resolve; }));
  const first = opened.residentPartition.close(), second = opened.residentPartition.close();
  expect(second).toBe(first);
  expect(source.storage.close).not.toHaveBeenCalled();
  settle();
  await Promise.all([first, second]);
  expect(session.close).toHaveBeenCalledOnce();
  expect(source.storage.close).toHaveBeenCalledOnce();
});
