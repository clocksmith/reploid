// Reproduces the earlier isolated chat export's scope step
// (artifacts/completion-candidate-20261013/chat-scope.json): the separate legacy Pool model
// that still pins Doppler 0.6.27 is disabled in this export only, so runtime-config
// synchronization can proceed for the 0.6.28 chat candidate. No qualification is assigned
// to that model. The earlier step was not retained as a script; this one writes the same
// single-field change and refuses any other shape.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const [applicationRoot, receipt] = process.argv.slice(2);
assert(applicationRoot && receipt, 'Provide the application export and a new receipt path');
const file = path.join(applicationRoot, 'self/pool/pool-config.json');
const config = JSON.parse(await fs.readFile(file, 'utf8'));
const enabled = config.modelCatalog.filter(model => model.enabled !== false && model.runtime === 'doppler');
assert.deepEqual(enabled.map(model => [model.modelId, model.runtimeVersion]), [['esm2-t12-35m-ur50d-f32-af32', '0.6.27']]);
enabled[0].enabled = false;
await fs.writeFile(file, JSON.stringify(config, null, 2) + '\n');
await fs.writeFile(receipt, JSON.stringify({ schema: 'reploid.isolated-chat-candidate-scope/v1',
  selectedChatModel: 'qwen-3-5-0-8b-q4k-ehaf16', publicChanged: false,
  unrelatedPoolModelsDisabled: ['esm2-t12-35m-ur50d-f32-af32'],
  reason: 'Separate legacy Pool model surface is outside this signed chat candidate; do not assign replacement runtime qualification to it',
  initialGeneratorRejection: 'Enabled model esm2-t12-35m-ur50d-f32-af32 pins Doppler 0.6.27; the browser loads 0.6.28',
  sameAs: 'artifacts/completion-candidate-20261013/chat-scope.json' }, null, 2) + '\n', { flag: 'wx' });
