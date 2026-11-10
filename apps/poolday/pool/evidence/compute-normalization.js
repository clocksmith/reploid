/** Consent, exact model contract, and provider-signed receipt evidence normalization. */
import {
  agreementIsAccepted,
  declaredAgreementProviderIds
} from '../evidence-record-contract.js';
import {
  clone,
  compactText,
  requireHash,
  sameStringSet,
  unique
} from './primitives.js';
import {
  SEQUENCE_ALPHABETS
} from '../../../../shared/pool/sequence-workload.js';
import {
  SIGNATURE_DOMAINS,
  hashJson,
  receiptSigningPayload,
  verifyCanonicalSignature
} from '../../../../shared/pool/inference-receipt.js';
import {
  exactModelContractKey
} from '../../../../shared/pool/model-contract.js';

export const normalizeConsent = (consent = {}, alphabet = SEQUENCE_ALPHABETS.aminoAcid) => {
  if (consent.publicSequence !== true) throw new TypeError('public sequence consent is required');
  if (consent.publicEvidenceNetwork !== true) throw new TypeError('public evidence-network consent is required');
  return {
    scope: alphabet === SEQUENCE_ALPHABETS.nucleotide
      ? 'public_dna_evidence_network'
      : 'public_protein_evidence_network',
    publicSequence: true,
    publicEvidenceNetwork: true,
    publishEmbedding: consent.publishEmbedding === true,
    publishResidueEvidence: consent.publishResidueEvidence === true,
    acknowledgedAt: compactText(consent.acknowledgedAt, 64) || new Date().toISOString()
  };
};

export const normalizeModelContract = (model = {}) => {
  const sequence = model.sequence || model.requirements?.sequence || null;
  const contract = {
    id: compactText(model.id || model.modelId, 240),
    hash: compactText(model.hash || model.modelHash, 160),
    manifestHash: compactText(model.manifestHash, 160),
    tokenizerHash: compactText(model.tokenizerHash || model.requirements?.tokenizerHash, 160) || null,
    runtime: compactText(model.runtime, 120),
    backend: compactText(model.backend, 120),
    workload: compactText(model.workload || model.requirements?.workload, 120),
    executionMode: compactText(model.executionMode || model.requirements?.executionMode, 120),
    dimensions: Number(model.dimensions || model.embeddingDimensions || model.requirements?.embeddingDimensions || 0) || null,
    quantization: compactText(model.quantization || model.requirements?.quantization, 80) || null,
    contextLength: Number(model.contextLength || model.requirements?.contextLength || 0) || null,
    sequence: sequence ? clone(sequence) : null,
    outputs: clone(model.outputs || model.requirements?.outputs || null),
    runtimeCompatibility: clone(model.runtimeCompatibility || model.requirements?.runtimeCompatibility || null),
    runtimeContract: clone(model.runtimeContract || model.requirements?.runtimeContract || null),
    artifactIdentity: clone(model.artifactIdentity || model.requirements?.artifactIdentity || null),
    ...(model.executablePack || model.requirements?.executablePack
      ? { executablePack: clone(model.executablePack || model.requirements.executablePack) } : {}),
    license: clone(model.license || model.requirements?.license || null),
    admission: clone(model.admission || model.requirements?.admission || null)
  };
  if (!contract.id || !contract.hash || !contract.manifestHash || !contract.runtime || !contract.workload) {
    throw new TypeError('exact model id, hash, manifest hash, runtime, and workload are required');
  }
  return contract;
};

export const normalizeVerifiedReceiptEvidence = async ({
  receiptEvidence = null,
  receiptRecord,
  receiptHash,
  agreement,
  modelContract,
  sequenceHash
}) => {
  const agreementAccepted = agreementIsAccepted(agreement);
  const supplied = Array.isArray(receiptEvidence) ? receiptEvidence : [];
  const primaryCandidate = receiptRecord?.receipt && receiptRecord?.providerPublicKey
    ? [{
      receiptHash,
      providerId: receiptRecord.providerId || receiptRecord.receipt.providerId,
      providerPublicKey: receiptRecord.providerPublicKey,
      receipt: receiptRecord.receipt
    }]
    : [];
  const candidates = supplied.length > 0 ? supplied : primaryCandidate;
  if (agreementAccepted && candidates.length < 2) {
    throw new TypeError('accepted compute agreement requires two verified receipt evidence records');
  }
  const normalized = [];
  for (const candidate of candidates) {
    const receipt = clone(candidate?.receipt || null);
    if (!receipt) throw new TypeError('compute receipt evidence requires the signed receipt');
    const computedReceiptHash = await hashJson(receipt);
    const evidenceReceiptHash = requireHash(candidate?.receiptHash, 'compute receipt evidence');
    if (computedReceiptHash !== evidenceReceiptHash) throw new TypeError('compute receipt evidence hash mismatch');
    const providerId = compactText(candidate?.providerId, 240);
    const providerPublicKey = compactText(candidate?.providerPublicKey, 12000);
    if (!providerId || receipt.providerId !== providerId) throw new TypeError('compute receipt evidence provider identity mismatch');
    if (!providerPublicKey || !receipt.providerSignature) throw new TypeError('compute receipt evidence signature material is required');
    if (receipt.signatureDomain !== SIGNATURE_DOMAINS.providerReceipt) {
      throw new TypeError('compute receipt evidence signature domain mismatch');
    }
    const signatureOk = await verifyCanonicalSignature(
      receiptSigningPayload(receipt),
      providerPublicKey,
      receipt.providerSignature,
      { domain: SIGNATURE_DOMAINS.providerReceipt }
    );
    if (!signatureOk) throw new TypeError('compute receipt evidence provider signature is invalid');
    if (exactModelContractKey(normalizeModelContract(receipt.model)) !== exactModelContractKey(modelContract)) {
      throw new TypeError('compute receipt evidence model contract mismatch');
    }
    if (receipt.inputHash !== sequenceHash) throw new TypeError('compute receipt evidence input identity mismatch');
    if (agreement?.jobId && receipt.jobId !== agreement.jobId) {
      throw new TypeError('compute receipt evidence job identity mismatch');
    }
    if (agreementAccepted) {
      const agreementField = compactText(agreement?.agreementField, 120);
      if (!agreementField || agreement?.agreementValue == null || receipt[agreementField] !== agreement.agreementValue) {
        throw new TypeError('compute receipt evidence does not match the accepted agreement value');
      }
    }
    normalized.push({ receiptHash: evidenceReceiptHash, providerId, providerPublicKey, receipt });
  }
  const evidenceReceiptHashes = normalized.map((entry) => entry.receiptHash);
  const evidenceProviderIds = normalized.map((entry) => entry.providerId);
  const evidenceProviderKeys = normalized.map((entry) => entry.providerPublicKey);
  if (agreementAccepted) {
    const declaredProviderIds = declaredAgreementProviderIds(agreement);
    if (!sameStringSet(evidenceReceiptHashes, agreement?.receiptHashes || [])) {
      throw new TypeError('compute agreement receipt identities do not match verified receipt evidence');
    }
    if (!Array.isArray(declaredProviderIds) || !sameStringSet(evidenceProviderIds, declaredProviderIds)) {
      throw new TypeError('compute agreement provider identities do not match verified receipt evidence');
    }
    if (unique(evidenceProviderIds).length < 2 || unique(evidenceProviderKeys).length < 2) {
      throw new TypeError('accepted compute agreement requires distinct verified provider identities and keys');
    }
  }
  if (normalized.length > 0 && !evidenceReceiptHashes.includes(receiptHash)) {
    throw new TypeError('verified receipt evidence does not include the primary receipt');
  }
  return normalized.sort((left, right) => left.receiptHash.localeCompare(right.receiptHash));
};
