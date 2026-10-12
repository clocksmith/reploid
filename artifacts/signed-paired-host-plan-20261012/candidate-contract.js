import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createWorkPartitionPlan } from '../../self/host/work-partition-plan.js';
const packagePath = resolve(process.argv[2]);
const runtime = await import(pathToFileURL(resolve(packagePath, 'src/partitions.js')).href);
const fixturePath = 'tests/fixtures/paired-activation-contract.json';
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
const { plan } = fixture;
const manifest = { modelId: plan.modelId, architecture: { numLayers: plan.totalLayers,
  hiddenSize: plan.hiddenSize, vocabSize: plan.vocabSize },
  inference: { session: { compute: { defaults: { activationDtype: 'f32' } } } } };
const actual = createWorkPartitionPlan(runtime, manifest, { id: plan.modelId,
  partitionSplitLayer: plan.splitLayer, partitionPlan: plan });
assert.deepEqual(actual, plan);
assert.equal(Object.isFrozen(actual.partitions[0].outputContract), true);
assert.equal(await runtime.hashLayerPartitionPlan(actual), await runtime.hashLayerPartitionPlan(plan));
const files = ['src/partitions.js', 'src/inference/pipelines/text/layer-partition-contract.js',
  'src/inference/pipelines/text/resident-partition-contract.js'];
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const result = { scope: 'Actual candidate package CPU codec, frozen synthetic plan; no physical or numerical qualification',
  packagePath, packageFiles: Object.fromEntries(files.map(path => [path, sha(resolve(packagePath, path))])),
  fixtureSha256: sha(fixturePath), hostSha256: sha('self/host/work-partition-plan.js'),
  planHash: await runtime.hashLayerPartitionPlan(actual), contract: runtime.getPartitionActivationContract(actual), passed: true };
writeFileSync('artifacts/signed-paired-host-plan-20261012/candidate-contract.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
