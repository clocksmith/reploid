import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectNativeSourceReceipts } from './native-source-receipts.js';
import { openNativeModelSource } from '../../server/native-model-source.js';
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-gather-'));
try {
  const evidence = await collectNativeSourceReceipts([
    { getReceipt: () => ({}), getGatherReceipt: async () => { throw new Error('Failed owner already closed'); } },
    { getReceipt: () => ({ requestedBytes: 0 }), getGatherReceipt: async () => ({ verifiedBytes: 4 }) },
  ]);
  assert.match(evidence[0].receiptFailure, /already closed/);
  assert.deepEqual(evidence[1].gather, { verifiedBytes: 4 }, 'Failed owner cannot suppress successful retry evidence');
  const manifest = Buffer.from(JSON.stringify({ modelId: 'gather-test', shards: [{ filename: 'weights.bin', size: 4 }, { filename: 'unassigned.bin', size: 4 }] }));
  const weights = Buffer.from([1, 2, 3, 4]);
  const index = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: hash(manifest),
    maxPieceBytes: 4, files: [{ path: 'weights.bin', size: 4, pieces: [{ offset: 0, size: 4, identity: hash(weights) }] },
      { path: 'unassigned.bin', size: 4, pieces: [{ offset: 0, size: 4, identity: hash(weights) }] }] }));
  await fs.writeFile(path.join(root, 'manifest.json'), manifest);
  await fs.writeFile(path.join(root, 'pieces.json'), index);
  await fs.writeFile(path.join(root, 'weights.bin'), weights);
  const model = { id: 'gather-test', identity: hash(manifest), source: { files: [
    { role: 'model-piece-index', path: 'pieces.json', hashAlgorithm: 'sha256', hash: hash(index).slice(7) }] } };
  let supplied;
  const runtime = { async createVerifiedPieceStorage(options) { supplied = options;
    return { storage: { rangeLease: { async read() {} }, async close() {} }, async getGatherReceipt() {} }; } };
  const gather = { maxPartBytes: 4, memoryBudgetBytes: 12 };
  await openNativeModelSource({ model, modelDirectory: root, runtime, gather });
  assert.deepEqual(supplied.nodeGather, { files: { 'weights.bin': path.join(await fs.realpath(root), 'weights.bin') }, ...gather });
  assert.equal(supplied.indexIdentity, hash(index));
  let closed = false;
  const oldRuntime = { async createVerifiedPieceStorage() { return { storage: { async close() { closed = true; } } }; } };
  await assert.rejects(openNativeModelSource({ model, modelDirectory: root, runtime: oldRuntime, gather }), /does not support/);
  assert(closed, 'Unsupported runtime is closed, never silently downgraded');
  await assert.rejects(openNativeModelSource({ model, gather, files: {} }), /cannot replace custody/);
  await assert.rejects(openNativeModelSource({ model, gather, resolveSource() {} }), /cannot replace custody/);
  for (const [pieceIndex, indices] of [[null, [0]], [{ path: 'pieces.json' }, null]]) {
    const configPath = path.join(root, 'invalid-gather.json');
    await fs.writeFile(configPath, JSON.stringify({ workerGather: gather, pieceIndex }));
    const child = spawnSync(process.execPath, [new URL('./qwen-partition-worker.js', import.meta.url).pathname, configPath], {
      input: JSON.stringify({ id: 'unsupported-gather', op: 'open', indices }) + '\n', encoding: 'utf8', timeout: 10000,
    });
    assert.equal(child.status, 0, child.stderr);
    assert.match(child.stdout, /workerGather requires pinned pieceIndex and partition indices/);
  }
  if (process.env.DOPPLER_SOURCE_URL) {
    const actualRuntime = await import(new URL('src/partitions.js', process.env.DOPPLER_SOURCE_URL));
    const source = await openNativeModelSource({ model, modelDirectory: root, runtime: actualRuntime, gather });
    try {
      const lease = await source.storage.rangeLease.read(0, 0, 4, new AbortController().signal);
      assert.deepEqual([...lease.bytes], [...weights]); lease.release();
      const receipt = await source.getGatherReceipt();
      assert.equal(receipt.manifestIdentity, model.identity);
      assert.equal(receipt.verifiedBytes, 4);
    } finally { await source.storage.close(); }
  }
} finally { await fs.rm(root, { recursive: true }); }
console.log('native-gather-contract: bounded direct-local admission, pinned identities, custody separation and no downgrade passed');
