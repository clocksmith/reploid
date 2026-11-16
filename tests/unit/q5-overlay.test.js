// @vitest-environment node
import { it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { q8OverlayHeader, writeQ5Overlay, deriveQ8Manifest } from '../fixtures/peers/pooled/q5-overlay.js';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const encode = value => new TextEncoder().encode(JSON.stringify(value));

it('writes exact bounded Q8 extents and publishes a distinct manifest/index only after completed data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'q5-overlay-'));
  try {
    const tensor = { dtype: 'Q5_0', shape: [1, 32], size: 22, shard: 0, offset: 0 };
    const tensors = [['first.weight', tensor], ['second.weight', { ...tensor, offset: 22 }]];
    const packed = Uint8Array.from({ length: 34 }, (_, i) => i);
    const layout = q8OverlayHeader(tensors);
    expect(layout.header.readUInt32LE(0)).toBe(0x46554747);
    expect(layout.header.readBigUInt64LE(8)).toBe(2n);
    expect(layout.rows[1].offset - layout.rows[0].offset).toBe(64);
    const overlay = await writeQ5Overlay({ directory: path.join(root, 'output'), tensors, maxBytes: 4096,
      readTensor: async () => new ArrayBuffer(22), converter: { async convert() {
        return { packed, quantSha256: 'fixture-quant', scaleSha256: 'fixture-scale' };
      } } });
    const bytes = await fs.readFile(overlay.filename);
    expect(sha(bytes)).toBe(overlay.identity);
    expect(bytes.subarray(overlay.converted[0].offset, overlay.converted[0].offset + 34)).toEqual(Buffer.from(packed));
    expect(overlay.pieces.reduce((sum, piece) => sum + piece.size, 0)).toBe(bytes.length);
    for (const piece of overlay.pieces) expect(sha(bytes.subarray(piece.offset, piece.offset + piece.size))).toBe(piece.identity);
    const manifest = { modelId: 'original', totalSize: 44, shards: [{ index: 0, filename: 'source_00000.bin', size: 44 }],
      tensors: Object.fromEntries(tensors), metadata: { sourceRuntime: { sourceFileCount: 1,
        sourceFiles: [{ index: 0, filename: 'source_00000.bin', size: 44 }] } } };
    const manifestBytes = encode(manifest), indexBytes = encode({ manifestIdentity: sha(manifestBytes), maxPieceBytes: 22, files: [] });
    const derived = deriveQ8Manifest({ manifestBytes, indexBytes, modelId: 'peer-q8-v2', overlay, converterIdentity: 'sha256:fixture' });
    const next = JSON.parse(new TextDecoder().decode(derived.manifestBytes));
    expect(next.modelId).toBe('peer-q8-v2'); expect(next.tensors['first.weight'].dtype).toBe('Q8_0');
    expect(next.metadata.representationControl.parentManifestIdentity).toBe(sha(manifestBytes));
    expect(JSON.parse(new TextDecoder().decode(derived.indexBytes)).manifestIdentity).toBe(derived.manifestIdentity);
    expect(manifest.tensors['first.weight'].dtype).toBe('Q5_0');
    expect(() => deriveQ8Manifest({ manifestBytes, indexBytes, modelId: 'original', overlay })).toThrow('New derivative');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('leaves cancelled private data partial, closes the descriptor and publishes no final overlay', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'q5-cancel-')), control = new AbortController();
  try {
    const directory = path.join(root, 'output');
    await expect(writeQ5Overlay({ directory, tensors: [['weight', { dtype: 'Q5_0', shape: [1, 32], size: 22 }]], maxBytes: 1024,
      signal: control.signal, readTensor: async () => new ArrayBuffer(22), converter: { async convert() {
        control.abort(new Error('cancel output')); return { packed: new Uint8Array(34) };
      } } })).rejects.toThrow('cancel output');
    await expect(fs.stat(path.join(directory, 'q5-peer-q8.gguf'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await fs.stat(path.join(directory, 'q5-peer-q8.gguf.partial'))).size).toBeGreaterThan(0);
    // Reopening and removing the partial uses real filesystem ownership after settlement.
    const handle = await fs.open(path.join(directory, 'q5-peer-q8.gguf.partial'), 'r+'); await handle.close();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
