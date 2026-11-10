// Explicit installed-package native composition check. No discovery or service startup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import * as runtime from 'doppler-gpu/partitions';
import { readNativeModelConfiguration } from '../../server/native-model-config.js';
import { createNativeGpuHost, openNativePartition } from '../../server/native-participant.js';
import { createLayerPartitionRunner } from '../../packages/reploid/src/mesh/partitions/partition-runner.js';

const file = process.env.REPLOID_NATIVE_ORDERED_CONFIG;
assert(file && path.isAbsolute(file), 'Declare REPLOID_NATIVE_ORDERED_CONFIG as an absolute JSON path');
const bytes = await fs.readFile(file);
const config = JSON.parse(bytes);
assert.equal(config.schema, 'reploid.native-ordered-physical/v1');
for (const key of ['modelConfig', 'modelDirectory', 'reference', 'output', 'webgpuModule']) {
  assert(path.isAbsolute(config[key]), `Explicit absolute ${key} required`);
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const referenceBytes = await fs.readFile(config.reference);
const reference = JSON.parse(referenceBytes);
assert.equal(reference.passed, true, 'Use a completed same-device control');
const model = await readNativeModelConfiguration(config.modelConfig, {
  modelId: reference.modelId, modelDirectory: config.modelDirectory,
});
assert.equal(model.identity, reference.modelIdentity);
assert.equal(model.partitionPlanId, reference.planId);
assert.deepEqual(model.partitionRuntime.runtimeConfig, reference.runtimeConfig);
assert.deepEqual(model.generation, reference.generation);
const gpu = createNativeGpuHost(() => import(pathToFileURL(config.webgpuModule).href), { backend: 'vulkan' });
const controller = new AbortController();
const stop = () => controller.abort(new Error('Native ordered physical check interrupted'));
process.once('SIGTERM', stop); process.once('SIGINT', stop);
const opened = [], report = { schema: 'reploid.native-ordered-physical-result/v1',
  scope: 'Installed native loader and ordered resident composition on one physical GPU, with verified pieces; no peer transport or independent source qualification',
  configSha256: hash(bytes), referenceSha256: hash(referenceBytes), modelId: model.id,
  modelIdentity: model.identity, planId: model.partitionPlanId, rows: [], cleanupFailures: [], passed: false };
let runner;
try {
  const stages = model.partitionPlan.partitions.map(({ index }) => ({ index,
    participantId: 'native-' + index, transportId: 'local-' + index,
    residentId: 'resident-' + index, executionId: 'program-' + index }));
  for (const stage of stages) {
    const program = await openNativePartition({ model, modelDirectory: config.modelDirectory,
      nativeGpu: () => gpu.open(), index: stage.index, signal: controller.signal,
      participantId: stage.participantId, ordered: { stage },
      onProgress: progress => console.log(JSON.stringify({ stage: stage.index, progress })) });
    opened.push(program);
    assert.equal(program.resident.getState().ready, true);
  }
  report.descriptors = opened.map(program => program.resident.getState().descriptor);
  const route = { schema: 'reploid.partition-route/v1', modelId: model.id, modelIdentity: model.identity,
    planId: model.partitionPlanId, activation: runtime.getPartitionActivationContract(model.partitionPlan), stages };
  const identity = { schema: 'reploid.partition-attempt/v2', route, threadId: 'native-control',
    attemptId: 'native-attempt', requesterId: 'native-requester', placementGeneration: 0 };
  const ports = opened.map((program, index) => ({ ...program.resident,
    async executeStage(request) {
      const result = await program.resident.executeStage(request);
      if (index !== stages.length - 1) return result;
      assert(result.logits, 'Final native stage returns its actual logits');
      const expected = reference.rows[result.step];
      const row = { step: result.step, tokenId: result.tokenId, expectedTokenId: expected.tokenId,
        logitsSha256: hash(Buffer.from(result.logits.buffer, result.logits.byteOffset, result.logits.byteLength)),
        expectedLogitsSha256: expected.logitsSha256 };
      report.rows.push(row); console.log(JSON.stringify(row));
      assert.equal(row.tokenId, row.expectedTokenId);
      assert.equal(row.logitsSha256, row.expectedLogitsSha256);
      return result;
    } }));
  runner = createLayerPartitionRunner({ runtime, plan: model.partitionPlan, route, stages: ports,
    transport: { transferActivation: async frame => structuredClone(frame) },
    // This offline owner approves only this already-bound test route. It does
    // not exercise authenticated remote grants, billing or peer transport.
    authorize: async () => !controller.signal.aborted, limits: config.limits });
  report.result = await runner.execute({ tokenIds: reference.inputTokenIds, generation: model.generation,
    identity, maxTokens: model.generation.maxTokens, signal: controller.signal,
    grants: { execution: stages.map(() => ({ id: 'test-execution' })),
      tokenContext: stages.map(() => ({ id: 'test-context' })),
      activation: stages.slice(1).map(() => ({ id: 'test-activation' })), output: { id: 'test-output' } } });
  assert.equal(report.rows.length, reference.rows.length);
  report.acquisition = opened.map(program => program.getReceipt());
  report.passed = true;
} catch (error) { report.failure = String(error); process.exitCode = 1; }
finally {
  try { await runner?.close(); } catch (error) { report.cleanupFailures.push(String(error)); }
  for (const program of opened.reverse()) {
    try { await program.resident.close(); } catch (error) { report.cleanupFailures.push(String(error)); }
  }
  try { await gpu.close(); } catch (error) { report.cleanupFailures.push(String(error)); }
  if (report.cleanupFailures.length) { report.passed = false; process.exitCode = 1; }
  process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
  await fs.writeFile(config.output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, rows: report.rows.length,
    failure: report.failure, cleanupFailures: report.cleanupFailures }));
}
