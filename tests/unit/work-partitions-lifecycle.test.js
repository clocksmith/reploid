// @vitest-environment node
// Both host adapters are exercised through injected ports; no DOM is required.
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('doppler-gpu/partitions', () => ({
  createResidentPartitionFactory: ports.signedFactory, configureDeviceMemoryBudget: ports.budget,
  createLayerPartitionPlan: ports.plan, hashLayerPartitionPlan: ports.hash,
  createManifestResidentPartitionFactory: ports.factory, inspectDeviceMemory: ports.memory,
}));
vi.mock('doppler-gpu', () => ({ openCapsule: ports.openCapsule }));
vi.mock('../../packages/reploid/src/mesh/index.js', async importOriginal => ({
  ...await importOriginal(), createResidentPartition: ports.resident,
}));
import { loadWorkPartition as loadBrowserPartition } from '../../self/host/work-partitions.js';
import { openNativePartition } from '../../server/native-participant.js';
import { createSignedResidentFactory } from '../../packages/reploid/src/mesh/partitions/signed-resident-factory.js';

it('requires a session cleanup owner before constructing a signed factory', () => {
  const createFactory = vi.fn();
  expect(() => createSignedResidentFactory({ createFactory })).toThrow('explicit session cleanup owner');
  expect(createFactory).not.toHaveBeenCalled();
});

describe.each(['browser', 'native'])('%s resident opening', host => {
const loadWorkPartition = (files, selected, index, controls) => host === 'browser'
  ? loadBrowserPartition(files, selected, index, controls)
  : openNativePartition({ files, model: selected, index, ...controls, modelDirectory: '/unused-model',
    releaseDirectory: '/unused-checkpoints', nativeGpu: async () => {} });

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

it.each([false, true])('preserves missing-supplier failure when tokenizer loader masks it (fallback=%s)', async fallback => {
  const missing = new Error('No authorized supplier offers the required tokenizer piece');
  const wrapped = new Error('Bundled tokenizer not found. Clear browser storage and re-download.');
  source.storage.loadTokenizerJson = vi.fn().mockRejectedValue(missing);
  resident.prepare.mockImplementation(async () => {
    const storage = await ports.factory.mock.calls[0][0].createStorage();
    await storage.loadTokenizerJson().catch(() => {});
    if (!fallback) throw wrapped;
  });
  await expect(loadWorkPartition(files, selected, 0, controls)).rejects.toMatchObject({ message: missing.message });
  expect(source.storage.close).toHaveBeenCalledOnce();
  expect(resident.close).toHaveBeenCalledOnce();
});

it('retains tokenizer acquisition and cleanup failures without claiming settlement', async () => {
  const missing = new Error('No authorized supplier offers the required tokenizer piece');
  const wrapped = new Error('Bundled tokenizer not found');
  const cleanup = new Error('Device cleanup failed');
  source.storage.loadTokenizerJson = vi.fn().mockRejectedValue(missing);
  resident.prepare.mockImplementation(async () => {
    const storage = await ports.factory.mock.calls[0][0].createStorage();
    await storage.loadTokenizerJson().catch(() => {});
    throw wrapped;
  });
  resident.close.mockRejectedValue(cleanup);
  const released = vi.fn(); controls.registerCleanup = vi.fn(() => released);
  await expect(loadWorkPartition(files, selected, 0, controls)).rejects.toMatchObject({
    name: 'AggregateError', errors: [expect.objectContaining({ cause: missing, errors: [missing, wrapped] }), cleanup],
  });
  expect(released).not.toHaveBeenCalled();
  expect(source.storage.close).toHaveBeenCalledOnce();
});

it('keeps unrelated execution failure when tokenizer acquisition succeeds', async () => {
  const failure = new Error('Execution device unavailable');
  const json = { vocabulary: 'fixture' };
  source.storage.loadTokenizerJson = vi.fn().mockResolvedValue(json);
  resident.prepare.mockImplementation(async () => {
    const storage = await ports.factory.mock.calls[0][0].createStorage();
    expect(await storage.loadTokenizerJson()).toBe(json);
    throw failure;
  });
  await expect(loadWorkPartition(files, selected, 0, controls)).rejects.toBe(failure);
  expect(source.storage.loadTokenizerJson).toHaveBeenCalledOnce();
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
  await expect(loadWorkPartition(files, signed(), 0, controls)).rejects.toThrow(/Signed (native )?resident requires/);
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
  const settled = vi.fn(); controls.registerCleanup = vi.fn(() => settled);
  resident.prepare.mockImplementation(async () => {
    const opened = await ports.signedFactory.mock.calls[0][0].openCapsule(signed().capsule, {});
    resident.close.mockImplementation(() => opened.residentPartition.close());
    throw new Error('consumer admission rejected');
  });
  await expect(loadWorkPartition(files, signed(), 0, controls)).rejects.toThrow('admission rejected');
  expect(source.storage.close).toHaveBeenCalledOnce(); expect(release.close).toHaveBeenCalledOnce();
  expect(settled).toHaveBeenCalledOnce();
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

it.each(['session', 'source', 'release'])('retries failed %s cleanup without reclosing settled owners', async failedOwner => {
  const { session, release } = signedPorts();
  await loadWorkPartition(files, signed(), 0, controls);
  const opened = await ports.signedFactory.mock.calls[0][0].openCapsule(signed().capsule, {});
  const owners = { session: session.close, source: source.storage.close, release: release.close };
  owners[failedOwner].mockRejectedValueOnce(new Error(`${failedOwner} cleanup failed`));
  const first = opened.residentPartition.close();
  expect(opened.residentPartition.close()).toBe(first);
  await expect(first).rejects.toThrow('cleanup failed');
  for (const owner of Object.values(owners)) expect(owner).toHaveBeenCalledOnce();
  await opened.residentPartition.close();
  for (const [name, owner] of Object.entries(owners)) expect(owner).toHaveBeenCalledTimes(name === failedOwner ? 2 : 1);
});

it('hands failed admission cleanup to the preparation owner until the unreturned session settles', async () => {
  const { session, release } = signedPorts();
  const settled = vi.fn(); controls.registerCleanup = vi.fn(() => settled);
  release.assertCurrent.mockRejectedValue(new Error('release revoked'));
  session.close.mockRejectedValue(new Error('device cleanup failed'));
  resident.prepare.mockImplementation(async () => {
    const binding = ports.signedFactory.mock.calls[0][0];
    await binding.openCapsule(signed().capsule, binding.capsuleOptions);
  });
  await expect(loadWorkPartition(files, signed(), 0, controls)).rejects.toThrow('cleanup failed');
  expect(controls.registerCleanup).toHaveBeenCalledOnce();
  const owner = controls.registerCleanup.mock.calls[0][0];
  await expect(owner.close()).rejects.toThrow('device cleanup failed');
  expect(settled).not.toHaveBeenCalled();
  session.close.mockResolvedValue();
  await owner.close();
  expect(settled).toHaveBeenCalledOnce();
  expect(session.close).toHaveBeenCalledTimes(4);
  expect(source.storage.close).toHaveBeenCalledOnce();
  expect(release.close).toHaveBeenCalledOnce();
});

it('passes explicit generation to admission and uses its context for owned cache allocation', async () => {
  const generation = { maxTokens: 16, maxSeqLen: 2048, temperature: 0.6, topK: 20, topP: 0.95,
    repetitionPenalty: 1, repetitionPenaltyWindow: 0, useChatTemplate: true, seed: 37 };
  const result = await loadWorkPartition(files, { ...selected, generation }, 0, controls);
  expect(result.model.generation).toMatchObject(generation);
  expect(ports.resident.mock.calls[0][0].model.generation).toEqual(result.model.generation);
  expect(ports.factory.mock.calls[0][0].runtimeConfig.inference.session.kvcache.maxSeqLen).toBe(2048);
});
it('rejects unsupported explicit generation before acquiring model files or GPU resources', async () => {
  await expect(loadWorkPartition(files, { ...selected, generation: { temperature: 0.6 } }, 0, controls)).rejects.toThrow();
  expect(ports.budget).not.toHaveBeenCalled(); expect(files.preparePartitionSource).not.toHaveBeenCalled();
});

});
