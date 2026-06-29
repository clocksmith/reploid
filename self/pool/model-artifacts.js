/**
 * @fileoverview Model artifact URL and manifest validation helpers.
 */

import { BROWSER_RUNTIME_CONFIG } from './config.js';
import { hashJson, sha256Hex } from './inference-receipt.js';

const trimSlashes = (value) => String(value || '').replace(/^\/+|\/+$/g, '');
const pathJoin = (...parts) => parts
  .map((part, index) => {
    const text = String(part || '');
    if (index === 0) return text.replace(/\/+$/g, '');
    return text.replace(/^\/+|\/+$/g, '');
  })
  .filter(Boolean)
  .join('/');

const readResponseBytes = async (response) => {
  if (typeof response.arrayBuffer === 'function') {
    return new Uint8Array(await response.arrayBuffer());
  }
  return new TextEncoder().encode(await response.text());
};

const fetchOk = async (fetchImpl, url, label) => {
  let response = null;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store'
    });
  } catch (cause) {
    const error = new Error(`${label} fetch failed: ${cause?.message || 'network or CORS error'}`);
    error.cause = cause;
    error.url = url;
    error.retryable = true;
    throw error;
  }
  if (!response?.ok) {
    const status = response?.status || 'unknown';
    const statusText = response?.statusText ? ` ${response.statusText}` : '';
    const error = new Error(`${label} fetch failed: ${status}${statusText}`);
    error.status = response?.status || null;
    error.url = url;
    error.retryable = status === 408 || status === 429 || status >= 500;
    throw error;
  }
  return response;
};

const normalizeShardEntry = (entry, index) => {
  if (typeof entry === 'string') {
    return {
      path: entry,
      hash: null,
      index
    };
  }
  return {
    path: entry?.path || entry?.file || entry?.name || null,
    hash: entry?.hash || entry?.sha256 || entry?.shardHash || null,
    bytes: entry?.bytes || entry?.size || null,
    index
  };
};

export function resolveModelArtifactBaseUrl(baseUrl = globalThis.REPLOID_POOL_MODEL_BASE_URL || BROWSER_RUNTIME_CONFIG.modelBaseUrl) {
  const normalized = String(baseUrl || '').trim();
  if (!normalized) throw new Error('model artifact base URL is not configured');
  return normalized.replace(/\/+$/g, '');
}

export function buildModelArtifactUrls(model = {}, { baseUrl } = {}) {
  const modelId = String(model.modelId || model.id || '').trim();
  const manifestHash = String(model.manifestHash || '').trim();
  if (!modelId) throw new Error('modelId is required for artifact URL construction');
  if (!manifestHash) throw new Error('manifestHash is required for artifact URL construction');
  const root = `${resolveModelArtifactBaseUrl(baseUrl)}/${encodeURIComponent(trimSlashes(modelId))}/${encodeURIComponent(trimSlashes(manifestHash))}`;
  return {
    root,
    manifest: `${root}/manifest.json`,
    tokenizer: `${root}/tokenizer.json`,
    shards: `${root}/shards/`
  };
}

export async function verifyModelArtifactManifest({
  model,
  baseUrl,
  fetchImpl = globalThis.fetch
} = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch is required for model artifact manifest verification');
  const urls = buildModelArtifactUrls(model, { baseUrl });
  let response = null;
  try {
    response = await fetchImpl(urls.manifest, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store'
    });
  } catch (cause) {
    const error = new Error(`model manifest fetch failed: ${cause?.message || 'network or CORS error'}`);
    error.cause = cause;
    error.urls = urls;
    error.retryable = true;
    throw error;
  }
  if (!response?.ok) {
    const status = response?.status || 'unknown';
    const statusText = response?.statusText ? ` ${response.statusText}` : '';
    const error = new Error(`model manifest fetch failed: ${status}${statusText}`);
    error.status = response?.status || null;
    error.urls = urls;
    error.retryable = status === 408 || status === 429 || status >= 500;
    throw error;
  }
  const text = await response.text();
  let manifest = null;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(`model manifest is not valid JSON: ${error.message}`);
  }
  const textHash = await sha256Hex(text);
  const jsonHash = await hashJson(manifest);
  const expectedManifestHash = String(model?.manifestHash || '').trim();
  const hashMatches = expectedManifestHash === textHash || expectedManifestHash === jsonHash || expectedManifestHash === manifest.manifestHash || expectedManifestHash === manifest.hash;
  if (expectedManifestHash && !hashMatches) {
    throw new Error('model manifest hash does not match configured manifestHash');
  }
  const modelId = manifest.modelId || manifest.id || model?.modelId || model?.id || null;
  const modelHash = manifest.modelHash || manifest.hash || model?.modelHash || model?.hash || null;
  if (model?.modelId && modelId && modelId !== model.modelId) throw new Error('model manifest modelId mismatch');
  if (model?.modelHash && modelHash && modelHash !== model.modelHash) throw new Error('model manifest modelHash mismatch');
  return {
    ok: true,
    urls,
    manifest,
    manifestHash: expectedManifestHash || textHash,
    observedHashes: {
      textHash,
      jsonHash
    }
  };
}

export function validateModelArtifactManifestShape(manifest = {}) {
  const reasons = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) reasons.push('manifest must be an object');
  if (!manifest.modelId && !manifest.id) reasons.push('manifest.modelId is required');
  if (!manifest.modelHash && !manifest.hash) reasons.push('manifest.modelHash is required');
  if (!manifest.tokenizerHash && !manifest.tokenizer?.hash) reasons.push('manifest tokenizer hash is required');
  const shards = Array.isArray(manifest.shards) ? manifest.shards : [];
  if (shards.length === 0) reasons.push('manifest.shards must contain at least one shard');
  shards.map(normalizeShardEntry).forEach((shard) => {
    if (!shard.path) reasons.push(`manifest.shards.${shard.index}.path is required`);
    if (!shard.hash) reasons.push(`manifest.shards.${shard.index}.hash is required`);
  });
  return {
    ok: reasons.length === 0,
    reasons,
    shards
  };
}

export async function verifyModelArtifactPackage({
  model,
  baseUrl,
  fetchImpl = globalThis.fetch
} = {}) {
  const manifestResult = await verifyModelArtifactManifest({ model, baseUrl, fetchImpl });
  const shape = validateModelArtifactManifestShape(manifestResult.manifest);
  if (!shape.ok) {
    const error = new Error(shape.reasons.join('; '));
    error.reasons = shape.reasons;
    throw error;
  }
  const urls = manifestResult.urls;
  const manifest = manifestResult.manifest;
  const tokenizerHash = manifest.tokenizerHash || manifest.tokenizer?.hash;
  const tokenizerPath = manifest.tokenizer?.path || 'tokenizer.json';
  const tokenizerUrl = pathJoin(urls.root, tokenizerPath);
  const tokenizerBytes = await readResponseBytes(await fetchOk(fetchImpl, tokenizerUrl, 'tokenizer artifact'));
  const observedTokenizerHash = await sha256Hex(tokenizerBytes);
  if (observedTokenizerHash !== tokenizerHash) {
    throw new Error('tokenizer artifact hash mismatch');
  }
  const shardResults = [];
  for (const shard of manifest.shards.map(normalizeShardEntry)) {
    const shardUrl = pathJoin(urls.root, 'shards', shard.path);
    const shardBytes = await readResponseBytes(await fetchOk(fetchImpl, shardUrl, `model shard ${shard.index}`));
    const observedHash = await sha256Hex(shardBytes);
    if (observedHash !== shard.hash) {
      throw new Error(`model shard ${shard.index} hash mismatch`);
    }
    shardResults.push({
      index: shard.index,
      path: shard.path,
      hash: observedHash,
      bytes: shardBytes.byteLength
    });
  }
  const packageIdentity = {
    modelId: manifest.modelId || manifest.id,
    modelHash: manifest.modelHash || manifest.hash,
    manifestHash: manifestResult.manifestHash,
    tokenizerHash: observedTokenizerHash,
    shardHashes: shardResults.map((shard) => shard.hash)
  };
  return {
    ok: true,
    urls,
    manifest,
    packageIdentity,
    tokenizer: {
      path: tokenizerPath,
      hash: observedTokenizerHash
    },
    shards: shardResults
  };
}

export default {
  resolveModelArtifactBaseUrl,
  buildModelArtifactUrls,
  verifyModelArtifactManifest,
  validateModelArtifactManifestShape,
  verifyModelArtifactPackage
};
