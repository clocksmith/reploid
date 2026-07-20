/**
 * @fileoverview Signed, non-routable publications for adapter runtime canaries.
 */

import {
  SIGNATURE_DOMAINS,
  hashJson,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';

export const ADAPTER_CANARY_PUBLICATION_SCHEMA = 'reploid.pool.adapter-canary-publication/v1';
export const ADAPTER_RUNTIME_CANARY_RECEIPT_SCHEMA = 'reploid.pool.adapter-runtime-canary-receipt/v1';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const REVISION = /^[a-f0-9]{40}$/;
const PACKAGE_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

const withoutFields = (value = {}, fields = []) => Object.fromEntries(
  Object.entries(value || {}).filter(([field]) => !fields.includes(field))
);

const isSafeRelativePath = (value) => {
  const path = String(value || '').trim();
  if (!path || path.startsWith('/') || path.includes('\\')) return false;
  return !path.split('/').some((part) => !part || part === '.' || part === '..');
};

const requireHash = (reasons, value, label) => {
  if (!SHA256.test(String(value || ''))) reasons.push(`${label} must be a sha256 digest`);
};

const requireText = (reasons, value, label) => {
  if (!String(value || '').trim()) reasons.push(`${label} is required`);
};

export const adapterCanaryPublicationSigningPayload = (publication = {}) => (
  withoutFields(publication, ['publicationHash', 'publisherSignature', 'storedAt'])
);

export function validateAdapterCanaryPublication(publication = {}) {
  const reasons = [];
  if (publication.schema !== ADAPTER_CANARY_PUBLICATION_SCHEMA) reasons.push('adapter canary publication schema mismatch');
  requireText(reasons, publication.canaryId, 'canaryId');
  if (publication.role !== 'external_adapter_interoperability_canary') reasons.push('adapter canary role is invalid');
  if (publication.routable !== false) reasons.push('adapter canary must be non-routable');
  if (publication.promotion?.state !== 'canary_only') reasons.push('adapter canary promotion state must be canary_only');
  if (publication.promotion?.qualityClaim !== false) reasons.push('adapter canary qualityClaim must be false');
  if ('pack' in publication || 'packHash' in publication || 'adapterRequirement' in publication) {
    reasons.push('adapter canary publication cannot contain routable adapter-pack fields');
  }

  if (publication.custody?.registrySchema !== 'reploid.network-canary-custody/v2') {
    reasons.push('adapter canary custody registry schema mismatch');
  }
  if (!isSafeRelativePath(publication.custody?.registryPath)) reasons.push('adapter canary custody registryPath is invalid');
  requireHash(reasons, publication.custody?.registryHash, 'adapter canary custody registryHash');
  if (publication.custody?.artifactId !== publication.canaryId) reasons.push('adapter canary custody artifactId mismatch');

  requireText(reasons, publication.artifact?.repoId, 'adapter canary artifact repoId');
  if (!REVISION.test(String(publication.artifact?.revision || ''))) reasons.push('adapter canary artifact revision must be immutable');
  if (!isSafeRelativePath(publication.artifact?.path)) reasons.push('adapter canary artifact path is invalid');
  if (!Number.isSafeInteger(publication.artifact?.sizeBytes) || publication.artifact.sizeBytes <= 0) {
    reasons.push('adapter canary artifact sizeBytes is invalid');
  }
  requireHash(reasons, publication.artifact?.sha256, 'adapter canary artifact sha256');

  requireText(reasons, publication.baseModel?.modelId, 'adapter canary base modelId');
  requireHash(reasons, publication.baseModel?.modelHash, 'adapter canary base modelHash');
  requireHash(reasons, publication.baseModel?.manifestHash, 'adapter canary base manifestHash');
  requireHash(reasons, publication.baseModel?.tokenizerHash, 'adapter canary base tokenizerHash');
  requireText(reasons, publication.baseModel?.artifactIdentity?.sourceRepo, 'adapter canary base sourceRepo');
  if (!REVISION.test(String(publication.baseModel?.artifactIdentity?.sourceRevision || ''))) {
    reasons.push('adapter canary base sourceRevision must be immutable');
  }
  requireText(reasons, publication.baseModel?.artifactIdentity?.weightPackId, 'adapter canary base weightPackId');
  requireHash(reasons, publication.baseModel?.artifactIdentity?.weightPackHash, 'adapter canary base weightPackHash');
  requireText(reasons, publication.baseModel?.artifactIdentity?.manifestVariantId, 'adapter canary base manifestVariantId');
  requireHash(reasons, publication.baseModel?.artifactIdentity?.conversionConfigDigest, 'adapter canary base conversionConfigDigest');

  if (publication.runtime?.packageName !== 'doppler-gpu') reasons.push('adapter canary runtime packageName must be doppler-gpu');
  if (!PACKAGE_VERSION.test(String(publication.runtime?.packageVersion || ''))) reasons.push('adapter canary runtime packageVersion is invalid');
  if (!String(publication.runtime?.packageIntegrity || '').startsWith('sha512-')) reasons.push('adapter canary runtime packageIntegrity is required');
  requireText(reasons, publication.runtime?.moduleUrl, 'adapter canary runtime moduleUrl');
  requireText(reasons, publication.runtime?.kernelBaseUrl, 'adapter canary runtime kernelBaseUrl');
  const pinnedRuntimeSegment = `doppler-gpu@${publication.runtime?.packageVersion}/`;
  if (!String(publication.runtime?.moduleUrl || '').includes(pinnedRuntimeSegment)) reasons.push('adapter canary runtime moduleUrl is not version-pinned');
  if (!String(publication.runtime?.kernelBaseUrl || '').includes(pinnedRuntimeSegment)) reasons.push('adapter canary runtime kernelBaseUrl is not version-pinned');

  if (publication.runtimeProof?.schema !== ADAPTER_RUNTIME_CANARY_RECEIPT_SCHEMA) {
    reasons.push('adapter canary runtime proof schema mismatch');
  }
  if (!isSafeRelativePath(publication.runtimeProof?.receiptPath)) reasons.push('adapter canary runtime proof receiptPath is invalid');
  requireHash(reasons, publication.runtimeProof?.receiptHash, 'adapter canary runtime proof receiptHash');
  if (!REVISION.test(String(publication.runtimeProof?.sourceRevision || ''))) {
    reasons.push('adapter canary runtime proof sourceRevision must be immutable');
  }
  if (publication.runtimeProof?.surface !== 'chromium-webgpu') reasons.push('adapter canary runtime proof surface must be chromium-webgpu');

  requireText(reasons, publication.publisher?.publisherId, 'adapter canary publisherId');
  requireText(reasons, publication.publisher?.publicKey, 'adapter canary publisher public key');
  if (!Number.isFinite(Date.parse(publication.createdAt))) reasons.push('adapter canary createdAt is invalid');
  if (!/not .*quality|quality.*not/i.test(String(publication.claimBoundary || ''))) {
    reasons.push('adapter canary claimBoundary must exclude model quality');
  }
  return { ok: reasons.length === 0, reasons };
}

export async function createSignedAdapterCanaryPublication({
  canaryId,
  custody,
  artifact,
  baseModel,
  runtime,
  runtimeProof,
  claimBoundary,
  publisherId,
  publisherPublicKey,
  privateKey,
  createdAt = new Date().toISOString()
} = {}) {
  const publication = {
    schema: ADAPTER_CANARY_PUBLICATION_SCHEMA,
    canaryId: String(canaryId || '').trim(),
    role: 'external_adapter_interoperability_canary',
    routable: false,
    promotion: { state: 'canary_only', qualityClaim: false },
    custody,
    artifact,
    baseModel,
    runtime,
    runtimeProof,
    claimBoundary: String(claimBoundary || '').trim(),
    publisher: {
      publisherId: String(publisherId || '').trim(),
      publicKey: String(publisherPublicKey || '').trim()
    },
    createdAt
  };
  const validation = validateAdapterCanaryPublication(publication);
  if (!validation.ok) throw new Error(validation.reasons.join('; '));
  if (!privateKey) throw new TypeError('privateKey is required');
  const payload = adapterCanaryPublicationSigningPayload(publication);
  return Object.freeze({
    ...publication,
    publicationHash: await hashJson(payload),
    publisherSignature: await signCanonical(payload, privateKey, {
      domain: SIGNATURE_DOMAINS.adapterCanaryPublication
    })
  });
}

export async function verifyAdapterCanaryPublication(publication = {}) {
  const validation = validateAdapterCanaryPublication(publication);
  const reasons = [...validation.reasons];
  const payload = adapterCanaryPublicationSigningPayload(publication);
  const publicationHash = await hashJson(payload);
  if (publication.publicationHash !== publicationHash) reasons.push('adapter canary publicationHash mismatch');
  if (!publication.publisherSignature) {
    reasons.push('adapter canary publisherSignature is required');
  } else if (publication.publisher?.publicKey) {
    try {
      const valid = await verifyCanonicalSignature(
        payload,
        publication.publisher.publicKey,
        publication.publisherSignature,
        { domain: SIGNATURE_DOMAINS.adapterCanaryPublication }
      );
      if (!valid) reasons.push('adapter canary publisherSignature invalid');
    } catch (error) {
      reasons.push(`adapter canary publisherSignature verification failed: ${error.message}`);
    }
  }
  return { ok: reasons.length === 0, reasons, publicationHash };
}

export default {
  ADAPTER_CANARY_PUBLICATION_SCHEMA,
  ADAPTER_RUNTIME_CANARY_RECEIPT_SCHEMA,
  adapterCanaryPublicationSigningPayload,
  validateAdapterCanaryPublication,
  createSignedAdapterCanaryPublication,
  verifyAdapterCanaryPublication
};
