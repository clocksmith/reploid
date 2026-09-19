/**
 * @fileoverview Canonical receipt helpers for Reploid browser inference pool.
 */

import { POOL_CONFIG, POOL_CONFIG_VERSION } from './config.js';
import { canonicalize } from './canonical-json.js';
import { exactModelContractKey } from './model-contract.js';
import { isSequenceWorkload } from './sequence-workload.js';

import { sha256Hex, hashJson, createSigningKeyPair, exportPublicKey, exportPrivateKey, importPublicKey, importPrivateKey, importSigningKeyPair, domainSeparatedPayload, signCanonical, verifyCanonicalSignature } from '../vendor/reploid/artifacts/signatures.js';
export { sha256Hex, hashJson, createSigningKeyPair, exportPublicKey, exportPrivateKey, importPublicKey, importPrivateKey, importSigningKeyPair, domainSeparatedPayload, signCanonical, verifyCanonicalSignature };


export const RECEIPT_VERSION = 'reploid_browser_inference/v1';
export const TRUST_TIER_SIGNED_RECEIPT = POOL_CONFIG.policies.fastest_receipt.trustTier;
export const TRUST_TIER_CANARY_AUDITED = POOL_CONFIG.policies.canary_audited.trustTier;
export const TRUST_TIER_REDUNDANT_AGREEMENT = POOL_CONFIG.policies.redundant_agreement.trustTier;
export const TRUST_TIER_ACCEPTED_RECEIPT = 'T4_requester_accepted';
export const SIGNATURE_DOMAINS = Object.freeze({
  providerReceipt: 'poolday.provider_receipt.v1',
  requesterAcceptance: 'poolday.requester_acceptance.v1',
  peerMessage: 'poolday.peer_message.v1',
  deviceRoleDelegation: 'poolday.device_role_delegation.v1',
  participationProfile: 'poolday.participation_profile.v1',
  researchSubmission: 'poolday.research_submission.v1',
  researchResult: 'poolday.research_result.v1',
  humanClaim: 'poolday.human_claim.v1',
  researchHypothesis: 'poolday.research_hypothesis.v1',
  researchPriorEvidence: 'poolday.research_prior_evidence.v1',
  researchPrediction: 'poolday.research_prediction.v1',
  researchResolutionPolicy: 'poolday.research_resolution_policy.v1',
  researchWorkOrder: 'poolday.research_work_order.v1',
  researchWorkClaim: 'poolday.research_work_claim.v1',
  researchOutcome: 'poolday.research_outcome.v1',
  researchCohort: 'poolday.research_cohort.v1',
  researchEvaluation: 'poolday.research_evaluation.v1',
  researchRealizedActionValue: 'poolday.research_realized_action_value.v1',
  researchAdjudicationExperiment: 'poolday.research_adjudication_experiment.v1',
  researchAdjudicationEvaluation: 'poolday.research_adjudication_evaluation.v1',
  researchDiscoveryCheckpoint: 'poolday.research_discovery_checkpoint.v1',
  researchCandidateAction: 'poolday.research_candidate_action.v1',
  researchSequenceLink: 'poolday.research_sequence_link.v1',
  researchRevocation: 'poolday.research_revocation.v1',
  adapterPublication: 'poolday.adapter_publication.v1',
  adapterCanaryPublication: 'poolday.adapter_canary_publication.v1',
  adapterRevocation: 'poolday.adapter_revocation.v1',
  adapterUseApproval: 'poolday.adapter_use_approval.v1'
});

export { canonicalize };

export function receiptSigningPayload(receipt) {
  const { providerSignature, requesterAcceptance, verifierDecision, ledgerEffects, ...payload } = receipt || {};
  return payload;
}

export function acceptanceSigningPayload(acceptance) {
  const { requesterSignature, ...payload } = acceptance || {};
  return payload;
}

const normalizeReceiptModel = (model = {}) => {
  const normalized = {
    id: model.id || model.modelId || null,
    hash: model.hash || model.modelHash || null,
    manifestHash: model.manifestHash || null,
    tokenizerHash: model.tokenizerHash || model.requirements?.tokenizerHash || null,
    runtime: model.runtime || 'doppler',
    backend: model.backend || 'browser-webgpu',
    workload: model.workload || model.workloadType || model.modelType || model.requirements?.workload || null,
    executionMode: model.executionMode || model.execution || model.requirements?.executionMode || null,
    executionModes: model.executionModes || model.requirements?.executionModes || null,
    contextLength: Number(model.contextLength || 0),
    embeddingDimensions: Number(model.embeddingDimensions || model.dimensions || 0) || null,
    quantization: model.quantization || null,
    sequence: model.sequence || model.requirements?.sequence || null,
    outputs: model.outputs || model.requirements?.outputs || null,
    runtimeCompatibility: model.runtimeCompatibility || model.requirements?.runtimeCompatibility || null,
    runtimeContract: model.runtimeContract || model.requirements?.runtimeContract || null,
    license: model.license || model.requirements?.license || null,
    artifactIdentity: model.artifactIdentity || model.requirements?.artifactIdentity || null,
    ...(model.executablePack || model.requirements?.executablePack ? { executablePack: model.executablePack || model.requirements.executablePack } : {}),
    ...(model.forecast || model.requirements?.forecast ? { forecast: model.forecast || model.requirements.forecast } : {}),
    admission: model.admission || model.requirements?.admission || null,
    requirements: model.requirements || null
  };
  return {
    ...normalized,
    exactModelContractKey: model.exactModelContractKey || exactModelContractKey(normalized)
  };
};

const normalizeReceiptAdapter = (adapter = null) => adapter ? ({
  schema: adapter.schema || null,
  packHash: adapter.packHash || null,
  adapterId: adapter.adapterId || null,
  adapterSha256: adapter.adapterSha256 || null,
  baseModelId: adapter.baseModelId || null,
  baseModelHash: adapter.baseModelHash || null,
  baseManifestHash: adapter.baseManifestHash || null,
  baseTokenizerHash: adapter.baseTokenizerHash || null,
  baseSourceRepo: adapter.baseSourceRepo || null,
  baseSourceRevision: adapter.baseSourceRevision || null,
  baseWeightPackId: adapter.baseWeightPackId || null,
  baseWeightPackHash: adapter.baseWeightPackHash || null,
  baseManifestVariantId: adapter.baseManifestVariantId || null,
  baseConversionConfigDigest: adapter.baseConversionConfigDigest || null,
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
  const outputKind = execution?.outputKind || assignment?.workload || model?.workload || model?.requirements?.workload || 'sequence.embedding.v1';
  const vectorHash = execution?.vectorHash || execution?.embeddingHash || null;
  const sequenceResult = execution?.sequenceResult || null;
  const sequenceResultHash = execution?.sequenceResultHash || null;
  let sequence = null;
  if (isSequenceWorkload(outputKind)) {
    if (!sequenceResult || !sequenceResultHash) throw new Error('sequence execution result and hash are required');
    if (await hashJson(sequenceResult) !== sequenceResultHash) throw new Error('sequence result hash mismatch');
    if (sequenceResult.workload !== outputKind) throw new Error('sequence result workload mismatch');
    if (sequenceResult.sequenceHash !== assignment.inputHash) throw new Error('sequence result input hash mismatch');
    const requestHash = assignment.sequenceRequestHash || await hashJson(assignment.sequenceRequest || null);
    sequence = {
      ...sequenceResult,
      requestHash,
      resultHash: sequenceResultHash
    };
  }
  const transcript = execution?.transcript || {
    outputKind,
    outputText,
    tokenIds,
    vectorHash,
    sequenceResultHash,
    sequenceResult
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
    routeDecisionHash: assignment.routeDecisionHash || null,
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
    sequenceResultHash,
    sequence,
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
    dopplerEvidenceComparison: execution?.dopplerEvidenceComparison || null,
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
    sequenceResultHash: agreement.sequenceResultHash || null,
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
