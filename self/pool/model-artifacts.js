/**
 * @fileoverview Model artifact URL and manifest validation helpers.
 */

import { BROWSER_RUNTIME_CONFIG } from './config.js';
import { hashJson, sha256Hex } from './inference-receipt.js';

const trimSlashes = (value) => String(value || '').replace(/^\/+|\/+$/g, '');

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

export default {
  resolveModelArtifactBaseUrl,
  buildModelArtifactUrls,
  verifyModelArtifactManifest
};
