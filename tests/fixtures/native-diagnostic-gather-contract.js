import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openDiagnosticModelSource } from './native-diagnostic-source.js';

assert(process.env.DOPPLER_SOURCE_URL, 'Explicit selected source URL required for real worker contract');
const runtime = await import(new URL('src/partitions.js', process.env.DOPPLER_SOURCE_URL));
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'diagnostic-gather-contract-'));
let source;
try {
  const bytes = Uint8Array.from({ length: 36 }, (_, i) => i + 1);
  const filename = path.join(root, 'weights.bin'), manifestPath = path.join(root, 'manifest.json');
  const manifestBytes = Buffer.from(JSON.stringify({ modelId: 'diagnostic-gather-contract', hashAlgorithm: 'sha256',
    shards: [{ filename: 'weights.bin', size: bytes.length, hash: hash(bytes).slice(7) }] }));
  const indexBytes = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', manifestIdentity: hash(manifestBytes),
    maxPieceBytes: 4, files: [{ path: 'weights.bin', size: bytes.length, pieces: Array.from({ length: 9 }, (_, i) => i * 4).map(offset =>
      ({ offset, size: 4, identity: hash(bytes.subarray(offset, offset + 4)) })) }] }));
  await fs.writeFile(filename, bytes); await fs.writeFile(manifestPath, manifestBytes);
  await fs.writeFile(path.join(root, 'pieces.json'), indexBytes);
  const config = { manifestPath, manifestSha256: hash(manifestBytes).slice(7),
    pieceIndex: { role: 'model-piece-index', path: 'pieces.json', hashAlgorithm: 'sha256', hash: hash(indexBytes).slice(7) },
    sourceMap: { schema: 'reploid.diagnostic-source-map/v1', manifestIdentity: hash(manifestBytes), indexIdentity: hash(indexBytes),
      files: { 'weights.bin': filename } }, workerGather: { concurrency: 1, maxRanges: 9, maxPartBytes: 36, memoryBudgetBytes: 44 } };
  await assert.rejects(openDiagnosticModelSource({ config: { ...config,
    workerGather: { ...config.workerGather, memoryBudgetBytes: 43 } }, runtime,
    model: { id: 'diagnostic-gather-contract', identity: hash(manifestBytes) } }), /memory|budget/i);
  source = await openDiagnosticModelSource({ config, runtime,
    model: { id: 'diagnostic-gather-contract', identity: hash(manifestBytes) } });
  const port = source.storage.rangeLease;
  assert.equal(port.batchFileIdentityChecks, 'before-read-after-auth/v1');
  assert.equal(port.maxRanges, 9); assert.equal(port.memoryBytes, 44);
  const nineRanges = Array.from({ length: 9 }, (_, i) => ({ shard: 0, offset: i * 4, length: 4 }));
  let lease = await port.readMany(nineRanges);
  assert.deepEqual([...lease.bytes], [...bytes]); lease.release();
  await assert.rejects(port.readMany([...nineRanges, nineRanges[0]]), /ranges bound/);
  await assert.rejects(port.readMany(nineRanges.map(range => ({ ...range, length: 5 }))), /part bound/);
  lease = await port.readMany([{ shard: 0, offset: 1, length: 2 }]);
  assert.deepEqual([...lease.bytes], [2, 3]); lease.release();
  await fs.rename(filename, filename + '.saved'); await fs.writeFile(filename, bytes);
  await assert.rejects(port.readMany([{ shard: 0, offset: 0, length: 4 }]), /identity changed/);
  await fs.unlink(filename); await fs.rename(filename + '.saved', filename);
  const abort = new AbortController(); abort.abort(new Error('cancelled real batch'));
  await assert.rejects(port.readMany(nineRanges, abort.signal), /cancelled real batch/);
  lease = await port.readMany(nineRanges);
  assert.deepEqual([...lease.bytes], [...bytes]); lease.release();
  await source.storage.close();
  await assert.rejects(port.readMany([{ shard: 0, offset: 0, length: 4 }]), /closed/);
  console.log('native-diagnostic-gather-contract: real selected worker boundaries, partial/full SHA, swap, cancel/recovery and close passed');
} finally { await source?.storage.close(); await fs.rm(root, { recursive: true, force: true }); }
