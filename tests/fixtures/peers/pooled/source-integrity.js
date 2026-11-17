// Out-of-band content proof: the peer's timed file reader stays unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].map(String).join(':');
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);

/** Endpoint continuity only; this never claims authenticated peer reads. */
export async function verifySourceAliases(files, signal) {
  assert(Array.isArray(files) && files.length > 0, 'Explicit frozen source aliases required');
  const selected = structuredClone(files);
  for (const file of selected) {
    signal?.throwIfAborted();
    assert(path.isAbsolute(file.path) && path.isAbsolute(file.canonicalPath)
      && typeof file.stamp === 'string' && typeof file.aliasStamp === 'string', 'Frozen source alias identity missing');
    const before = await fs.lstat(file.path, { bigint: true });
    assert.equal(stamp(before), file.aliasStamp, 'Frozen source alias changed');
    assert.equal(await fs.realpath(file.path), file.canonicalPath, 'Frozen source alias target changed');
    const target = await fs.lstat(file.canonicalPath, { bigint: true });
    assert(target.isFile() && stamp(target) === file.stamp, 'Frozen source file changed');
    assert.equal(stamp(await fs.lstat(file.path, { bigint: true })), file.aliasStamp, 'Frozen source alias changed during verification');
  }
  signal?.throwIfAborted();
  return { filesChecked: selected.length, scope: 'Frozen source alias and target continuity at verification; not per-read authentication' };
}

function admit(config) {
  assert(Array.isArray(config.files) && config.files.length > 0 && new Set(config.files.map(file => file.path)).size === config.files.length,
    'Explicit unique source proof files required');
  assert(Number.isSafeInteger(config.timeoutMs) && config.timeoutMs > 0, 'Finite source proof deadline required');
  for (const file of config.files) {
    assert(path.isAbsolute(file.path) && path.isAbsolute(file.canonicalPath) && sha(file.sha256)
      && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && typeof file.stamp === 'string' && typeof file.aliasStamp === 'string',
    'Complete frozen source identity and expected content hash required');
  }
  const files = structuredClone(config.files);
  assert(Number.isSafeInteger(files.reduce((sum, file) => sum + file.bytes, 0)), 'Source proof total exceeds finite-byte accounting');
  const active = AbortSignal.any([AbortSignal.timeout(config.timeoutMs), ...(config.signal ? [config.signal] : [])]);
  assert(Number.isInteger(constants.O_NOFOLLOW) && Number.isInteger(constants.O_NONBLOCK), 'No-follow proof admission required');
  active.throwIfAborted();
  return { files, active };
}

async function current(file, active) {
  active.throwIfAborted();
  assert.equal(await fs.realpath(file.path), file.canonicalPath, 'Source proof alias target changed');
  assert.equal(stamp(await fs.lstat(file.path, { bigint: true })), file.aliasStamp, 'Source proof alias changed');
  const stat = await fs.lstat(file.canonicalPath, { bigint: true });
  assert(stat.isFile() && Number(stat.size) === file.bytes && stamp(stat) === file.stamp, 'Source proof file changed');
  active.throwIfAborted();
}

export async function proveSourceIntegrity(config) {
  const { files, active } = admit(config);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  assert(Number.isSafeInteger(total) && Number.isSafeInteger(config.maxBytes) && config.maxBytes >= total
    && Number.isSafeInteger(config.maxReadBytes) && config.maxReadBytes > 0 && config.maxReadBytes <= 8 * 1024 ** 2,
  'Source proof exceeds its explicit complete-byte or read-buffer budget');
  const scratch = new Uint8Array(config.maxReadBytes);
  let verifiedBytes = 0;
  for (const file of files) {
    await current(file, active);
    const handle = await fs.open(file.canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let failure;
    try {
      assert.equal(stamp(await handle.stat({ bigint: true })), file.stamp, 'Source proof descriptor changed at admission');
      const hash = createHash('sha256'); let offset = 0;
      while (offset < file.bytes) {
        active.throwIfAborted();
        const result = await handle.read(scratch, 0, Math.min(scratch.length, file.bytes - offset), offset);
        assert(result.bytesRead > 0, 'Source proof read truncated');
        hash.update(scratch.subarray(0, result.bytesRead)); offset += result.bytesRead;
      }
      active.throwIfAborted();
      assert.equal(hash.digest('hex'), file.sha256, 'Source content does not match its frozen hash');
      assert.equal(stamp(await handle.stat({ bigint: true })), file.stamp, 'Source proof descriptor changed during hashing');
      await current(file, active); verifiedBytes += file.bytes;
    } catch (error) { failure = error; }
    try { await handle.close(); }
    catch (error) { failure = failure ? new AggregateError([failure, error], 'Source proof and descriptor cleanup failed') : error; }
    if (failure) throw failure;
  }
  for (const file of files) await current(file, active);
  return { schema: 'reploid.peer-source-integrity/v1', completed: true, files, verifiedBytes,
    scope: 'Complete declared file hashes verified through identity-bound descriptors before timing; later continuity checks are not per-read authentication of the unmodified peer' };
}

export async function readSourceProofMetadata(filename, signal, maxBytes = 1024 ** 2) {
  signal?.throwIfAborted();
  assert(path.isAbsolute(filename) && Number.isInteger(constants.O_NOFOLLOW) && Number.isInteger(constants.O_NONBLOCK),
    'Explicit no-follow source proof metadata path required');
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1024 ** 2, 'Finite source proof metadata budget required');
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let bytes;
  try {
    const before = await handle.stat({ bigint: true });
    assert(before.isFile() && before.size <= BigInt(maxBytes), 'Source proof receipt exceeds its metadata budget');
    bytes = new Uint8Array(Number(before.size)); let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const result = await handle.read(bytes, offset, bytes.length - offset, offset);
      assert(result.bytesRead > 0, 'Source proof receipt truncated'); offset += result.bytesRead;
    }
    assert.equal(stamp(await handle.stat({ bigint: true })), stamp(before), 'Source proof receipt changed');
    assert.equal(stamp(await fs.lstat(filename, { bigint: true })), stamp(before), 'Source proof receipt replaced');
    signal?.throwIfAborted();
  } finally { await handle.close(); }
  return bytes;
}

async function verifyReceipt(receipt, files, active) {
  assert(receipt.schema === 'reploid.peer-source-integrity/v1' && receipt.completed === true, 'Incomplete source proof');
  assert.deepEqual(receipt.files, files, 'Source proof does not bind the complete selected file set');
  assert.equal(receipt.verifiedBytes, files.reduce((sum, file) => sum + file.bytes, 0), 'Source proof coverage differs');
  for (const file of files) await current(file, active);
}

export async function verifySourceIntegrityProof(config) {
  const { files, active } = admit(config);
  assert(config.proof && path.isAbsolute(config.proof.path) && sha(config.proof.sha256), 'Pinned complete source proof required');
  const bytes = await readSourceProofMetadata(config.proof.path, active);
  assert.equal(digest(bytes), config.proof.sha256, 'Source proof receipt identity differs');
  const receipt = JSON.parse(new TextDecoder().decode(bytes));
  await verifyReceipt(receipt, files, active);
  return { ready: true, receiptSha256: config.proof.sha256, verifiedBytes: receipt.verifiedBytes,
    scope: receipt.scope, timedPeerReaderModified: false };
}

/** Compose completed descriptor-bound proofs without rereading source contents. */
export async function composeSourceIntegrityProof(config) {
  const { files, active } = admit(config);
  const proofs = structuredClone(config.proofs);
  assert(Array.isArray(proofs) && proofs.length > 0 && proofs.length <= files.length,
    'Explicit bounded source proof components required');
  assert(Number.isSafeInteger(config.maxProofBytes) && config.maxProofBytes > 0 && config.maxProofBytes <= 1024 ** 2,
    'Finite total source proof metadata budget required');
  const expected = new Map(files.map(file => [file.path, file]));
  const covered = new Set();
  let metadataBytes = 0;
  for (const proof of proofs) {
    active.throwIfAborted();
    assert(proof && path.isAbsolute(proof.path) && sha(proof.sha256), 'Pinned source proof component required');
    const bytes = await readSourceProofMetadata(proof.path, active, config.maxProofBytes - metadataBytes);
    metadataBytes += bytes.length;
    assert.equal(digest(bytes), proof.sha256, 'Source proof component identity differs');
    const receipt = JSON.parse(new TextDecoder().decode(bytes));
    assert(Array.isArray(receipt.files) && receipt.files.length > 0, 'Source proof component has no files');
    const selected = receipt.files.map(file => {
      assert(expected.has(file.path), 'Source proof component contains an unselected file');
      assert(!covered.has(file.path), 'Source proof components overlap');
      covered.add(file.path);
      return expected.get(file.path);
    });
    await verifyReceipt(receipt, selected, active);
  }
  assert.equal(covered.size, files.length, 'Source proof components omit selected files');
  // Recheck all members after the last component, including the earliest proof.
  for (const file of files) await current(file, active);
  return { schema: 'reploid.peer-source-integrity/v1', completed: true, files,
    verifiedBytes: files.reduce((sum, file) => sum + file.bytes, 0), componentProofs: proofs, metadataBytes,
    scope: 'Complete selected coverage composed from pinned descriptor-bound content proofs with current file continuity; not per-read authentication of the unmodified peer' };
}

/** Build coverage from the admitted manifest/index, never from a caller's subset. */
export async function requiredSourceIntegrityFiles(metadata, layout, signal) {
  const selected = new Map();
  const add = async (filename, bytes, sha256) => {
    signal?.throwIfAborted();
    assert(filename && Number.isSafeInteger(bytes) && bytes >= 0 && sha(sha256), 'Missing source content commitment');
    const canonicalPath = await fs.realpath(filename), stat = await fs.lstat(canonicalPath, { bigint: true });
    assert(stat.isFile() && Number(stat.size) === bytes, 'Source proof file extent differs');
    const file = { path: canonicalPath, canonicalPath, bytes, sha256, stamp: stamp(stat), aliasStamp: stamp(stat) };
    if (selected.has(canonicalPath)) assert.deepEqual(selected.get(canonicalPath), file, 'Conflicting source commitments');
    selected.set(canonicalPath, file);
  };
  for (const file of metadata.index.files) {
    if (layout.fullFiles[file.path]) {
      const shard = metadata.manifest.shards.find(value => value.filename === file.path);
      assert(shard && (shard.hashAlgorithm ?? metadata.manifest.hashAlgorithm) === 'sha256',
        'Full source proof requires an explicit SHA256 shard commitment; tokenizer may use authenticated pieces');
      await add(layout.fullFiles[file.path], file.size, shard.hash);
    } else {
      assert(file.path === 'tokenizer.json', 'Missing source proof file');
      for (const piece of file.pieces) {
        assert(/^sha256:[a-f0-9]{64}$/u.test(piece.identity), 'Missing tokenizer piece commitment');
        await add(layout.readFiles[file.path + '.' + piece.offset], piece.size, piece.identity.slice(7));
      }
    }
  }
  signal?.throwIfAborted();
  return [...selected.values()].sort((a, b) => a.path.localeCompare(b.path, 'en'));
}
