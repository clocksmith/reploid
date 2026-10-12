/** Resolve signed Capsule paths against their declared manifest location and pinned source. */
export function resolvePartitionArtifactSource(model, manifest, files, artifact) {
  const reject = () => { throw new Error('Capsule artifact differs from the pinned catalog source'); };
  let sourcePath = artifact?.path;
  if (model.capsule !== undefined) {
    const capsule = model.capsule;
    const signed = capsule.artifacts?.find(row => row.artifactId === artifact?.artifactId);
    const signedManifest = capsule.artifacts?.find(row => row.artifactId === capsule.program?.manifestArtifactId);
    if (!signed || !signedManifest || signedManifest.role !== 'manifest'
      || signedManifest.hash !== model.identity
      || ['artifactId', 'role', 'path', 'hash', 'sizeBytes'].some(key => signed[key] !== artifact[key])) reject();
    const origin = 'https://reploid-capsule.invalid/';
    const manifestURL = new URL(signedManifest.path, origin), artifactURL = new URL(artifact.path, origin);
    for (const [url, path] of [[manifestURL, signedManifest.path], [artifactURL, artifact.path]]) {
      if (url.origin !== new URL(origin).origin || url.search || url.hash || url.pathname.slice(1) !== path) reject();
    }
    const directory = signedManifest.path.slice(0, signedManifest.path.lastIndexOf('/') + 1);
    // Metadata outside the manifest directory needs an exact catalog path.
    // Model-local files keep their exact manifest-relative path, never a basename alias.
    if (artifact.path.startsWith(directory)) sourcePath = artifact.path.slice(directory.length);
  }
  const shard = manifest.shards.find(row => row.filename === sourcePath);
  const file = files.find(row => row.path === sourcePath)
    || (shard && { path: shard.filename, role: 'model-weights', sizeBytes: shard.size,
      hash: shard.hash, hashAlgorithm: manifest.hashAlgorithm });
  if (!file || file.sizeBytes !== artifact.sizeBytes || 'sha256:' + file.hash !== artifact.hash
    || file.hashAlgorithm !== 'sha256') reject();
  return file;
}
