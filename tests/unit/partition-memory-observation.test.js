// @vitest-environment node
import { test, expect, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { preparePartitionMemory } from '../fixtures/prepare-partition-memory.js';

test.each([[false, false], [true, false], [false, true], [true, true]])('device loss profiler=%s ordered=%s remain observable', async (profileImmediate, ordered) => {
  const names = ['__nativePartitionFixture', '__DOPPLER_KERNEL_BASE_PATH__', 'gpuValidationErrors',
    'partitionDeviceEvents', 'partitionGpuSubmissions', 'resident', 'chunks', 'observePrefill', 'abortOnSubmit', 'encodeBytes', 'memorySnapshot', 'settleMemory', 'rejectOversizedAllocation'];
  const prior = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const bytes = new TextEncoder().encode(JSON.stringify({ modelId: 'test', architecture: {},
    inference: { session: { compute: { defaults: { activationDtype: 'f32' } } } } }));
  const identity = 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const submitted = [], dispatched = [];
  let infoResult = Promise.resolve({ messages: [] });
  let pipelineResult = Promise.resolve({});
  const shaderModule = { getCompilationInfo: () => infoResult };
  const originalFailure = new Error('provider preparation failure');
  let lose, lost = false;
  const device = { lost: new Promise(resolve => { lose = resolve; }), addEventListener() {},
    queue: { submit: buffers => submitted.push(buffers), onSubmittedWorkDone: async () => { if (lost) throw Error('queue lost'); } },
    createShaderModule(descriptor) { if (descriptor.label === 'reject-module') throw originalFailure; return shaderModule; },
    createBindGroup: () => ({}),
    createComputePipeline(descriptor) { if (descriptor.label === 'reject-sync-pipeline') throw originalFailure; return {}; },
    createComputePipelineAsync: () => pipelineResult,
    createCommandEncoder: () => ({ beginComputePass: () => ({ setPipeline() {}, setBindGroup() {},
      dispatchWorkgroups: (...args) => dispatched.push(args), dispatchWorkgroupsIndirect() {} }), finish: () => ({}) }) }; 
  let acceptedAllocation;
  const runtime = { validateOrderedLayerPartitionPlan: vi.fn(), createLayerPartitionPlan: () => ({}), hashLayerPartitionPlan: () => 'test-plan',
    configureDeviceMemoryBudget: async () => {}, inspectDeviceMemory: () => ({ liveBytes: 12 }),
    createManifestResidentPartitionFactory: vi.fn(() => ({ openResidentPartition: async allocation => { acceptedAllocation = allocation; return { getDescriptor: () => ({ ready: true }) }; } })) };
  const modules = { 'partitions.js': runtime,
    'device.js': { getDevice: () => lost ? null : device, getKernelCapabilities: () => ({}) },
    'buffer-pool.js': { getBufferPool: () => { if (lost) throw Error('pool lost');
      return { getStats: () => ({ activeBuffers: 0 }), getLabelStats: () => [] }; } },
    'artifact-storage-context.js': { createHttpArtifactStorageContext: () => ({}) } };
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('fetch', async () => ({ arrayBuffer: async () => bytes.buffer }));
  globalThis.__nativePartitionFixture = { importModule: async url => modules[url.split('/').at(-1)] };
  try {
    await preparePartitionMemory({ model: { identity, generation: { maxSeqLen: 32 } }, index: 0,
      modelSource: 'https://fixture/', config: { DOPPLER_PARTITIONS_MODULE_URL: 'https://fixture/src/partitions.js' },
      policy: { maxGpuBufferBytes: 1420000000 }, profileImmediate,
      ...(ordered ? { orderedPlan: { schema: 'doppler.layer-partition-contract/v3', activationPrecision: 'two-f32' }, participantId: 'ordered-middle',
        pairedBinding: { manifestIdentity: identity, activation: { activationPrecision: 'two-f32' } } } : {}) });
    expect(acceptedAllocation.participantId).toBe(ordered ? 'ordered-middle' : 'memory-A');
    expect(runtime.validateOrderedLayerPartitionPlan).toHaveBeenCalledTimes(ordered ? 1 : 0);
    if (ordered) expect(acceptedAllocation.plan.schema).toBe('doppler.layer-partition-contract/v3');
    expect(runtime.createManifestResidentPartitionFactory.mock.calls[0][0].runtimeConfig.shared.debug.profiler.enabled).toBe(profileImmediate);
    const descriptor = { label: 'test pipeline', compute: { entryPoint: 'main', constants: { WIDTH: 8 } } };
    expect(device.createShaderModule({ label: 'test shader', code: 'source' })).toBe(shaderModule);
    expect(shaderModule.getCompilationInfo()).toBe(infoResult);
    await infoResult;
    expect(globalThis.memorySnapshot().pipelinePreparationEvents).toContainEqual(expect.objectContaining({
      operation: 'getCompilationInfo', status: 'completed', label: 'test shader' }));
    expect(() => device.createShaderModule({ label: 'reject-module', code: 'source' })).toThrow(originalFailure);
    expect(() => device.createComputePipeline({ ...descriptor, label: 'reject-sync-pipeline' })).toThrow(originalFailure);
    let finish;
    pipelineResult = new Promise(resolve => { finish = resolve; });
    const returned = device.createComputePipelineAsync(descriptor);
    expect(returned).toBe(pipelineResult);
    expect(globalThis.memorySnapshot().pendingPipelinePreparation).toEqual([
      expect.objectContaining({ operation: 'createComputePipelineAsync', status: 'started', entryPoint: 'main' })]);
    finish({});
    const pipeline = await returned;
    expect(globalThis.memorySnapshot().pendingPipelinePreparation).toEqual([]);
    pipelineResult = Promise.reject(originalFailure);
    const rejected = device.createComputePipelineAsync({ ...descriptor, label: 'rejected pipeline' });
    expect(rejected).toBe(pipelineResult);
    await expect(rejected).rejects.toBe(originalFailure);
    infoResult = Promise.reject(originalFailure);
    expect(shaderModule.getCompilationInfo()).toBe(infoResult);
    await expect(infoResult).rejects.toBe(originalFailure);
    for (const operation of ['createShaderModule', 'createComputePipeline', 'createComputePipelineAsync', 'getCompilationInfo']) {
      expect(globalThis.memorySnapshot().pipelinePreparationEvents).toContainEqual(expect.objectContaining({
        operation, status: 'rejected', message: originalFailure.message }));
    }
    expect(globalThis.memorySnapshot().pendingPipelinePreparation).toEqual([]);
    let finishPending;
    pipelineResult = new Promise(resolve => { finishPending = resolve; });
    const pending = device.createComputePipelineAsync({ ...descriptor, label: 'retained pending' });
    for (let index = 0; index < 70; index++) device.createComputePipeline({ ...descriptor, label: `bounded ${index}` });
    expect(globalThis.memorySnapshot().pipelinePreparationEvents).toHaveLength(128);
    expect(globalThis.memorySnapshot().pendingPipelinePreparation).toEqual([
      expect.objectContaining({ label: 'retained pending', status: 'started' })]);
    finishPending({}); await pending;
    Object.freeze(shaderModule);
    expect(device.createShaderModule({ label: 'readonly module', code: 'source' })).toBe(shaderModule);
    expect(globalThis.memorySnapshot().observationErrors).toContainEqual(expect.objectContaining({ operation: 'createShaderModule' }));
    const encoder = device.createCommandEncoder({ label: 'test encoder' });
    const group = device.createBindGroup({ entries: [{ binding: 0, resource: { buffer: { label: 'layer12.weight', size: 64 }, offset: 4, size: 32 } }] });
    const pass = encoder.beginComputePass(); pass.setPipeline(pipeline); pass.setBindGroup(0, group); pass.dispatchWorkgroups(3);
    const buffer = encoder.finish(); device.queue.submit((function* () { yield buffer; })());
    expect(submitted).toEqual([[buffer]]); expect(dispatched).toEqual([[3, undefined, undefined]]);
    expect(globalThis.memorySnapshot().submissions[0].commandBuffers[0]).toMatchObject({ label: 'test encoder',
      commands: [{ pipeline: { label: 'test pipeline', entryPoint: 'main', constants: { WIDTH: 8 } }, bindings: { 0: [{ binding: 0, bufferLabel: 'layer12.weight', bufferBytes: 64, offset: 4, size: 32 }] }, workgroups: [3, 1, 1] }] });
    expect(globalThis.memorySnapshot().pool.activeBuffers).toBe(0);
    lost = true; lose({ reason: 'unknown', message: 'actual device failure' }); await Promise.resolve();
    const snapshot = globalThis.memorySnapshot();
    expect(snapshot.device.liveBytes).toBe(12);
    expect(snapshot.pool).toBeNull();
    expect(snapshot.observationErrors).toContainEqual({ operation: 'pool', message: 'pool lost' });
    expect(snapshot.deviceEvents).toContainEqual(expect.objectContaining({ type: 'device-lost', message: 'actual device failure' }));
    await expect(globalThis.settleMemory()).rejects.toThrow('queue lost');
    expect(globalThis.memorySnapshot().deviceEvents).toContainEqual(expect.objectContaining({ type: 'queue-failed', message: 'queue lost' }));
  } finally {
    vi.unstubAllGlobals();
    for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});
