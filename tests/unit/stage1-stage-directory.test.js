// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildStageDirectory, loadPinnedStage, stageDirectoryBytesNeeded, stageDirectoryOperation, STAGE_DIRECTORY_MANIFEST, verifyStageDirectory }
  from '../../scripts/stage1/build-stage-directory.js';
import { createStageLoader } from '../../scripts/stage1/stage-loader.js';
import { measureHeldRanges, summarizeRanges } from '../../scripts/stage1/inventory.js';
import { STAGE1_MODEL_ID, STAGE1_PINS } from '../../scripts/stage1/expectations.js';
import { metadataFiles, metadataPieces } from '../../scripts/stage1/stage-metadata.js';
import catalog from '../../shared/config/chat-models.json' with { type: 'json' };

const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const INVENTORY = 'f'.repeat(64);
let root;
beforeEach(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'stage1-stage-dir-'))); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

/**
 * Three shards: s0 holds stage 0 only, s2 stage 1 only, and s1 holds ranges of both stages, interleaved, with an
 * unassigned gap. Every piece has distinct non-zero bytes.
 */
async function syntheticCopy({ zeroOtherPiece = false } = {}) {
  let seed = 0;
  const piece = size => Buffer.alloc(size, ++seed);
  const layout = { 's0.bin': [[0, 0, 24], [0, 24, 40]], 's1.bin': [[0, 0, 16], [1, 16, 32], [null, 48, 8], [0, 56, 16], [1, 72, 24]], 's2.bin': [[1, 0, 64]] };
  const stageRanges = [[], []], files = {};
  for (const [name, rows] of Object.entries(layout)) {
    const parts = rows.map(([stage, offset, size], index) => {
      const bytes = zeroOtherPiece && name === 's1.bin' && index === 1 ? Buffer.alloc(size) : piece(size);
      if (stage !== null) stageRanges[stage].push({ path: name, offset, size, identity: sha(bytes) });
      return bytes;
    });
    files[name] = Buffer.concat(parts);
  }
  const manifest = Buffer.from(JSON.stringify({ modelId: 'synthetic', shards: Object.entries(files).map(([filename, bytes]) => ({ filename, size: bytes.length })),
    tokenizer: { type: 'bundled', file: 'tokenizer.json' } }));
  // Non-weight files, as the catalog lists them by role: the tokenizer is split into two index pieces like the real one.
  const tokenizer = Buffer.from(JSON.stringify({ model: { type: 'BPE', vocab: { a: 0, b: 1 } } }));
  const index = Buffer.from(JSON.stringify({ schema: 'doppler.verified-pieces/v1', files: [
    { path: 'tokenizer.json', size: tokenizer.length, pieces: [{ offset: 0, size: 16, identity: sha(tokenizer.subarray(0, 16)) },
      { offset: 16, size: tokenizer.length - 16, identity: sha(tokenizer.subarray(16)) }] }] }));
  const source = path.join(root, 'full');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'manifest.json'), manifest);
  await fs.writeFile(path.join(source, 'tokenizer.json'), tokenizer);
  await fs.writeFile(path.join(source, 'pieces.json'), index);
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(path.join(source, name), bytes);
  const file = (role, name, bytes) => ({ path: name, role, sizeBytes: bytes.length, hashAlgorithm: 'sha256', hash: sha(bytes).slice(7) });
  const model = { id: 'synthetic', identity: sha(manifest), source: { files: [file('model-manifest', 'manifest.json', manifest),
    file('tokenizer', 'tokenizer.json', tokenizer), file('model-piece-index', 'pieces.json', index)] } };
  const stage = index => ({ stageIndex: index, stageRanges: stageRanges[index], otherRanges: stageRanges[1 - index],
    pin: summarizeRanges(stageRanges[index]), model, inventorySha256: INVENTORY });
  return { source, files, stageRanges, model, stage, tokenizer, index };
}

const snapshot = async directory => {
  const rows = {};
  for (const name of (await fs.readdir(directory)).sort()) {
    const file = path.join(directory, name), stat = await fs.stat(file);
    rows[name] = { digest: sha(await fs.readFile(file)), mtimeMs: stat.mtimeMs, mode: stat.mode };
  }
  return rows;
};

describe('the stage directory builder', () => {
  // Pure arithmetic. No Windows machine has built a stage directory.
  it('asks for the assigned bytes where files are sparse, and for each shard up to its last assigned range on Windows', () => {
    const files = new Map([['shard-a.bin', [{ offset: 0, size: 100 }, { offset: 900, size: 100 }]], ['shard-b.bin', [{ offset: 5000, size: 50 }]]]);
    const input = { files, assignedBytes: 250, metadataBytes: 30 };
    expect(stageDirectoryBytesNeeded({ ...input, platform: 'linux' })).toBe(280);
    expect(stageDirectoryBytesNeeded({ ...input, platform: 'darwin' })).toBe(280);
    expect(stageDirectoryBytesNeeded({ ...input, platform: 'win32' })).toBe(1000 + 5050 + 30);
  });

  it('writes each stage exactly its assigned ranges, copying only assigned bytes out of the shard both stages share', async () => {
    const copy = await syntheticCopy(), before = await snapshot(copy.source), all = copy.stageRanges.flat();
    for (const index of [0, 1]) {
      const target = path.join(root, `stage-${index}`);
      const built = await buildStageDirectory({ ...copy.stage(index), source: copy.source, target });
      expect(built).toMatchObject({ built: true, verified: 'hashed', stageIndex: index, ...summarizeRanges(copy.stageRanges[index]) });
      expect((await measureHeldRanges({ directory: target, ranges: all })).map(row => `${row.path}:${row.offset}`).sort())
        .toEqual(copy.stageRanges[index].map(row => `${row.path}:${row.offset}`).sort());
      const names = await fs.readdir(target);
      expect(names.sort()).toEqual(['manifest.json', 'pieces.json', 'tokenizer.json', STAGE_DIRECTORY_MANIFEST,
        ...new Set(copy.stageRanges[index].map(row => row.path))].sort());
      expect(await fs.readFile(path.join(target, 'tokenizer.json'))).toEqual(copy.tokenizer);
      // In the shared shard, every byte outside this stage's ranges is zero: nothing of the other stage was copied.
      const shared = await fs.readFile(path.join(target, 's1.bin'));
      const mine = copy.stageRanges[index].filter(row => row.path === 's1.bin');
      shared.forEach((byte, offset) => {
        const assigned = mine.some(row => offset >= row.offset && offset < row.offset + row.size);
        expect(byte === copy.files['s1.bin'][offset] || (!assigned && byte === 0)).toBe(true);
        if (!assigned) expect(byte).toBe(0);
      });
      expect(JSON.parse(await fs.readFile(path.join(target, STAGE_DIRECTORY_MANIFEST), 'utf8'))).toMatchObject({
        schema: 'reploid.stage1-stage-directory/v1', modelIdentity: copy.model.identity, inventorySha256: INVENTORY, stageIndex: index,
        ...summarizeRanges(copy.stageRanges[index]),
        metadataFiles: copy.model.source.files.map(row => ({ role: row.role, path: row.path, bytes: row.sizeBytes, digest: 'sha256:' + row.hash })) });
    }
    expect(await snapshot(copy.source)).toEqual(before);
  });

  it('then serves, through the stage loader, the tokenizer as metadata and exactly the assigned ranges, and refuses the other stage', async () => {
    const copy = await syntheticCopy(), target = path.join(root, 'stage-1');
    await buildStageDirectory({ ...copy.stage(1), source: copy.source, target });
    const pieces = metadataPieces(copy.model, copy.index);
    expect(pieces.map(row => row.role)).toEqual(['tokenizer', 'tokenizer']);
    const loader = createStageLoader({ directory: target, assignedRanges: copy.stageRanges[1], metadataPieces: pieces });
    for (const piece of pieces) expect(sha(await loader.read(piece))).toBe(piece.identity);
    for (const range of copy.stageRanges[1]) expect(sha(await loader.read(range))).toBe(range.identity);
    for (const range of copy.stageRanges[0]) await expect(loader.read(range)).rejects.toMatchObject({ code: 'stage-loader-refused' });
    expect(loader.accounting()).toEqual({ source: 'stage-loader', ...summarizeRanges(copy.stageRanges[1]),
      outsideStageRanges: copy.stageRanges[0].length, outsideStageBytes: summarizeRanges(copy.stageRanges[0]).bytes,
      metadata: { roles: ['tokenizer'], pieceCount: 2, bytes: copy.tokenizer.length } });
  });

  it('refuses a tokenizer that differs from its pin or is missing, and never counts it as a weight range', async () => {
    const copy = await syntheticCopy(), target = path.join(root, 'stage-0');
    await fs.writeFile(path.join(copy.source, 'tokenizer.json'), Buffer.from('{"changed":true}'));
    await expect(buildStageDirectory({ ...copy.stage(0), source: copy.source, target })).rejects.toMatchObject({ code: 'stage-directory-digest-mismatch' });
    await fs.rm(path.join(copy.source, 'tokenizer.json'));
    await expect(buildStageDirectory({ ...copy.stage(0), source: copy.source, target })).rejects.toMatchObject({ code: 'stage-directory-refused' });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    await fs.writeFile(path.join(copy.source, 'tokenizer.json'), copy.tokenizer);
    await buildStageDirectory({ ...copy.stage(0), source: copy.source, target });
    // The weight inventory a host scan uses sees only tensor ranges: the tokenizer beside them adds nothing.
    expect(summarizeRanges(await measureHeldRanges({ directory: target, ranges: copy.stageRanges.flat() }))).toEqual(summarizeRanges(copy.stageRanges[0]));
  });

  it('refuses a full copy whose bytes differ from a pinned digest, leaving nothing behind and the source untouched', async () => {
    const copy = await syntheticCopy(), target = path.join(root, 'stage-1');
    const corrupted = Buffer.from(copy.files['s1.bin']);
    corrupted[copy.stageRanges[1][0].offset + 3] ^= 0xff;
    await fs.writeFile(path.join(copy.source, 's1.bin'), corrupted);
    const before = await snapshot(copy.source);
    await expect(buildStageDirectory({ ...copy.stage(1), source: copy.source, target })).rejects.toMatchObject({ code: 'stage-directory-digest-mismatch' });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await snapshot(copy.source)).toEqual(before);
  });

  it('never overwrites an existing directory, empty or built', async () => {
    const copy = await syntheticCopy(), target = path.join(root, 'stage-0');
    await fs.mkdir(target);
    await expect(buildStageDirectory({ ...copy.stage(0), source: copy.source, target })).rejects.toMatchObject({ code: 'stage-directory-exists' });
    expect(await fs.readdir(target)).toEqual([]);
    await fs.rmdir(target);
    await buildStageDirectory({ ...copy.stage(0), source: copy.source, target });
    const built = await snapshot(target);
    await expect(buildStageDirectory({ ...copy.stage(0), source: copy.source, target })).rejects.toMatchObject({ code: 'stage-directory-exists' });
    expect(await snapshot(target)).toEqual(built);
  });

  it('refuses ranges that are not the pinned stage, a wrong full copy and a target inside the full copy', async () => {
    const copy = await syntheticCopy(), target = path.join(root, 'stage-0');
    await expect(buildStageDirectory({ ...copy.stage(0), pin: { ...copy.stage(0).pin, bytes: 1 }, source: copy.source, target }))
      .rejects.toMatchObject({ code: 'stage-directory-pin-mismatch' });
    await expect(buildStageDirectory({ ...copy.stage(0), model: { ...copy.model, identity: sha(Buffer.from('other')) }, source: copy.source, target }))
      .rejects.toMatchObject({ code: 'WRONG_WEIGHTS' });
    await expect(buildStageDirectory({ ...copy.stage(0), source: copy.source, target: path.join(copy.source, 'stage') }))
      .rejects.toMatchObject({ code: 'stage-directory-refused' });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses a layout where an unwritten gap would read back as an other-stage range', async () => {
    const copy = await syntheticCopy({ zeroOtherPiece: true }), target = path.join(root, 'stage-0');
    await expect(buildStageDirectory({ ...copy.stage(0), source: copy.source, target })).rejects.toMatchObject({ code: 'stage-directory-holds-other-stage' });
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('verifying an existing stage directory', () => {
  it('checks the build record against the pin without rebuilding, and with --hash re-reads every range', async () => {
    const copy = await syntheticCopy(), target = path.join(root, 'stage-1');
    await expect(verifyStageDirectory({ ...copy.stage(1), directory: target })).rejects.toMatchObject({ code: 'stage-directory-unbuilt' });
    await buildStageDirectory({ ...copy.stage(1), source: copy.source, target });
    const built = await snapshot(target);
    expect(await verifyStageDirectory({ ...copy.stage(1), directory: target })).toEqual({ verified: 'record', stageIndex: 1, ...summarizeRanges(copy.stageRanges[1]),
      metadataFiles: copy.model.source.files.map(row => ({ role: row.role, path: row.path, bytes: row.sizeBytes })) });
    expect(await verifyStageDirectory({ ...copy.stage(1), directory: target, hash: true })).toMatchObject({ verified: 'hashed' });
    expect(await snapshot(target)).toEqual(built);
    // The other stage's pin, another inventory, or a different stage index is a mismatch.
    await expect(verifyStageDirectory({ ...copy.stage(0), directory: target })).rejects.toMatchObject({ code: 'stage-directory-mismatch' });
    await expect(verifyStageDirectory({ ...copy.stage(1), inventorySha256: '0'.repeat(64), directory: target })).rejects.toMatchObject({ code: 'stage-directory-mismatch' });
    // A changed tokenizer fails even the record check: metadata files are always re-hashed (they are small).
    await fs.writeFile(path.join(target, 'tokenizer.json'), Buffer.from('{}'));
    await expect(verifyStageDirectory({ ...copy.stage(1), directory: target })).rejects.toMatchObject({ code: 'stage-directory-mismatch' });
    await fs.writeFile(path.join(target, 'tokenizer.json'), copy.tokenizer);
    // A changed written byte passes the record check but not the hash check.
    const file = path.join(target, 's2.bin'), bytes = await fs.readFile(file);
    bytes[5] ^= 0xff;
    await fs.writeFile(file, bytes);
    await expect(verifyStageDirectory({ ...copy.stage(1), directory: target })).resolves.toMatchObject({ verified: 'record' });
    await expect(verifyStageDirectory({ ...copy.stage(1), directory: target, hash: true })).rejects.toMatchObject({ code: 'stage-directory-digest-mismatch' });
    await fs.truncate(file, 10);
    await expect(verifyStageDirectory({ ...copy.stage(1), directory: target })).rejects.toMatchObject({ code: 'stage-directory-incomplete' });
  });
});

describe('the Stage 1 pin', () => {
  it('gives stage 0 1,051 ranges and stage 1 4,461 ranges, with three shards shared between them', async () => {
    const [zero, one] = await Promise.all([loadPinnedStage(0), loadPinnedStage(1)]);
    expect(summarizeRanges(zero.stageRanges)).toMatchObject({ rangeCount: 1051, bytes: 2759168448 });
    expect(summarizeRanges(one.stageRanges)).toMatchObject({ rangeCount: 4461, bytes: 14235183680 });
    expect(zero.otherRanges).toEqual(one.stageRanges);
    const shared = [...new Set(zero.stageRanges.map(row => row.path))].filter(name => one.stageRanges.some(row => row.path === name));
    expect(shared).toHaveLength(3);
    expect(zero.pin).toEqual({ ...STAGE1_PINS.stages[0], rangesDigest: summarizeRanges(zero.stageRanges).rangesDigest });
  }, 60000);

  it('serves the Stage 1 model\'s non-weight files by catalog role: manifest, tokenizer and piece index', async () => {
    const model = catalog.find(row => row.id === STAGE1_MODEL_ID);
    expect(metadataFiles(model).map(row => [row.role, row.path])).toEqual([['model-manifest', 'manifest.json'], ['tokenizer', 'tokenizer.json'],
      ['model-piece-index', 'qwen27b-q4-pieces.json']]);
    const { readPieceIndexBytes } = await import('../../scripts/stage1/stage-metadata.js');
    const pieces = metadataPieces(model, (await readPieceIndexBytes({ model, modelDirectory: root })).bytes);
    expect(pieces).toHaveLength(3);
    expect(new Set(pieces.map(row => row.path))).toEqual(new Set(['tokenizer.json']));
    expect(pieces.reduce((sum, row) => sum + row.size, 0)).toBe(metadataFiles(model)[1].sizeBytes);
  });

  it('the host operation refuses an operator inventory other than its own pin, and an unknown stage', async () => {
    const body = { action: 'verify', directory: root, stageIndex: 0, stageRanges: [], rangesDigest: 'x' };
    await expect(stageDirectoryOperation({ ...body, inventorySha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'stage-directory-pin-mismatch' });
    await expect(stageDirectoryOperation({ ...body, stageIndex: 2, inventorySha256: STAGE1_PINS.inventorySha256 })).rejects.toMatchObject({ code: 'stage-directory-refused' });
    await expect(stageDirectoryOperation({ ...body, inventorySha256: STAGE1_PINS.inventorySha256 })).rejects.toMatchObject({ code: 'stage-directory-pin-mismatch' });
  });
});
