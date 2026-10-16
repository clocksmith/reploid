import { sha256Hex } from './signatures.js';

export const computeManifestShardSetHash = async (manifest = {}) => {
  const shards = Array.isArray(manifest?.shards) ? manifest.shards : [];
  if (shards.length === 0) return null;
  const shardHashInput = shards
    .map((shard) => {
      const filename = typeof shard?.filename === 'string' ? shard.filename : '';
      const size = Number.isFinite(Number(shard?.size)) ? Number(shard.size) : '';
      const hash = typeof shard?.hash === 'string'
        ? shard.hash
        : (typeof shard?.blake3 === 'string' ? shard.blake3 : '');
      return `${filename}:${size}:${hash}`;
    })
    .join('\n');
  return sha256Hex(shardHashInput);
};
