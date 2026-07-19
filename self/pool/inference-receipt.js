/**
 * @fileoverview Canonical receipt helpers for Reploid browser inference pool.
 */

import { POOL_CONFIG, POOL_CONFIG_VERSION } from './config.js';

const textEncoder = new TextEncoder();

export const RECEIPT_VERSION = 'reploid_browser_inference/v1';
export const TRUST_TIER_SIGNED_RECEIPT = POOL_CONFIG.policies.fastest_receipt.trustTier;
export const TRUST_TIER_CANARY_AUDITED = POOL_CONFIG.policies.canary_audited.trustTier;
export const TRUST_TIER_REDUNDANT_AGREEMENT = POOL_CONFIG.policies.redundant_agreement.trustTier;
export const TRUST_TIER_ACCEPTED_RECEIPT = 'T4_requester_accepted';
export const SIGNATURE_DOMAINS = Object.freeze({
  providerReceipt: 'poolday.provider_receipt.v1',
  requesterAcceptance: 'poolday.requester_acceptance.v1',
  peerMessage: 'poolday.peer_message.v1',
  adapterPublication: 'poolday.adapter_publication.v1',
  adapterRevocation: 'poolday.adapter_revocation.v1',
  adapterUseApproval: 'poolday.adapter_use_approval.v1'
});

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
}

const bytesToHex = (bytes) => Array.from(bytes)
  .map((byte) => byte.toString(16).padStart(2, '0'))
  .join('');

const bytesToBase64 = (bytes) => {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

const base64ToBytes = (value) => {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(String(value || ''), 'base64'));
  }
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export async function sha256Hex(value) {
  const input = value instanceof Uint8Array ? value : textEncoder.encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', input);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function hashJson(value) {
  return sha256Hex(canonicalize(value));
}

export async function createSigningKeyPair() {
  return crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
}

export async function exportPublicKey(publicKey) {
  const spki = await crypto.subtle.exportKey('spki', publicKey);
  return bytesToBase64(new Uint8Array(spki));
}

export async function exportPrivateKey(privateKey) {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return bytesToBase64(new Uint8Array(pkcs8));
}

export async function importPublicKey(publicKeyBase64) {
  const bytes = base64ToBytes(publicKeyBase64);
  return crypto.subtle.importKey(
    'spki',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

export async function importPrivateKey(privateKeyBase64) {
  const bytes = base64ToBytes(privateKeyBase64);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes,
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign']
  );
}

export async function importSigningKeyPair({ privateKey, publicKey } = {}) {
  if (!privateKey || !publicKey) throw new Error('privateKey and publicKey are required');
  return {
    privateKey: await importPrivateKey(privateKey),
    publicKey: await importPublicKey(publicKey)
  };
}

export function domainSeparatedPayload(domain, payload) {
  const normalized = String(domain || '').trim();
  if (!normalized) throw new Error('signature domain is required');
  return {
    signatureDomain: normalized,
    payload
  };
}

export async function signCanonical(value, privateKey, { domain = null } = {}) {
  const signingValue = domain ? domainSeparatedPayload(domain, value) : value;
  const payload = textEncoder.encode(canonicalize(signingValue));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    payload
  );
  return bytesToBase64(new Uint8Array(signature));
}

export async function verifyCanonicalSignature(value, publicKeyBase64, signatureBase64, { domain = null, allowLegacy = false } = {}) {
  const publicKey = await importPublicKey(publicKeyBase64);
  const verifyValue = async (candidate) => crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    base64ToBytes(signatureBase64),
    textEncoder.encode(canonicalize(candidate))
  );
  if (!domain) return verifyValue(value);
  const domainOk = await verifyValue(domainSeparatedPayload(domain, value));
  if (domainOk || !allowLegacy) return domainOk;
  return verifyValue(value);
}

export function receiptSigningPayload(receipt) {
  const { providerSignature, requesterAcceptance, verifierDecision, ledgerEffects, ...payload } = receipt || {};
  return payload;
}

export function acceptanceSigningPayload(acceptance) {
  const { requesterSignature, ...payload } = acceptance || {};
  return payload;
}

const normalizeReceiptModel = (model = {}) => ({
  id: model.id || model.modelId || null,
  hash: model.hash || model.modelHash || null,
  manifestHash: model.manifestHash || null,
  runtime: model.runtime || 'doppler',
  backend: model.backend || 'browser-webgpu',
  workload: model.workload || model.workloadType || model.modelType || model.requirements?.workload || null,
  executionMode: model.executionMode || model.execution || model.requirements?.executionMode || null,
  contextLength: Number(model.contextLength || 0),
  quantization: model.quantization || null,
  artifactIdentity: model.artifactIdentity || model.requirements?.artifactIdentity || null,
  requirements: model.requirements || null
});

const normalizeReceiptAdapter = (adapter = null) => adapter ? ({
  schema: adapter.schema || null,
  packHash: adapter.packHash || null,
  adapterId: adapter.adapterId || null,
  adapterSha256: adapter.adapterSha256 || null,
  baseModelId: adapter.baseModelId || null,
  baseModelHash: adapter.baseModelHash || null,
  baseManifestHash: adapter.baseManifestHash || null,
  humanPromotionReceiptHash: adapter.humanPromotionReceiptHash || null,
  dopplerParityReceiptHash: adapter.dopplerParityReceiptHash || null,
  gammaSelectionReceiptHash: adapter.gammaSelectionReceiptHash || null,
  publicationHash: adapter.publicationHash || null,
  publisherId: adapter.publisherId || null,
  adapterUseApprovalHash: adapter.adapterUseApprovalHash || null,
  state: adapter.state || null,
  artifactSources: Array.isArray(adapter.artifactSources) ? adapter.artifactSources : []
}) : null;

export async function buildPoolReceipt({ assignment, provider, model, runtime, execution }) {
  const outputText = execution?.outputText || '';
  const tokenIds = Array.isArray(execution?.tokenIds) ? execution.tokenIds : [];
  const outputKind = execution?.outputKind || assignment?.workload || model?.workload || model?.requirements?.workload || 'text_generation';
  const vectorHash = execution?.vectorHash || execution?.embeddingHash || null;
  const transcript = execution?.transcript || {
    outputKind,
    outputText,
    tokenIds,
    vectorHash
  };
  const runtimeProfileHash = assignment.runtimeProfileHash
    || provider?.runtimeProfileHash
    || provider?.device?.runtimeProfileHash
    || runtime?.runtimeProfileHash
    || null;
  return {
    receiptVersion: RECEIPT_VERSION,
    signatureDomain: SIGNATURE_DOMAINS.providerReceipt,
    trustTier: TRUST_TIER_SIGNED_RECEIPT,
    assignmentId: assignment.assignmentId,
    jobId: assignment.jobId,
    requesterId: assignment.requesterId,
    providerId: assignment.providerId,
    policyId: assignment.policyId,
    policyConfigVersion: assignment.policyConfigVersion || null,
    policyConfigHash: assignment.policyConfigHash || null,
    model: normalizeReceiptModel(model),
    adapter: normalizeReceiptAdapter(
      execution?.adapter || assignment?.adapter || assignment?.model?.requirements?.adapter || null
    ),
    runtime,
    outputKind,
    inputHash: assignment.inputHash,
    generationConfigHash: assignment.generationConfigHash,
    outputHash: await sha256Hex(outputText),
    tokenIdsHash: await hashJson(tokenIds),
    vectorHash,
    transcriptHash: await hashJson(transcript),
    tokenCounts: execution?.tokenCounts || { input: 0, output: tokenIds.length },
    embedding: execution?.embeddingDimensions ? {
      dimensions: execution.embeddingDimensions,
      stats: execution.embeddingStats || null
    } : null,
    device: provider?.device || {},
    timing: execution?.timing || {},
    verification: {
      level: assignment.verificationLevel || 'signed_receipt',
      canaryId: assignment.auditId || null,
      redundancyGroupSize: assignment.redundancyGroupSize || 1,
      requiredAgreement: assignment.requiredAgreement || assignment.redundancyGroupSize || 1,
      runtimeProfileHash,
      ring: assignment.ring || null,
      sampledProofHashes: [],
      programBundleHash: null
    },
    dopplerProviderReceipt: execution?.dopplerProviderReceipt || null,
    status: execution?.status || 'completed',
    providerSignature: null,
    requesterAcceptance: null,
    verifierDecision: null,
    ledgerEffects: []
  };
}

export async function signProviderReceipt(receipt, privateKey) {
  const domainReceipt = {
    ...receipt,
    signatureDomain: receipt?.signatureDomain || SIGNATURE_DOMAINS.providerReceipt
  };
  return {
    ...domainReceipt,
    providerSignature: await signCanonical(
      receiptSigningPayload(domainReceipt),
      privateKey,
      { domain: SIGNATURE_DOMAINS.providerReceipt }
    )
  };
}

export function calculateReceiptPoints(receiptRecord, { multiplier = 1 } = {}) {
  const receipt = receiptRecord?.receipt || {};
  const outputTokens = Number(receipt?.tokenCounts?.output || 0);
  const inputTokens = Number(receipt?.tokenCounts?.input || 0);
  const basePoints = Math.max(1, outputTokens + Math.floor(inputTokens / 4));
  return Math.max(1, Math.floor(basePoints * multiplier));
}

export function compactAgreementForAcceptance(agreement = null) {
  if (!agreement) return null;
  return {
    mode: agreement.mode || null,
    status: agreement.status || null,
    requiredAgreement: Number(agreement.requiredAgreement || agreement.requiredProviders || 1),
    providerCount: Number(agreement.providerCount || 1),
    agreementField: agreement.agreementField || 'tokenIdsHash',
    outputHash: agreement.outputHash || null,
    tokenIdsHash: agreement.tokenIdsHash || null,
    vectorHash: agreement.vectorHash || null,
    effectiveTrustTier: agreement.effectiveTrustTier || null
  };
}

export async function buildAcceptanceSummary({ job, receiptHash, receiptRecords = [] } = {}) {
  const receiptHashes = Array.isArray(job?.agreement?.receiptHashes) && job.agreement.status === 'accepted'
    ? job.agreement.receiptHashes
    : [receiptHash];
  const recordByHash = new Map(receiptRecords.map((record) => [record.receiptHash, record]));
  const agreedRecords = receiptHashes
    .map((currentReceiptHash) => recordByHash.get(currentReceiptHash))
    .filter((record) => record?.verifierDecision?.accepted);
  const multiplier = 1 / Math.max(1, receiptHashes.length);
  const providerPoints = agreedRecords.map((record) => {
    const uncappedPoints = calculateReceiptPoints(record, { multiplier });
    const cap = record.providerAdmission?.earningsCapPerAcceptance
      ?? record.providerAdmission?.lane?.earningsCapPerAcceptance;
    return {
      receiptHash: record.receiptHash,
      providerId: record.providerId,
      points: Number.isFinite(Number(cap)) ? Math.min(uncappedPoints, Number(cap)) : uncappedPoints
    };
  });
  const pointSpend = providerPoints.reduce((sum, entry) => sum + entry.points, 0);
  const policyConfigVersion = job?.policyConfigVersion || POOL_CONFIG_VERSION;
  const policyConfigHash = job?.policyConfigHash || await hashJson(POOL_CONFIG);
  const payload = {
    jobId: job?.jobId || null,
    requesterId: job?.requesterId || null,
    policyId: job?.policyId || null,
    policyConfigVersion,
    policyConfigHash,
    receiptHash,
    receiptHashes,
    agreement: compactAgreementForAcceptance(job?.agreement || null),
    pointSpend,
    providerPoints
  };
  return {
    ...payload,
    agreementHash: await hashJson(payload),
    agreedRecords,
    multiplier,
    totalProviderPoints: pointSpend
  };
}

export async function countersignReceipt({
  receiptHash,
  requesterId,
  accepted,
  jobId = null,
  policyId = null,
  policyConfigVersion = null,
  policyConfigHash = null,
  receiptHashes = null,
  agreementHash = null,
  pointSpend = null,
  providerPoints = null
} = {}, privateKey) {
  const acceptance = {
    signatureDomain: SIGNATURE_DOMAINS.requesterAcceptance,
    receiptHash,
    requesterId,
    accepted: accepted === true,
    acceptedAt: new Date().toISOString(),
    requesterSignature: null
  };
  if (jobId) acceptance.jobId = jobId;
  if (policyId) acceptance.policyId = policyId;
  if (policyConfigVersion) acceptance.policyConfigVersion = policyConfigVersion;
  if (policyConfigHash) acceptance.policyConfigHash = policyConfigHash;
  if (Array.isArray(receiptHashes)) acceptance.receiptHashes = receiptHashes;
  if (agreementHash) acceptance.agreementHash = agreementHash;
  if (pointSpend !== null && pointSpend !== undefined) acceptance.pointSpend = Number(pointSpend);
  if (Array.isArray(providerPoints)) acceptance.providerPoints = providerPoints;
  return {
    ...acceptance,
    requesterSignature: await signCanonical(
      acceptanceSigningPayload(acceptance),
      privateKey,
      { domain: SIGNATURE_DOMAINS.requesterAcceptance }
    )
  };
}
