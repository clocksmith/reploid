import fs from 'node:fs';
import { createHash } from 'node:crypto';
import * as runtime from '../../../doppler/src/inference/pipelines/text/layer-partition-contract.js';
import { selectPartitionRoute } from '../../packages/reploid/src/mesh/partitions/partition-placement.js';
const result = [];
for (const count of [2, 3, 4, 7]) {
  const plan = runtime.createOrderedLayerPartitionPlan({ modelId: 'actual-provider', numLayers: 24,
    hiddenSize: 1024, vocabSize: 151936, splitLayers: Array.from({ length: count - 1 }, (_, index) => index + 1),
    activationDtype: 'f32', activationPrecision: 'two-f32' });
  const planId = await runtime.hashLayerPartitionPlan(plan), activation = runtime.getPartitionActivationContract(plan);
  const model = { id: plan.modelId, identity: 'sha256:' + 'a'.repeat(64) };
  const capabilities = plan.partitions.map(({ index }) => ({ participantId: 'p' + index, transportId: 't' + index,
    observedAt: 1, expiresAt: 100, available: true, description: { schema: 'reploid.partition-capability/v2',
      participantId: 'p' + index, phase: 'ready', capacity: { active: 0, availableSlots: 1, closed: false }, models: [{
        ...model, availability: 'ready', planId, index, residentId: 'r' + index, executionId: 'e' + index, activation }] } }));
  const selected = await selectPartitionRoute({ runtime, plan, model, capabilities, now: 2,
    limits: { maxStages: 24, maxPeers: 24, maxOffersPerPeer: 1, maxSelectionSteps: 1000 } });
  if (selected.route?.stages.length !== count) throw Error('Actual provider route failed');
  result.push({ stages: count, planId, route: selected.route, selectionSteps: selected.selectionSteps });
}
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
fs.writeFileSync(new URL('./provider-check.json', import.meta.url), JSON.stringify({
  scope: 'Actual source provider public plan/codecs; synthetic participant/model identity, no computation or admission',
  providerSource: hash('../doppler/src/inference/pipelines/text/layer-partition-contract.js'),
  contractSource: hash('packages/reploid/src/mesh/partitions/partition-contract.js'),
  placementSource: hash('packages/reploid/src/mesh/partitions/partition-placement.js'), result }, null, 2) + '\n');
