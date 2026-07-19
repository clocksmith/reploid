import { artifactOriginIdentity, validateArtifactOrigin } from '../../self/pool/artifact-origin.js';

export function createGcsAdapterOriginSigner({
  storage,
  expiresMs = 5 * 60 * 1000,
  now = Date.now
} = {}) {
  if (!storage?.bucket) throw new TypeError('Firebase Admin storage is required');
  if (!Number.isInteger(expiresMs) || expiresMs <= 0 || expiresMs > 15 * 60 * 1000) {
    throw new TypeError('expiresMs must be an integer between 1 and 900000');
  }
  return async ({ origin } = {}) => {
    const validation = validateArtifactOrigin(origin);
    if (!validation.ok) throw new Error(validation.reasons.join('; '));
    if (origin.provider !== 'gcs') throw new Error('private adapter delivery currently supports GCS origins only');
    const identity = artifactOriginIdentity(origin);
    const expiresAtMs = now() + expiresMs;
    const file = storage.bucket(identity.bucket).file(identity.object, {
      generation: identity.generation
    });
    const [url] = await file.getSignedUrl({
      version: 'v4',
      action: 'read',
      expires: expiresAtMs
    });
    return {
      origin: identity,
      url,
      expiresAt: new Date(expiresAtMs).toISOString()
    };
  };
}

export default { createGcsAdapterOriginSigner };
