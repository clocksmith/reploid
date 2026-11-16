// Private peer-derived data provisioning only. No model execution or GPU work.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const align = size => Math.ceil(size / 32) * 32;

export function q8OverlayHeader(tensors) {
  assert(Array.isArray(tensors) && tensors.length > 0 && new Set(tensors.map(([name]) => name)).size === tensors.length,
    'Nonempty unique overlay tensor names required');
  let size = 24, offset = 0;
  const rows = tensors.map(([name, tensor]) => {
    assert(tensor.dtype === 'Q5_0' && tensor.shape.length === 2
      && tensor.shape.every(dimension => Number.isSafeInteger(dimension) && dimension > 0) && tensor.shape[1] % 32 === 0
      && tensor.spans == null && tensor.sourceTransform == null && tensor.storage == null, 'Explicit contiguous Q5 matrix required');
    const elements = tensor.shape[0] * tensor.shape[1];
    assert(Number.isSafeInteger(elements) && Number.isSafeInteger(elements / 32)
      && tensor.size === elements / 32 * 22, 'Q5 metadata geometry differs');
    const encoded = Buffer.from(name), bytes = elements / 32 * 34;
    size += 8 + encoded.length + 4 + 8 * tensor.shape.length + 4 + 8;
    offset = align(offset);
    const row = { name, tensor: structuredClone(tensor), encoded, relativeOffset: offset, size: bytes };
    offset += bytes; return row;
  });
  const header = Buffer.alloc(align(size)); let cursor = 0;
  const u32 = value => { header.writeUInt32LE(value, cursor); cursor += 4; };
  const u64 = value => { header.writeBigUInt64LE(BigInt(value), cursor); cursor += 8; };
  u32(0x46554747); u32(3); u64(rows.length); u64(0);
  for (const row of rows) {
    u64(row.encoded.length); row.encoded.copy(header, cursor); cursor += row.encoded.length;
    u32(row.tensor.shape.length);
    for (const dimension of [...row.tensor.shape].reverse()) u64(dimension);
    u32(8); u64(row.relativeOffset);
    row.offset = header.length + row.relativeOffset;
  }
  return { header, rows, size: header.length + offset };
}

export async function writeQ5Overlay({ directory, tensors, readTensor, converter, maxBytes, signal }) {
  assert(path.isAbsolute(directory), 'Explicit private overlay directory required');
  const layout = q8OverlayHeader(tensors);
  assert(Number.isSafeInteger(maxBytes) && layout.size <= maxBytes, 'Overlay exceeds its declared output bound');
  await fs.mkdir(directory);
  const partial = path.join(directory, 'q5-peer-q8.gguf.partial'), filename = path.join(directory, 'q5-peer-q8.gguf');
  const handle = await fs.open(partial, 'wx', 0o600);
  const digest = createHash('sha256'), pieces = [], converted = [];
  let position = 0;
  const write = async bytes => {
    signal?.throwIfAborted();
    const offset = position;
    let copied = 0;
    while (copied < bytes.length) {
      const result = await handle.write(bytes, copied, bytes.length - copied, position);
      assert(result.bytesWritten > 0, 'Truncated overlay write');
      copied += result.bytesWritten; position += result.bytesWritten;
      signal?.throwIfAborted();
    }
    digest.update(bytes);
    pieces.push({ offset, size: bytes.length, identity: sha(bytes) });
  };
  try {
    await write(layout.header);
    for (const row of layout.rows) {
      signal?.throwIfAborted();
      if (position < row.offset) await write(new Uint8Array(row.offset - position));
      const raw = await readTensor(row.name, row.tensor, signal);
      const result = await converter.convert(raw, row.tensor.shape);
      assert(result.packed.length === row.size, 'Converted tensor length differs');
      await write(result.packed);
      converted.push({ name: row.name, source: row.tensor, offset: row.offset, size: row.size, shape: row.tensor.shape,
        packedIdentity: sha(result.packed), quantSha256: result.quantSha256, scaleSha256: result.scaleSha256 });
    }
    assert(position === layout.size, 'Overlay extent differs');
    await handle.sync();
  } finally { await handle.close(); }
  signal?.throwIfAborted();
  await fs.rename(partial, filename);
  return { filename, size: layout.size, identity: 'sha256:' + digest.digest('hex'), pieces, converted,
    scope: 'Explicit peer-derived Q5-to-Q8 weight values; no original-source equivalence or inference qualification' };
}

export function deriveQ8Manifest({ manifestBytes, indexBytes, modelId, overlay, converterIdentity }) {
  const parentIdentity = sha(manifestBytes), parentIndexIdentity = sha(indexBytes);
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)), index = JSON.parse(new TextDecoder().decode(indexBytes));
  assert(index.manifestIdentity === parentIdentity && typeof modelId === 'string' && modelId !== manifest.modelId,
    'New derivative identity and parent manifest binding required');
  const source = manifest.metadata.sourceRuntime, shardIndex = manifest.shards.length;
  assert(source.sourceFiles.length === shardIndex, 'Parent source/shard binding differs');
  const filename = 'source_' + String(shardIndex).padStart(5, '0') + '.bin';
  const offset = manifest.shards.reduce((sum, shard) => sum + shard.size, 0);
  manifest.modelId = modelId;
  manifest.shards.push({ index: shardIndex, filename, size: overlay.size, hash: overlay.identity.slice(7), hashAlgorithm: 'sha256', offset });
  source.sourceFiles.push({ index: shardIndex, filename, path: overlay.filename, size: overlay.size,
    hash: overlay.identity.slice(7), hashAlgorithm: 'sha256' });
  source.sourceFileCount = source.sourceFiles.length;
  for (const row of overlay.converted) {
    const original = manifest.tensors[row.name];
    assert(original.dtype === 'Q5_0' && JSON.stringify(original) === JSON.stringify(row.source), 'Converted source tensor changed');
    manifest.tensors[row.name] = { ...original, shard: shardIndex, offset: row.offset, size: row.size, dtype: 'Q8_0' };
  }
  manifest.totalSize = offset + overlay.size;
  const previous = manifest.metadata.representationControl;
  manifest.metadata.representationControl = { ...previous,
    scope: 'Explicit expanded peer-effective-weight derivative; original-source equivalence and performance remain unqualified',
    parentManifestIdentity: parentIdentity, parentIndexIdentity, additionalOverlayIdentity: overlay.identity,
    targetConversionWorkerIdentity: converterIdentity,
    replacedTensors: [...(previous?.replacedTensors ?? []), ...overlay.converted.map(row => row.name)],
    additionalConvertedTensors: overlay.converted,
  };
  const derived = new TextEncoder().encode(JSON.stringify(manifest, null, 2) + '\n');
  index.manifestIdentity = sha(derived);
  index.files.push({ path: filename, size: overlay.size, pieces: overlay.pieces });
  index.maxPieceBytes = Math.max(index.maxPieceBytes, ...overlay.pieces.map(piece => piece.size));
  return { manifestBytes: derived, indexBytes: new TextEncoder().encode(JSON.stringify(index) + '\n'),
    modelId, manifestIdentity: sha(derived), parentManifestIdentity: parentIdentity, sourceFilename: filename };
}
