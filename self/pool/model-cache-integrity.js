/**
 * @fileoverview Fail-closed verification of Doppler's browser-persistent model cache.
 *
 * Reploid uses only the public doppler-gpu/tooling/storage contract. The
 * browser runtime remains responsible for cache layout and IO.
 */

import { hashJson, sha256Hex } from './inference-receipt.js';

export const MODEL_CACHE_INTEGRITY_SCHEMA = 'reploid.pool.model_cache_integrity/v1';

const requiredStorageMethods = Object.freeze([
  'listModels',
  'openModelStore',
  'loadManifestFromStore',
  'loadFileFromStore',
  'computeHash',
  'deleteModel'
]);

const normalizeDigest = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/^[a-z0-9-]+:/, '');

const digestsMatch = (left, right) => (
  !!normalizeDigest(left)
  && normalizeDigest(left) === normalizeDigest(right)
);

const normalizeShard = (shard = {}, index) => ({
  index,
  path: shard.filename || shard.path || shard.file || shard.name || null,
  size: Number.isFinite(Number(shard.size ?? shard.bytes))
    ? Number(shard.size ?? shard.bytes)
    : null,
  hash: shard.hash || shard.blake3 || shard.sha256 || shard.digest || null,
  hashAlgorithm: shard.hashAlgorithm || null
});

const modelHashFromManifest = (manifest = {}) => (
  manifest.modelHash
  || manifest.artifactIdentity?.weightPackHash
  || manifest.artifactIdentity?.shardSetHash
  || null
);

const tokenizerPathFromManifest = (manifest = {}) => (
  manifest.tokenizer?.file
  || manifest.tokenizer?.path
  || manifest.tokenizer?.filename
  || manifest.tokenizer?.name
  || null
);

const readStoredFile = async (storage, path, reasons) => {
  try {
    const payload = await storage.loadFileFromStore(path);
    if (!(payload instanceof ArrayBuffer)) {
      reasons.push(`${path}: stored payload is not an ArrayBuffer`);
      return null;
    }
    return payload;
  } catch (error) {
    reasons.push(`${path}: ${error?.message || 'stored payload is unreadable'}`);
    return null;
  }
};

const invalidateCache = async (storage, modelId, evidence) => {
  const deleted = await storage.deleteModel(modelId);
  if (deleted !== true) {
    throw new Error(`Corrupt persistent model cache could not be invalidated for "${modelId}".`);
  }
  return {
    ...evidence,
    status: 'invalidated',
    valid: false,
    invalidated: true
  };
};

export async function verifyDopplerPersistentModelCache({
  model = {},
  storage,
  checkedAt = new Date().toISOString()
} = {}) {
  const modelId = String(model.modelId || model.id || '').trim();
  if (!modelId) throw new Error('Persistent model cache verification requires modelId.');
  const missingMethods = requiredStorageMethods.filter((method) => typeof storage?.[method] !== 'function');
  if (missingMethods.length > 0) {
    throw new Error(`Doppler storage module is missing public methods: ${missingMethods.join(', ')}`);
  }

  const models = await storage.listModels();
  if (!Array.isArray(models) || !models.includes(modelId)) {
    return {
      schema: MODEL_CACHE_INTEGRITY_SCHEMA,
      checkedAt,
      modelId,
      status: 'not_cached',
      valid: null,
      invalidated: false,
      manifestHash: null,
      files: [],
      reasons: []
    };
  }

  await storage.openModelStore(modelId);
  const reasons = [];
  const files = [];
  let manifestText = null;
  let manifest = null;
  try {
    manifestText = await storage.loadManifestFromStore();
    manifest = JSON.parse(manifestText);
  } catch (error) {
    reasons.push(`manifest.json: ${error?.message || 'stored manifest is unreadable'}`);
  }

  let observedManifestHash = null;
  if (manifest && typeof manifestText === 'string') {
    observedManifestHash = await sha256Hex(manifestText);
    const canonicalManifestHash = await hashJson(manifest);
    if (model.manifestHash
      && !digestsMatch(model.manifestHash, observedManifestHash)
      && !digestsMatch(model.manifestHash, canonicalManifestHash)) {
      reasons.push('manifest.json: hash does not match the configured model contract');
    }
    const storedModelId = manifest.modelId || manifest.id || null;
    if (storedModelId !== modelId) {
      reasons.push(`manifest.json: modelId ${storedModelId || 'missing'} does not match ${modelId}`);
    }
    const storedModelHash = modelHashFromManifest(manifest);
    if (model.modelHash && !digestsMatch(model.modelHash, storedModelHash)) {
      reasons.push('manifest.json: model hash does not match the configured model contract');
    }

    const shards = Array.isArray(manifest.shards)
      ? manifest.shards.map(normalizeShard)
      : [];
    if (shards.length === 0) reasons.push('manifest.json: no shards are declared');
    for (const shard of shards) {
      if (!shard.path || !shard.hash) {
        reasons.push(`manifest.json: shard ${shard.index} lacks a path or digest`);
        continue;
      }
      const payload = await readStoredFile(storage, shard.path, reasons);
      if (!payload) continue;
      const algorithm = shard.hashAlgorithm || manifest.hashAlgorithm;
      if (!algorithm) {
        reasons.push(`${shard.path}: hash algorithm is missing`);
        continue;
      }
      const observedHash = await storage.computeHash(new Uint8Array(payload), algorithm);
      const sizeMatches = shard.size === null || payload.byteLength === shard.size;
      const hashMatches = digestsMatch(shard.hash, observedHash);
      files.push({
        kind: 'shard',
        index: shard.index,
        path: shard.path,
        bytes: payload.byteLength,
        declaredBytes: shard.size,
        hashAlgorithm: algorithm,
        expectedHash: normalizeDigest(shard.hash),
        observedHash: normalizeDigest(observedHash),
        valid: sizeMatches && hashMatches
      });
      if (!sizeMatches) reasons.push(`${shard.path}: stored size does not match the manifest`);
      if (!hashMatches) reasons.push(`${shard.path}: stored hash does not match the manifest`);
    }

    const tokenizerPath = tokenizerPathFromManifest(manifest);
    if (model.tokenizerHash && !tokenizerPath) {
      reasons.push('manifest.json: tokenizer path is missing');
    } else if (model.tokenizerHash && tokenizerPath) {
      const payload = await readStoredFile(storage, tokenizerPath, reasons);
      if (payload) {
        const observedHash = await sha256Hex(new Uint8Array(payload));
        const hashMatches = digestsMatch(model.tokenizerHash, observedHash);
        files.push({
          kind: 'tokenizer',
          path: tokenizerPath,
          bytes: payload.byteLength,
          hashAlgorithm: 'sha256',
          expectedHash: normalizeDigest(model.tokenizerHash),
          observedHash: normalizeDigest(observedHash),
          valid: hashMatches
        });
        if (!hashMatches) reasons.push(`${tokenizerPath}: stored hash does not match the model contract`);
      }
    }
  }

  const evidence = {
    schema: MODEL_CACHE_INTEGRITY_SCHEMA,
    checkedAt,
    modelId,
    status: reasons.length === 0 ? 'verified' : 'invalid',
    valid: reasons.length === 0,
    invalidated: false,
    manifestHash: observedManifestHash,
    files,
    reasons
  };
  if (reasons.length > 0) return invalidateCache(storage, modelId, evidence);
  return evidence;
}

export default {
  MODEL_CACHE_INTEGRITY_SCHEMA,
  verifyDopplerPersistentModelCache
};
