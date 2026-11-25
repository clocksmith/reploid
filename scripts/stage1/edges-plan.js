/**
 * The north-star run's plan for the catalogued 27B: the same model and pieces as Stage 1, cut into four ordered stages so
 * that the requester's own machine runs both ends. Stage 0 holds the embedding and layer 0 (it also tokenizes and
 * coordinates), stages 1 and 2 hold layers 1-31 and 32-62 on two other machines, and stage 3 holds layer 63, the final
 * norm and the output head (it samples and detokenizes). The plan is Doppler's own ordered plan for these cuts; this
 * module only names the cuts, pins the resulting plan identity, and derives each stage's piece ranges from the pinned
 * manifest and piece index (no weight bytes are read).
 */
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { resolveServedFile } from '../../server/browser-roots.js';
import { STAGE1_MODEL_ID } from './expectations.js';
import { summarizeRanges } from './inventory.js';

export const EDGES_SPLIT_LAYERS = Object.freeze([1, 32, 63]);
export const EDGES_PINS = Object.freeze({
  planIdentity: 'sha256:2a7a262dc4d596932578812fbe4a600a3333d67a9bf4b666a01c7d9789b943b7',
  // Per-stage GPU buffer ceilings, in stage order: the edges are small, the middle stages hold 31 layers each.
  maxGpuBufferBytes: Object.freeze([6442450944, 12884901888, 12884901888, 6442450944])
});
/** Stage roles, in stage order. `requester` stages run on the requester's own machine and read content. */
export const EDGES_ROLES = Object.freeze(['requester', 'operator', 'operator', 'requester']);

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pinnedFile = (model, role) => model.source.files.find(file => file.role === role);

async function readPinned(model) {
  const manifestBytes = await fs.readFile(resolveServedFile(pinnedFile(model, 'model-manifest').url));
  if ('sha256:' + sha256(manifestBytes) !== model.identity) throw Error('The served manifest differs from the catalog identity');
  const descriptor = pinnedFile(model, 'model-piece-index');
  const indexBytes = await fs.readFile(resolveServedFile(descriptor.url));
  if (sha256(indexBytes) !== descriptor.hash) throw Error('The served piece index differs from its pin');
  return { manifest: JSON.parse(manifestBytes), index: JSON.parse(indexBytes), indexSha256: descriptor.hash };
}

/** The catalogued 27B with the edges cut in place of its two-stage cut; refuses unless Doppler's plan hashes to the pin. */
export async function loadEdgesModel({ runtime = null, pins = EDGES_PINS } = {}) {
  const base = catalog.find(row => row.id === STAGE1_MODEL_ID);
  const doppler = runtime ?? await import('dopplerx/partitions');
  const { manifest } = await readPinned(base);
  const partitionRequest = { ...base.partitionRequest, splitLayers: [...EDGES_SPLIT_LAYERS] };
  const plan = doppler.createOrderedLayerPartitionPlanFromManifest(manifest, partitionRequest);
  const planIdentity = doppler.hashLayerPartitionPlan(plan);
  if (pins && planIdentity !== pins.planIdentity) throw Error(`The edges plan hashes to ${planIdentity}, not its pin`);
  const model = structuredClone(base);
  model.partitionRequest = partitionRequest;
  model.partitionPlanId = planIdentity;
  model.partitionRuntime = { ...model.partitionRuntime, maxGpuBufferBytes: [...EDGES_PINS.maxGpuBufferBytes] };
  return { model, plan };
}

/** Each stage's piece ranges, as the Stage 1 inventory lists them, from the pinned manifest and piece index only. */
export async function edgesInventory({ model, plan }) {
  const { manifest, index, indexSha256 } = await readPinned(model);
  const files = new Map(index.files.map(file => [file.path, file]));
  const owned = plan.partitions.map(() => new Set());
  for (const [name, tensor] of Object.entries(manifest.tensors)) {
    const layer = /^layer\.(\d+)$/.exec(tensor.group);
    const owners = plan.partitions.map((stage, stageIndex) => ({ stage, stageIndex })).filter(({ stage }) => (layer
      ? stage.layerRange[0] <= Number(layer[1]) && Number(layer[1]) <= stage.layerRange[1]
      : tensor.group === 'embed' ? stage.hasEmbedding : tensor.group === 'head' && stage.hasLmHead));
    if (owners.length !== 1) throw Error(`Tensor ${name} has ${owners.length} owning stages`);
    for (const span of tensor.spans ?? [tensor]) {
      const shard = manifest.shards[span.shardIndex ?? span.shard], file = files.get(shard.filename);
      for (const piece of file.pieces) {
        if (Math.min(span.offset + span.size, piece.offset + piece.size) > Math.max(span.offset, piece.offset)) owned[owners[0].stageIndex].add(piece);
      }
    }
  }
  const stages = plan.partitions.map((stage, stageIndex) => {
    const ranges = [];
    for (const shard of manifest.shards) {
      for (const piece of files.get(shard.filename).pieces) {
        if (owned[stageIndex].has(piece)) ranges.push({ shardIndex: shard.index, path: shard.filename, offset: piece.offset, size: piece.size, identity: piece.identity });
      }
    }
    return { stageIndex, layerRange: [...stage.layerRange], hasEmbedding: stage.hasEmbedding, hasLmHead: stage.hasLmHead, ranges, ...summarizeRanges(ranges) };
  });
  return { modelId: model.id, modelIdentity: model.identity, planId: model.partitionPlanId, indexSha256, stages };
}

/** The digest a stage directory's build record carries for this plan's inventory: ranges only, canonical order. */
export function edgesInventorySha256(inventory) {
  const canonical = { modelId: inventory.modelId, modelIdentity: inventory.modelIdentity, planId: inventory.planId, indexSha256: inventory.indexSha256,
    stages: inventory.stages.map(stage => ({ stageIndex: stage.stageIndex, layerRange: stage.layerRange, ranges: stage.ranges })) };
  return sha256(JSON.stringify(canonical));
}

/**
 * Build (from a full copy) or verify one edges stage directory, with the stage ranges this host derives itself from
 * its own pinned manifest and piece index. Counts and digests come back, never a path.
 */
export async function edgesStageDirectory({ action, stageIndex, source = null, directory, hash = false, signal }) {
  const { buildStageDirectory, verifyStageDirectory } = await import('./build-stage-directory.js');
  const loaded = await loadEdgesModel(), inventory = await edgesInventory(loaded);
  const stage = inventory.stages[stageIndex];
  if (!stage) throw Error('No such edges stage');
  const common = { stageIndex, stageRanges: stage.ranges, otherRanges: inventory.stages.filter(row => row !== stage).flatMap(row => row.ranges),
    pin: { rangeCount: stage.rangeCount, bytes: stage.bytes, rangesDigest: stage.rangesDigest }, model: loaded.model,
    inventorySha256: edgesInventorySha256(inventory), signal };
  const result = action === 'build' ? await buildStageDirectory({ ...common, source, target: directory })
    : await verifyStageDirectory({ ...common, directory, hash });
  const { files: _files, ...counts } = result;
  return { ...counts, layerRange: stage.layerRange, planId: inventory.planId };
}

const entered = (() => { try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); } catch { return false; } })();
if (entered) {
  const { parseArgs } = await import('node:util');
  const { values } = parseArgs({ options: { build: { type: 'string' }, verify: { type: 'string' }, source: { type: 'string' }, target: { type: 'string' },
    hash: { type: 'boolean' }, summary: { type: 'boolean' } } });
  try {
    if (values.summary) {
      const loaded = await loadEdgesModel(), inventory = await edgesInventory(loaded);
      process.stdout.write(JSON.stringify({ planId: inventory.planId, inventorySha256: edgesInventorySha256(inventory),
        stages: inventory.stages.map(({ ranges: _ranges, ...row }) => row) }, null, 2) + '\n');
    } else {
      const action = values.build !== undefined ? 'build' : 'verify', stageIndex = Number(values.build ?? values.verify);
      process.stdout.write(JSON.stringify(await edgesStageDirectory({ action, stageIndex, source: values.source ?? null,
        directory: values.target, hash: values.hash === true }), null, 2) + '\n');
    }
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
