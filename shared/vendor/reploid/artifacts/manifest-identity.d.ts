export interface ManifestShardIdentity {
  filename?: string;
  size?: number | string;
  hash?: string;
  blake3?: string;
}

export declare function computeManifestShardSetHash(
  manifest?: { shards?: ManifestShardIdentity[] }
): Promise<string | null>;
