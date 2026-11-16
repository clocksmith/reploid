// @vitest-environment node
import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { proveSourceIntegrity, verifySourceIntegrityProof, requiredSourceIntegrityFiles, readSourceProofMetadata } from '../fixtures/peers/pooled/source-integrity.js';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'peer-source-proof-'));
  const target = path.join(root, 'weight.bin'), filename = path.join(root, 'approved-link');
  const bytes = new Uint8Array(257).fill(3);
  await fs.writeFile(target, bytes); await fs.symlink(target, filename);
  const canonicalPath = await fs.realpath(target);
  const file = { path: filename, canonicalPath, bytes: bytes.length, sha256: hash(bytes),
    stamp: stamp(await fs.lstat(canonicalPath, { bigint: true })), aliasStamp: stamp(await fs.lstat(filename, { bigint: true })) };
  return { root, config: { files: [file], timeoutMs: 1000, maxBytes: 257, maxReadBytes: 64 } };
}
it('proves all selected bytes outside timing and rejects partial coverage or replaced source aliases', async () => {
  const { root, config } = await setup();
  try {
    const proof = await proveSourceIntegrity(config), bytes = JSON.stringify(proof), filename = path.join(root, 'proof.json');
    await fs.writeFile(filename, bytes);
    const pinned = { ...config, proof: { path: filename, sha256: hash(bytes) } };
    expect(await verifySourceIntegrityProof(pinned)).toMatchObject({ ready: true, verifiedBytes: 257, timedPeerReaderModified: false });
    await expect(proveSourceIntegrity({ ...config, maxBytes: 256 })).rejects.toThrow('budget');
    await fs.unlink(config.files[0].path); await fs.symlink(config.files[0].canonicalPath, config.files[0].path);
    await expect(verifySourceIntegrityProof(pinned)).rejects.toThrow('alias changed');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it('rejects content mismatch, mutation during hashing and incomplete receipts', async () => {
  const { root, config } = await setup(), original = fs.open.bind(fs);
  try {
    await expect(proveSourceIntegrity({ ...config, files: [{ ...config.files[0], sha256: '0'.repeat(64) }] })).rejects.toThrow('content');
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await original(...args), read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementationOnce(async (...values) => {
        const result = await read(...values); await fs.writeFile(config.files[0].canonicalPath, new Uint8Array(257)); return result;
      });
      return handle;
    });
    await expect(proveSourceIntegrity(config)).rejects.toThrow();
    const filename = path.join(root, 'incomplete.json'), bytes = JSON.stringify({ schema: 'reploid.peer-source-integrity/v1', completed: false });
    await fs.writeFile(filename, bytes);
    await expect(verifySourceIntegrityProof({ ...config, proof: { path: filename, sha256: hash(bytes) } })).rejects.toThrow('Incomplete');
  } finally { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); }
});
it('settles a real in-flight descriptor on cancellation before any proof can publish', async () => {
  const { root, config } = await setup(), original = fs.open.bind(fs), control = new AbortController();
  let close;
  try {
    vi.spyOn(fs, 'open').mockImplementationOnce(async (...args) => {
      const handle = await original(...args), read = handle.read.bind(handle); close = vi.spyOn(handle, 'close');
      vi.spyOn(handle, 'read').mockImplementationOnce(async (...values) => {
        const result = await read(...values); control.abort(new Error('cancel proof')); return result;
      }); return handle;
    });
    await expect(proveSourceIntegrity({ ...config, signal: control.signal })).rejects.toThrow('cancel proof');
    expect(close).toHaveBeenCalledOnce();
  } finally { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); }
});

it('derives complete content coverage from admitted shards and tokenizer pieces rather than an operator subset', async () => {
  const { root, config } = await setup();
  try {
    const token = path.join(root, 'tokenizer.json.0'); await fs.writeFile(token, Uint8Array.of(7));
    const metadata = { manifest: { hashAlgorithm: 'sha256', shards: [{ filename: 'weights.bin', hash: config.files[0].sha256 }] },
      index: { files: [{ path: 'weights.bin', size: 257 },
        { path: 'tokenizer.json', pieces: [{ offset: 0, size: 1, identity: 'sha256:' + hash(Uint8Array.of(7)) }] }] } };
    const layout = { fullFiles: { 'weights.bin': config.files[0].path }, readFiles: { 'tokenizer.json.0': token } };
    const files = await requiredSourceIntegrityFiles(metadata, layout);
    expect(files).toHaveLength(2); expect(files.reduce((sum, file) => sum + file.bytes, 0)).toBe(258);
    const proof = await proveSourceIntegrity(config), receipt = JSON.stringify(proof), filename = path.join(root, 'proof.json');
    await fs.writeFile(filename, receipt);
    await expect(verifySourceIntegrityProof({ ...config, files, proof: { path: filename, sha256: hash(receipt) } })).rejects.toThrow('complete selected file set');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it('rejects pre-aborted proof admission before opening descriptors and caps metadata allocation', async () => {
  const { root, config } = await setup(), control = new AbortController();
  try {
    const open = vi.spyOn(fs, 'open'); control.abort(new Error('already cancelled'));
    await expect(verifySourceIntegrityProof({ ...config, signal: control.signal })).rejects.toThrow('already cancelled');
    expect(open).not.toHaveBeenCalled();
    const filename = path.join(root, 'oversized.json'); await fs.writeFile(filename, new Uint8Array(1024 ** 2 + 1));
    await expect(readSourceProofMetadata(filename, AbortSignal.timeout(1000))).rejects.toThrow('metadata budget');
  } finally { vi.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); }
});
