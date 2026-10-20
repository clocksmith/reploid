/** Explicit one-step application check; requires an already provisioned 0.8B model. */
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import * as training from 'doppler-gpu/training';
import { createDopplerTrainingExecutor } from '../../self/host/lora-training-executor.js';
import { createTrainingSession } from '../../packages/reploid/src/training/session.js';
import policy from '../../self/config/lora-training.json' with { type: 'json' };
import pin from '../../self/config/doppler-package.json' with { type: 'json' };
const directory = process.argv[2];
assert(directory, 'Pass an already provisioned model directory');
const started = Date.now();
await training.bootstrapNativeTrainingHost();
const session = createTrainingSession({ policy, participantId: async () => 'native-application-check',
  openExecutor: async () => createDopplerTrainingExecutor({ policy, loadRuntime: async () => training,
    modelUrl: pathToFileURL(directory).href }),
  openNetwork: () => { throw Error('No network authorized'); }, connectPeer: () => { throw Error('No peers authorized'); } });
try {
  const candidate = await session.run({ consent: true,
    samples: [{ inputIds: [100, 200, 300], targetIds: [200, 300, 400], supervisedTokenCount: 3 }],
    adapter: { id: 'reploid-application-check', name: 'Reploid application check', version: '0.0.1' } });
  assert.equal(candidate.evaluated, false); assert.equal(candidate.activated, false);
  assert.equal(candidate.manifest.metadata.baseManifestHash, policy.baseManifestHash);
  assert.equal(candidate.metrics.length, 1); assert(Number.isFinite(candidate.metrics[0].loss));
  const receipt = { schema: 'reploid.training-application-check/v1', passed: true, at: new Date().toISOString(),
    execution: 'one local native GPU optimizer step through the application executor; not pooled network or quality evidence',
    package: pin, baseManifestHash: policy.baseManifestHash, target: { layerIdx: policy.layerIdx, module: policy.module },
    weightsSha256: candidate.weightsSha256, bytes: candidate.weights.byteLength, metrics: candidate.metrics,
    evaluated: false, activated: false, elapsedMs: Date.now() - started };
  await mkdir('artifacts/community-lora-20261017', { recursive: true });
  await writeFile('artifacts/community-lora-20261017/native.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally { await session.close(); await training.releaseNativeTrainingHost(); }
