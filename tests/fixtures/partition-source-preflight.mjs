// Offline qualification for the standard untied, ordered RDRR partition path.
// No GPU, model download or contributor startup. Reads one real authenticated piece per
// stage and checks that its storage can open with every other stage's files absent.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as runtime from 'doppler-gpu/partitions';
import { createWorkPartitionPlan } from '../../apps/poolday/host/work-partition-plan.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };
import { resolveServedFile } from '../../server/browser-roots.js';
import { openNativeModelSource } from '../../server/native-model-source.js';

const [, , modelId, weightsDirectory] = process.argv;
assert(modelId && weightsDirectory, 'Usage: node tests/fixtures/partition-source-preflight.mjs MODEL LOCAL_WEIGHT_DIRECTORY');
const model = catalog.find(row => row.id === modelId);
assert(model?.partitionPlan?.schema === 'doppler.layer-partition-contract/v3', 'Select a catalog model with an ordered plan');
const pinnedFile = role => model.source.files.find(file => file.role === role);
const manifestBytes = await readFile(resolveServedFile(pinnedFile('model-manifest').url));
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal('sha256:' + hash(manifestBytes), model.identity);
const manifest = JSON.parse(manifestBytes);
const descriptor = pinnedFile('model-piece-index');
const indexBytes = await readFile(resolveServedFile(descriptor.url));
assert.equal(hash(indexBytes), descriptor.hash);
const files = new Map(JSON.parse(indexBytes).files.map(file => [file.path, file]));
assert.equal(manifest.inference.output.tieWordEmbeddings, false, 'Tied heads need an explicit shared embedding dependency');
const plan = createWorkPartitionPlan(runtime, manifest, model);
assert.equal(await runtime.hashLayerPartitionPlan(plan), model.partitionPlanId);
const stages = plan.partitions.map(stage => ({ stage, pieces: new Set(), shards: new Set(), tensorBytes: 0 }));
for (const [name, tensor] of Object.entries(manifest.tensors)) {
  const layer = /^layer\.(\d+)$/.exec(tensor.group);
  const owners = stages.filter(({stage}) => layer ? stage.layerRange[0] <= Number(layer[1]) && Number(layer[1]) <= stage.layerRange[1]
    : tensor.group === 'embed' ? stage.hasEmbedding : tensor.group === 'head' && stage.hasLmHead);
  assert.equal(owners.length, 1, 'Unexpected ownership for tensor ' + name);
  const owner = owners[0];
  for (const span of tensor.spans ?? [tensor]) {
    const shard = manifest.shards[span.shardIndex ?? span.shard];
    const file = files.get(shard.filename);
    assert.equal(file.size, shard.size);
    assert.equal(path.basename(file.path), file.path);
    owner.shards.add(file);
    owner.tensorBytes += span.size;
    let covered = 0;
    for (const piece of file.pieces) {
      const start = Math.max(span.offset, piece.offset), end = Math.min(span.offset + span.size, piece.offset + piece.size);
      if (end <= start) continue;
      owner.pieces.add(piece);
      covered += end - start;
    }
    assert.equal(covered, span.size, 'Piece index does not cover a tensor span of ' + name);
  }
}
const total = (items, key) => [...items].reduce((n, value) => n + value[key], 0);
const exclusive = stages.map((stage, index) => {
  const file = [...stage.shards].find(file => stages.every((other, i) => i === index || !other.shards.has(file)));
  assert(file, 'No stage-exclusive shard available for the source check');
  const piece = file.pieces.find(piece => stage.pieces.has(piece));
  return { file, piece, shardIndex: manifest.shards.findIndex(shard => shard.filename === file.path) };
});
const results = [];
for (const [index, owner] of stages.entries()) {
  const { file, piece, shardIndex } = exclusive[index];
  const scratch = await mkdtemp(path.join(tmpdir(), 'reploid-partition-piece-'));
  let opened;
  try {
    await writeFile(path.join(scratch, 'manifest.json'), manifestBytes);
    const source = await open(path.join(weightsDirectory, file.path), 'r');
    const bytes = Buffer.alloc(piece.size);
    try {
      let received = 0;
      while (received < bytes.length) {
        const result = await source.read(bytes, received, bytes.length - received, piece.offset + received);
        assert(result.bytesRead > 0, 'Source shard truncated');
        received += result.bytesRead;
      }
    } finally { await source.close(); }
    assert.equal('sha256:' + hash(bytes), piece.identity);
    const dest = await open(path.join(scratch, file.path), 'wx');
    try {
      await dest.truncate(file.size);
      assert.equal((await dest.write(bytes, 0, bytes.length, piece.offset)).bytesWritten, bytes.length);
    } finally { await dest.close(); }
    opened = await openNativeModelSource({ model, modelDirectory: scratch, runtime, signal: new AbortController().signal });
    const readBack = await opened.storage.loadShardRange(shardIndex, piece.offset, Math.min(32, bytes.length));
    assert.deepEqual(Buffer.from(readBack), bytes.subarray(0, readBack.byteLength));
    const outside = exclusive[(index + 1) % stages.length];
    await assert.rejects(opened.storage.loadShardRange(outside.shardIndex, outside.piece.offset, 1), /ENOENT|no such file/i);
    results.push({ index, layerRange: owner.stage.layerRange, tensorBytes: owner.tensorBytes, pieces: owner.pieces.size,
      verifiedPieceBytes: total(owner.pieces, 'size'), shards: owner.shards.size, wholeShardBytes: total(owner.shards, 'size'),
      overlapsOtherStages: { pieces: [...owner.pieces].filter(p => stages.some(other => other !== owner && other.pieces.has(p))).length,
        shards: [...owner.shards].filter(f => stages.some(other => other !== owner && other.shards.has(f))).length },
      sample: { file: file.path, offset: piece.offset, size: piece.size, identity: piece.identity, checkedBytes: readBack.byteLength,
        missingOppositeShardRefused: outside.file.path } });
  } finally { try { await opened?.storage.close(); } finally { await rm(scratch, { recursive: true, force: true }); } }
}
console.log(JSON.stringify({ modelId, modelIdentity: model.identity, planId: model.partitionPlanId,
  verified: 'Tensor span to authenticated piece coverage plus one actual source read per stage.', stages: results }, null, 2));
