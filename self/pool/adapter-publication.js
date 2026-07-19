/**
 * @fileoverview Signed publication, revocation, and requester consent for adapter packs.
 */

import {
  adapterRequirementFromPack,
  adapterRequirementsEqual,
  validateAdapterRequirement,
  verifyAdapterPack
} from './adapter-pack.js';
import {
  SIGNATURE_DOMAINS,
  hashJson,
  signCanonical,
  verifyCanonicalSignature
} from './inference-receipt.js';

export const ADAPTER_PUBLICATION_SCHEMA = 'reploid.pool.adapter-publication/v1';
export const ADAPTER_USE_APPROVAL_SCHEMA = 'reploid.pool.adapter-use-approval/v1';
export const ADAPTER_REVOCATION_SCHEMA = 'reploid.pool.adapter-revocation/v1';

const uniqueStrings = (values) => Array.from(new Set(
  (Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean)
)).sort();

const withoutFields = (value = {}, fields = []) => Object.fromEntries(
  Object.entries(value || {}).filter(([field]) => !fields.includes(field))
);

export const adapterPublicationSigningPayload = (publication = {}) => (
  // Revocation is a separately signed registry event. Registry timestamps and
  // current revocation state must not rewrite the immutable publication.
  withoutFields(publication, [
    'publicationHash',
    'publisherSignature',
    'revoked',
    'revocation',
    'updatedAt'
  ])
);

export const adapterUseApprovalSigningPayload = (approval = {}) => (
  withoutFields(approval, ['approvalHash', 'requesterSignature'])
);

export const adapterRevocationSigningPayload = (revocation = {}) => (
  withoutFields(revocation, ['revocationHash', 'publisherSignature'])
);

export async function createSignedAdapterPublication({
  pack,
  publisherId,
  publisherPublicKey,
  privateKey,
  visibility = pack?.distribution?.visibility || 'private',
  originUrls = [],
  capabilities = [],
  createdAt = new Date().toISOString()
} = {}) {
  const packValidation = await verifyAdapterPack(pack, { requirePromoted: true });
  if (!packValidation.ok) throw new Error(packValidation.reasons.join('; '));
  const publication = {
    schema: ADAPTER_PUBLICATION_SCHEMA,
    pack,
    packHash: pack.packHash,
    publisher: {
      publisherId: String(publisherId || '').trim(),
      publicKey: String(publisherPublicKey || '').trim()
    },
    visibility: ['public', 'private', 'entitled'].includes(visibility) ? visibility : 'private',
    originUrls: uniqueStrings(originUrls),
    capabilities: uniqueStrings(capabilities),
    createdAt,
    revoked: false
  };
  if (!publication.publisher.publisherId || !publication.publisher.publicKey || !privateKey) {
    throw new TypeError('publisherId, publisherPublicKey, and privateKey are required');
  }
  if (publication.visibility !== 'public' && publication.originUrls.length > 0) {
    throw new Error('private or entitled publications cannot expose public origin URLs');
  }
  const publicationHash = await hashJson(adapterPublicationSigningPayload(publication));
  return Object.freeze({
    ...publication,
    publicationHash,
    publisherSignature: await signCanonical(adapterPublicationSigningPayload(publication), privateKey, {
      domain: SIGNATURE_DOMAINS.adapterPublication
    })
  });
}

export async function verifyAdapterPublication(publication = {}) {
  const reasons = [];
  if (publication.schema !== ADAPTER_PUBLICATION_SCHEMA) reasons.push('adapter publication schema mismatch');
  const packValidation = await verifyAdapterPack(publication.pack || {}, { requirePromoted: true });
  reasons.push(...packValidation.reasons.map((reason) => `pack: ${reason}`));
  if (publication.packHash !== publication.pack?.packHash) reasons.push('publication pack hash mismatch');
  if (!publication.publisher?.publisherId) reasons.push('publication publisherId is required');
  if (!publication.publisher?.publicKey) reasons.push('publication publisher public key is required');
  if (!['public', 'private', 'entitled'].includes(publication.visibility)) reasons.push('publication visibility is invalid');
  if (publication.visibility !== 'public' && (publication.originUrls || []).length > 0) {
    reasons.push('private or entitled publications cannot expose public origin URLs');
  }
  const payload = adapterPublicationSigningPayload(publication);
  const publicationHash = await hashJson(payload);
  if (publication.publicationHash !== publicationHash) reasons.push('publicationHash mismatch');
  if (!publication.publisherSignature) {
    reasons.push('publisherSignature is required');
  } else if (publication.publisher?.publicKey) {
    try {
      const ok = await verifyCanonicalSignature(
        payload,
        publication.publisher.publicKey,
        publication.publisherSignature,
        { domain: SIGNATURE_DOMAINS.adapterPublication }
      );
      if (!ok) reasons.push('publisherSignature invalid');
    } catch (error) {
      reasons.push(`publisherSignature verification failed: ${error.message}`);
    }
  }
  if (publication.revoked === true) reasons.push('adapter publication is revoked');
  return { ok: reasons.length === 0, reasons, publicationHash, packHash: publication.packHash };
}

export function adapterRequirementFromPublication(publication = {}, { state = 'fetchable' } = {}) {
  return Object.freeze({
    ...adapterRequirementFromPack(publication.pack || {}),
    publicationHash: publication.publicationHash || null,
    publisherId: publication.publisher?.publisherId || null,
    state: ['active', 'cached', 'fetchable'].includes(state) ? state : 'fetchable'
  });
}

export function validatePublishedAdapterRequirement(requirement = {}) {
  const reasons = [...validateAdapterRequirement(requirement).reasons];
  if (!String(requirement.publicationHash || '').startsWith('sha256:')) reasons.push('adapter publicationHash is required');
  if (!String(requirement.publisherId || '').trim()) reasons.push('adapter publisherId is required');
  if (!['active', 'cached', 'fetchable'].includes(requirement.state)) reasons.push('adapter state is invalid');
  return { ok: reasons.length === 0, reasons };
}

export function publishedAdapterRequirementsEqual(left = {}, right = {}) {
  return adapterRequirementsEqual(left, right)
    && left.publicationHash === right.publicationHash
    && left.publisherId === right.publisherId;
}

export async function createAdapterUseApproval({
  adapterRequirement,
  requesterId,
  requesterPublicKey,
  privateKey,
  inputHash,
  modelRequirements,
  approvedAt = new Date().toISOString(),
  nonce = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`
} = {}) {
  const requirementValidation = validatePublishedAdapterRequirement(adapterRequirement);
  if (!requirementValidation.ok) throw new Error(requirementValidation.reasons.join('; '));
  const approval = {
    schema: ADAPTER_USE_APPROVAL_SCHEMA,
    requesterId: String(requesterId || '').trim(),
    requesterPublicKey: String(requesterPublicKey || '').trim(),
    adapterPackHash: adapterRequirement.packHash,
    publicationHash: adapterRequirement.publicationHash,
    inputHash: String(inputHash || '').trim(),
    modelId: String(modelRequirements?.modelId || modelRequirements?.id || '').trim(),
    modelHash: String(modelRequirements?.modelHash || modelRequirements?.hash || '').trim(),
    manifestHash: String(modelRequirements?.manifestHash || '').trim(),
    approved: true,
    approvedAt,
    nonce: String(nonce)
  };
  for (const [field, value] of Object.entries({
    requesterId: approval.requesterId,
    requesterPublicKey: approval.requesterPublicKey,
    inputHash: approval.inputHash,
    modelId: approval.modelId,
    modelHash: approval.modelHash,
    manifestHash: approval.manifestHash
  })) {
    if (!value) throw new TypeError(`${field} is required`);
  }
  if (!privateKey) throw new TypeError('privateKey is required');
  const approvalHash = await hashJson(approval);
  return Object.freeze({
    ...approval,
    approvalHash,
    requesterSignature: await signCanonical(approval, privateKey, {
      domain: SIGNATURE_DOMAINS.adapterUseApproval
    })
  });
}

export async function verifyAdapterUseApproval(approval = {}, {
  adapterRequirement = {},
  requesterId = null,
  inputHash = null,
  modelRequirements = null
} = {}) {
  const reasons = [];
  if (approval.schema !== ADAPTER_USE_APPROVAL_SCHEMA) reasons.push('adapter use approval schema mismatch');
  if (approval.approved !== true) reasons.push('adapter use was not approved');
  if (requesterId && approval.requesterId !== requesterId) reasons.push('adapter use requester mismatch');
  if (approval.adapterPackHash !== adapterRequirement.packHash) reasons.push('adapter use pack hash mismatch');
  if (approval.publicationHash !== adapterRequirement.publicationHash) reasons.push('adapter use publication hash mismatch');
  if (inputHash && approval.inputHash !== inputHash) reasons.push('adapter use input hash mismatch');
  if (modelRequirements) {
    if (approval.modelId !== (modelRequirements.modelId || modelRequirements.id)) reasons.push('adapter use model id mismatch');
    if (approval.modelHash !== (modelRequirements.modelHash || modelRequirements.hash)) reasons.push('adapter use model hash mismatch');
    if (approval.manifestHash !== modelRequirements.manifestHash) reasons.push('adapter use manifest hash mismatch');
  }
  const payload = adapterUseApprovalSigningPayload(approval);
  const approvalHash = await hashJson(payload);
  if (approval.approvalHash !== approvalHash) reasons.push('adapter use approvalHash mismatch');
  if (!approval.requesterSignature) reasons.push('adapter use requesterSignature is required');
  if (approval.requesterPublicKey && approval.requesterSignature) {
    try {
      const ok = await verifyCanonicalSignature(
        payload,
        approval.requesterPublicKey,
        approval.requesterSignature,
        { domain: SIGNATURE_DOMAINS.adapterUseApproval }
      );
      if (!ok) reasons.push('adapter use requesterSignature invalid');
    } catch (error) {
      reasons.push(`adapter use signature verification failed: ${error.message}`);
    }
  }
  return { ok: reasons.length === 0, reasons, approvalHash };
}

export async function createAdapterRevocation({ publication, reason, privateKey, revokedAt = new Date().toISOString() } = {}) {
  if (!publication?.packHash || !publication?.publisher?.publisherId || !privateKey) {
    throw new TypeError('publication and privateKey are required');
  }
  const revocation = {
    schema: ADAPTER_REVOCATION_SCHEMA,
    packHash: publication.packHash,
    publicationHash: publication.publicationHash,
    publisherId: publication.publisher.publisherId,
    reason: String(reason || 'publisher_revoked').trim(),
    revokedAt
  };
  const revocationHash = await hashJson(revocation);
  return Object.freeze({
    ...revocation,
    revocationHash,
    publisherSignature: await signCanonical(revocation, privateKey, {
      domain: SIGNATURE_DOMAINS.adapterRevocation
    })
  });
}

export async function verifyAdapterRevocation(revocation = {}, publication = {}) {
  const reasons = [];
  if (revocation.schema !== ADAPTER_REVOCATION_SCHEMA) reasons.push('adapter revocation schema mismatch');
  if (revocation.packHash !== publication.packHash) reasons.push('revocation pack hash mismatch');
  if (revocation.publicationHash !== publication.publicationHash) reasons.push('revocation publication hash mismatch');
  if (revocation.publisherId !== publication.publisher?.publisherId) reasons.push('revocation publisher mismatch');
  const payload = adapterRevocationSigningPayload(revocation);
  const revocationHash = await hashJson(payload);
  if (revocation.revocationHash !== revocationHash) reasons.push('revocationHash mismatch');
  if (!revocation.publisherSignature) reasons.push('revocation publisherSignature is required');
  if (publication.publisher?.publicKey && revocation.publisherSignature) {
    try {
      const ok = await verifyCanonicalSignature(
        payload,
        publication.publisher.publicKey,
        revocation.publisherSignature,
        { domain: SIGNATURE_DOMAINS.adapterRevocation }
      );
      if (!ok) reasons.push('revocation publisherSignature invalid');
    } catch (error) {
      reasons.push(`revocation signature verification failed: ${error.message}`);
    }
  }
  return { ok: reasons.length === 0, reasons, revocationHash };
}

export default {
  ADAPTER_PUBLICATION_SCHEMA,
  ADAPTER_USE_APPROVAL_SCHEMA,
  ADAPTER_REVOCATION_SCHEMA,
  createSignedAdapterPublication,
  verifyAdapterPublication,
  adapterRequirementFromPublication,
  validatePublishedAdapterRequirement,
  publishedAdapterRequirementsEqual,
  createAdapterUseApproval,
  verifyAdapterUseApproval,
  createAdapterRevocation,
  verifyAdapterRevocation
};
