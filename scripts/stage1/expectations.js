/** The frozen Stage 1 workload, derived from the catalog, the code-trace fixture and the plan's piece inventory. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { hashJson } from '../../packages/reploid/src/artifacts/signatures.js';
import { canonicalPartitionJson } from '../../packages/reploid/src/contracts/partition.js';
import { summarizeRanges } from './inventory.js';

export const STAGE1_MODEL_ID = 'qwen-3-8-27b-text-q4k-ef16-af32';
export const STAGE1_PINS = Object.freeze({
  planIdentity: 'sha256:a000b91dd404ff328a0deaa2f5e3ff89b5c73c9a93001d1870c145df4fdd882c',
  quantization: 'q4k',
  decoding: Object.freeze({ temperature: 0, topK: 1, topP: 1, repetitionPenalty: 1, repetitionPenaltyWindow: 1 }),
  inventorySha256: 'fb87f2cd341bb9e3709316d797284cc10606e54305881fe96e2de34e35644b94',
  // Packed weights and input embedding on the GPU, before context. Slightly below the file bytes of all stages.
  minimumSoloLoadBytes: 16941875200,
  stages: Object.freeze([Object.freeze({ rangeCount: 1051, bytes: 2759168448 }), Object.freeze({ rangeCount: 4461, bytes: 14235183680 })])
});
export const STAGE1_FIXTURE_FILE = fileURLToPath(new URL('../../tests/fixtures/private-split-27b-code-trace.json', import.meta.url));
const PREFLIGHT = fileURLToPath(new URL('../../tests/fixtures/partition-source-preflight.mjs', import.meta.url));
const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));
const DECODING_KEYS = ['temperature', 'topK', 'topP', 'repetitionPenalty', 'repetitionPenaltyWindow'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
/** The digest the production stage token witness records. */
export const witnessDigest = value => sha256(canonicalPartitionJson(value));

/** Runs the existing offline inventory; reads the packaged manifest and piece index, no weight bytes. */
export async function readPieceInventory() {
  const { stdout } = await promisify(execFile)(process.execPath, [PREFLIGHT, STAGE1_MODEL_ID, '--piece-inventory'],
    { cwd: REPOSITORY, maxBuffer: 16 * 1024 * 1024 });
  return { sha256: sha256(stdout), inventory: JSON.parse(stdout) };
}

const decodingOf = generation => Object.fromEntries(DECODING_KEYS.map(key => [key, generation[key]]));
export const stage1Decoding = decodingOf;

/** `runtimeClass` is `physical` for real hosts. A fake-runtime receipt can never satisfy physical expectations. */
export async function loadStage1Expectations({ runtimeClass = 'physical', fixtureFile = STAGE1_FIXTURE_FILE, creditWeights = [1, 1] } = {}) {
  if (!['physical', 'fake-runtime'].includes(runtimeClass)) throw Error('Unknown Stage 1 runtime class');
  const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
  const fixtureBytes = await fs.readFile(fixtureFile), fixture = JSON.parse(fixtureBytes);
  if (fixture.modelId !== model.id || fixture.modelIdentity !== model.identity || fixture.planIdentity !== model.partitionPlanId
    || model.partitionPlanId !== STAGE1_PINS.planIdentity || model.quantization !== STAGE1_PINS.quantization
    || canonicalPartitionJson(decodingOf(model.generation)) !== canonicalPartitionJson(STAGE1_PINS.decoding)) {
    throw Error('Stage 1 fixture, catalog and pinned workload disagree');
  }
  const { sha256: inventorySha256, inventory } = await readPieceInventory();
  if (inventorySha256 !== STAGE1_PINS.inventorySha256) throw Error(`Stage inventory changed: ${inventorySha256}`);
  const stageRanges = inventory.stages.map(stage => stage.ranges);
  const stages = inventory.stages.map((stage, index) => {
    const summary = summarizeRanges(stage.ranges), pin = STAGE1_PINS.stages[index];
    if (summary.rangeCount !== pin.rangeCount || summary.bytes !== pin.bytes) throw Error(`Stage ${index} inventory differs from its pin`);
    return { stageIndex: stage.stageIndex, layerRange: stage.layerRange, ...summary };
  });
  const reference = fixture.reference, outputIds = [...reference.visibleOutputIds, reference.stopId];
  const expectations = {
    schema: 'reploid.stage1-expectations/v1', runtimeClass,
    inventorySource: runtimeClass === 'physical' ? 'hashed-on-host' : 'fake-runtime-declared',
    inventorySha256, creditsPerOutputToken: 1, creditWeights: [...creditWeights], minimumSoloLoadBytes: STAGE1_PINS.minimumSoloLoadBytes,
    workload: { modelId: model.id, modelIdentity: model.identity, quantization: model.quantization,
      planIdentity: model.partitionPlanId, messagesDigest: await hashJson(fixture.messages),
      promptDigest: witnessDigest(reference.inputIds), promptCount: reference.inputIds.length,
      maxOutputTokens: fixture.maxOutputTokens, decoding: decodingOf(model.generation) },
    reference: { outputIds, sampleDigest: witnessDigest(outputIds), outputText: reference.outputText, stopReasons: ['eos-token', 'stop-token'] },
    stages,
    totalWeight: { rangeCount: stages.reduce((sum, stage) => sum + stage.rangeCount, 0), bytes: stages.reduce((sum, stage) => sum + stage.bytes, 0) }
  };
  return { expectations, stageRanges, model, fixture, fixtureBytes, fixtureFile };
}
