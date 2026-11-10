// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readNativeModelConfiguration } from '../../server/native-model-config.js';

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
