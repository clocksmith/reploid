// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fillWholeModelDirectory, wholeModelDirectoryComplete } from '../../server/native-whole-model-fill.js';

const roots = [];
afterEach(() => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function folder() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'reploid-whole-fill-')); roots.push(root); return root; }

function fixture() {
  const pieces = [Buffer.from([1, 2, 3, 4]), Buffer.from([5, 6, 7, 8]), Buffer.from([9, 10])];
  const shard = Buffer.concat(pieces.slice(0, 2)), tokenizer = pieces[2];
  const manifest = { modelId: 'fixture', hashAlgorithm: 'sha256', tokenizer: { file: 'tokenizer.json' },
    shards: [{ index: 0, filename: 'shard_00000.bin', size: 8, hash: hash(shard), offset: 0 }] };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const piece = (bytes, offset) => ({ offset, size: bytes.length, identity: 'sha256:' + hash(bytes) });
  const index = { schema: 'doppler.verified-pieces/v1', manifestIdentity: 'sha256:' + hash(manifestBytes), maxPieceBytes: 4, files: [
    { path: 'shard_00000.bin', size: 8, pieces: [piece(pieces[0], 0), piece(pieces[1], 4)] },
    { path: 'tokenizer.json', size: 2, pieces: [piece(tokenizer, 0)] }] };
  const indexBytes = Buffer.from(JSON.stringify(index));
  const model = { id: 'fixture', identity: 'sha256:' + hash(manifestBytes), source: { files: [
    { path: 'manifest.json', role: 'model-manifest', sizeBytes: manifestBytes.length, hashAlgorithm: 'sha256', hash: hash(manifestBytes) },
    { path: 'tokenizer.json', role: 'tokenizer', sizeBytes: 2, hashAlgorithm: 'sha256', hash: hash(tokenizer) },
    { path: 'pieces.json', role: 'model-piece-index', sizeBytes: indexBytes.length, hashAlgorithm: 'sha256', hash: hash(indexBytes) }] } };
  const byIdentity = new Map(pieces.map(bytes => ['sha256:' + hash(bytes), bytes]));
  const requested = [], events = [];
  const options = root => ({ root, model, manifest, index, freeBytes: async () => 1 << 20, onProgress: event => events.push(event),
    readMetadata: async file => { if (file.path === 'manifest.json') return new Uint8Array(manifestBytes); throw new Error('unexpected ' + file.path); },
    acquire: async piece => { requested.push(piece.identity); return new Uint8Array(byIdentity.get(piece.identity)); } });
  return { model, manifest, manifestBytes, shard, tokenizer, pieces, index, requested, events, options };
}

it('assembles every file from verified pieces, writes the manifest last and is then complete', async () => {
  const f = fixture(), root = await folder(), released = [];
  expect(await wholeModelDirectoryComplete(root, f.model)).toBe(false);
  const result = await fillWholeModelDirectory({ ...f.options(root), release: async file => released.push(file.path) });
  expect(await fs.readFile(path.join(root, 'shard_00000.bin'))).toEqual(f.shard);
  expect(await fs.readFile(path.join(root, 'tokenizer.json'))).toEqual(f.tokenizer);
  expect(await fs.readFile(path.join(root, 'manifest.json'))).toEqual(f.manifestBytes);
  expect((await fs.readdir(root)).sort()).toEqual(['manifest.json', 'shard_00000.bin', 'tokenizer.json']);
  expect(result).toMatchObject({ files: 3, pieces: 3, fetchedPieces: 3, reusedPieces: 0, completedFiles: 3 });
  expect(released).toEqual(['shard_00000.bin', 'tokenizer.json']);
  expect(f.events.map(event => event.phase)).toEqual(['start', 'piece', 'piece', 'file', 'piece', 'file', 'file', 'complete']);
  expect(f.events.filter(event => event.phase === 'file').map(event => event.path).at(-1)).toBe('manifest.json');
  expect(await wholeModelDirectoryComplete(root, f.model)).toBe(true);
});

it('rejects a corrupted piece and leaves no file under its final name', async () => {
  const f = fixture(), root = await folder();
  const options = f.options(root), honest = options.acquire;
  options.acquire = async piece => { const bytes = await honest(piece); if (piece.offset === 4) bytes[0] ^= 0xff; return bytes; };
  await expect(fillWholeModelDirectory(options)).rejects.toMatchObject({ code: 'WHOLE_MODEL_PIECE_REJECTED' });
  const names = await fs.readdir(root);
  expect(names).not.toContain('shard_00000.bin'); expect(names).not.toContain('manifest.json');
  expect(await wholeModelDirectoryComplete(root, f.model)).toBe(false);
});

it('resumes: verified pieces already written are reused, and a damaged final file is repaired', async () => {
  const f = fixture(), root = await folder();
  const first = f.options(root), honest = first.acquire;
  first.acquire = async piece => { if (piece.offset === 4) throw new Error('supplier went away'); return honest(piece); };
  await expect(fillWholeModelDirectory(first)).rejects.toThrow('supplier went away');
  expect(await fs.readdir(root)).toEqual(['shard_00000.bin.partial']);
  f.requested.length = 0;
  const resumed = await fillWholeModelDirectory(f.options(root));
  expect(f.requested).toEqual([f.index.files[0].pieces[1].identity, f.index.files[1].pieces[0].identity]);
  expect(resumed).toMatchObject({ reusedPieces: 1, fetchedPieces: 2 });
  expect(await fs.readFile(path.join(root, 'shard_00000.bin'))).toEqual(f.shard);
  // A same-size file whose bytes differ is not trusted: only its bad piece is fetched again.
  await fs.rm(path.join(root, 'manifest.json'));
  const damaged = Buffer.from(f.shard); damaged[5] ^= 1; await fs.writeFile(path.join(root, 'shard_00000.bin'), damaged);
  f.requested.length = 0;
  const repaired = await fillWholeModelDirectory(f.options(root));
  expect(f.requested).toEqual([f.index.files[0].pieces[1].identity]);
  expect(repaired).toMatchObject({ reusedPieces: 1, fetchedPieces: 1 });
  expect(await fs.readFile(path.join(root, 'shard_00000.bin'))).toEqual(f.shard);
});

it('never overwrites another model and stops when the directory lacks room', async () => {
  const f = fixture(), root = await folder();
  await fs.writeFile(path.join(root, 'manifest.json'), '{"modelId":"other"}');
  await expect(fillWholeModelDirectory(f.options(root))).rejects.toMatchObject({ code: 'WHOLE_MODEL_DIRECTORY_CONFLICT' });
  const empty = await folder();
  await expect(fillWholeModelDirectory({ ...f.options(empty), freeBytes: async () => 4 })).rejects.toMatchObject({ code: 'WHOLE_MODEL_STORAGE' });
  expect(f.requested).toEqual([]);
});
