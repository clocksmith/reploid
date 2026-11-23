// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readNativeModelConfiguration, catalogWholeRuntime } from '../../server/native-model-config.js';

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => fs.rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'native-model-'));
  directories.push(directory);
  const manifest = { modelId: 'explicit-model', architecture: { numLayers: 12, hiddenSize: 16, vocabSize: 128 } };
  const bytes = JSON.stringify(manifest);
  await fs.writeFile(path.join(directory, 'manifest.json'), bytes);
  const configuration = { schema: 'reploid.native-model/v1', model: {
    id: manifest.modelId, name: 'Explicit model', provider: 'doppler',
    identity: 'sha256:' + createHash('sha256').update(bytes).digest('hex'),
    executionModes: ['whole-model', 'partition'],
    generation: { maxTokens: 4, maxSeqLen: 64, temperature: 0, topK: 1, topP: 1,
      repetitionPenalty: 1, repetitionPenaltyWindow: 0, useChatTemplate: true },
    partitionRuntime: { maxGpuBufferBytes: [1024, 2048, 4096], runtimeConfig: { inference: {} } },
  }, partition: { splitLayers: [3, 8], activationDtype: 'f32', activationPrecision: 'f32' } };
  const file = path.join(directory, 'operator.json');
  const write = () => fs.writeFile(file, JSON.stringify(configuration));
  await write();
  const plan = { stageCount: 3, modelId: manifest.modelId };
  const runtime = { createOrderedLayerPartitionPlanFromManifest: vi.fn(() => plan),
    hashLayerPartitionPlan: vi.fn(() => 'sha256:' + 'a'.repeat(64)) };
  const loadRuntime = vi.fn(async () => runtime);
  const read = () => readNativeModelConfiguration(file, { modelId: manifest.modelId, modelDirectory: directory, loadRuntime });
  return { directory, file, configuration, manifest, plan, runtime, loadRuntime, write, read };
}
it('binds actual manifest bytes and delegates JSON geometry to Doppler before native startup', async () => {
  const f = await fixture();
  const model = await f.read();
  expect(f.runtime.createOrderedLayerPartitionPlanFromManifest).toHaveBeenCalledWith(f.manifest, f.configuration.partition);
  expect(model.partitionPlan).toEqual(f.plan);
  expect(model.partitionPlanId).toBe('sha256:' + 'a'.repeat(64));
  expect(model.partitionRuntime.maxGpuBufferBytes).toEqual([1024, 2048, 4096]);
  expect(f.configuration.model.partitionPlan).toBeUndefined();
});
it('prepares a three-stage plan through the installed ordinary Doppler package', async () => {
  const f = await fixture();
  const model = await readNativeModelConfiguration(f.file, { modelId: f.manifest.modelId, modelDirectory: f.directory });
  expect(model.partitionPlan.partitions.map(row => row.layerRange)).toEqual([[0, 2], [3, 7], [8, 11]]);
  expect(model.partitionPlanId).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(model.partitionPlan.partitions[1].inputContract.hiddenSize).toBe(16);
});
it('rejects altered manifest bytes before importing the runtime', async () => {
  const f = await fixture();
  await fs.appendFile(path.join(f.directory, 'manifest.json'), ' ');
  await expect(f.read()).rejects.toThrow('actual manifest');
  expect(f.loadRuntime).not.toHaveBeenCalled();
});
it('lets a weightless requester use a catalog --model-config with an empty model directory, while requiring manifest.json for custom descriptors', async () => {
  const catalog = (await import('../../shared/config/chat-models.json', { with: { type: 'json' } })).default;
  const model27 = catalog.find(row => row.id === 'qwen-3-8-27b-text-q4k-ef16-af32');
  const empty = await fs.mkdtemp(path.join(os.tmpdir(), 'native-model-empty-'));
  directories.push(empty);
  const configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'native-model-cfg-'));
  directories.push(configDir);
  const file = path.join(configDir, 'model.json');
  await fs.writeFile(file, JSON.stringify({ schema: 'reploid.native-model/v1', model: model27.id }));
  const loaded = await readNativeModelConfiguration(file, { modelId: model27.id, modelDirectory: empty, models: catalog });
  expect(loaded.id).toBe(model27.id);
  expect(loaded.partitionPlanId).toBe(model27.partitionPlanId);
  const f = await fixture();
  await fs.unlink(path.join(f.directory, 'manifest.json'));
  await expect(f.read()).rejects.toThrow('manifest.json in the model directory');
});
it('uses catalog generation and runtime settings with explicit private split and budget overrides', async () => {
  const f = await fixture();
  const base = structuredClone(f.configuration.model);
  base.executionModes = ['whole-model'];
  base.loadOptions = { runtimeConfig: { inference: { session: { decodeLoop: { batchSize: 1 } } } } };
  base.partitionPlan = { stageCount: 2 };
  base.partitionSplitLayer = 2;
  f.configuration.model = base.id;
  f.configuration.partitionRuntime = { maxGpuBufferBytes: [4096, 8192, 4096], runtimeConfig: 'model' };
  await f.write();
  const model = await readNativeModelConfiguration(f.file, { modelId: base.id, modelDirectory: f.directory,
    models: [base], loadRuntime: f.loadRuntime });
  expect(model.partitionPlan.stageCount).toBe(3);
  expect(model.partitionSplitLayer).toBeUndefined();
  expect(model.executionModes).toContain('partition');
  expect(model.partitionRuntime.runtimeConfig).toEqual(base.loadOptions.runtimeConfig);
  expect(base.partitionPlan.stageCount).toBe(2);
  expect(base.partitionSplitLayer).toBe(2);
  expect(base.executionModes).toEqual(['whole-model']);
});
it('refuses an older runtime and incomplete stage budgets rather than inventing a split', async () => {
  const f = await fixture();
  f.loadRuntime.mockResolvedValueOnce({});
  await expect(f.read()).rejects.toThrow('matching runtime');
  f.configuration.model.partitionRuntime.maxGpuBufferBytes = [1024];
  await f.write();
  await expect(f.read()).rejects.toThrow('per partition stage');
});
it('rejects competing plans and missing explicit partition authority', async () => {
  const f = await fixture();
  f.configuration.model.partitionPlan = {};
  await f.write(); await expect(f.read()).rejects.toThrow('competing');
  delete f.configuration.model.partitionPlan;
  f.configuration.model.executionModes = ['whole-model'];
  await f.write(); await expect(f.read()).rejects.toThrow('explicitly allow');
  expect(f.loadRuntime).not.toHaveBeenCalled();
});
it('rejects operator-local definitions in the public room before identity or provider startup', async () => {
  const f = await fixture();
  const identity = path.join(f.directory, 'not-created', 'identity.json');
  await expect(promisify(execFile)(process.execPath, ['server/native-participant.js', '--connect-only',
    '--model', f.manifest.modelId, '--model-directory', f.directory, '--identity-file', identity,
    '--rtc-module', '@roamhq/wrtc', '--ws-module', 'ws', '--model-config', f.file],
  { cwd: process.cwd(), timeout: 5000 })).rejects.toMatchObject({ stderr: expect.stringContaining('explicit private room') });
  await expect(fs.stat(identity)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('accepts the declared tool-call format and refuses an unknown one before any runtime work', async () => {
  const f = await fixture();
  f.configuration.model.toolCallFormat = 'reploid.tool-call/hermes-v1';
  await f.write();
  expect((await f.read()).toolCallFormat).toBe('reploid.tool-call/hermes-v1');
  for (const unknown of ['openai', true, null]) {
    f.loadRuntime.mockClear();
    f.configuration.model.toolCallFormat = unknown;
    await f.write();
    await expect(f.read()).rejects.toThrow('Unknown model toolCallFormat');
    expect(f.loadRuntime).not.toHaveBeenCalled();
  }
});

it('accepts whole-model gathering only with explicit bounds, a pinned piece index and a whole-model entry', async () => {
  const f = await fixture();
  delete f.configuration.partition; delete f.configuration.model.partitionRuntime;
  f.configuration.model.source = { files: [{ path: 'pieces.json', role: 'model-piece-index', hashAlgorithm: 'sha256', hash: 'c'.repeat(64) }] };
  f.configuration.wholeRuntime = { gather: { maxPartBytes: 4096, memoryBudgetBytes: 65536, concurrency: 8, maxRanges: 3,
    verificationCache: { directory: path.join(f.directory, 'state') } } };
  await f.write();
  expect((await f.read()).wholeRuntime).toEqual(f.configuration.wholeRuntime);
  const refuse = async change => {
    const saved = structuredClone(f.configuration);
    change(f.configuration); await f.write();
    await expect(f.read()).rejects.toThrow(/Whole-model/);
    Object.assign(f.configuration, saved); f.configuration.wholeRuntime = saved.wholeRuntime; f.configuration.model = saved.model;
  };
  await refuse(c => { delete c.wholeRuntime.gather.concurrency; });
  await refuse(c => { c.wholeRuntime.gather.verificationCache.directory = 'relative/state'; });
  await refuse(c => { c.wholeRuntime.gather.unknown = 1; });
  await refuse(c => { c.wholeRuntime.extra = {}; });
  await refuse(c => { c.model.source.files = []; });
  await refuse(c => { c.model.executionModes = ['partition']; });
});

it('gives a catalog entry\'s gather policy a verification directory beside the provider identity, and refuses one named in the catalog', () => {
  const model = { id: 'catalog-model', executionModes: ['whole-model'],
    source: { files: [{ path: 'pieces.json', role: 'model-piece-index', hashAlgorithm: 'sha256', hash: 'c'.repeat(64) }] },
    wholeRuntime: { gather: { maxPartBytes: 4096, memoryBudgetBytes: 65536, concurrency: 8, maxRanges: 3 } } };
  const resolved = catalogWholeRuntime(model, '/var/lib/provider');
  expect(resolved).toEqual({ gather: { ...model.wholeRuntime.gather, verificationCache: { directory: '/var/lib/provider/piece-state' } } });
  expect(model.wholeRuntime.gather.verificationCache).toBeUndefined();
  expect(() => catalogWholeRuntime(model, 'relative')).toThrow(/absolute directory/);
  expect(() => catalogWholeRuntime({ ...model, wholeRuntime: { gather: { ...model.wholeRuntime.gather, verificationCache: { directory: '/elsewhere' } } } },
    '/var/lib/provider')).toThrow(/cannot name a machine directory/);
  expect(() => catalogWholeRuntime({ ...model, wholeRuntime: { gather: { maxPartBytes: 4096 } } }, '/var/lib/provider')).toThrow(/Whole-model/);
  expect(() => catalogWholeRuntime({ ...model, executionModes: ['partition'] }, '/var/lib/provider')).toThrow(/Whole-model/);
});

it('validates a gather policy carried inside an operator model entry as it does a top-level one', async () => {
  const f = await fixture();
  delete f.configuration.partition; delete f.configuration.model.partitionRuntime;
  f.configuration.model.source = { files: [{ path: 'pieces.json', role: 'model-piece-index', hashAlgorithm: 'sha256', hash: 'c'.repeat(64) }] };
  f.configuration.model.wholeRuntime = { gather: { maxPartBytes: 4096, memoryBudgetBytes: 65536, concurrency: 2 } };
  await f.write();
  expect((await f.read()).wholeRuntime).toEqual(f.configuration.model.wholeRuntime);
  f.configuration.model.wholeRuntime.gather.concurrency = 0; await f.write();
  await expect(f.read()).rejects.toThrow(/Whole-model/);
});
